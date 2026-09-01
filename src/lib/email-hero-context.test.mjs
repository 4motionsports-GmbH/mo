// Unit tests for the hero-context helpers (node --test).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clip,
  colorWordForPrompt,
  heroContextLines,
  loyaltyHint,
  ownedProductTitles,
  productCategories,
  productHeroDescriptors,
  seasonHint,
} from "./email-hero-context.mjs";

test("seasonHint covers every month with a distinct German hint", () => {
  const hints = new Set();
  for (let m = 0; m < 12; m += 1) {
    const h = seasonHint(new Date(2026, m, 15));
    assert.ok(h.length > 10, `month ${m + 1} has a hint`);
    hints.add(h);
  }
  assert.ok(hints.size >= 8, "hints are month-specific, not one generic string");
  assert.match(seasonHint(new Date(2026, 0, 5)), /Neujahr/);
  assert.match(seasonHint(new Date(2026, 11, 5)), /Weihnacht/);
});

test("clip squashes whitespace and cuts on a word boundary", () => {
  assert.equal(clip("  a   b  ", 50), "a b");
  const long = "Wort ".repeat(60);
  const out = clip(long, 40);
  assert.ok(out.length <= 41, "respects the limit");
  assert.ok(out.endsWith("…"), "marks the cut");
  assert.ok(!out.includes("  "), "no double spaces");
  assert.equal(clip(null, 10), "");
});

test("ownedProductTitles de-duplicates across orders and respects the limit", () => {
  const history = {
    orders: [
      { items: [{ title: "ATX Power Rack" }, { title: "Hantelscheiben 20 kg" }] },
      { items: [{ title: "ATX Power Rack" }, { title: "Klimmzugstange" }] },
      { items: [{ title: null }, { title: "  " }] },
    ],
  };
  assert.deepEqual(ownedProductTitles(history), [
    "ATX Power Rack",
    "Hantelscheiben 20 kg",
    "Klimmzugstange",
  ]);
  assert.deepEqual(ownedProductTitles(history, 2), ["ATX Power Rack", "Hantelscheiben 20 kg"]);
  assert.deepEqual(ownedProductTitles(null), []);
  assert.deepEqual(ownedProductTitles({ orders: [] }), []);
});

test("productCategories de-duplicates case-insensitively", () => {
  const products = [
    { category: "Power Racks" },
    { category: "power racks" },
    { category: "Kleingeräte" },
    { category: "" },
    {},
  ];
  assert.deepEqual(productCategories(products), ["Power Racks", "Kleingeräte"]);
  assert.deepEqual(productCategories([]), []);
});

test("loyaltyHint distinguishes first-time, repeat and loyal buyers", () => {
  assert.match(loyaltyHint(0, 0), /Noch kein Kauf/);
  assert.match(loyaltyHint(1, 12900), /Erstk/);
  assert.match(loyaltyHint(1, 12900), /129 €/);
  assert.match(loyaltyHint(3, 50000), /Wiederk/);
  assert.match(loyaltyHint(7, 250000), /Stammkund/);
});

test("heroContextLines drops empty values and joins arrays", () => {
  assert.deepEqual(
    heroContextLines({
      Persona: "Home-Athlet",
      "Bereits gekauft": ["Rack", "Scheiben"],
      Leer: "   ",
      Fehlt: null,
      Leerliste: [],
    }),
    ["Persona: Home-Athlet", "Bereits gekauft: Rack, Scheiben"]
  );
  assert.deepEqual(heroContextLines({}), []);
  assert.deepEqual(heroContextLines(null), []);
});

// ── ensureHeroStyleTail: stored prompts must always carry the CURRENT rules ──
import { ensureHeroStyleTail, HERO_PROMPT_STYLE_TAIL } from "./email-hero-context.mjs";

test("ensureHeroStyleTail leaves a current prompt untouched", () => {
  const current = `A rack in a bright room.\n\n${HERO_PROMPT_STYLE_TAIL}`;
  assert.equal(ensureHeroStyleTail(current), current);
});

test("ensureHeroStyleTail replaces a superseded (portrait) tail", () => {
  const legacyTail =
    "Photorealistic premium e-commerce hero shot in a bright modern home gym: " +
    "matte black equipment. Portrait orientation. Strictly no text.";
  const stored = `A rack next to a window.\n\n${legacyTail}`;
  const out = ensureHeroStyleTail(stored);
  assert.ok(out.startsWith("A rack next to a window."), "keeps the operator's scene");
  assert.ok(!out.includes("Portrait orientation"), "drops the superseded rule");
  assert.ok(out.includes("IMPORTANT COMPOSITION RULE"), "adds the current rules");
  assert.ok(out.includes("WIDE LANDSCAPE"), "landscape rule present");
});

test("ensureHeroStyleTail appends to a bare scene", () => {
  const out = ensureHeroStyleTail("Just a scene.");
  assert.ok(out.startsWith("Just a scene."));
  assert.ok(out.includes("IMPORTANT COMPOSITION RULE"));
});

