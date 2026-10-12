import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignHighlightNames,
  countedLabel,
  draftPromptPlan,
  effectiveDraftOffer,
  highlightNamesSection,
  noDiscountHint,
  setContentsLines,
  setHeroProducts,
  setHighlightNames,
  setOfferSection,
} from "./draft-offer.mjs";

const SET = [
  { productId: "kettlebell", title: "Kettlebell – 16 kg", quantity: 2 },
  { productId: "bench", title: "Hantelbank", quantity: 1 },
];

// ── effectiveDraftOffer ──────────────────────────────────────────────────────

test("effectiveDraftOffer: a set mail never carries a discount, whoever asked", () => {
  for (const discountPercent of [0, 5, 10, 50]) {
    assert.deepEqual(
      effectiveDraftOffer({ discountPercent, requestedScope: "recommendations", hasActiveBundle: true }),
      { kind: "set", discountPercent: 0, discountScope: "all" }
    );
  }
  // A stored "set" scope on a set mail also resets to "all".
  assert.deepEqual(
    effectiveDraftOffer({ discountPercent: 10, storedScope: "set", hasActiveBundle: true }),
    { kind: "set", discountPercent: 0, discountScope: "all" }
  );
});

test("effectiveDraftOffer: an item mail keeps the requested depth and an editable scope", () => {
  assert.deepEqual(
    effectiveDraftOffer({ discountPercent: 10, requestedScope: "recommendations", hasActiveBundle: false }),
    { kind: "items", discountPercent: 10, discountScope: "recommendations" }
  );
  // No request → the stored scope.
  assert.deepEqual(
    effectiveDraftOffer({ discountPercent: 10, requestedScope: null, storedScope: "recommendations" }),
    { kind: "items", discountPercent: 10, discountScope: "recommendations" }
  );
  // The request wins over the stored scope.
  assert.equal(
    effectiveDraftOffer({ discountPercent: 5, requestedScope: "all", storedScope: "recommendations" })
      .discountScope,
    "all"
  );
  // Nothing at all → "all".
  assert.deepEqual(effectiveDraftOffer({ discountPercent: 0 }), {
    kind: "items",
    discountPercent: 0,
    discountScope: "all",
  });
});

test("effectiveDraftOffer: the history scope 'set' becomes 'all' without a set", () => {
  assert.equal(effectiveDraftOffer({ discountPercent: 10, requestedScope: "set" }).discountScope, "all");
  assert.equal(effectiveDraftOffer({ discountPercent: 10, storedScope: "set" }).discountScope, "all");
  assert.equal(effectiveDraftOffer({ discountPercent: 10, requestedScope: "bogus" }).discountScope, "all");
});

test("effectiveDraftOffer: a nonsensical depth reads as no discount", () => {
  assert.equal(effectiveDraftOffer({ discountPercent: -5 }).discountPercent, 0);
  assert.equal(effectiveDraftOffer({ discountPercent: Number.NaN }).discountPercent, 0);
  assert.equal(effectiveDraftOffer({ discountPercent: null }).discountPercent, 0);
});

// ── set contents ─────────────────────────────────────────────────────────────

test("setContentsLines: counts in front, same titles merged", () => {
  assert.deepEqual(setContentsLines(SET), ["2× Kettlebell – 16 kg", "1× Hantelbank"]);
  assert.deepEqual(
    setContentsLines([
      { title: "Kettlebell – 16 kg", quantity: 1 },
      { title: "Kettlebell – 16 kg", quantity: 2 },
    ]),
    ["3× Kettlebell – 16 kg"]
  );
  assert.deepEqual(setContentsLines([{ title: "Matte" }]), ["1× Matte"]);
  assert.deepEqual(setContentsLines(null), []);
  assert.deepEqual(setContentsLines([{ title: "  " }]), []);
});

test("setHighlightNames: the component titles without counts, one per title", () => {
  assert.deepEqual(setHighlightNames(SET), ["Kettlebell – 16 kg", "Hantelbank"]);
  assert.deepEqual(
    setHighlightNames([{ title: " Matte " }, { title: "Matte", quantity: 3 }]),
    ["Matte"]
  );
  assert.deepEqual(setHighlightNames(undefined), []);
});

// ── prompt variant ───────────────────────────────────────────────────────────

test("draftPromptPlan: a set mail shows the set, no recommendations and no code", () => {
  const plan = draftPromptPlan({
    offerKind: "set",
    setComponents: SET,
    recommendationNames: ["Klimmzugstange"],
    discountCode: "MO-XXXX",
    discountPercent: 10,
  });
  assert.deepEqual(plan, {
    kind: "set",
    showRecommendations: false,
    setLines: ["2× Kettlebell – 16 kg", "1× Hantelbank"],
    highlightNames: ["Kettlebell – 16 kg", "Hantelbank"],
    discountCode: null,
    discountPercent: 0,
  });
});

test("draftPromptPlan: an item mail shows the recommendations and its code", () => {
  const plan = draftPromptPlan({
    offerKind: "items",
    setComponents: SET,
    recommendationNames: ["Klimmzugstange", " Klimmzugstange", "Matte"],
    discountCode: "MO-XXXX",
    discountPercent: 10,
  });
  assert.deepEqual(plan, {
    kind: "items",
    showRecommendations: true,
    setLines: [],
    highlightNames: ["Klimmzugstange", "Matte"],
    discountCode: "MO-XXXX",
    discountPercent: 10,
  });
});

