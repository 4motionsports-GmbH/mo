// POST /api/account/marketing-opt-in — the AT-SIGN-IN marketing opt-in.
//
// PRESENTATION-MAXIMISED, FULLY LAWFUL. A signed-in (tier-3) customer opts into
// marketing without re-typing their email: we already hold their VERIFIED
// Shopify address, so the account removes ONLY the "type your email" step. The
// consent itself is unchanged from the in-chat capture flow:
//
//   * NO auto-enrol / NO pre-tick — the widget renders an UNCHECKED box and the
//     customer must actively tick it. We still require `marketingConsent: true`
//     in the body; without it we refuse (a Shopify account NEVER implies
//     consent).
//   * runs the EXISTING double-opt-in: this only sets DOI 'pending' and sends
//     the confirmation email. NO marketing is permitted until the customer
//     clicks that link (GET /api/confirm-marketing).
//   * stores the exact label + footer shown verbatim as `consent_text_shown`
//     with the same `consent_copy_version` stamp (v3), so the Art. 7 audit is
//     identical to the typed-email path. Withdrawable via the same unsubscribe.
//
// Gated by the standard signed-in guard (origin + secret + live access token).

import { requireSignedInCustomer, readSession } from "@/lib/account-guard";
import { preflightResponse } from "@/lib/security";
import { errorResponse, reportError } from "@/lib/observability";
import { resolveConsentCopyVersion } from "@/lib/consent-copy-version.mjs";
import { upsertEmailCapture } from "@/lib/email-capture-store";
import { isEmailAlreadySubscribed, recordMoOptIn } from "@/lib/consent-flows";
import { getCustomerById, linkCustomerOnEmailCapture } from "@/lib/customer-store";
import { sendEmail, senderAddress } from "@/lib/email";
import { outboundThreading } from "@/lib/email-inbound";
import { recordSentMessage } from "@/lib/email-messages-store";
import { getBaseUrl } from "@/lib/base-url";
import { resolveLocale } from "@/lib/locale";
import { apiMessage } from "@/lib/api-messages.mjs";
import {
  doiEmailSubject,
  doiEmailBody,
  signInMarketingConsentCopy,
  signInVariantsActive,
} from "@/lib/consent-copy";
import { isKnownSigninVariant, normalizePlacement, pickSigninVariant } from "@/lib/consent-variants.mjs";
import { doiSentField, optInAnswer } from "@/lib/capture-funnel.mjs";
import { withEmailDesign } from "@/lib/email-design-context";
import { getCachedEmailDesignForKind } from "@/lib/email-design-store";
import {
  KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN,
  KPI_EMAIL_CAPTURE_SUBMITTED,
  recordKpiEvent,
} from "@/lib/kpi-events";

export const maxDuration = 30;

const ALLOWED_METHODS = "POST, OPTIONS";

// A synthetic placeholder email (no verified address — sign-in without an email
// claim) can't receive a real DOI / marketing mail; refuse the opt-in for it.
const SYNTHETIC_EMAIL_PREFIX = "shopify:";

interface OptInPayload {
  marketingConsent?: unknown;
  consentTextShown?: unknown;
  locale?: unknown;
  /** Where the ask was shown (popup | signin_return | value_moment), telemetry only. */
  placement?: unknown;
  /** The served framing variant id, echoed (telemetry only; never a 400). */
  variant?: unknown;
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req, ALLOWED_METHODS);
}

