import { test } from "node:test";
import assert from "node:assert/strict";
import { countdownSecret, signCountdownToken, verifyCountdownToken } from "./email-countdown-token.mjs";

test("round trip keeps deadline (to the second) and language", () => {
  const token = signCountdownToken({ expiresAt: "2026-09-12T21:59:30.500Z", language: "en" }, "s3cret");
  assert.ok(token && !token.includes("+") && !token.includes("/") && !token.includes("="), "URL-safe");
  assert.deepEqual(verifyCountdownToken(token, "s3cret"), { expiresAt: "2026-09-12T21:59:30.000Z", language: "en" });
  assert.equal(verifyCountdownToken(token, "other"), null, "wrong secret → null");
});

test("tampered or malformed tokens are rejected", () => {
  const token = signCountdownToken({ expiresAt: "2026-09-12T21:59:00Z" }, "s3cret");
  const [payload, sig] = token.split(".");
  assert.equal(verifyCountdownToken(`${payload}x.${sig}`, "s3cret"), null);
  assert.equal(verifyCountdownToken(`${payload}.${sig.slice(0, -2)}aa`, "s3cret"), null);
  assert.equal(verifyCountdownToken("nonsense", "s3cret"), null);
  assert.equal(verifyCountdownToken(token, undefined), null);
  assert.equal(signCountdownToken({ expiresAt: "garbage" }, "s3cret"), null);
  assert.equal(signCountdownToken({ expiresAt: "2026-09-12T21:59:00Z" }, undefined), null);
});

test("the secret falls back to the chat shared secret", () => {
  assert.equal(countdownSecret({ UNSUBSCRIBE_SECRET: "a", CHAT_SHARED_SECRET: "b" }), "a");
  assert.equal(countdownSecret({ CHAT_SHARED_SECRET: "b" }), "b");
  assert.equal(countdownSecret({}), undefined);
});
