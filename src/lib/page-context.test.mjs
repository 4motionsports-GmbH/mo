import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contextSource,
  pageContextKind,
  parseHoldoutPct,
  holdoutBucket,
  isPageContextHeldOut,
  planPageContext,
  countProductCards,
  countOtherCards,
  compareArms,
  requiredSampleSize,
  experimentProgress,
} from "./page-context.mjs";

test("contextSource: exact values only", () => {
  assert.equal(contextSource("page"), "page");
  assert.equal(contextSource(" cta "), "cta");
  assert.equal(contextSource("nudge"), "nudge");
  for (const v of [undefined, null, 1, "PAGE", "other"]) assert.equal(contextSource(v), null);
});

test("pageContextKind: product (trail ignored), one category, else dropped", () => {
  assert.equal(pageContextKind({ type: "product", productId: "x", recentlyViewed: [{ type: "product" }] }), "product");
  assert.equal(pageContextKind({ type: "browsing", recentlyViewed: [{ type: "category", name: "Hanteln" }] }), "collection");
  assert.equal(pageContextKind({ type: "browsing", recentlyViewed: [{ type: "product", name: "x" }] }), null);
  assert.equal(pageContextKind({ type: "browsing", recentlyViewed: [{ type: "category", name: "a" }, { type: "category", name: "b" }] }), null);
  assert.equal(pageContextKind({ type: "browsing", recentlyViewed: [{ type: "category", name: " " }] }), null);
  assert.equal(pageContextKind({ type: "x" }), null);
  assert.equal(pageContextKind(null), null);
});

test("parseHoldoutPct", () => {
  assert.equal(parseHoldoutPct(""), 0);
  assert.equal(parseHoldoutPct("abc"), 0);
  assert.equal(parseHoldoutPct("-5"), 0);
  assert.equal(parseHoldoutPct("20"), 20);
  assert.equal(parseHoldoutPct("20.7"), 20);
  assert.equal(parseHoldoutPct("80"), 50);
  assert.equal(parseHoldoutPct(undefined), 0);
});

test("holdout: deterministic buckets 0–99; 0 % never holds out; ~20 % at 20", () => {
  assert.equal(holdoutBucket("abc"), holdoutBucket("abc"));
  let held = 0;
  for (let i = 0; i < 10000; i++) {
    const b = holdoutBucket(`sid-${i}`);
    assert.ok(b >= 0 && b < 100);
    if (isPageContextHeldOut(`sid-${i}`, 20)) held++;
    assert.equal(isPageContextHeldOut(`sid-${i}`, 0), false);
  }
  assert.ok(held >= 1800 && held <= 2200, String(held));
  assert.equal(isPageContextHeldOut("", 20), false);
});

const base = { source: "page", kind: "product", hasUserMessage: true, enabled: true, heldOut: false, pct: 20, productResolved: true, categoryResolved: false };

test("planPageContext: every row of the plan table", () => {
  assert.deepEqual(planPageContext({ ...base, source: null }), { ground: true, noteStyle: "default", event: null });
  assert.deepEqual(planPageContext({ ...base, source: "cta" }), { ground: true, noteStyle: "default", event: null });
  assert.deepEqual(planPageContext({ ...base, hasUserMessage: false }), { ground: false, noteStyle: "none", event: null });
  assert.deepEqual(planPageContext({ ...base, kind: null }), { ground: false, noteStyle: "none", event: null });
  assert.deepEqual(planPageContext({ ...base, enabled: false }), {
    ground: false, noteStyle: "none", event: { applied: false, kind: "product", resolved: true, pct: 100 },
  });
  assert.deepEqual(planPageContext({ ...base, heldOut: true }), {
    ground: false, noteStyle: "none", event: { applied: false, kind: "product", resolved: true, pct: 20 },
  });
  assert.deepEqual(planPageContext(base), { ground: true, noteStyle: "page", event: { applied: true, kind: "product", resolved: true, pct: 20 } });
  assert.deepEqual(planPageContext({ ...base, productResolved: false }), {
    ground: false, noteStyle: "none", event: { applied: true, kind: "product", resolved: false, pct: 20 },
  });
  // Collection pages are never held out and record pct 0.
  assert.deepEqual(planPageContext({ ...base, kind: "collection", heldOut: true, categoryResolved: true }), {
    ground: true, noteStyle: "page", event: { applied: true, kind: "collection", resolved: true, pct: 0 },
  });
});

