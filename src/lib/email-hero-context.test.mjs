// Unit tests for the hero-context helpers (node --test).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clip,
  heroContextLines,
  loyaltyHint,
  ownedProductTitles,
  productCategories,
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
