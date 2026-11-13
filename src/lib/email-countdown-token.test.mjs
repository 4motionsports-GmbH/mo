import { test } from "node:test";
import assert from "node:assert/strict";
import { countdownSecret, signCountdownColors, signCountdownToken, verifyCountdownColors, verifyCountdownToken } from "./email-countdown-token.mjs";
import { countdownLookQuery, parseCountdownColors, parseCountdownLabel } from "./email-countdown-image.mjs";

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

test("colour signature: binds the canonical colour query to the token", () => {
  const token = signCountdownToken({ expiresAt: "2026-11-30T22:59:00Z", language: "de" }, "s3cret");
  const query = "bg=111111&tile=292929&digit=ffd400&label=a1a1a1";
  const sig = signCountdownColors(token, query, "s3cret");
  assert.match(sig, /^[A-Za-z0-9_-]{22}$/, "URL-safe, fixed length");
  assert.equal(verifyCountdownColors(token, query, sig, "s3cret"), true);
  // other colours, another token, another secret, a cut or missing signature: refused
  assert.equal(verifyCountdownColors(token, query.replace("ffd400", "ff0000"), sig, "s3cret"), false);
  const other = signCountdownToken({ expiresAt: "2026-12-01T22:59:00Z", language: "de" }, "s3cret");
  assert.equal(verifyCountdownColors(other, query, sig, "s3cret"), false);
  assert.equal(verifyCountdownColors(token, query, sig, "other"), false);
  assert.equal(verifyCountdownColors(token, query, sig.slice(0, -1), "s3cret"), false);
  assert.equal(verifyCountdownColors(token, query, null, "s3cret"), false);
  assert.equal(verifyCountdownColors(token, query, sig, undefined), false);
  // nothing to sign: no colours, no token, no secret
  assert.equal(signCountdownColors(token, "", "s3cret"), null);
  assert.equal(signCountdownColors("", query, "s3cret"), null);
  assert.equal(signCountdownColors(token, query, undefined), null);
});

test("the label rides under the same signature: nobody can write a text of their own on the picture", () => {
  const token = signCountdownToken({ expiresAt: "2026-11-30T22:59:00Z", language: "de" }, "s3cret");
  const colors = { bg: "#111111", tile: "#292929", digit: "#ffd400", label: "#a1a1a1" };
  const signed = countdownLookQuery(colors, { text: "Nur noch kurz" });
  const sig = signCountdownColors(token, signed, "s3cret");
  assert.equal(verifyCountdownColors(token, signed, sig, "s3cret"), true);
  // another text, no text, the label hidden — each needs its own signature
  for (const label of [{ text: "Gratis für alle" }, null, { hidden: true }]) {
    assert.equal(verifyCountdownColors(token, countdownLookQuery(colors, label), sig, "s3cret"), false, JSON.stringify(label));
  }
  // the colours alone sign exactly as before the label existed
  assert.equal(signCountdownColors(token, countdownLookQuery(colors), "s3cret"), signCountdownColors(token, "bg=111111&tile=292929&digit=ffd400&label=a1a1a1", "s3cret"));
  // what the route recomputes from a request equals what the mail signed
  const params = new URLSearchParams(`w=m&${signed}&cs=${sig}`);
  assert.equal(verifyCountdownColors(token, countdownLookQuery(parseCountdownColors(params), parseCountdownLabel(params)), params.get("cs"), "s3cret"), true);
});
