import { test } from "node:test";
import assert from "node:assert/strict";
import {
  upsertProductInCatalog,
  removeProductFromCatalog,
  shouldReembed,
  upsertEmbeddingItem,
  removeEmbeddingItem,
} from "./catalog-merge.mjs";

test("upsert appends a new product and keeps the list sorted by name", () => {
  const catalog = [{ id: "b", name: "Bench" }];
  const { catalog: next, changed, existed } = upsertProductInCatalog(catalog, { id: "a", name: "Ab Roller" });
  assert.equal(changed, true);
  assert.equal(existed, false);
  assert.deepEqual(next.map((p) => p.id), ["a", "b"]);
});

test("upsert replaces a changed product (changed = true)", () => {
  const catalog = [{ id: "a", name: "Rack", inStock: true }];
  const { changed } = upsertProductInCatalog(catalog, { id: "a", name: "Rack", inStock: false });
  assert.equal(changed, true);
});

test("upsert of an identical product is a NO-OP (idempotent burst guard)", () => {
  const product = { id: "a", name: "Rack", inStock: true };
  const { changed } = upsertProductInCatalog([product], { ...product });
  assert.equal(changed, false);
});

test("remove drops the product; absent id is a no-op", () => {
  assert.equal(removeProductFromCatalog([{ id: "a" }], "a").changed, true);
  assert.equal(removeProductFromCatalog([{ id: "a" }], "zzz").changed, false);
});

test("shouldReembed: a docVersion bump forces re-embed even with a stored vector", () => {
  const existingItem = { vector: [1, 2, 3], docHash: "same" };
  // Same hash but the blob was built with an older doc version ⇒ re-embed.
  assert.equal(
    shouldReembed({ fileDocVersion: 1, currentDocVersion: 2, existingItem, newDocHash: "same" }),
    true
  );
});

test("shouldReembed: changed text (hash mismatch) forces re-embed", () => {
  const existingItem = { vector: [1], docHash: "old" };
  assert.equal(
    shouldReembed({ fileDocVersion: 2, currentDocVersion: 2, existingItem, newDocHash: "new" }),
    true
  );
});

test("shouldReembed: unchanged text + version reuses the stored vector (no OpenAI call)", () => {
  const existingItem = { vector: [1], docHash: "same" };
  assert.equal(
    shouldReembed({ fileDocVersion: 2, currentDocVersion: 2, existingItem, newDocHash: "same" }),
    false
  );
});

test("shouldReembed: a new product or a missing vector always re-embeds", () => {
  assert.equal(
    shouldReembed({ fileDocVersion: 2, currentDocVersion: 2, existingItem: undefined, newDocHash: "x" }),
    true
  );
  assert.equal(
    shouldReembed({ fileDocVersion: 2, currentDocVersion: 2, existingItem: { docHash: "x" }, newDocHash: "x" }),
    true
  );
});

test("embedding item upsert/remove by id", () => {
  let items = [{ id: "a", vector: [1], docHash: "a" }];
  items = upsertEmbeddingItem(items, { id: "b", vector: [2], docHash: "b" });
  assert.deepEqual(items.map((i) => i.id), ["a", "b"]);
  items = upsertEmbeddingItem(items, { id: "a", vector: [9], docHash: "a2" });
  assert.deepEqual(items.find((i) => i.id === "a").vector, [9]);
  items = removeEmbeddingItem(items, "a");
  assert.deepEqual(items.map((i) => i.id), ["b"]);
});