function okJson(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export async function POST(req: Request) {
  const guard = await requireSignedInCustomer(req, ALLOWED_METHODS);
  if (!guard.ok) return guard.response;
  const headers = guard.headers;

  try {
    let payload: OptInPayload;
    try {
      payload = (await req.json()) as OptInPayload;
    } catch {
      return errorResponse("bad_request", apiMessage("invalid_json", resolveLocale(req)), 400, headers);
    }

    const locale = resolveLocale(req, payload.locale);

    // Explicit affirmative act required — the endpoint NEVER enrols on its own.
    if (payload.marketingConsent !== true) {
      return errorResponse(
        "marketing_consent_required",
        apiMessage("marketing_consent_required", locale),
        400,
        headers
      );
    }

    // Use the customer's VERIFIED, consent-anchored email — the whole point is
    // that the signed-in customer never re-types it.
    const customer = await getCustomerById(guard.customerId);
    if (!customer) {
      return errorResponse("not_found", apiMessage("customer_not_found", locale), 404, headers);
    }
    const email = customer.email;
    if (!email || email.startsWith(SYNTHETIC_EMAIL_PREFIX)) {
      return errorResponse(
        "no_verified_email",
        apiMessage("no_verified_email", locale),
        422,
        headers
      );
    }

    const sessionId = readSession(req);
    const consentTextShown =
      typeof payload.consentTextShown === "string" ? payload.consentTextShown : null;

    // Attest the v3 sign-in copy only when the echoed text is byte-identical to
    // the canonical SIGN-IN string (label + footer); anything else → NULL
    // (honest "unattested"; the verbatim text stays authoritative).
    const consentCopyVersion = resolveConsentCopyVersion(
      consentTextShown,
      signInMarketingConsentCopy(locale).consentTextShown
    );

    // Same upsert + DOI machinery as /api/capture-email — only the email source
    // differs. transactionalConsent stays false (no summary requested here); the
    // DB OR-merges it so an existing transactional consent is never downgraded.
    // ONE consent (docs/archive/CUSTOMER_PLATFORM_PLAN.md §7): an address already
    // subscribed — via Shopify or an earlier DOI — gets no second DOI mail.
    const alreadySubscribed = await isEmailAlreadySubscribed(email);

    const capture = await upsertEmailCapture({
      sessionId,
      email,
      transactionalConsent: false,
      marketingConsent: true,
      consentTextShown,
      consentCopyVersion,
      locale,
      alreadySubscribed,
    });
    if (!capture) {
      return errorResponse(
        "upstream_unavailable",
        apiMessage("consent_save_failed", locale),
        503,
        headers
      );
    }

    // Attach the current conversation + sync the customer's mirrored consent.
    // GREATEST(identity_tier, 2) never downgrades this signed-in (tier-3) row.
    await linkCustomerOnEmailCapture({ email, sessionId });
    // Report the act to the one consent (pending until the DOI link is
    // clicked; nothing goes to Shopify before that).
    await recordMoOptIn({
      email,
      surface: "mo_signin",
      captureId: capture.id,
      doiPending: capture.doiEmailRequired,
      signInProof: guard.proof,
    });

    // Send the DOI confirmation email — only when newly pending (an already
    // confirmed address re-opting in doesn't re-send; a suppressed address is
    // never pended, so it never gets one). NO marketing until the link is
    // clicked.
    let doiEmailSent = false;
    if (capture.doiEmailRequired && capture.doiToken) {
      const confirmUrl = `${getBaseUrl(req)}/api/confirm-marketing?token=${encodeURIComponent(capture.doiToken)}&locale=${locale}`;
      // Render inside the design selected for this email type (admin
      // Einstellungen); null → classic built-ins. The lawyer-approved DOI copy
      // itself is untouched — only the design around it changes.
      const emailDesign = await getCachedEmailDesignForKind("doi");
      const body = withEmailDesign(emailDesign, () => doiEmailBody(confirmUrl, locale));
      const threading = outboundThreading();
      const doiResult = await sendEmail({
        to: email,
        subject: doiEmailSubject(locale),
        text: body.text,
        html: body.html,
        kind: "doi",
        messageId: threading.messageId,
        replyTo: threading.replyTo,
      });
      doiEmailSent = doiResult.ok;
      // MIRROR-WRITE (additive, fail-soft): log the DOI mail as correspondence.
      if (doiResult.ok) {
        await recordSentMessage({
          toAddress: email,
          fromAddress: senderAddress() ?? "",
          subject: doiEmailSubject(locale),
          bodyText: body.text,
          bodyHtml: body.html,
          messageId: threading.messageId,
        });
      }
      if (!doiResult.ok && !doiResult.skipped) {
        // The pending consent is stored; the user just didn't get the link. Log
        // it (they can re-request) rather than failing the whole opt-in.
        reportError(doiResult.error, {
          route: "api/account/marketing-opt-in",
          phase: "doi_send",
        });
      }
    }

    // The answer the widget gets, computed once (also for the telemetry): an
    // address subscribed elsewhere keeps doiStatus none/pending but is answered
    // as already confirmed. A suppressed address is answered neutrally —
    // status none, never „already subscribed“, never „DOI mail sent“ (OI1 F2;
    // capture-funnel.mjs → optInAnswer, tested).
    const answer = optInAnswer({
      suppressed: capture.suppressed,
      subscribedElsewhere: capture.subscribedElsewhere,
      marketingDoiStatus: capture.marketingDoiStatus,
      doiEmailRequired: capture.doiEmailRequired,
      doiEmailSent,
    });

    // Funnel telemetry (pseudonymous, session-keyed — NO email in the data),
    // tagged so the opt-in surface can be split out from the in-chat capture.
    // placement / variant only when they are known values (OI3). Written after
    // the send attempt, so the opt-in says whether its DOI mail went out
    // (`doiSent`, OI1 F3).
    const placement = normalizePlacement(payload.placement);
    const variant =
      typeof payload.variant === "string" && isKnownSigninVariant(payload.variant, locale) ? payload.variant : null;
    const optInData: Record<string, unknown> = {
      trigger: "signin_optin",
      source: "mo_signin",
      ...(capture.optInOutcome ? { outcome: capture.optInOutcome } : {}),
      alreadyConfirmed: answer.alreadyConfirmed,
      doiRequired: capture.doiEmailRequired,
      ...(placement ? { placement } : {}),
      ...(variant ? { variant } : {}),
      ...(variant && signInVariantsActive(locale) && variant !== pickSigninVariant(sessionId, locale, process.env.CONSENT_SIGNIN_VARIANTS).id
        ? { variantMismatch: true }
        : {}),
    };
    await recordKpiEvent({
      sessionId,
      event: KPI_EMAIL_CAPTURE_SUBMITTED,
      data: { marketingConsent: true, ...optInData },
    });
    await recordKpiEvent({
      sessionId,
      event: KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN,
      data: { doiStatus: capture.marketingDoiStatus, ...optInData, ...doiSentField(capture.optInOutcome, doiEmailSent) },
    });

    return okJson({ ok: true, marketing: answer }, headers);
  } catch (err) {
    reportError(err, { route: "api/account/marketing-opt-in" });
    return errorResponse("internal_error", "Unexpected server error", 500, headers);
  }
}
