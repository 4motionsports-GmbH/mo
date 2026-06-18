import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileEmbeddingItems, isConsistentPair } from "./catalog-pair.mjs";

test("reconcileEmbeddingItems drops orphan vectors (ids not in the catalog)", () => {
  const catalogIds = ["a", "b", "c"];
  const items = [
    { id: "a", vector: [1] },
    { id: "gone", vector: [2] }, // product was removed — orphan
    { id: "c", vector: [3] },
  ];
  const out = reconcileEmbeddingItems(catalogIds, items);
  assert.deepEqual(out.map((i) => i.id), ["a", "c"]);
});

test("reconcileEmbeddingItems de-duplicates by id (first wins) and preserves order", () => {
  const out = reconcileEmbeddingItems(["a", "b"], [
    { id: "b", vector: [1] },
    { id: "a", vector: [2] },
    { id: "b", vector: [99] },
  ]);
  assert.deepEqual(out.map((i) => i.id), ["b", "a"]);
  assert.deepEqual(out[0].vector, [1]);
});

test("the written pair is always consistent: every vector id exists in the catalog", () => {
  const products = [{ id: "a" }, { id: "b" }];
  // Embeddings still carry a vector for a product that no longer exists.
  const rawItems = [{ id: "a", vector: [1] }, { id: "removed", vector: [2] }];
  assert.equal(isConsistentPair(products, { items: rawItems }), false);

  const reconciled = reconcileEmbeddingItems(products.map((p) => p.id), rawItems);
  assert.equal(isConsistentPair(products, { items: reconciled }), true);
});

test("a product without a vector is still a consistent pair (keyword fallback)", () => {
  // Reverse direction is NOT required: a catalog product may legitimately have
  // no embedding (it was skipped) — that does not break consistency.
  const products = [{ id: "a" }, { id: "b" }];
  assert.equal(isConsistentPair(products, { items: [{ id: "a", vector: [1] }] }), true);
});
