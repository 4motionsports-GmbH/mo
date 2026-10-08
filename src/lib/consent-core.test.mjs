import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveEmailConsent,
  legacyMarketingStatus,
  consentLabel,
  isHardBlock,
} from "./consent-core.mjs";

const none = { state: "not_subscribed", level: null, at: null, source: null };
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-02-01T00:00:00.000Z";
const T3 = "2026-03-01T00:00:00.000Z";

test("a Mo DOI confirm subscribes and is pushed to Shopify", () => {
  const d = resolveEmailConsent(none, { state: "subscribed", level: "confirmed_opt_in", at: T1, source: "mo_chat_gate" });
  assert.equal(d.changed, true);
  assert.deepEqual(d.next, { state: "subscribed", level: "confirmed_opt_in", at: T1, source: "mo_chat_gate" });
  assert.equal(d.effects.pushToShopify, true);
  assert.equal(d.effects.markSynced, false);
});

test("a Shopify subscribe is mirrored, never pushed back", () => {
  const d = resolveEmailConsent(none, { state: "subscribed", level: "single_opt_in", at: T1, source: "shopify" });
  assert.equal(d.changed, true);
  assert.equal(d.next.level, "single_opt_in");
  assert.equal(d.effects.pushToShopify, false);
  assert.equal(d.effects.markSynced, true);
});

test("echo of the same state is a no-op that marks the mirror in sync", () => {
  const cur = { state: "subscribed", level: "confirmed_opt_in", at: T1, source: "mo" };
  const d = resolveEmailConsent(cur, { state: "subscribed", level: "confirmed_opt_in", at: T2, source: "shopify" });
  assert.equal(d.changed, false);
  assert.equal(d.outcome, "echo");
  assert.equal(d.effects.markSynced, true);
});

test("a subscription without a level echoes an unknown-level subscription", () => {
  const cur = { state: "subscribed", level: "unknown", at: T1, source: "shopify" };
  const d = resolveEmailConsent(cur, { state: "subscribed", level: null, at: T1, source: "shopify" });
  assert.equal(d.outcome, "echo");
});

test("the newer act wins in both directions", () => {
  const sub = { state: "subscribed", level: "confirmed_opt_in", at: T1, source: "mo" };
  const unsub = resolveEmailConsent(sub, { state: "unsubscribed", at: T2, source: "shopify" });
  assert.equal(unsub.changed, true);
  assert.equal(unsub.next.state, "unsubscribed");
  assert.equal(unsub.effects.suppress, "unsubscribe");
  assert.equal(unsub.effects.pushToShopify, false);

  const cur = { state: "unsubscribed", level: null, at: T2, source: "mo", suppression: "unsubscribe" };
  const resub = resolveEmailConsent(cur, { state: "subscribed", level: "single_opt_in", at: T3, source: "shopify" });
  assert.equal(resub.changed, true);
  assert.equal(resub.effects.liftSuppression, true);
});

test("an older Shopify value loses and Mo's newer state is pushed back", () => {
  const cur = { state: "unsubscribed", level: null, at: T3, source: "mo", suppression: "unsubscribe" };
  const d = resolveEmailConsent(cur, { state: "subscribed", level: "single_opt_in", at: T1, source: "shopify" });
  assert.equal(d.changed, false);
  assert.equal(d.outcome, "stale");
  assert.equal(d.effects.pushToShopify, true);
});

test("an undated Shopify value never overrides a dated Mo state", () => {
  const cur = { state: "subscribed", level: "confirmed_opt_in", at: T2, source: "mo_signin" };
  const d = resolveEmailConsent(cur, { state: "not_subscribed", at: null, source: "shopify" });
  assert.equal(d.changed, false);
  assert.equal(d.effects.pushToShopify, true);
});

test("a DOI expiry is never pushed over the shop's own pending (C.29 heal rule)", () => {
  // expirePendingConsents reset a Shopify-sourced pending to not_subscribed (source 'mo').
  const expired = { state: "not_subscribed", level: null, at: T3, source: "mo" };
  const d = resolveEmailConsent(expired, { state: "pending", level: null, at: T1, source: "shopify" });
  assert.equal(d.changed, false);
  assert.equal(d.outcome, "stale");
  assert.equal(d.effects.pushToShopify, false);
  // The same for an older Shopify subscribe / unsubscribe / not_subscribed.
  for (const state of ["subscribed", "unsubscribed", "not_subscribed"]) {
    const r = resolveEmailConsent(expired, { state, level: state === "subscribed" ? "single_opt_in" : null, at: T1, source: "shopify" });
    assert.equal(r.effects.pushToShopify, false, state);
  }
});

test("a Mo pending is never pushed back over an older Shopify value", () => {
  const pending = { state: "pending", level: null, at: T3, source: "mo_signin" };
  const d = resolveEmailConsent(pending, { state: "not_subscribed", at: T1, source: "shopify" });
  assert.equal(d.outcome, "stale");
  assert.equal(d.effects.pushToShopify, false);
});

