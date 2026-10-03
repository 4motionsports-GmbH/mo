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
//
// REPLAYED ORDER DATA: the output of `get_order_status` (the signed-in
// customer's order status, lib/order-status.ts) is never replayed as sent by
// the client. Its output is replaced with `{ replayed: true }` — so the model
// re-queries for current facts instead of repeating stale ones, a shared
// device's later visitor cannot read them back out of a resent history, and a
// forged history cannot inject "order data" that looks like a real tool
// result. The input is reduced to the schema's two fields.

const INCOMPLETE_TOOL_STATES = new Set(["input-streaming", "input-available"]);

/** Tools whose replayed OUTPUT is never trusted (see above). */
export const NON_REPLAYABLE_OUTPUT_TOOLS = new Set(["get_order_status"]);

/** What the model sees in place of a replayed get_order_status result. */
export const REPLAYED_OUTPUT = Object.freeze({ replayed: true });

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
    let changed = false;
    const parts = [];
    for (const part of message.parts) {
      if (!isToolPart(part)) {
        parts.push(part);
        continue;
      }
      const p = /** @type {{ state?: unknown, input?: unknown }} */ (part);
      if (typeof p.state === "string" && INCOMPLETE_TOOL_STATES.has(p.state)) {
        changed = true;
        continue;
      }
      if (!isPlainObject(p.input)) {
        changed = true;
        continue;
      }
      const name = toolNameOf(part);
      if (name && NON_REPLAYABLE_OUTPUT_TOOLS.has(name)) {
        parts.push(/** @type {typeof part} */ (replayedPart(part, name)));
        changed = true;
        continue;
      }
      parts.push(part);
    }
    return changed ? { ...message, parts } : message;
  });
}

/** @param {{ type: string, toolName?: unknown }} part */
function toolNameOf(part) {
  if (part.type === "dynamic-tool") return typeof part.toolName === "string" ? part.toolName : null;
  return part.type.slice("tool-".length);
}

/**
 * A completed get_order_status part rebuilt from scratch: the call stays (so
 * the conversation still shows that Mo looked it up), the output becomes
 * REPLAYED_OUTPUT whatever state the client claims (output-available,
 * output-error, …), and only the schema's input fields survive.
 *
 * @param {any} part
 * @param {string} name
 */
function replayedPart(part, name) {
  const input = /** @type {Record<string, unknown>} */ (part.input);
  /** @type {Record<string, unknown>} */
  const safeInput = {};
  if (typeof input.topic === "string") safeInput.topic = input.topic.slice(0, 20);
  if (typeof input.orderRef === "string") safeInput.orderRef = input.orderRef.slice(0, 40);
  return {
    type: part.type,
    ...(part.type === "dynamic-tool" ? { toolName: name } : {}),
    toolCallId: part.toolCallId,
    state: "output-available",
    input: safeInput,
    output: REPLAYED_OUTPUT,
  };
}
