import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_MESSAGE_MAX_CHARS,
  FEEDBACK_CONTEXT_MAX,
  cleanContextField,
  validateFeedbackRequest,
} from "./feedback-validation.mjs";

test("rejects an empty / whitespace / missing message", () => {
  for (const message of ["", "   ", "\n\t ", undefined, null, 42, {}]) {
    const res = validateFeedbackRequest({ message });
    assert.equal(res.ok, false);
    assert.equal(res.code, "bad_request");
    assert.ok(res.message.length > 0);
  }
});

test("rejects a message over the length cap (documented code)", () => {
  const res = validateFeedbackRequest({
    message: "x".repeat(FEEDBACK_MESSAGE_MAX_CHARS + 1),
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "payload_too_large"); // wire-stable
});

test("accepts a message exactly at the cap", () => {
  const res = validateFeedbackRequest({
    message: "x".repeat(FEEDBACK_MESSAGE_MAX_CHARS),
  });
  assert.equal(res.ok, true);
  assert.equal(res.value.message.length, FEEDBACK_MESSAGE_MAX_CHARS);
});

test("trims the message and accepts the `feedback` alias", () => {
  const res = validateFeedbackRequest({ feedback: "  tolles Tool!  " });
  assert.equal(res.ok, true);
  assert.equal(res.value.message, "tolles Tool!");
});

test("normalises optional context, dropping empties to null", () => {
  const res = validateFeedbackRequest({
    message: "Gut",
    sessionId: "  sess-1 ",
    conversationId: "thread-2",
    tier: " anonymous ",
    email: " Max@Example.de ",
    page: "/produkte/rack",
    extra: "ignored",
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, {
    message: "Gut",
    sessionId: "sess-1",
    conversationId: "thread-2",
    tier: "anonymous",
    email: "Max@Example.de", // case preserved — feedback context, not a key
    page: "/produkte/rack",
  });
});

test("missing context fields become null", () => {
  const res = validateFeedbackRequest({ message: "Hi" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, {
    message: "Hi",
    sessionId: null,
    conversationId: null,
    tier: null,
    email: null,
    page: null,
  });
});

test("cleanContextField trims, caps length, and nulls empties", () => {
  assert.equal(cleanContextField("  abc  ", 10), "abc");
  assert.equal(cleanContextField("abcdef", 3), "abc");
  assert.equal(cleanContextField("   ", 10), null);
  assert.equal(cleanContextField(123, 10), null);
  assert.equal(cleanContextField(undefined, 10), null);
});

test("over-long context values are capped, not rejected", () => {
  const res = validateFeedbackRequest({
    message: "Hi",
    page: "/".repeat(FEEDBACK_CONTEXT_MAX.page + 50),
  });
  assert.equal(res.ok, true);
  assert.equal(res.value.page.length, FEEDBACK_CONTEXT_MAX.page);
});
