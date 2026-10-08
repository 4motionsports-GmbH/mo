// POST /api/chat-marketing-opt-in — the CHAT CONSENT GATE accept (added with copy v4).
//
// Marketing-ONLY opt-in with a typed email, for ANONYMOUS chat sessions: the
// widget shows the consent gate once per session after the user's first chat
// message (copy from GET /api/consent-copy?surface=chat) and POSTs here on the
// explicit "Ja, Angebote aktivieren" tap. Deliberately NOT /api/capture-email:
// that endpoint hard-requires the transactional tick (its form exists to send
// the summary) and its audit string covers both consents — neither fits a
// marketing-only signup.
//
// The consent itself is unchanged from every other marketing path:
//
//   * BUTTON-CONSENT (lawyer-approved July 2026): the served label + footer are
//     fully visible, nothing is pre-selected, and decline is equally reachable.
//     We still require `marketingConsent: true` in the body — the widget only
//     sends it on the actual accept tap; without it we refuse.
//   * runs the EXISTING double-opt-in: this only sets DOI 'pending' and sends
//     the confirmation email. NO marketing is permitted until the user clicks
//     that link (GET /api/confirm-marketing). One DOI mail per address within
//     MARKETING_DOI_RESEND_COOLDOWN_MINUTES, also for parallel requests
//     (email-capture-store.ts); none when the shop's own confirmation mail is
//     out (C.29, Mo's mirror).
//   * stores the exact label + footer shown verbatim as `consent_text_shown`
//     with the same `consent_copy_version` stamp (CONSENT_COPY_VERSION,
//     currently v5), so the Art. 7 audit is identical to the other surfaces.
//     Withdrawable via the same unsubscribe.
//
// The capture is recorded against the session (session_id on the upsert +
// linkCustomerOnEmailCapture) exactly like /api/capture-email, so the
// returning-customer memory verification on /api/chat
// (wasEmailCapturedFromSession) passes for a gate-captured email too.
//
// Guards like /api/capture-email: origin allowlist + x-ms-chat-key +
// x-ms-session, chat rate bucket, plus the per-RECIPIENT send cap so the
// endpoint can't be used as an email-bombing relay.

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, checkRateLimitKeyed, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { isValidEmail } from "@/lib/capture-validation.mjs";
import { resolveConsentCopyVersion } from "@/lib/consent-copy-version.mjs";
import { releaseDoiClaim, upsertEmailCapture } from "@/lib/email-capture-store";
import { isDoiOptInRecorded, shouldReleaseDoiClaim } from "@/lib/email-capture-core.mjs";
import { isEmailAlreadySubscribed, recordMoOptIn } from "@/lib/consent-flows";
import { mirrorConsentForEmail } from "@/lib/shopify-optin-precheck";
import { linkCustomerOnEmailCapture } from "@/lib/customer-store";
import { sendDoiMail, type DoiSendState } from "@/lib/doi-mail";
import { getBaseUrl } from "@/lib/base-url";
import { resolveLocale } from "@/lib/locale";
import { apiMessage } from "@/lib/api-messages.mjs";
import { chatGateMarketingConsentCopy } from "@/lib/consent-copy";
import { doiCooldownField, doiSentField, optInAnswer } from "@/lib/capture-funnel.mjs";
import {
  KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN,
  KPI_EMAIL_CAPTURE_SUBMITTED,
  recordKpiEvent,
} from "@/lib/kpi-events";

export const maxDuration = 30;

/** The gate's one trigger marker (server-set; LEGACY_SOURCE_TRIGGERS in capture-funnel.mjs). */
const CHAT_GATE_TRIGGER = "chat_gate";

interface ChatOptInPayload {
  sessionId?: unknown;
  email?: unknown;
  marketingConsent?: unknown;
  consentTextShown?: unknown;
  locale?: unknown;
  // Echo of the surface moment ("chat_gate"). Accepted for compatibility;
  // the events always store the server-set marker, never the client text.
  trigger?: unknown;
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

    let payload: ChatOptInPayload;
    try {
      payload = (await req.json()) as ChatOptInPayload;
    } catch {
      return errorResponse("bad_request", apiMessage("invalid_json", resolveLocale(req)), 400, headers);
    }

    const locale = resolveLocale(req, payload.locale);
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const sessionId =
      typeof payload.sessionId === "string" && payload.sessionId.trim()
        ? payload.sessionId.trim()
        : req.headers.get("x-ms-session");
    const consentTextShown =
      typeof payload.consentTextShown === "string" ? payload.consentTextShown : null;

    if (!isValidEmail(email)) {
      return errorResponse("invalid_email", apiMessage("invalid_email", locale), 400, headers);
    }

    // Explicit affirmative act required — the gate NEVER enrols on its own.
    // The widget only sends true on the actual accept tap.
    if (payload.marketingConsent !== true) {
      return errorResponse(
        "marketing_consent_required",
        apiMessage("marketing_consent_required", locale),
        400,
        headers
      );
    }