// ── Brand + product fidelity in the image prompt ──────────────────────────────
// The hero should look like the product the shop actually sells, so the prompt
// names brand, product, object type and colour instead of a generic category.

test("a descriptor carries brand, product name, object type and colour", () => {
  assert.deepEqual(
    productHeroDescriptors([
      {
        name: "Functional Trainer - Dual Pulley",
        brand: "ATX®",
        category: "Weight Lifting Machines with Pulleys",
        specifications: { Farbe: "schwarz-150", Serie: "700" },
      },
    ]),
    ["ATX® Functional Trainer - Dual Pulley (Weight Lifting Machines with Pulleys, black)"]
  );
});

test("the brand is not repeated when the product name already starts with it", () => {
  const [d] = productHeroDescriptors([
    { name: "ATX® Power Rack 620", brand: "ATX®", category: "Power Racks", specifications: {} },
  ]);
  assert.equal(d, "ATX® Power Rack 620 (Power Racks)");
  assert.equal(d.match(/ATX/g).length, 1);
});

test("'Uncategorized' is a catalogue placeholder, not an object type", () => {
  assert.deepEqual(
    productHeroDescriptors([
      { name: "Ab-/Adduktionstrainer", brand: "Stolzenberg", category: "Uncategorized" },
    ]),
    ["Stolzenberg Ab-/Adduktionstrainer"]
  );
});

test("products without brand or colour still yield a usable descriptor", () => {
  assert.deepEqual(
    productHeroDescriptors([{ name: "Yoga Mat", category: "Yoga & Pilates Mats" }]),
    ["Yoga Mat (Yoga & Pilates Mats)"]
  );
  assert.deepEqual(productHeroDescriptors([{ name: "Nur ein Name" }]), ["Nur ein Name"]);
  assert.deepEqual(productHeroDescriptors([{ brand: "ATX®" }]), [], "kein Name = kein Eintrag");
  assert.deepEqual(productHeroDescriptors(undefined), []);
});

test("descriptors respect the limit", () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, category: "C" }));
  assert.equal(productHeroDescriptors(many).length, 3);
  assert.equal(productHeroDescriptors(many, 2).length, 2);
});

test("colour specs lose their RAL-ish code and become English", () => {
  assert.equal(colorWordForPrompt("schwarz-150"), "black");
  assert.equal(colorWordForPrompt("Schwarz"), "black");
  assert.equal(colorWordForPrompt("weiß"), "white");
  assert.equal(colorWordForPrompt("anthrazit RAL 7016"), "anthracite grey");
  assert.equal(colorWordForPrompt("Schwarz / Rot"), "black / red");
  // Unmapped words survive rather than being dropped or mistranslated.
  assert.equal(colorWordForPrompt("bordeaux"), "bordeaux");
  for (const bad of [null, undefined, "", "   ", 42]) {
    assert.equal(colorWordForPrompt(bad), "");
  }
});

test("an alternative colour spec key is picked up", () => {
  const [d] = productHeroDescriptors([
    { name: "Bench", category: "Exercise Benches", specifications: { Ausführung: "grau-7" } },
  ]);
  assert.equal(d, "Bench (Exercise Benches, grey)");
});

// The tail must SUPERSEDE a prompt written before the brand rule existed,
// keeping the operator's own scene text.
test("a pre-brand-fidelity prompt gets the current tail, scene preserved", () => {
  const legacy =
    "A power rack on light concrete.\n\nPhotorealistic premium e-commerce hero shot in a " +
    "bright modern home gym: IMPORTANT COMPOSITION RULE: left 45% bright.";
  const updated = ensureHeroStyleTail(legacy);
  assert.ok(updated.startsWith("A power rack on light concrete."), "Szene bleibt erhalten");
  assert.ok(updated.includes("BRAND FIDELITY RULE"), "neue Regel ist drin");
  assert.ok(!updated.includes("left 45% bright."), "alter Schwanz ist ersetzt");
  // Idempotent once current.
  assert.equal(ensureHeroStyleTail(updated), updated);
});

// Both of these come from real catalogue rows — clean fixtures had missed them.
test("colour values separated by semicolons are each stripped and mapped", () => {
  assert.equal(colorWordForPrompt("schwarz-150; grau-17; chrom"), "black / grey");
});

test("a brand sitting mid-name is not prefixed a second time", () => {
  const [d] = productHeroDescriptors([
    {
      name: "150 kg ATX® Gym Bumper Plates - Vorteilspaket",
      brand: "ATX®",
      category: "Weight Plates",
      specifications: { Farbe: "schwarz-150; weiss" },
    },
  ]);
  assert.equal(d, "150 kg ATX® Gym Bumper Plates - Vorteilspaket (Weight Plates, black / white)");
  assert.equal(d.match(/ATX/g).length, 1);
});
