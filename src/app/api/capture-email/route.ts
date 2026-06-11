// POST /api/capture-email — GDPR email capture + double-opt-in entry point.
//
// Body: { sessionId, email, transactionalConsent, marketingConsent, consentTextShown }
//
//   - Validates the email and that transactional consent is present (we can't
//     email a summary without consent to email the summary).
//   - Upserts one consent record per address (records consent_text_shown for
//     the Art. 7 audit trail).
//   - transactionalConsent → sends the summary email immediately (the service
//     the user requested; lawful under Art. 6(1)(b)).
//   - marketingConsent → sets marketing_doi_status='pending', issues a DOI
//     token, and sends a confirmation email. NO marketing is permitted until
//     the user clicks that link. A suppressed/unsubscribed address is never
//     re-pended.
//
// Defensive: an email-send failure is logged AND surfaced in the response
// (never silently lost). The summary send failing returns 502; the DOI send
// failing is reported per-channel without losing the (successful) capture.

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import {
  isValidEmail,
  upsertEmailCapture,
} from "@/lib/email-capture-store";
import { linkCustomerOnEmailCapture } from "@/lib/customer-store";
import { sendEmail } from "@/lib/email";
import { sendSummaryEmail } from "@/lib/summary-email";
import { getBaseUrl } from "@/lib/base-url";
import {
  DOI_EMAIL_SUBJECT,
  doiEmailBody,
} from "@/lib/consent-copy";

export const maxDuration = 30;

interface CapturePayload {
  sessionId?: unknown;
  email?: unknown;
  transactionalConsent?: unknown;
  marketingConsent?: unknown;
  consentTextShown?: unknown;
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
      return errorResponse("bad_request", "Ungültiger JSON-Body", 400, headers);
    }

    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const transactionalConsent = payload.transactionalConsent === true;
    const marketingConsent = payload.marketingConsent === true;
    const sessionId =
      typeof payload.sessionId === "string" && payload.sessionId.trim()
        ? payload.sessionId.trim()
        : req.headers.get("x-ms-session");
    const consentTextShown =
      typeof payload.consentTextShown === "string" ? payload.consentTextShown : null;

    if (!isValidEmail(email)) {
      return errorResponse("bad_request", "Ungültige E-Mail-Adresse", 400, headers);
    }
    // You can't email a summary without consent to email the summary.
    if (!transactionalConsent) {
      return errorResponse(
        "bad_request",
        "Transaktionale Einwilligung ist erforderlich, um die Zusammenfassung zu senden.",
        400,
        headers
      );
    }

    const capture = await upsertEmailCapture({
      sessionId,
      email,
      transactionalConsent,
      marketingConsent,
      consentTextShown,
    });
    if (!capture) {
      // No DB configured (or the write failed) — we cannot store the consent,
      // which is the whole point of this endpoint. Be honest rather than
      // pretend-success.
      return errorResponse(
        "upstream_unavailable",
        "Einwilligung konnte nicht gespeichert werden — bitte später erneut versuchen.",
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

    const baseUrl = getBaseUrl(req);

    // 1) Transactional summary email — send immediately (the requested service).
    const summary = await sendSummaryEmail({ sessionId, email });
    // `skipped` means Resend isn't configured (local dev) — not a real failure.
    const summarySkipped = summary.result.ok === false && summary.result.skipped;
    if (!summary.sent && !summarySkipped) {
      // A real delivery failure: surface it. The consent is already stored.
      return errorResponse(
        "upstream_unavailable",
        "Die Zusammenfassung konnte nicht zugestellt werden.",
        502,
        headers
      );
    }

    // 2) Marketing double-opt-in confirmation email — only when newly pending.
    let doiEmailSent = false;
    if (capture.doiEmailRequired && capture.doiToken) {
      const confirmUrl = `${baseUrl}/api/confirm-marketing?token=${encodeURIComponent(capture.doiToken)}`;
      const body = doiEmailBody(confirmUrl);
      const doiResult = await sendEmail({
        to: email,
        subject: DOI_EMAIL_SUBJECT,
        text: body.text,
        html: body.html,
        kind: "doi",
      });
      doiEmailSent = doiResult.ok;
      if (!doiResult.ok && !doiResult.skipped) {
        // DOI send failed for real. The pending capture stays, the user just
        // didn't get the link — report it; the user can re-request. We do NOT
        // fail the whole request, since the transactional summary already went.
        reportError(doiResult.error, {
          route: "api/capture-email",
          phase: "doi_send",
        });
      }
    }

    return okJson(
      {
        ok: true,
        transactional: { summarySent: summary.sent || summarySkipped },
        marketing: {
          status: capture.marketingDoiStatus,
          doiEmailSent,
          // True once the user is already confirmed (re-submission) — no DOI needed.
          alreadyConfirmed: capture.marketingDoiStatus === "confirmed" && !capture.doiEmailRequired,
        },
      },
      headers
    );
  } catch (err) {
    reportError(err, { route: "api/capture-email" });
    return errorResponse("internal_error", "Unexpected server error", 500, headers);
  }
}
