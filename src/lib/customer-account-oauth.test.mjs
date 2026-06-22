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
  withAuthMarker,
  isRevokedTokenError,
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

test("withAuthMarker stamps ?ms_auth=ok so the widget re-probes after sign-in", () => {
  // THE re-hydration signal: a successful callback must carry ?ms_auth=ok back to
  // the storefront return_url — the widget keys re-hydration on reading it.
  const out = withAuthMarker("https://www.motionsports.de/pages/beratung", "ok");
  const url = new URL(out);
  assert.equal(url.searchParams.get("ms_auth"), "ok");
  assert.equal(url.origin + url.pathname, "https://www.motionsports.de/pages/beratung");
});

test("withAuthMarker preserves existing query params and overwrites a stale ms_auth", () => {
  const out = withAuthMarker("https://www.motionsports.de/pages/beratung?utm=x&ms_auth=error", "ok");
  const url = new URL(out);
  assert.equal(url.searchParams.get("utm"), "x");
  assert.equal(url.searchParams.get("ms_auth"), "ok");
  // No duplicate ms_auth params (set, not append).
  assert.equal(url.searchParams.getAll("ms_auth").length, 1);
});

test("withAuthMarker carries the other markers and is defensive on a bad URL", () => {
  assert.equal(
    new URL(withAuthMarker("https://motionsports.de/", "login_required")).searchParams.get("ms_auth"),
    "login_required"
  );
  assert.equal(
    new URL(withAuthMarker("https://motionsports.de/", "logged_out")).searchParams.get("ms_auth"),
    "logged_out"
  );
  // Unparseable input → returned unchanged (never throws).
  assert.equal(withAuthMarker("not a url", "ok"), "not a url");
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

test("isRevokedTokenError detects a 401 (revoked/invalid token), not other failures", () => {
  // Typed status (what CustomerAccountApiError carries on a 401).
  assert.equal(isRevokedTokenError({ status: 401 }), true);
  assert.equal(isRevokedTokenError(Object.assign(new Error("x"), { status: 401 })), true);
  // Message fallback (robust even if the error wasn't wrapped with a status).
  assert.equal(
    isRevokedTokenError(
      new Error('Customer Account GraphQL 401: {"errors":[{"message":"Access token is invalid or revoked"}]}')
    ),
    true
  );
  assert.equal(isRevokedTokenError(new Error("Access token is invalid or revoked")), true);
  // NOT a revoked-token signal → keep the session (no false logout).
  assert.equal(isRevokedTokenError({ status: 500 }), false);
  assert.equal(isRevokedTokenError(new Error("network timeout")), false);
  assert.equal(isRevokedTokenError(new Error("Customer Account GraphQL 503: upstream")), false);
  assert.equal(isRevokedTokenError(null), false);
  assert.equal(isRevokedTokenError(undefined), false);
  assert.equal(isRevokedTokenError("401"), false);
});
