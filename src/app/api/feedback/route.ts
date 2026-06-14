// POST /api/feedback — customer feedback capture from the storefront widget.
//
// A free-text comment plus OPTIONAL context (session/conversation, tier/email if
// the widget already has them, the page the user was on). Behind the SAME widget
// guard as the other public endpoints — origin allowlist + x-ms-chat-key shared
// secret + rate limit — and with light abuse protection: a dedicated, tight
// rate-limit bucket and a hard length cap on the message (validation layer).
//
// The comment is stored in the `feedback` table (migration 0020) and surfaced
// read-only in the admin FEEDBACK tab. NOTHING here grants any permission: an
// `email` in the body is user-supplied contact context for this comment (like
// /api/contact), never a consent record — the audit-grade consent trail stays in
// email_captures alone.

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { validateFeedbackRequest } from "@/lib/feedback-validation.mjs";
import { insertFeedback } from "@/lib/feedback-store";

export const maxDuration = 10;

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
    const rl = await checkRateLimit(req, "feedback");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, headers);

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return errorResponse("bad_request", "Ungültiger JSON-Body", 400, headers);
    }

    const validation = validateFeedbackRequest(payload);
    if (!validation.ok) {
      const status = validation.code === "payload_too_large" ? 413 : 400;
      return errorResponse(validation.code, validation.message, status, headers);
    }

    // Fall back to the session header when the body didn't carry one, so a
    // comment is still tied to its session even if the widget omitted it.
    const value = {
      ...validation.value,
      sessionId: validation.value.sessionId ?? req.headers.get("x-ms-session"),
    };

    const id = await insertFeedback(value);
    if (id == null) {
      // No DB configured (or the write failed) — storing the comment is the
      // whole point of this endpoint, so be honest rather than pretend success.
      return errorResponse(
        "upstream_unavailable",
        "Feedback konnte nicht gespeichert werden — bitte später erneut versuchen.",
        503,
        headers
      );
    }

    return okJson({ ok: true }, headers);
  } catch (err) {
    reportError(err, { route: "api/feedback" });
    return errorResponse("internal_error", "Unexpected server error", 500, headers);
  }
}
