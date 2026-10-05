import { test } from "node:test";
import assert from "node:assert/strict";
import { shopRecognitionProof, decideShopRecognition, signedInProofFor, signInProofNote } from "./signed-in-proof.mjs";

test("shopRecognitionProof: shop, token, none", () => {
  assert.equal(shopRecognitionProof({ hasToken: false, shopProofHours: 24 }), "shop");
  assert.equal(shopRecognitionProof({ hasToken: true, shopProofHours: 0 }), "token");
  assert.equal(shopRecognitionProof({ hasToken: false, shopProofHours: 0 }), "none");
});

const base = { flagOn: true, shopProofHours: 0, hasToken: true, liveToken: true, linkedShopifyCustomerId: null, shopifyCustomerId: "7" };

test("decideShopRecognition: another customer's sign-in on the session → handover, before every other rule", () => {
  for (const flagOn of [true, false]) {
    const d = decideShopRecognition({ ...base, flagOn, linkedShopifyCustomerId: "8" });
    assert.equal(d.action, "handover");
    assert.equal(d.noCode, "handover");
    assert.equal(d.alreadySignedIn, false);
  }
});

test("decideShopRecognition: same customer → alreadySignedIn; token → issue", () => {
  const d = decideShopRecognition({ ...base, linkedShopifyCustomerId: "7" });
  assert.deepEqual(d, { action: "issue", proof: "token", hasToken: true, alreadySignedIn: true, noCode: null });
});

test("decideShopRecognition: flag off → no code (proof still reflects the token)", () => {
  const d = decideShopRecognition({ ...base, flagOn: false });
  assert.deepEqual(d, { action: "no_code", proof: "token", hasToken: true, alreadySignedIn: false, noCode: "flag_off" });
});

test("decideShopRecognition: no token and no shop proof → no_proof; shop proof → issue with hasToken kept", () => {
  assert.equal(decideShopRecognition({ ...base, hasToken: false, liveToken: false }).noCode, "no_proof");
  const d = decideShopRecognition({ ...base, hasToken: false, liveToken: false, shopProofHours: 24 });
  assert.deepEqual(d, { action: "issue", proof: "shop", hasToken: false, alreadySignedIn: false, noCode: null });
  // A token that exists but is not live (exact check) gives no proof.
  assert.equal(decideShopRecognition({ ...base, liveToken: false }).noCode, "no_proof");
});

const NOW = Date.parse("2026-10-05T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

test("signedInProofFor: kinds and the shop window", () => {
  assert.equal(signedInProofFor({ linkKind: "customer_account", authenticatedAt: null, nowMs: NOW, shopProofHours: 0 }), "token");
  for (const linkKind of ["email", "legacy", "x", null]) {
    assert.equal(signedInProofFor({ linkKind, authenticatedAt: hoursAgo(1), nowMs: NOW, shopProofHours: 24 }), null);
  }
  assert.equal(signedInProofFor({ linkKind: "app_proxy", authenticatedAt: hoursAgo(1), nowMs: NOW, shopProofHours: 0 }), "token");
  assert.equal(signedInProofFor({ linkKind: "app_proxy", authenticatedAt: hoursAgo(1), nowMs: NOW, shopProofHours: 24 }), "shop");
  assert.equal(signedInProofFor({ linkKind: "app_proxy", authenticatedAt: new Date(NOW - 3_600_000), nowMs: NOW, shopProofHours: 24 }), "shop");
  assert.equal(signedInProofFor({ linkKind: "app_proxy", authenticatedAt: hoursAgo(25), nowMs: NOW, shopProofHours: 24 }), "token");
  assert.equal(signedInProofFor({ linkKind: "app_proxy", authenticatedAt: new Date(NOW + 120_000).toISOString(), nowMs: NOW, shopProofHours: 24 }), "token");
  assert.equal(signedInProofFor({ linkKind: "app_proxy", authenticatedAt: "garbage", nowMs: NOW, shopProofHours: 24 }), "token");
});

test("signInProofNote: both proofs, nothing else", () => {
  assert.equal(signInProofNote("token"), "Anmeldenachweis: Kundenkonto-Anmeldung im Chat");
  assert.equal(signInProofNote("shop"), "Anmeldenachweis: Shop-Login (App Proxy)");
  assert.equal(signInProofNote(null), null);
});
