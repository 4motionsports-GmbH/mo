import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEmbeddingDoc,
  embeddingDocHash,
  deriveUseCases,
  EMBEDDING_DOC_VERSION,
} from "./embedding-doc.mjs";

const longDescription =
  "Dieses Laufband ist ideal für zu Hause. " + "Sehr ausführliche Beschreibung. ".repeat(40);

const treadmill = {
  id: "laufband-x",
  name: "Laufband X",
  category: "Laufbänder",
  brand: "MotionSports",
  price: 999,
  detailedDescription: longDescription,
  shortDescription: longDescription.slice(0, 240),
  features: Array.from({ length: 20 }, (_, i) => `Feature ${i + 1}`),
  specifications: { Material: "Stahl", "Max. Geschwindigkeit": "20 km/h" },
  tags: ["klappbar", "leise"],
  targetGroup: ["Einsteiger"],
  noiseLevelDb: 55,
  footprintM2: 1.5,
};

test("EMBEDDING_DOC_VERSION is a number (the re-embed marker)", () => {
  assert.equal(typeof EMBEDDING_DOC_VERSION, "number");
  assert.ok(EMBEDDING_DOC_VERSION >= 2);
});

test("the description is no longer clipped at 240 chars (real signal kept)", () => {
  const doc = buildEmbeddingDoc(treadmill);
  // Content well beyond the old 240-char clip must be present.
  assert.ok(doc.length > 500);
  assert.ok(doc.includes("Sehr ausführliche Beschreibung."));
});

test("more than 12 features are included (no hard 12 cap)", () => {
  const doc = buildEmbeddingDoc(treadmill);
  assert.ok(doc.includes("Feature 13"));
  assert.ok(doc.includes("Feature 20"));
});

test("problem/need phrasing is derived in customer language", () => {
  const phrases = deriveUseCases(treadmill).join(" | ");
  // cardio + foldable/small + quiet signals → need-space phrasing.
  assert.match(phrases, /Cardio/i);
  assert.match(phrases, /kleine Wohnungen/i);
  assert.match(phrases, /leise/i);
});

test("strength + beginner products get the right need phrasing", () => {
  const rack = {
    id: "rack",
    name: "Power Rack Einsteiger",
    category: "Power Racks",
    features: ["verstellbar"],
    tags: ["einsteiger"],
  };
  const phrases = deriveUseCases(rack).join(" | ");
  assert.match(phrases, /Krafttraining|Muskelaufbau/i);
  assert.match(phrases, /Einsteiger/i);
});

test("embeddingDocHash is stable for the same text and changes when the text changes", () => {
  const a = buildEmbeddingDoc(treadmill);
  assert.equal(embeddingDocHash(a), embeddingDocHash(a));
  const changed = buildEmbeddingDoc({ ...treadmill, price: 1099 });
  assert.notEqual(embeddingDocHash(a), embeddingDocHash(changed));
});

test("missing fields degrade cleanly (fallback-bundle shaped product)", () => {
  const doc = buildEmbeddingDoc({ id: "x", name: "Nur Name" });
  assert.ok(doc.includes("Nur Name"));
});

test("multi-variant products embed a price range and a Varianten section", () => {
  const bands = {
    id: "widerstandsbaender",
    name: "Widerstandsbänder Gummi",
    category: "Widerstandsbänder",
    price: 3.6,
    variants: [
      { id: "1", title: "Level 1", price: 3.6, available: true, isDefault: true },
      { id: "2", title: "Level 2", price: 4.9, available: true, isDefault: false },
      { id: "9", title: "Level 9", price: 43.9, salePrice: 39.9, available: true, isDefault: false },
    ],
  };
  const doc = buildEmbeddingDoc(bands);
  assert.ok(doc.includes("Preis: ab 3.6 EUR bis 39.9 EUR"));
  assert.ok(doc.includes("Varianten:"));
  assert.ok(doc.includes("- Level 9 — 39.9 EUR"));
});

test("single-variant products keep the flat price line and no Varianten section", () => {
  const doc = buildEmbeddingDoc({
    id: "x",
    name: "Bank",
    price: 99,
    variants: [{ id: "1", title: "", price: 99, available: true, isDefault: true }],
  });
  assert.ok(doc.includes("Preis: 99 EUR"));
  assert.ok(!doc.includes("Varianten:"));
});

test("many variants collapse to a summary line", () => {
  const variants = Array.from({ length: 24 }, (_, i) => ({
    id: String(i + 1),
    title: `${(i + 1) * 2.5} kg`,
    price: 10 + i,
    available: true,
    isDefault: i === 0,
  }));
  const doc = buildEmbeddingDoc({ id: "y", name: "Hantel", price: 10, variants });
  assert.ok(doc.includes("24 Varianten:"));
  assert.ok(doc.includes("2.5 kg"));
});