    // Per-recipient abuse cap (same as /api/capture-email): the session bucket
    // above is keyed by a client-supplied header an attacker can rotate, so
    // additionally cap how many DOI sends a single RECIPIENT address can
    // receive. Stops the gate being used as an email-bombing relay.
    const recipientRl = await checkRateLimitKeyed(
      "capture-recipient",
      `email:${email.toLowerCase()}`
    );
    if (!recipientRl.ok) return rateLimitResponse(recipientRl.retryAfter, headers);

    // Attest the current chat-gate copy (CONSENT_COPY_VERSION) only when the
    // echoed text is byte-identical to the canonical CHAT string (label +
    // footer) of the served locale; anything else → NULL
    // (honest "unattested"; the verbatim text stays authoritative).
    const consentCopyVersion = resolveConsentCopyVersion(
      consentTextShown,
      chatGateMarketingConsentCopy(locale).consentTextShown
    );

    // Same upsert + DOI machinery as /api/capture-email — marketing only, no
    // summary requested. transactionalConsent stays false; the DB OR-merges it
    // so an existing transactional consent is never downgraded. The session id
    // is recorded on the capture, which is what the /api/chat returning-
    // customer memory gate verifies (wasEmailCapturedFromSession).
    // ONE consent (docs/archive/CUSTOMER_PLATFORM_PLAN.md §7): an address already
    // subscribed — via Shopify or an earlier DOI — gets no second DOI mail;
    // nor does one whose shop sign-up still awaits the shop's own confirmation
    // mail (C.29 — Mo's mirror only, no Shopify call for a typed address).
    const mirror = await mirrorConsentForEmail(email);
    const alreadySubscribed = (await isEmailAlreadySubscribed(email)) || mirror.subscribed;

    const capture = await upsertEmailCapture({
      sessionId,
      email,
      transactionalConsent: false,
      marketingConsent: true,
      consentTextShown,
      consentCopyVersion,
      locale,
      alreadySubscribed,
      pendingElsewhere: mirror.shopifyPendingFresh,
    });
    if (!capture) {
      return errorResponse(
        "upstream_unavailable",
        apiMessage("consent_save_failed", locale),
        503,
        headers
      );
    }

    // Customer linking, same as /api/capture-email: find-or-create the customer
    // for this email, attach the current conversation, bump last_seen_at.
    // Best-effort — a linking failure must not block the DOI email.
    await linkCustomerOnEmailCapture({ email, sessionId });

    // Send the DOI confirmation email — only when this request claimed it (a
    // pending DOI mailed within the cooldown, an already confirmed or
    // subscribed address and a suppressed one get none). A claim whose mail
    // did not go out is released, so the next accept sends at once. NO
    // marketing until the link is clicked.
    let doiSend: DoiSendState = "none";
    try {
      if (capture.doiEmailRequired && capture.doiToken) {
        doiSend = await sendDoiMail({
          email,
          token: capture.doiToken,
          locale,
          baseUrl: getBaseUrl(req),
          route: "api/chat-marketing-opt-in",
        });
      }
    } finally {
      if (shouldReleaseDoiClaim(capture.doiEmailRequired, doiSend)) await releaseDoiClaim(capture);
    }
    const doiEmailSent = doiSend === "sent";

    // Report the act to the one consent (pending until the DOI link is
    // clicked; nothing goes to Shopify before that) — only once the DOI mail
    // went out.
    await recordMoOptIn({
      email,
      surface: "mo_chat_gate",
      captureId: capture.id,
      doiPending: isDoiOptInRecorded(capture.doiEmailRequired, doiSend),
    });

    // Funnel telemetry (pseudonymous, session-keyed — NO email in the data),
    // tagged with the gate's server-set trigger so the surface splits out in
    // the funnel. Written after the send attempt, like the other two routes,
    // so the opt-in says whether its DOI mail went out (`doiSent`) or why
    // none was due (`doiCooldown`).
    const outcome = capture.optInOutcome;
    await recordKpiEvent({
      sessionId,
      event: KPI_EMAIL_CAPTURE_SUBMITTED,
      data: {
        marketingConsent: true,
        trigger: CHAT_GATE_TRIGGER,
        source: "mo_chat_gate",
        ...(outcome ? { outcome } : {}),
      },
    });
    await recordKpiEvent({
      sessionId,
      event: KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN,
      data: {
        doiStatus: capture.marketingDoiStatus,
        trigger: CHAT_GATE_TRIGGER,
        source: "mo_chat_gate",
        ...(outcome ? { outcome } : {}),
        ...doiSentField(outcome, doiEmailSent),
        ...doiCooldownField(outcome, capture.doiCooldown),
        ...(capture.doiResend ? { doiResend: true } : {}),
      },
    });

    return okJson(
      {
        ok: true,
        // The same answer as the other opt-in routes (capture-funnel.mjs →
        // optInAnswer, tested): a suppressed address neutral (OI1 F2);
        // already confirmed / subscribed → alreadyConfirmed; a valid
        // confirmation mail already out → pending + doiEmailSent.
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
  } catch (err) {
    reportError(err, { route: "api/chat-marketing-opt-in" });
    return errorResponse("internal_error", "Unexpected server error", 500, headers);
  }
}
