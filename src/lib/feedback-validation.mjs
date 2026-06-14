// Validation + normalisation for POST /api/feedback — kept in plain .mjs (pure,
// no I/O) so it is trivially unit-testable with node:test and shared by the TS
// route, mirroring the capture-validation.mjs / email-offer-trigger.mjs
// convention.
//
// The feedback text is the only required field. Everything else is optional
// CONTEXT the widget attaches when it has it. Light abuse protection lives here:
// the message has a min (non-empty) and a hard max length, and every optional
// context field is length-capped so a single submission can never store an
// unbounded blob.

/** Max characters for the feedback text itself (longer is rejected, not cut). */
export const FEEDBACK_MESSAGE_MAX_CHARS = 4000;

/** Length caps for the optional context fields (over-long values are trimmed). */
export const FEEDBACK_CONTEXT_MAX = {
  sessionId: 128,
  conversationId: 128,
  tier: 40,
  email: 254,
  page: 1024,
};

/**
 * Coerce an unknown to a trimmed, length-capped string or null. Empty after
 * trimming → null. Non-strings → null.
 *
 * @param {unknown} value
 * @param {number} max
 * @returns {string | null}
 */
export function cleanContextField(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * Validate + normalise a feedback submission. Returns either
 * `{ ok: true, value }` with the cleaned, ready-to-store fields, or
 * `{ ok: false, code, message }` where `code` is a stable error-envelope code
 * and `message` a user-safe German string. The route maps a failure to its
 * documented HTTP status (400 / 413) verbatim.
 *
 * @param {unknown} input — the parsed JSON body (shape not yet trusted)
 * @returns {(
 *   { ok: true, value: { message: string, sessionId: string|null,
 *     conversationId: string|null, tier: string|null, email: string|null,
 *     page: string|null } }
 *   | { ok: false, code: "bad_request" | "payload_too_large", message: string }
 * )}
 */
export function validateFeedbackRequest(input) {
  const body = input && typeof input === "object" ? input : {};
  // Accept `message` (canonical) or `feedback` (friendlier alias) for the text.
  const raw =
    typeof body.message === "string"
      ? body.message
      : typeof body.feedback === "string"
        ? body.feedback
        : "";
  const message = raw.trim();

  if (!message) {
    return {
      ok: false,
      code: "bad_request",
      message: "Bitte gib zuerst dein Feedback ein.",
    };
  }
  if (message.length > FEEDBACK_MESSAGE_MAX_CHARS) {
    return {
      ok: false,
      code: "payload_too_large",
      message: `Dein Feedback ist zu lang (max. ${FEEDBACK_MESSAGE_MAX_CHARS} Zeichen).`,
    };
  }

  return {
    ok: true,
    value: {
      message,
      sessionId: cleanContextField(body.sessionId, FEEDBACK_CONTEXT_MAX.sessionId),
      conversationId: cleanContextField(
        body.conversationId,
        FEEDBACK_CONTEXT_MAX.conversationId
      ),
      tier: cleanContextField(body.tier, FEEDBACK_CONTEXT_MAX.tier),
      email: cleanContextField(body.email, FEEDBACK_CONTEXT_MAX.email),
      page: cleanContextField(body.page, FEEDBACK_CONTEXT_MAX.page),
    },
  };
}