test("draftPromptPlan: no code or no depth means no discount in an item mail", () => {
  assert.equal(
    draftPromptPlan({ offerKind: "items", discountCode: null, discountPercent: 10 }).discountPercent,
    0
  );
  assert.equal(
    draftPromptPlan({ offerKind: "items", discountCode: "MO-XXXX", discountPercent: 0 }).discountCode,
    null
  );
});

test("draftPromptPlan: a set request without set contents degrades to items", () => {
  const plan = draftPromptPlan({ offerKind: "set", setComponents: [], recommendationNames: ["Matte"] });
  assert.equal(plan.kind, "items");
  assert.equal(plan.showRecommendations, true);
  assert.deepEqual(plan.highlightNames, ["Matte"]);
});

// ── highlights ───────────────────────────────────────────────────────────────

test("alignHighlightNames: copied count prefixes and case differences map to the target", () => {
  const out = alignHighlightNames(
    [
      { name: "2× Kettlebell – 16 kg", description: "Für dein Ganzkörpertraining." },
      { name: "hantelbank", description: "Stabil." },
      { name: "Unbekannt", description: "Bleibt, wie es kam." },
      { name: "Hantelbank", description: "Doppelt — der erste gewinnt." },
      { name: "", description: "leer" },
      { name: "Matte", description: "  " },
    ],
    ["Kettlebell – 16 kg", "Hantelbank"]
  );
  assert.deepEqual(out, [
    { name: "Kettlebell – 16 kg", description: "Für dein Ganzkörpertraining." },
    { name: "Hantelbank", description: "Stabil." },
    { name: "Unbekannt", description: "Bleibt, wie es kam." },
  ]);
  assert.deepEqual(
    alignHighlightNames([{ name: "3 x Matte", description: "ok" }], ["Matte"]),
    [{ name: "Matte", description: "ok" }]
  );
  assert.deepEqual(alignHighlightNames(null, ["Matte"]), []);
});

test("highlightNamesSection: lists the exact names, set wording without counts", () => {
  const de = highlightNamesSection(["Kettlebell – 16 kg"], "set", "de");
  assert.match(de, /ohne die Anzahl/);
  assert.match(de, /- Kettlebell – 16 kg/);
  assert.doesNotMatch(highlightNamesSection(["Matte"], "items", "de"), /Set/);
  assert.match(highlightNamesSection(["Matte"], "set", "en"), /without the count/);
  assert.equal(highlightNamesSection([], "set", "de"), "");
});

// ── prompt text ──────────────────────────────────────────────────────────────

test("setOfferSection: the set is THE offer, with counts and no price from the model", () => {
  const de = setOfferSection({ title: "Dein Kettlebell-Set", lines: setContentsLines(SET), hasSaving: true }, "de");
  assert.match(de, /Das Set IST das Angebot/);
  assert.match(de, /- 2× Kettlebell – 16 kg/);
  assert.match(de, /- 1× Hantelbank/);
  assert.match(de, /„Dein Kettlebell-Set“/);
  assert.match(de, /günstiger als die Einzelprodukte zusammen/);
  assert.match(de, /KEINEN Preis, KEINE Ersparnis und KEINE Prozentzahl/);
  assert.doesNotMatch(de, /außerdem/i);

  const noSaving = setOfferSection({ title: "Set", lines: ["1× Matte"], hasSaving: false }, "de");
  assert.match(noSaving, /Behaupte NICHT, dass das Set günstiger ist/);
  assert.doesNotMatch(noSaving, /weise freundlich auf den Vorteil hin/);

  const en = setOfferSection({ title: "Your set", lines: ["2× Kettlebell"], hasSaving: false }, "en");
  assert.match(en, /The set IS the offer/);
  assert.match(en, /Do NOT claim that the set is cheaper/);
  assert.match(en, /Do NOT state a price, a saving or a percentage/);
});

test("noDiscountHint: the set branch forbids code and percentage but not the set's advantage", () => {
  const set = noDiscountHint("set", "de");
  assert.match(set, /KEIN Rabattangebot/);
  assert.match(set, /Prozentzahl/);
  assert.doesNotMatch(set, /Preisnachlass/);
  assert.match(noDiscountHint("items", "de"), /versprich keinen Preisnachlass/);
  assert.match(noDiscountHint("set", "en"), /no code and no percentage/);
  assert.match(noDiscountHint("items", "en"), /NO discount offer/);
});

// ── hero ─────────────────────────────────────────────────────────────────────

test("setHeroProducts: one entry per product id with the total count", () => {
  assert.deepEqual(
    setHeroProducts([
      { productId: "kettlebell", title: "Kettlebell – 16 kg", quantity: 2 },
      { productId: "bench", title: "Hantelbank", quantity: 1 },
      { productId: "kettlebell", title: "Kettlebell – 24 kg", quantity: 1 },
      { productId: "", title: "ohne Id", quantity: 1 },
      { productId: "mat", title: "Matte" },
    ]),
    [
      { productId: "kettlebell", title: "Kettlebell – 16 kg", quantity: 3 },
      { productId: "bench", title: "Hantelbank", quantity: 1 },
      { productId: "mat", title: "Matte", quantity: 1 },
    ]
  );
  assert.deepEqual(setHeroProducts(null), []);
});

test("countedLabel: the count only when more than one", () => {
  assert.equal(countedLabel("ATX® Kettlebell", 2), "2× ATX® Kettlebell");
  assert.equal(countedLabel("Hantelbank", 1), "Hantelbank");
  assert.equal(countedLabel("Matte", Number.NaN), "Matte");
});
