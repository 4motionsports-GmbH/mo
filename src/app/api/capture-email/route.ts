// POST /api/capture-email — GDPR email capture + double-opt-in entry point.
//
// Body: { sessionId, email, transactionalConsent, marketingConsent, consentTextShown }
//
//   - Validates the email and that transactional consent is present (we can't
//     email a summary without consent to email the summary). With consent
//     copy v2 BOTH boxes start unchecked, so a missing transactional consent
//     is rejected with the documented `transactional_consent_required` code.
//   - Upserts one consent record per address (records consent_text_shown plus
//     the consent_copy_version stamp for the Art. 7 audit trail).
//   - transactionalConsent → sends the summary email immediately (the service
//     the user requested; lawful under Art. 6(1)(b)).
//   - marketingConsent → sets marketing_doi_status='pending', issues a DOI
//     token, and sends a confirmation email. NO marketing is permitted until
//     the user clicks that link. A suppressed/unsubscribed address is never
//     re-pended. One DOI mail per address within MARKETING_DOI_RESEND_
//     COOLDOWN_MINUTES, also for parallel requests (email-capture-store.ts);
//     none when the shop's own confirmation mail is out (C.29, Mo's mirror).
//
// Defensive: an email-send failure is logged AND surfaced in the response
// (never silently lost). The summary send failing returns 502; the DOI send
// failing is reported per-channel without losing the (successful) capture.
// The DOI mail goes out before the summary; a claim whose mail did not go out
// (failed, or an error before the send) is released right after the attempt,
// so the next accept sends at once. The marketing opt-in KPI event is written
// right after the send attempt too (on an early exit: in `finally`), so it
// records whether the DOI mail went out (OI1 F3) and exists before the link can
// be clicked.

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, checkRateLimitKeyed, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { validateCaptureRequest } from "@/lib/capture-validation.mjs";
import { resolveConsentCopyVersion } from "@/lib/consent-copy-version.mjs";
import { releaseDoiClaim, upsertEmailCapture } from "@/lib/email-capture-store";
import { isDoiOptInRecorded, shouldReleaseDoiClaim } from "@/lib/email-capture-core.mjs";
import { isEmailAlreadySubscribed, recordMoOptIn } from "@/lib/consent-flows";
import { mirrorConsentForEmail } from "@/lib/shopify-optin-precheck";
import { linkCustomerOnEmailCapture } from "@/lib/customer-store";
import { sendDoiMail, type DoiSendState } from "@/lib/doi-mail";
import { sendSummaryEmail } from "@/lib/summary-email";
import { getBaseUrl } from "@/lib/base-url";
import { resolveLocale } from "@/lib/locale";
import { apiMessage } from "@/lib/api-messages.mjs";
import { captureConsentCopy } from "@/lib/consent-copy";
import {
  KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN,
  KPI_EMAIL_CAPTURE_SUBMITTED,
  recordKpiEvent,
} from "@/lib/kpi-events";
import { doiCooldownField, doiSentField, optInAnswer, storedOfferTrigger } from "@/lib/capture-funnel.mjs";

export const maxDuration = 30;

const MAX_TRIGGER_CHARS = 40;

