// Sanitize the client-resent chat history before it is converted for the
// model. Kept in plain .mjs (pure, no I/O) so it is trivially unit-testable
// with node:test and shared by the TS chat route — mirroring the
// email-offer-trigger.mjs convention.
//
// WHY THIS EXISTS: the widget resends the FULL message history on every turn,
// including whatever state an earlier turn was left in when its stream was
// aborted (page closed, network drop) or when the model produced a tool input
// that failed schema validation. Two kinds of debris in that history make the
// Anthropic call itself blow up (Sentry: AI_APICallError
// "tool_use.input: Input should be an object"):
//
//   1. INCOMPLETE tool parts (state "input-streaming"/"input-available"):
//      every tool in this app executes server-side, so a part persisted
//      without an output can only be an aborted call. Resending it produces a
//      tool_use block with undefined/partial input and no paired tool_result.
//   2. NON-OBJECT inputs: for "output-error" parts the AI SDK falls back to
//      `rawInput` — the raw, unparsed model text (a string) when the input
//      failed validation. Anthropic requires tool_use.input to be an object.
//
// Both are debris of a call the model never completed a round-trip on;
// dropping the part (never the whole message) is lossless for the
// conversation and keeps the remaining history exactly as rendered.

const INCOMPLETE_TOOL_STATES = new Set(["input-streaming", "input-available"]);

/** @param {{ type?: unknown }} part */
function isToolPart(part) {
  return (
    typeof part.type === "string" &&
    (part.type.startsWith("tool-") || part.type === "dynamic-tool")
  );
}

/** @param {unknown} value */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Drop assistant tool parts that cannot be replayed to the provider: parts in
 * an incomplete state (aborted stream — the call never executed) and parts
 * whose `input` is not a plain object (corrupted / failed-validation input
 * that the provider would reject). Non-tool parts and non-assistant messages
 * pass through untouched; messages are never removed, only thinned.
 *
 * @template {{ role: string, parts?: Array<{ type: string }> }} M
 * @param {M[]} messages
 * @returns {M[]}
 */
export function sanitizeToolParts(messages) {
  return messages.map((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.parts)) {
      return message;
    }
    const parts = message.parts.filter((part) => {
      if (!isToolPart(part)) return true;
      const p = /** @type {{ state?: unknown, input?: unknown }} */ (part);
      if (typeof p.state === "string" && INCOMPLETE_TOOL_STATES.has(p.state)) {
        return false;
      }
      return isPlainObject(p.input);
    });
    return parts.length === message.parts.length ? message : { ...message, parts };
  });
}
