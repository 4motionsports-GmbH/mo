import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveOwnedHandles,
  deriveOwnedCategories,
  selectSimilarProducts,
} from "./bestandskunden-similarity.mjs";

const CATALOG = [
  { id: "atx-treadmill-x", category: "Laufbänder", inStock: true, name: "ATX Treadmill X" },
  { id: "atx-treadmill-mat", category: "Laufbänder", inStock: true, name: "Laufband-Matte" },
  { id: "cardio-bike-pro", category: "Laufbänder", inStock: false, name: "Bike Pro (sold out)" },
  { id: "power-rack-9000", category: "Power Racks", inStock: true, name: "Power Rack 9000" },
  { id: "protein-vanille", category: "Supplements", inStock: true, name: "Protein Vanille" },
];

const PURCHASE = {
  orders: [{ items: [{ handle: "atx-treadmill-x", quantity: 1 }] }],
};

test("deriveOwnedHandles normalises and collects purchased handles", () => {
  const owned = deriveOwnedHandles(PURCHASE);
  assert.ok(owned.has("atx-treadmill-x"));
  assert.equal(owned.size, 1);
});

test("deriveOwnedCategories maps purchased handles to catalog categories", () => {
  const cats = deriveOwnedCategories(PURCHASE, CATALOG);
  assert.deepEqual([...cats], ["Laufbänder"]);
});

test("selectSimilarProducts returns only same-category, in-stock, not-owned products", () => {
  const owned = deriveOwnedHandles(PURCHASE);
  const cats = deriveOwnedCategories(PURCHASE, CATALOG);
  const similar = selectSimilarProducts(CATALOG, { ownedCategories: cats, ownedHandles: owned });
  const ids = similar.map((p) => p.id);
  // mat is similar; the purchased treadmill is excluded (owned); the bike is
  // excluded (sold out); cross-category rack + supplements are excluded.
  assert.deepEqual(ids, ["atx-treadmill-mat"]);
});

test("no purchased category → no similar products (fail-closed, never a blast)", () => {
  const similar = selectSimilarProducts(CATALOG, { ownedCategories: new Set() });
  assert.deepEqual(similar, []);
});

test("cross-category products are never 'similar'", () => {
  // Bought supplements only → must never surface a treadmill or rack.
  const purchase = { orders: [{ items: [{ handle: "protein-vanille" }] }] };
  const owned = deriveOwnedHandles(purchase);
  const cats = deriveOwnedCategories(purchase, CATALOG);
  const similar = selectSimilarProducts(CATALOG, { ownedCategories: cats, ownedHandles: owned });
  assert.deepEqual(similar.map((p) => p.id), []); // only owned supplement is in that category
});

test("limit caps the result", () => {
  const cats = new Set(["Laufbänder"]);
  const similar = selectSimilarProducts(CATALOG, { ownedCategories: cats, limit: 1 });
  assert.equal(similar.length, 1);
});
