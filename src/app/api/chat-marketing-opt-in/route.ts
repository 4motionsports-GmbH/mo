// POST /api/chat-marketing-opt-in — the CHAT CONSENT GATE accept (v4).
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
//     that link (GET /api/confirm-marketing).
//   * stores the exact label + footer shown verbatim as `consent_text_shown`
//     with the same `consent_copy_version` stamp (v4), so the Art. 7 audit is
//     identical to the other surfaces. Withdrawable via the same unsubscribe.
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
import { upsertEmailCapture } from "@/lib/email-capture-store";
import { linkCustomerOnEmailCapture } from "@/lib/customer-store";
import { sendEmail, senderAddress } from "@/lib/email";
import { outboundThreading } from "@/lib/email-inbound";
import { recordSentMessage } from "@/lib/email-messages-store";
import { getBaseUrl } from "@/lib/base-url";
import { resolveLocale } from "@/lib/locale";
import { apiMessage } from "@/lib/api-messages.mjs";
import {
  doiEmailSubject,
  doiEmailBody,
  chatGateMarketingConsentCopy,
} from "@/lib/consent-copy";
import { withEmailTheme } from "@/lib/email-theme-context";
import { getCachedThemeForKind } from "@/lib/email-theme-store";
import {
  KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN,
  KPI_EMAIL_CAPTURE_SUBMITTED,
  recordKpiEvent,
} from "@/lib/kpi-events";

export const maxDuration = 30;

const MAX_TRIGGER_CHARS = 40;

interface ChatOptInPayload {
  sessionId?: unknown;
  email?: unknown;
  marketingConsent?: unknown;
  consentTextShown?: unknown;
  locale?: unknown;
  // Echo of the surface moment ("chat_gate"). Telemetry-only — never stored
  // with the consent record.
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
    const trigger =
      typeof payload.trigger === "string"
        ? payload.trigger.trim().slice(0, MAX_TRIGGER_CHARS) || null
        : null;

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

    // Attest the v4 chat-gate copy only when the echoed text is byte-identical
    // to the canonical CHAT string (label + footer); anything else → NULL
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
    const capture = await upsertEmailCapture({
      sessionId,
      email,
      transactionalConsent: false,
      marketingConsent: true,
      consentTextShown,
      consentCopyVersion,
      locale,
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

    // Funnel telemetry (pseudonymous, session-keyed — NO email in the data),
    // tagged with the gate trigger so the surface splits out in the funnel.
    await recordKpiEvent({
      sessionId,
      event: KPI_EMAIL_CAPTURE_SUBMITTED,
      data: { marketingConsent: true, trigger: trigger ?? "chat_gate" },
    });
    await recordKpiEvent({
      sessionId,
      event: KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN,
      data: { doiStatus: capture.marketingDoiStatus, trigger: trigger ?? "chat_gate" },
    });

    // Send the DOI confirmation email — only when newly pending (a suppressed
    // address is never re-pended; an already-confirmed one isn't re-sent). NO
    // marketing until the link is clicked.
    let doiEmailSent = false;
    if (capture.doiEmailRequired && capture.doiToken) {
      const confirmUrl = `${getBaseUrl(req)}/api/confirm-marketing?token=${encodeURIComponent(capture.doiToken)}&locale=${locale}`;
      // Render inside the operator-assigned design template (admin
      // Einstellungen); null → built-in default. The lawyer-approved DOI copy
      // itself is untouched — only the shell chrome is themed.
      const emailTheme = await getCachedThemeForKind("doi");
      const body = withEmailTheme(emailTheme, () => doiEmailBody(confirmUrl, locale));
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
          route: "api/chat-marketing-opt-in",
          phase: "doi_send",
        });
      }
    }

    return okJson(
      {
        ok: true,
        marketing: {
          status: capture.marketingDoiStatus,
          doiEmailSent,
          // True when the address was already confirmed (re-opt-in) — no DOI needed.
          alreadyConfirmed:
            capture.marketingDoiStatus === "confirmed" && !capture.doiEmailRequired,
        },
      },
      headers
    );
  } catch (err) {
    reportError(err, { route: "api/chat-marketing-opt-in" });
    return errorResponse("internal_error", "Unexpected server error", 500, headers);
  }
}
