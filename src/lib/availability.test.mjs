import { test } from "node:test";
import assert from "node:assert/strict";
import { isAvailable, filterAvailable } from "./availability.mjs";

test("isAvailable: only inStock === false is unavailable", () => {
  assert.equal(isAvailable({ inStock: true }), true);
  assert.equal(isAvailable({ inStock: false }), false);
  // Missing stock data (e.g. fallback bundle) ⇒ treated as available, never hidden.
  assert.equal(isAvailable({}), true);
  assert.equal(isAvailable(null), false);
  assert.equal(isAvailable(undefined), false);
});

test("an unavailable item is NOT recommended (filtered out)", () => {
  const products = [
    { id: "in", inStock: true },
    { id: "out", inStock: false },
    { id: "unknown" }, // no stock field
  ];
  const recommendable = filterAvailable(products);
  assert.deepEqual(recommendable.map((p) => p.id), ["in", "unknown"]);
  assert.ok(!recommendable.some((p) => p.id === "out"));
});

test("a restocked item becomes recommendable again once inStock flips back", () => {
  const product = { id: "x", inStock: false };
  assert.deepEqual(filterAvailable([product]), []);
  const restocked = { ...product, inStock: true };
  assert.deepEqual(filterAvailable([restocked]).map((p) => p.id), ["x"]);
});
