import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHandle, hasRecommendedPurchase } from "./kpi-match.mjs";

test("normalizeHandle lowercases and collapses non-alphanumerics", () => {
  assert.equal(normalizeHandle("150-kg-ATX®-Gym-Plates"), "150-kg-atx-gym-plates");
  assert.equal(normalizeHandle("whey-protein-motion-sports"), "whey-protein-motion-sports");
  assert.equal(normalizeHandle("  Trim__Me  "), "trim-me");
});

test("normalizeHandle handles nullish input", () => {
  assert.equal(normalizeHandle(null), "");
  assert.equal(normalizeHandle(undefined), "");
  assert.equal(normalizeHandle(""), "");
});

test("normalizeHandle aligns catalog id with stripped Shopify handle", () => {
  // catalog id keeps the ®; the live storefront handle drops it.
  assert.equal(
    normalizeHandle("150-kg-atx®-gym-bumper-plates-vorteilspaket"),
    normalizeHandle("150-kg-atx-gym-bumper-plates-vorteilspaket")
  );
});

test("hasRecommendedPurchase matches on a shared normalised handle", () => {
  assert.equal(
    hasRecommendedPurchase(
      ["atx®-rack-pro", "whey-protein"],
      ["some-other-thing", "ATX-Rack-Pro"]
    ),
    true
  );
});

test("hasRecommendedPurchase is false with no overlap or empty inputs", () => {
  assert.equal(hasRecommendedPurchase(["a-rack"], ["a-bench"]), false);
  assert.equal(hasRecommendedPurchase([], ["a-rack"]), false);
  assert.equal(hasRecommendedPurchase(["a-rack"], []), false);
  assert.equal(hasRecommendedPurchase([null, ""], [null]), false);
});
