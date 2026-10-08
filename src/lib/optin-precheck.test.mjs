import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideOptInPrecheck,
  needsShopifyConsentRead,
  isFreshConsentTime,
  isFreshShopifyPending,
  SHOPIFY_OPTIN_PRECHECK_MS,
  FUTURE_SKEW_MS,
} from "./optin-precheck.mjs";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const DAYS = 7;
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();
const none = { state: "not_subscribed", source: null, at: null, suppressed: false };
const decide = (mirror, live, liveStatus = live ? "ok" : "skipped") =>
  decideOptInPrecheck({ mirror, live, liveStatus, nowMs: NOW, freshDays: DAYS });

test("the live read runs only when Mo has no consent and the address is not blocked", () => {
  assert.equal(needsShopifyConsentRead({ mirrorState: "not_subscribed", suppressed: false }), true);
  assert.equal(needsShopifyConsentRead({ mirrorState: "not_subscribed", suppressed: true }), false);
  for (const s of ["subscribed", "pending", "unsubscribed", null, undefined]) {
    assert.equal(needsShopifyConsentRead({ mirrorState: s, suppressed: false }), false, String(s));
  }
  assert.equal(SHOPIFY_OPTIN_PRECHECK_MS, 1500);
});

// --- Rows where Shopify is not read -------------------------------------------

test("mirror subscribed → proceed, not read (the route's own check answers)", () => {
  const d = decide({ state: "subscribed", source: "shopify", at: daysAgo(30) }, null);
  assert.deepEqual(d, { route: "proceed", act: null, check: "skipped" });
});

test("mirror pending from Shopify within the window → shopify_pending without a read", () => {
  const d = decide({ state: "pending", source: "shopify", at: daysAgo(2) }, null);
  assert.deepEqual(d, { route: "shopify_pending", act: null, check: "mirror_pending" });
});

test("mirror pending from Shopify, older than the window or undated → proceed", () => {
  assert.deepEqual(decide({ state: "pending", source: "shopify", at: daysAgo(8) }, null), {
    route: "proceed",
    act: null,
    check: "mirror_pending_stale",
  });
  assert.equal(decide({ state: "pending", source: "shopify", at: null }, null).check, "mirror_pending_stale");
});

test("mirror pending from a Mo surface → proceed (the T2.1 cooldown decides)", () => {
  for (const source of ["mo_signin", "mo_capture_form", "mo_chat_gate", "mo"]) {
    assert.deepEqual(decide({ state: "pending", source, at: daysAgo(0) }, null), {
      route: "proceed",
      act: null,
      check: "skipped",
    });
  }
});

test("a suppressed address (any state) → proceed, not read (the store answers neutrally)", () => {
  for (const state of ["not_subscribed", "unsubscribed", "pending"]) {
    const d = decide({ state, source: "shopify", at: daysAgo(1), suppressed: true }, null);
    assert.deepEqual(d, { route: "proceed", act: null, check: "skipped" }, state);
  }
});

test("mirror unsubscribed → proceed, not read", () => {
  assert.equal(decide({ state: "unsubscribed", source: "mo", at: daysAgo(3) }, null).check, "skipped");
});

test("no mirror row (DB failure) → proceed / unavailable", () => {
  assert.deepEqual(decide(null, null, "skipped"), { route: "proceed", act: null, check: "unavailable" });
});

// --- Rows where Mo has no consent and Shopify is read --------------------------

test("Shopify SUBSCRIBED (any level) → already_subscribed with a subscribed act", () => {
  for (const level of ["confirmed_opt_in", "single_opt_in", "unknown"]) {
    const at = daysAgo(40);
    const d = decide(none, { state: "subscribed", level, at });
    assert.equal(d.route, "already_subscribed");
    assert.equal(d.check, "subscribed");
    assert.deepEqual(d.act, { state: "subscribed", level, at, source: "shopify" });
  }
});

test("Shopify PENDING within the window → shopify_pending with a pending act", () => {
  const at = daysAgo(1);
  const d = decide(none, { state: "pending", level: "confirmed_opt_in", at });
  assert.equal(d.route, "shopify_pending");
  assert.equal(d.check, "pending");
  assert.deepEqual(d.act, { state: "pending", level: "confirmed_opt_in", at, source: "shopify" });
  // The window's edge counts as fresh.
  assert.equal(decide(none, { state: "pending", level: null, at: daysAgo(7) }).route, "shopify_pending");
});

