import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeToolParts } from "./chat-message-sanitize.mjs";

// A healthy completed tool part exactly as the widget persists it after a
// successful server-side execution round-trip.
const completedToolPart = {
  type: "tool-show_product",
  toolCallId: "call_1",
  state: "output-available",
  input: { productId: "prod_1" },
  output: { ok: true },
};

const textPart = { type: "text", text: "Hier ist ein passendes Gerät:" };

function assistant(...parts) {
  return { id: "a1", role: "assistant", parts };
}

function user(text) {
  return { id: "u1", role: "user", parts: [{ type: "text", text }] };
}

test("healthy history passes through unchanged (same references)", () => {
  const messages = [user("Hallo"), assistant(textPart, completedToolPart)];
  const out = sanitizeToolParts(messages);
  assert.deepEqual(out, messages);
  // Untouched messages keep their identity — no needless copies.
  assert.equal(out[0], messages[0]);
  assert.equal(out[1], messages[1]);
});

test("drops incomplete tool parts left behind by an aborted stream", () => {
  for (const state of ["input-streaming", "input-available"]) {
    const out = sanitizeToolParts([
      user("Hallo"),
      assistant(textPart, {
        type: "tool-search_products",
        toolCallId: "call_2",
        state,
        input: { query: "Laufband" },
      }),
    ]);
    assert.deepEqual(
      out[1].parts,
      [textPart],
      `state=${state} must be dropped`
    );
  }
});

test("drops tool parts whose input is not a plain object", () => {
  // Sentry AI_APICallError "tool_use.input: Input should be an object": for
  // output-error parts the SDK falls back to rawInput (a string) when the
  // model's input failed validation; undefined/null/array inputs are the
  // aborted-persist variants of the same corruption.
  for (const input of [undefined, null, '{"productId": "prod', ["prod_1"], 42]) {
    const out = sanitizeToolParts([
      user("Hallo"),
      assistant(textPart, {
        type: "tool-show_product",
        toolCallId: "call_3",
        state: "output-error",
        input,
        rawInput: '{"productId": "prod',
        errorText: "Invalid input",
      }),
    ]);
    assert.deepEqual(
      out[1].parts,
      [textPart],
      `input=${JSON.stringify(input)} must be dropped`
    );
  }
});

test("keeps output-error parts whose input IS a valid object", () => {
  const errored = {
    type: "tool-add_to_cart",
    toolCallId: "call_4",
    state: "output-error",
    input: { productId: "prod_1" },
    errorText: "catalog timeout",
  };
  const out = sanitizeToolParts([user("Hallo"), assistant(errored)]);
  assert.deepEqual(out[1].parts, [errored]);
});

test("handles dynamic-tool parts by the same rules", () => {
  const out = sanitizeToolParts([
    assistant({
      type: "dynamic-tool",
      toolName: "search_products",
      toolCallId: "call_5",
      state: "input-available",
      input: { query: "Rack" },
    }),
  ]);
  assert.deepEqual(out[0].parts, []);
});

test("never touches user messages or non-tool parts", () => {
  const weirdUser = {
    id: "u2",
    role: "user",
    // A user message can never carry tool parts, but even if a client sent
    // one, we leave user messages alone.
    parts: [{ type: "tool-show_product", state: "input-streaming" }],
  };
  const out = sanitizeToolParts([weirdUser]);
  assert.equal(out[0], weirdUser);
});

test("messages without a parts array pass through", () => {
  const bare = { id: "a2", role: "assistant" };
  const out = sanitizeToolParts([bare]);
  assert.equal(out[0], bare);
});
