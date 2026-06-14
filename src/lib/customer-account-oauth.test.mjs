import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  base64url,
  generateCodeVerifier,
  codeChallengeS256,
  signState,
  verifyState,
  safeReturnUrl,
  withParams,
} from "./customer-account-oauth.mjs";

test("base64url has no +, /, or = padding", () => {
  const s = base64url(Buffer.from([251, 255, 191, 0, 1, 2, 3]));
  assert.ok(!/[+/=]/.test(s));
});

test("code_verifier is 43-char base64url, fresh each call", () => {
  const a = generateCodeVerifier();
  const b = generateCodeVerifier();
  assert.equal(a.length, 43);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(a));
  assert.notEqual(a, b);
});

test("S256 challenge equals base64url(SHA-256(verifier))", () => {
  const verifier = "test_verifier_value_123";
  const expected = base64url(createHash("sha256").update(verifier).digest());
  assert.equal(codeChallengeS256(verifier), expected);
});

test("signState/verifyState round-trips and rejects tampering", () => {
  const signingKey = "unit-test-signing-key";
  const state = "abc123randomstate";
  const signed = signState(state, signingKey);
  assert.equal(verifyState(signed, signingKey), state);

  // Tampered signature.
  assert.equal(verifyState(signed.slice(0, -1) + "X", signingKey), null);
  // Tampered payload.
  assert.equal(verifyState("zzz." + signed.split(".")[1], signingKey), null);
  // Wrong key.
  assert.equal(verifyState(signed, "different-key"), null);
  // Garbage.
  assert.equal(verifyState("no-dot", signingKey), null);
  assert.equal(verifyState("", signingKey), null);
});

test("safeReturnUrl only accepts allow-listed origins", () => {
  const allowed = ["https://www.motionsports.de", "https://motionsports.de"];
  assert.equal(
    safeReturnUrl("https://www.motionsports.de/pages/beratung", allowed),
    "https://www.motionsports.de/pages/beratung"
  );
  // Disallowed origin → null (open-redirect guard).
  assert.equal(safeReturnUrl("https://evil.example/phish", allowed), null);
  // Non-http(s) scheme → null.
  assert.equal(safeReturnUrl("javascript:alert(1)", allowed), null);
  // Garbage / empty.
  assert.equal(safeReturnUrl("not a url", allowed), null);
  assert.equal(safeReturnUrl("", allowed), null);
  assert.equal(safeReturnUrl(undefined, allowed), null);
});

test("withParams appends without clobbering existing query", () => {
  const out = withParams("https://account.example/oauth/authorize?x=1", {
    client_id: "cid",
    state: "s t/a=te",
  });
  const url = new URL(out);
  assert.equal(url.searchParams.get("x"), "1");
  assert.equal(url.searchParams.get("client_id"), "cid");
  assert.equal(url.searchParams.get("state"), "s t/a=te");
});