test("Shopify PENDING older than the window or undated → proceed (Mo's DOI), no act", () => {
  assert.deepEqual(decide(none, { state: "pending", level: null, at: daysAgo(7.01) }), {
    route: "proceed",
    act: null,
    check: "pending_stale",
  });
  assert.deepEqual(decide(none, { state: "pending", level: null, at: null }), {
    route: "proceed",
    act: null,
    check: "pending_stale",
  });
  assert.equal(decide(none, { state: "pending", level: null, at: "not a date" }).check, "pending_stale");
});

test("Shopify UNSUBSCRIBED → blocked with an unsubscribed act", () => {
  const at = daysAgo(10);
  const d = decide(none, { state: "unsubscribed", level: "single_opt_in", at });
  assert.equal(d.route, "blocked");
  assert.equal(d.check, "unsubscribed");
  assert.deepEqual(d.act, { state: "unsubscribed", level: "single_opt_in", at, source: "shopify" });
});

test("Shopify INVALID → blocked with an invalid act", () => {
  const at = daysAgo(5);
  const d = decide(none, { state: "invalid", level: null, at });
  assert.equal(d.route, "blocked");
  assert.equal(d.check, "invalid");
  assert.deepEqual(d.act, { state: "invalid", at, source: "shopify" });
});

test("Shopify NOT_SUBSCRIBED or REDACTED → proceed (Mo's DOI), no act", () => {
  for (const state of ["not_subscribed", "redacted"]) {
    assert.deepEqual(decide(none, { state, level: null, at: null }), {
      route: "proceed",
      act: null,
      check: "not_subscribed",
    });
  }
});

test("a read that ran but found no consent object → proceed / not_subscribed", () => {
  assert.deepEqual(decide(none, null, "ok"), { route: "proceed", act: null, check: "not_subscribed" });
});

test("no read (no Shopify id) → proceed / skipped", () => {
  assert.deepEqual(decide(none, null, "skipped"), { route: "proceed", act: null, check: "skipped" });
});

test("a failed or skipped-by-switch read → proceed / unavailable (today's behaviour)", () => {
  for (const status of ["timeout", "throttled", "error", "not_configured", "disabled", "not_found"]) {
    assert.deepEqual(decide(none, null, status), { route: "proceed", act: null, check: "unavailable" }, status);
  }
});

// --- Clock ----------------------------------------------------------------------

test("clock skew: up to five minutes in the future still counts, more does not", () => {
  const soon = new Date(NOW + FUTURE_SKEW_MS).toISOString();
  const late = new Date(NOW + FUTURE_SKEW_MS + 1000).toISOString();
  assert.equal(decide(none, { state: "pending", level: null, at: soon }).route, "shopify_pending");
  assert.equal(decide(none, { state: "pending", level: null, at: late }).route, "proceed");
  assert.equal(decide({ state: "pending", source: "shopify", at: soon }, null).route, "shopify_pending");
  assert.equal(decide({ state: "pending", source: "shopify", at: late }, null).route, "proceed");
});

test("isFreshConsentTime / isFreshShopifyPending", () => {
  assert.equal(isFreshConsentTime(daysAgo(1), NOW, DAYS), true);
  assert.equal(isFreshConsentTime(daysAgo(8), NOW, DAYS), false);
  assert.equal(isFreshConsentTime(null, NOW, DAYS), false);
  assert.equal(isFreshConsentTime("", NOW, DAYS), false);
  assert.equal(isFreshConsentTime(daysAgo(8), NOW, 10), true);
  assert.equal(isFreshShopifyPending({ state: "pending", source: "shopify", at: daysAgo(1) }, NOW, DAYS), true);
  assert.equal(
    isFreshShopifyPending({ state: "pending", source: "shopify", at: daysAgo(1), suppressed: true }, NOW, DAYS),
    false
  );
  assert.equal(isFreshShopifyPending({ state: "pending", source: "mo_signin", at: daysAgo(1) }, NOW, DAYS), false);
  assert.equal(isFreshShopifyPending({ state: "subscribed", source: "shopify", at: daysAgo(1) }, NOW, DAYS), false);
  assert.equal(isFreshShopifyPending(null, NOW, DAYS), false);
});