interface CapturePayload {
  sessionId?: unknown;
  email?: unknown;
  transactionalConsent?: unknown;
  marketingConsent?: unknown;
  consentTextShown?: unknown;
  // Optional echo of the offer_email_summary `trigger` input — the value
  // moment the capture card was shown at. Telemetry-only (never stored with
  // the consent record), so the opt-in funnel can be split by trigger.
  trigger?: unknown;
  // Storefront-selected language ("de" default, "en" on /en). Carried so the
  // summary + DOI emails and the consent audit string match what was shown.
  locale?: unknown;
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

function okJson(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export async function POST(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const headers = corsHeaders(guard.origin);

  try {
    const rl = await checkRateLimit(req, "chat");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, headers);

    let payload: CapturePayload;
    try {
      payload = (await req.json()) as CapturePayload;
    } catch {
      // No body parsed yet → fall back to the header/query locale for the error.
      return errorResponse("bad_request", apiMessage("invalid_json", resolveLocale(req)), 400, headers);
    }

    const locale = resolveLocale(req, payload.locale);
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const transactionalConsent = payload.transactionalConsent === true;
    const marketingConsent = payload.marketingConsent === true;
    const sessionId =
      typeof payload.sessionId === "string" && payload.sessionId.trim()
        ? payload.sessionId.trim()
        : req.headers.get("x-ms-session");
    const consentTextShown =
      typeof payload.consentTextShown === "string" ? payload.consentTextShown : null;
    const trigger =
      typeof payload.trigger === "string"
        ? payload.trigger.trim().slice(0, MAX_TRIGGER_CHARS) || null
        : null;

    // You can't email a summary without consent to email the summary. With
    // copy v2 BOTH boxes start unchecked, so a no-transactional submit is a
    // real user state — rejected with the dedicated, documented code
    // `transactional_consent_required` (the widget shows a targeted hint).
    const validation = validateCaptureRequest(
      {
        email,
        transactionalConsent: payload.transactionalConsent,
      },
      locale
    );
    if (!validation.ok) {
      return errorResponse(validation.code, validation.message, 400, headers);
    }

    // Per-recipient abuse cap: the session bucket above is keyed by a client-
    // supplied header an attacker can rotate, so additionally cap how many sends
    // a single RECIPIENT address can receive (keyed by the email, lower-cased).
    // Stops this endpoint being used as an email-bombing relay against a victim.
    const recipientRl = await checkRateLimitKeyed(
      "capture-recipient",
      `email:${email.toLowerCase()}`
    );
    if (!recipientRl.ok) return rateLimitResponse(recipientRl.retryAfter, headers);

    // Audit-trail version stamp: attest the served copy version only when the
    // echoed consentTextShown is byte-identical to the canonical string the
    // backend currently serves; anything else stores NULL (the verbatim text
    // itself remains the authoritative Art. 7 record).
    const consentCopyVersion = resolveConsentCopyVersion(
      consentTextShown,
      captureConsentCopy(locale).consentTextShown
    );

    // ONE consent (docs/archive/CUSTOMER_PLATFORM_PLAN.md §7): an address already
    // subscribed — via Shopify or an earlier DOI — gets no second DOI mail;
    // nor does one whose shop sign-up still awaits the shop's own confirmation
    // mail (C.29 — Mo's mirror only, no Shopify call for a typed address).
    const mirror = marketingConsent ? await mirrorConsentForEmail(email) : null;
    const alreadySubscribed = marketingConsent
      ? (await isEmailAlreadySubscribed(email)) || mirror?.subscribed === true
      : false;

    const capture = await upsertEmailCapture({
      sessionId,
      email,
      transactionalConsent,
      marketingConsent,
      consentTextShown,
      consentCopyVersion,
      locale,
      alreadySubscribed,
      pendingElsewhere: mirror?.shopifyPendingFresh === true,
    });
    if (!capture) {
      // No DB configured (or the write failed) — we cannot store the consent,
      // which is the whole point of this endpoint. Be honest rather than
      // pretend-success.
      return errorResponse(
        "upstream_unavailable",
        apiMessage("consent_save_failed", locale),
        503,
        headers
      );
    }

    // Customer linking: find-or-create the customer for this email, attach the
    // current conversation, bump last_seen_at. An email that already exists
    // means a RETURNING customer — this session becomes another entry under the
    // same customer. Best-effort (never throws): the consent is already stored,
    // and a linking failure must not block the summary/DOI emails.
    await linkCustomerOnEmailCapture({ email, sessionId });

    // Funnel telemetry (pseudonymous, session-keyed — NO email in the data).
    // `submitted` is emitted as soon as the consent is stored, so a downstream
    // summary-send failure (502 below) can't lose the fact that the user
    // submitted. source = the surface (server-set); outcome = what the tick
    // led to; the client's trigger echo is stored only when it is a tool value
    // (OI1).
    const outcome = capture.optInOutcome;
    const storedTrigger = storedOfferTrigger(trigger);
    await recordKpiEvent({
      sessionId,
      event: KPI_EMAIL_CAPTURE_SUBMITTED,
      data: {
        marketingConsent,
        source: "mo_capture_form",
        ...(outcome ? { outcome } : {}),
        ...(storedTrigger ? { trigger: storedTrigger } : {}),
      },
    });

    const baseUrl = getBaseUrl(req);
    let doiSend: DoiSendState = "none";

    // A claimed DOI whose mail did not go out — the send failed or an
    // unexpected error came first — is released, so the next accept sends at
    // once instead of waiting out the cooldown. Right after the send attempt,
    // and again (a no-op then) on every exit.
    let claimSettled = false;
    const releaseUnsentClaim = async () => {
      if (claimSettled) return;
      claimSettled = true;
      if (shouldReleaseDoiClaim(capture.doiEmailRequired, doiSend)) await releaseDoiClaim(capture);
    };
    // The marketing opt-in event, written once the DOI send is decided —
    // before the summary, and on any exit before that point — so it says
    // whether the DOI mail actually went out (`doiSent`, OI1 F3) or why none
    // was due (`doiCooldown`, T2.1), and exists before the link can be clicked.
    let optInEventWritten = false;
    const writeOptInEvent = async () => {
      if (optInEventWritten || !marketingConsent) return;
      optInEventWritten = true;
      await recordKpiEvent({
        sessionId,
        event: KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN,
        data: {
          doiStatus: capture.marketingDoiStatus,
          source: "mo_capture_form",
          ...(outcome ? { outcome } : {}),
          ...doiSentField(outcome, doiSend === "sent"),
          ...doiCooldownField(outcome, capture.doiCooldown),
          ...(capture.doiResend ? { doiResend: true } : {}),
          // The capture this opt-in belongs to (an id, no address): the DOI click
          // is attributed to the opt-in that sent its mail, also across devices.
          captureId: capture.id,
          ...(storedTrigger ? { trigger: storedTrigger } : {}),
        },
      });
    };

    try {
      // 1) Marketing double-opt-in confirmation email — first, before the
      // summary: the summary (an LLM call, the cart, a second send) can take
      // long, and a claim held across it would answer every parallel or
      // retried accept „confirmation mail is out“ before any mail went (and,
      // if the function were cut off, for the whole cooldown). Only when this
      // request claimed it (none within the cooldown after an earlier DOI
      // mail, for a confirmed / subscribed / suppressed address, or when the
      // shop's own confirmation mail is out). A failed send is reported,
      // never fails the request, and its claim is released below.
      if (capture.doiEmailRequired && capture.doiToken) {
        doiSend = await sendDoiMail({
          email,
          token: capture.doiToken,
          locale,
          baseUrl,
          route: "api/capture-email",
        });
      }
      const doiEmailSent = doiSend === "sent";
      await releaseUnsentClaim();

      // Report the act to the one consent (pending until the DOI link is
      // clicked; nothing goes to Shopify before that) — only once the DOI mail
      // went out, and before the summary, so a summary failure cannot lose it.
      await recordMoOptIn({
        email,
        surface: "mo_capture_form",
        captureId: capture.id,
        doiPending: isDoiOptInRecorded(capture.doiEmailRequired, doiSend),
      });
      await writeOptInEvent();

      // 2) Transactional summary email — the requested service.
      const summary = await sendSummaryEmail({ sessionId, email, locale });
      // `skipped` means Resend isn't configured (local dev) — not a real failure.
      const summarySkipped = summary.result.ok === false && summary.result.skipped;
      if (!summary.sent && !summarySkipped) {
        // A real delivery failure: surface it. The consent is stored and a
        // DOI mail that went out stays valid (a retry within the cooldown is
        // answered „confirmation mail is out“).
        return errorResponse(
          "upstream_unavailable",
          apiMessage("summary_delivery_failed", locale),
          502,
          headers
        );
      }

      return okJson(
        {
          ok: true,
          transactional: { summarySent: summary.sent || summarySkipped },
          // A suppressed address is answered neutrally — status none, never
          // „already subscribed“, never „DOI mail sent“ (OI1 F2).
          // alreadyConfirmed: the user is already confirmed (re-submission) —
          // no DOI needed. A valid confirmation mail already out (Mo within
          // the cooldown, or the shop's) reads pending + doiEmailSent
          // (capture-funnel.mjs → optInAnswer, tested).
          marketing: optInAnswer({
            suppressed: capture.suppressed,
            subscribedElsewhere: capture.subscribedElsewhere,
            pendingElsewhere: capture.pendingElsewhere,
            marketingDoiStatus: capture.marketingDoiStatus,
            doiEmailRequired: capture.doiEmailRequired,
            doiEmailSent,
            doiCooldown: capture.doiCooldown,
          }),
        },
        headers
      );
    } finally {
      await releaseUnsentClaim();
      await writeOptInEvent();
    }
  } catch (err) {
    reportError(err, { route: "api/capture-email" });
    return errorResponse("internal_error", "Unexpected server error", 500, headers);
  }
}