test("card counts: other cards leave out the open product (any variant)", () => {
  const calls = [
    { toolName: "show_product", input: { productId: "rack" } },
    { toolName: "show_product", input: { productId: "rack~123" } },
    { toolName: "show_product", input: { productId: "bench" } },
    { toolName: "compare_products", input: { productIds: ["rack", "bench"] } },
    { toolName: "add_to_cart", input: { productId: "rack" } },
    { toolName: "update_customer_profile", input: {} },
  ];
  assert.equal(countProductCards(calls), 5);
  assert.equal(countOtherCards(calls, "rack"), 3);
  assert.equal(countOtherCards(calls, null), 5);
});

test("compareArms: rates, interval, significance, empty arms", () => {
  const r = compareArms({ applied: { n: 1000, k: 200 }, holdout: { n: 1000, k: 150 } });
  assert.ok(Math.abs(r.diff - 0.05) < 1e-9);
  assert.equal(r.significant, true);
  assert.ok(r.ciLow > 0);
  assert.equal(compareArms({ applied: { n: 100, k: 16 }, holdout: { n: 100, k: 15 } }).significant, false);
  assert.equal(compareArms({ applied: { n: 0, k: 0 }, holdout: { n: 10, k: 1 } }).appliedRate, null);
});

test("requiredSampleSize: ~13,300 at 80/20 and ~8,400 at 50/50 (15 % base, +15 %)", () => {
  const a = requiredSampleSize({ baseRate: 0.15, relLift: 0.15, holdoutShare: 0.2 });
  assert.ok(Math.abs(a.total - 13273) <= 5, String(a.total));
  assert.ok(Math.abs(a.holdout - 2655) <= 5, String(a.holdout));
  const b = requiredSampleSize({ baseRate: 0.15, relLift: 0.15, holdoutShare: 0.5 });
  assert.ok(Math.abs(b.total - 8385) <= 5, String(b.total));
});

test("experimentProgress: reached only when both arms reach their target", () => {
  assert.equal(experimentProgress({ applied: { n: 10 }, holdout: { n: 3 } }, { applied: 10, holdout: 3 }).reached, true);
  assert.equal(experimentProgress({ applied: { n: 10 }, holdout: { n: 2 } }, { applied: 10, holdout: 3 }).reached, false);
});

test("summarisePageContextRows: coverage, comparison population and exclusions", async () => {
  const { summarisePageContextRows: s } = await import("./page-context.mjs");
  const exp = { pct: 20, targetPerArm: { applied: 2, holdout: 1 } };
  const row = (over) => ({ arm: "applied", pct: 20, resolved: true, primed: false, locale: "de", click_window_open: false, sessions: 1, clicked_other: 0, ...over });
  const out = s(
    [
      row({ sessions: 3, clicked_other: 2 }),
      row({ arm: "holdout", sessions: 2, clicked_other: 1 }),
      row({ arm: "mixed" }),
      row({ pct: 100 }),
      row({ resolved: false, locale: "en" }),
      row({ primed: true }),
      row({ click_window_open: true }),
    ],
    exp
  );
  assert.equal(out.sessions, 10);
  assert.equal(out.resolved, 9);
  assert.deepEqual(out.byLocale.en, { sessions: 1, resolved: 0 });
  assert.equal(out.arms.applied.sessions, 3);
  assert.equal(out.arms.holdout.sessions, 2);
  assert.deepEqual(out.excluded, { otherShare: 1, mixed: 1, unresolved: 1, primed: 1, windowOpen: 1 });
  assert.equal(out.progress.reached, true);
  assert.ok(Math.abs(out.primary.appliedRate - 2 / 3) < 1e-9);
  // Without a pre-registered experiment nothing is compared.
  const none = s([row({ sessions: 3 })], null);
  assert.equal(none.arms.applied.sessions, 0);
  assert.equal(none.excluded.otherShare, 3);
  assert.equal(none.primary, null);
});