test("Mo's subscribe and unsubscribe still heal an older Shopify value", () => {
  const sub = { state: "subscribed", level: "confirmed_opt_in", at: T3, source: "mo_chat_gate" };
  assert.equal(resolveEmailConsent(sub, { state: "pending", at: T1, source: "shopify" }).effects.pushToShopify, false); // rule 3: ignored
  assert.equal(resolveEmailConsent(sub, { state: "unsubscribed", at: T1, source: "shopify" }).effects.pushToShopify, true);
  const unsub = { state: "unsubscribed", level: null, at: T3, source: "admin", suppression: "manual" };
  assert.equal(resolveEmailConsent(unsub, { state: "pending", at: T1, source: "shopify" }).effects.pushToShopify, true);
  // A Shopify-sourced current state never heals (Shopify is not drifting from itself).
  const shopSub = { state: "subscribed", level: "single_opt_in", at: T3, source: "shopify" };
  assert.equal(resolveEmailConsent(shopSub, { state: "unsubscribed", at: T1, source: "shopify" }).effects.pushToShopify, false);
});

test("an undated value may fill an empty state", () => {
  const d = resolveEmailConsent(none, { state: "subscribed", level: "unknown", at: null, source: "shopify" });
  assert.equal(d.changed, true);
  assert.ok(d.next.at, "an applied act always carries a time");
});

test("equal timestamps resolve to the more restrictive state", () => {
  const cur = { state: "subscribed", level: "single_opt_in", at: T1, source: "shopify" };
  assert.equal(resolveEmailConsent(cur, { state: "unsubscribed", at: T1, source: "shopify" }).changed, true);
  const cur2 = { state: "unsubscribed", level: null, at: T1, source: "shopify" };
  assert.equal(resolveEmailConsent(cur2, { state: "subscribed", level: "single_opt_in", at: T1, source: "shopify" }).changed, false);
});

test("a pending DOI never overrides a live subscription", () => {
  const cur = { state: "subscribed", level: "single_opt_in", at: T1, source: "shopify" };
  const d = resolveEmailConsent(cur, { state: "pending", at: T2, source: "mo_chat_gate" });
  assert.equal(d.changed, false);
  assert.equal(d.outcome, "ignored");
});

test("pending is local and never pushed to Shopify", () => {
  const d = resolveEmailConsent(none, { state: "pending", at: T1, source: "mo_capture_form" });
  assert.equal(d.changed, true);
  assert.equal(d.effects.pushToShopify, false);
});

test("a complaint blocks every automatic re-subscribe", () => {
  const cur = { state: "unsubscribed", level: null, at: T1, source: "mo", suppression: "complaint" };
  const d = resolveEmailConsent(cur, { state: "subscribed", level: "confirmed_opt_in", at: T3, source: "shopify" });
  assert.equal(d.changed, false);
  assert.equal(d.outcome, "blocked");
});

test("an erasure block is lifted only by a newer act", () => {
  const cur = { state: "not_subscribed", level: null, at: null, source: null, suppression: "erasure", suppressionAt: T2 };
  const old = resolveEmailConsent(cur, { state: "subscribed", level: "single_opt_in", at: T1, source: "shopify" });
  assert.equal(old.outcome, "blocked");
  const fresh = resolveEmailConsent(cur, { state: "subscribed", level: "confirmed_opt_in", at: T3, source: "mo_chat_gate" });
  assert.equal(fresh.changed, true);
  assert.equal(fresh.effects.liftErasure, true);
});

test("admin withdrawals carry the manual reason; complaints keep theirs", () => {
  const sub = { state: "subscribed", level: "confirmed_opt_in", at: T1, source: "mo" };
  assert.equal(resolveEmailConsent(sub, { state: "unsubscribed", at: T2, source: "admin" }).effects.suppress, "manual");
  assert.equal(
    resolveEmailConsent(sub, { state: "unsubscribed", at: T2, source: "mo", reason: "complaint" }).effects.suppress,
    "complaint"
  );
});

test("invalid addresses become a bounce block without touching consent", () => {
  const sub = { state: "subscribed", level: "confirmed_opt_in", at: T1, source: "mo" };
  const d = resolveEmailConsent(sub, { state: "invalid", at: T2, source: "shopify" });
  assert.equal(d.changed, false);
  assert.equal(d.effects.suppress, "bounce");
});

test("labels and the legacy mirror", () => {
  assert.equal(legacyMarketingStatus("subscribed"), "confirmed");
  assert.equal(legacyMarketingStatus("not_subscribed"), "none");
  assert.equal(consentLabel("subscribed", "confirmed_opt_in"), "Angemeldet (DOI)");
  assert.equal(consentLabel("subscribed", "single_opt_in"), "Angemeldet (ohne DOI-Nachweis)");
  assert.equal(isHardBlock("erasure"), true);
  assert.equal(isHardBlock("unsubscribe"), false);
});
