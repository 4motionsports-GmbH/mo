import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BUNDLE_MAX_PRODUCTS,
  selectBundleCandidates,
  sanitizeBundleSuggestion,
} from "./bundle-suggestion-core.mjs";

// A tiny fake catalog covering every exclusion path.
const CATALOG = [
  { id: "in-stock-a", inStock: true, shopifyVariantId: "gid://shopify/ProductVariant/1", price: 100 },
  { id: "in-stock-b", inStock: true, shopifyVariantId: "gid://shopify/ProductVariant/2", salePrice: 50, price: 80 },
  { id: "owned-c", inStock: true, shopifyVariantId: "gid://shopify/ProductVariant/3", price: 30 },
  { id: "sold-out-d", inStock: false, shopifyVariantId: "gid://shopify/ProductVariant/4", price: 40 },
  { id: "no-variant-e", inStock: true, price: 60 },
  { id: "free-f", inStock: true, shopifyVariantId: "gid://shopify/ProductVariant/6", price: 0 },
];

test("selectBundleCandidates excludes owned and sold-out (and unpriceable / variant-less)", () => {
  const candidates = selectBundleCandidates(CATALOG, ["owned-c"]);
  const ids = candidates.map((p) => p.id);
  assert.deepEqual(ids, ["in-stock-a", "in-stock-b"]);
  // The owned product is gone.
  assert.ok(!ids.includes("owned-c"), "owned product must be excluded");
  // The sold-out product is gone — S10 would refuse it at compose time anyway.
  assert.ok(!ids.includes("sold-out-d"), "sold-out product must be excluded");
  // No resolvable variant / zero price are not bundleable.
  assert.ok(!ids.includes("no-variant-e"));
  assert.ok(!ids.includes("free-f"));
});

test("selectBundleCandidates with no owned items keeps every in-stock priceable product", () => {
  const ids = selectBundleCandidates(CATALOG, []).map((p) => p.id);
  // owned-c is now eligible (nothing owned); sold-out / variant-less / free stay excluded.
  assert.deepEqual(ids, ["in-stock-a", "in-stock-b", "owned-c"]);
});

test("sanitizeBundleSuggestion drops hallucinated / owned / sold-out ids", () => {
  const allowed = ["in-stock-a", "in-stock-b"];
  const picks = sanitizeBundleSuggestion(
    [
      { productId: "in-stock-a", rationale: "core" },
      { productId: "owned-c", rationale: "already owned — must be dropped" },
      { productId: "sold-out-d", rationale: "sold out — must be dropped" },
      { productId: "hallucinated-x", rationale: "not in catalog — must be dropped" },
      { productId: "in-stock-b", rationale: "complements a" },
    ],
    allowed
  );
  assert.deepEqual(
    picks.map((p) => p.productId),
    ["in-stock-a", "in-stock-b"]
  );
});

test("sanitizeBundleSuggestion de-duplicates and clamps to the max", () => {
  const allowed = ["a", "b", "c", "d", "e", "f", "g"];
  const picks = sanitizeBundleSuggestion(
    [
      { productId: "a" },
      { productId: "a" }, // duplicate
      { productId: "b" },
      { productId: "c" },
      { productId: "d" },
      { productId: "e" },
      { productId: "f" },
      { productId: "g" },
    ],
    allowed
  );
  assert.equal(picks.length, BUNDLE_MAX_PRODUCTS);
  assert.deepEqual(
    picks.map((p) => p.productId),
    ["a", "b", "c", "d", "e"]
  );
});

test("sanitizeBundleSuggestion tolerates junk input", () => {
  assert.deepEqual(sanitizeBundleSuggestion(null, ["a"]), []);
  assert.deepEqual(sanitizeBundleSuggestion([{ rationale: "no id" }], ["a"]), []);
  assert.deepEqual(sanitizeBundleSuggestion([{ productId: "  " }], ["a"]), []);
});
