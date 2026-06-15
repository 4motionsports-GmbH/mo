import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyAppProxySignature,
  evaluateAppProxyAuth,
} from "./shopify-app-proxy.mjs";

const SECRET = "hush-test-secret";

// Compute a VALID Shopify App Proxy signature for a set of params, using the same
// algorithm the verifier expects (sorted `key=value`, no separator, HMAC-SHA256
// hex). Returns the params object WITH the signature added, so a round-trip test
// proves the verifier accepts exactly what Shopify would send.
function sign(params, secret = SECRET) {
  const base = Object.keys(params)
    .sort()
    .map((k) => `${k}=${Array.isArray(params[k]) ? params[k].join(",") : params[k]}`)
    .join("");
  const signature = createHmac("sha256", secret).update(base).digest("hex");
  return { ...params, signature };
}

test("verifyAppProxySignature accepts a correctly-signed request", () => {
  const signed = sign({
    shop: "motionsports.myshopify.com",
    path_prefix: "/apps/chat",
    timestamp: "1700000000",
    logged_in_customer_id: "123456789",
    session: "sess-widget-1",
  });
  assert.equal(verifyAppProxySignature(signed, SECRET), true);
  // URLSearchParams form (how the route reads it) verifies identically.
  assert.equal(verifyAppProxySignature(new URLSearchParams(signed), SECRET), true);
});

test("verifyAppProxySignature rejects a tampered param (signature no longer covers it)", () => {
  const signed = sign({
    shop: "motionsports.myshopify.com",
    path_prefix: "/apps/chat",
    timestamp: "1700000000",
    logged_in_customer_id: "123456789",
  });
  // An attacker swaps in a different customer id but keeps the old signature.
  const tampered = { ...signed, logged_in_customer_id: "999999999" };
  assert.equal(verifyAppProxySignature(tampered, SECRET), false);
});

test("verifyAppProxySignature fails closed on missing signature / wrong or blank secret", () => {
  const signed = sign({ shop: "x", timestamp: "1" });
  const { signature, ...unsigned } = signed;
  void signature;
  assert.equal(verifyAppProxySignature(unsigned, SECRET), false, "no signature");
  assert.equal(verifyAppProxySignature(signed, "wrong-secret"), false, "wrong secret");
  assert.equal(verifyAppProxySignature(signed, ""), false, "blank secret");
  assert.equal(verifyAppProxySignature(signed, null), false, "no secret");
});

test("evaluateAppProxyAuth: signed + logged in → ok with the trusted customer id + session", () => {
  const signed = sign({
    shop: "motionsports.myshopify.com",
    path_prefix: "/apps/chat",
    timestamp: "1700000000",
    logged_in_customer_id: "123456789",
    session: "sess-widget-1",
  });
  const res = evaluateAppProxyAuth(signed, SECRET);
  assert.deepEqual(res, {
    ok: true,
    shopifyCustomerId: "123456789",
    sessionId: "sess-widget-1",
  });
});

test("evaluateAppProxyAuth: signed but logged OUT (empty id) → not_logged_in (fail closed)", () => {
  const signed = sign({
    shop: "motionsports.myshopify.com",
    path_prefix: "/apps/chat",
    timestamp: "1700000000",
    logged_in_customer_id: "", // Shopify includes the param empty when logged out
    session: "sess-widget-1",
  });
  assert.deepEqual(evaluateAppProxyAuth(signed, SECRET), {
    ok: false,
    reason: "not_logged_in",
  });
});

test("evaluateAppProxyAuth: bad signature → bad_signature, never trusts the id", () => {
  const res = evaluateAppProxyAuth(
    { logged_in_customer_id: "123456789", signature: "deadbeef" },
    SECRET
  );
  assert.deepEqual(res, { ok: false, reason: "bad_signature" });
});

test("evaluateAppProxyAuth: a non-numeric (forged) id is rejected even if signed", () => {
  const signed = sign({ logged_in_customer_id: "not-a-number", timestamp: "1" });
  assert.deepEqual(evaluateAppProxyAuth(signed, SECRET), {
    ok: false,
    reason: "not_logged_in",
  });
});

test("evaluateAppProxyAuth: a non-positive id (\"0\") is rejected — never binds customer 0", () => {
  const signed = sign({ logged_in_customer_id: "0", timestamp: "1" });
  assert.deepEqual(evaluateAppProxyAuth(signed, SECRET), {
    ok: false,
    reason: "not_logged_in",
  });
});
