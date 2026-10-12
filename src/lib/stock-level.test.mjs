import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maxSetQuantity,
  recommendationStock,
  stockLabel,
  stockQuantity,
  stockStatus,
} from "./stock-level.mjs";

test("stockQuantity: only positive, tracked numbers are shown", () => {
  assert.equal(stockQuantity(12, true), 12);
  assert.equal(stockQuantity(12, undefined), 12);
  assert.equal(stockQuantity("7", undefined), 7);
  assert.equal(stockQuantity(3.9, true), 3);
  // untracked: Shopify's number is meaningless
  assert.equal(stockQuantity(12, false), null);
  // zero / oversold / missing read as unknown, never as "0 auf Lager"
  assert.equal(stockQuantity(0, true), null);
  assert.equal(stockQuantity(-4, true), null);
  assert.equal(stockQuantity(undefined, true), null);
  assert.equal(stockQuantity(null, true), null);
  assert.equal(stockQuantity("", true), null);
  assert.equal(stockQuantity("abc", true), null);
});

const SINGLE = {
  id: "bar",
  inventoryQuantity: 9,
  variants: [{ id: "1", title: "", inventoryQuantity: 9, isDefault: true, available: true }],
};
const MULTI = {
  id: "kb",
  inventoryQuantity: 30,
  variants: [
    { id: "11", title: "8 kg", inventoryQuantity: 4, isDefault: true, available: true },
    { id: "12", title: "16 kg", inventoryQuantity: 26, isDefault: false, available: true },
  ],
};

test("recommendationStock: single-variant products show the variant quantity", () => {
  assert.deepEqual(recommendationStock(SINGLE, SINGLE.variants[0]), {
    stock: 9,
    stockScope: "variant",
    unitStock: 9,
  });
});

test("recommendationStock: a bare ref of a multi-variant product shows the total, the set uses the default", () => {
  assert.deepEqual(recommendationStock(MULTI, MULTI.variants[0], { pinned: false }), {
    stock: 30,
    stockScope: "product",
    unitStock: 4,
  });
});

test("recommendationStock: a pinned variant shows its own quantity", () => {
  assert.deepEqual(recommendationStock(MULTI, MULTI.variants[1], { pinned: true }), {
    stock: 26,
    stockScope: "variant",
    unitStock: 26,
  });
});

test("recommendationStock: untracked or unknown stock stays unknown", () => {
  assert.deepEqual(recommendationStock({ ...SINGLE, tracksInventory: false }, SINGLE.variants[0]), {
    stock: null,
    stockScope: "variant",
    unitStock: null,
  });
  // the bundled fallback catalog carries no stock numbers at all
  const bare = { id: "x", price: 10, inStock: true };
  assert.deepEqual(recommendationStock(bare, null), { stock: null, stockScope: "variant", unitStock: null });
  assert.deepEqual(recommendationStock(null, null), { stock: null, stockScope: "variant", unitStock: null });
});

test("stockStatus and stockLabel", () => {
  assert.equal(stockStatus(true), "available");
  assert.equal(stockStatus(false), "sold_out");
  assert.equal(stockStatus(null), "missing");
  assert.equal(stockLabel({ available: false, stock: 5 }), "Ausverkauft");
  assert.equal(stockLabel({ available: null }), "Nicht im Katalog");
  assert.equal(stockLabel({ available: true, stock: null }), null);
  assert.equal(stockLabel({ available: true, stock: 1200, stockScope: "variant" }), "1.200 auf Lager");
  assert.equal(stockLabel({ available: true, stock: 30, stockScope: "product" }), "30 auf Lager (gesamt)");
});

test("maxSetQuantity: the known stock caps the count, unknown stock leaves the cap", () => {
  assert.equal(maxSetQuantity(null, 10), 10);
  assert.equal(maxSetQuantity(undefined, 10), 10);
  assert.equal(maxSetQuantity(3, 10), 3);
  assert.equal(maxSetQuantity(50, 10), 10);
  assert.equal(maxSetQuantity(0, 10), 1);
});
