import { test } from "node:test";
import assert from "node:assert/strict";

import { foldGerman, searchCatalogByName } from "./catalog-search-core.mjs";

test("foldGerman folds precomposed and decomposed umlauts + ß, lowercases", () => {
  assert.equal(foldGerman("Läufband"), "laufband");
  assert.equal(foldGerman("Ösen"), "osen");
  assert.equal(foldGerman("Müller"), "muller");
  assert.equal(foldGerman("Straße"), "strasse");
  // Decomposed: "a" + combining diaeresis (U+0308) — what the synced catalog
  // actually contains for at least one product name.
  assert.equal(foldGerman("Ständer"), "stander");
  assert.equal(foldGerman(undefined), "");
});

const CATALOG = [
  { id: "a", name: "Laufband Pro 3000", brand: "ATX", category: "Cardio", inStock: true },
  { id: "b", name: "Hantelstangen Ständer", brand: "ATX", category: "Kraft", inStock: true },
  { id: "c", name: "Gymnastikmatte mit Ösen", brand: "AIREX", category: "Matten", inStock: true },
  { id: "d", name: "Laufband Compact", brand: "Vision", category: "Cardio", inStock: false },
  { id: "e", name: "Kurzhantel Set", brand: "Müller", category: "Kraft", inStock: true },
];

test("matches case-insensitively without typing umlauts", () => {
  // "laufband" finds both "Laufband ..." entries.
  const ids = searchCatalogByName(CATALOG, "laufband").map((p) => p.id);
  assert.deepEqual(new Set(ids), new Set(["a", "d"]));
});

test("umlaut-tolerant: 'stander' matches the decomposed 'Ständer' name", () => {
  const ids = searchCatalogByName(CATALOG, "stander").map((p) => p.id);
  assert.deepEqual(ids, ["b"]);
});

test("umlaut-tolerant: 'osen' matches 'Ösen', 'muller' matches brand 'Müller'", () => {
  assert.deepEqual(searchCatalogByName(CATALOG, "osen").map((p) => p.id), ["c"]);
  assert.deepEqual(searchCatalogByName(CATALOG, "muller").map((p) => p.id), ["e"]);
});

test("AND-term matching across name/brand/category", () => {
  const ids = searchCatalogByName(CATALOG, "laufband cardio").map((p) => p.id);
  assert.deepEqual(new Set(ids), new Set(["a", "d"]));
  // A term that no single product satisfies together → no results.
  assert.deepEqual(searchCatalogByName(CATALOG, "laufband matten").map((p) => p.id), []);
});

test("in-stock results sort before sold-out ones", () => {
  const ids = searchCatalogByName(CATALOG, "laufband").map((p) => p.id);
  assert.deepEqual(ids, ["a", "d"]); // in-stock 'a' before sold-out 'd'
});

test("empty / whitespace / non-string query returns no results", () => {
  assert.deepEqual(searchCatalogByName(CATALOG, ""), []);
  assert.deepEqual(searchCatalogByName(CATALOG, "   "), []);
  assert.deepEqual(searchCatalogByName(CATALOG, undefined), []);
});

test("a single stray short term still narrows instead of matching everything", () => {
  // Whole query is one char → kept as the only term (so it filters, not match-all).
  const all = searchCatalogByName(CATALOG, "q");
  assert.deepEqual(all, []);
  // Real word + stray single char → the single char is dropped, the word filters.
  const ids = searchCatalogByName(CATALOG, "laufband x").map((p) => p.id);
  assert.deepEqual(new Set(ids), new Set(["a", "d"]));
});

test("respects the result cap", () => {
  const many = Array.from({ length: 50 }, (_, i) => ({
    id: String(i),
    name: `Laufband ${i}`,
    inStock: true,
  }));
  assert.equal(searchCatalogByName(many, "laufband", 20).length, 20);
});

test("non-array catalog is handled safely", () => {
  assert.deepEqual(searchCatalogByName(null, "laufband"), []);
});
