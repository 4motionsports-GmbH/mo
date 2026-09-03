// Unit tests for the hero-context helpers (node --test).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HERO_PROMPT_STYLE_TAIL,
  HERO_SCENE_INSTRUCTION,
  MAX_HERO_PROMPT_CHARS,
  MAX_HERO_SCENE_CHARS,
  clip,
  colorWordForPrompt,
  ensureHeroStyleTail,
  heroContextLines,
  loyaltyHint,
  normalizeHeroPrompt,
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
  assert.ok(out.endsWith(HERO_PROMPT_STYLE_TAIL), "adds the CURRENT tail verbatim");
  assert.ok(out.includes("WIDE LANDSCAPE"), "landscape rule present");
});

test("ensureHeroStyleTail appends to a bare scene", () => {
  const out = ensureHeroStyleTail("Just a scene.");
  assert.ok(out.startsWith("Just a scene."));
  assert.ok(out.endsWith(HERO_PROMPT_STYLE_TAIL));
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
  assert.ok(updated.endsWith(HERO_PROMPT_STYLE_TAIL), "aktueller Tail ist drin");
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

// ── Prompt length budget ─────────────────────────────────────────────────────
// Regression: the cap was a hard-coded 1500. Adding the BRAND FIDELITY RULE
// pushed the tail to 984 chars, leaving ~514 for a scene the drafter is asked
// to write in ~70 words — every "Bild generieren" failed with a 400. The cap is
// now DERIVED from the tail, and these guard that it stays livable.

test("the cap leaves the full scene budget on top of the tail", () => {
  assert.equal(
    MAX_HERO_PROMPT_CHARS,
    HERO_PROMPT_STYLE_TAIL.length + MAX_HERO_SCENE_CHARS + 8,
    "die Obergrenze muss aus dem Tail abgeleitet sein, keine feste Zahl"
  );
  assert.ok(
    MAX_HERO_PROMPT_CHARS - HERO_PROMPT_STYLE_TAIL.length >= MAX_HERO_SCENE_CHARS,
    "der Tail darf das Szenen-Budget nie aufzehren"
  );
});

test("a realistic scene with long catalogue product names fits", () => {
  // ~70 words, naming two real ATX descriptors verbatim — the worst case the
  // drafting instruction can produce.
  const scene =
    "A bright modern home gym corner where an ATX® Hardcore Power Rack & Pull " +
    "Station FCR-780 (Power Racks, black / grey) stands against a pale concrete " +
    "wall, its matte black uprights catching soft morning light, with a set of " +
    "150 kg ATX® Gym Bumper Plates - Vorteilspaket (Weight Plates, black / white) " +
    "stacked neatly on a low storage rack beside it, chalk dust settled on the " +
    "floor, the whole arrangement calm, uncluttered and ready for the next session.";
  const full = normalizeHeroPrompt(`${scene}\n\n${HERO_PROMPT_STYLE_TAIL}`);
  assert.ok(
    full.length <= MAX_HERO_PROMPT_CHARS,
    `realistischer Prompt (${full.length}) muss unter ${MAX_HERO_PROMPT_CHARS} bleiben`
  );
});

test("a scene at the exact budget still fits once the tail is appended", () => {
  const scene = "x".repeat(MAX_HERO_SCENE_CHARS);
  const full = normalizeHeroPrompt(`${scene}\n\n${HERO_PROMPT_STYLE_TAIL}`);
  assert.ok(full.length <= MAX_HERO_PROMPT_CHARS, `${full.length} > ${MAX_HERO_PROMPT_CHARS}`);
});

test("normalizeHeroPrompt collapses whitespace so route and generator agree", () => {
  assert.equal(normalizeHeroPrompt("  a\n\nb\t c  "), "a b c");
  assert.equal(normalizeHeroPrompt("scene\n\ntail").length, "scene tail".length);
  for (const bad of [null, undefined, 42, {}]) {
    assert.equal(typeof normalizeHeroPrompt(bad), "string");
  }
  assert.equal(normalizeHeroPrompt(null), "");
  assert.equal(normalizeHeroPrompt("   \n  "), "");
});

test("a runaway scene clipped to budget still yields a generatable prompt", () => {
  // The drafting model is asked for ~70 words but is not bound by it. Whatever
  // it returns, the suggestion must stay inside our own cap.
  const runaway = "word ".repeat(400).trim();
  const full = normalizeHeroPrompt(
    `${clip(runaway, MAX_HERO_SCENE_CHARS)}\n\n${HERO_PROMPT_STYLE_TAIL}`
  );
  assert.ok(
    full.length <= MAX_HERO_PROMPT_CHARS,
    `geklippter Vorschlag (${full.length}) muss unter ${MAX_HERO_PROMPT_CHARS} bleiben`
  );
});

// ── Scene instruction ⟷ style tail must agree ────────────────────────────────
// These two texts reach the image model together. They drifted apart once: an
// edit meant to allow brand names landed in the schema but silently missed the
// scene instruction, which kept telling the drafter that brand names mean
// nothing — so every prompt carried both messages at once.

test("the scene instruction asks for brand and product by name", () => {
  assert.match(HERO_SCENE_INSTRUCTION, /Marke und Produktbezeichnung wörtlich/);
  assert.doesNotMatch(
    HERO_SCENE_INSTRUCTION,
    /Markennamen sagen dem Bildmodell/,
    "die alte, widersprechende Anweisung darf nicht zurückkommen"
  );
});

test("both texts put the equipment on the right and keep the left empty", () => {
  assert.match(HERO_SCENE_INSTRUCTION, /RECHTS im Bild/);
  assert.match(HERO_SCENE_INSTRUCTION, /leeren hellen\s+Wand links|Wand links daneben/);
  assert.match(HERO_PROMPT_STYLE_TAIL, /LEFT 55% OF THE FRAME MUST STAY EMPTY/);
  assert.match(HERO_PROMPT_STYLE_TAIL, /RIGHT 40% of the/);
});

// The protected width must match the hero's actual text column
// (performance.ts: hero-text td is width="55%"). It was 45% once while the text
// column was 55%, so the headline sat over 10% of busy image.
test("the protected width matches the hero's text column", () => {
  assert.match(HERO_PROMPT_STYLE_TAIL, /LEFT 55%/, "Textspalte im Design ist 55% breit");
  assert.doesNotMatch(HERO_PROMPT_STYLE_TAIL, /left 45%/i);
});

test("the scene instruction caps the number of objects", () => {
  // Five named products fill the whole frame and destroy the empty left half —
  // that is what the live prompt did.
  assert.match(HERO_SCENE_INSTRUCTION, /HÖCHSTENS ZWEI Objekte/);
});

test("brand markings on the equipment are allowed, other lettering is not", () => {
  assert.match(HERO_PROMPT_STYLE_TAIL, /small brand lettering as it actually appears/);
  assert.match(HERO_PROMPT_STYLE_TAIL, /ONLY lettering allowed/);
  assert.match(HERO_PROMPT_STYLE_TAIL, /no headline text, no captions/);
  // The blanket ban that contradicted the brand requirement must be gone.
  assert.doesNotMatch(HERO_PROMPT_STYLE_TAIL, /no logos/);
  assert.doesNotMatch(HERO_PROMPT_STYLE_TAIL, /no brand markings on the/);
});

test("the composition rule leads the tail rather than being buried in it", () => {
  assert.ok(
    HERO_PROMPT_STYLE_TAIL.startsWith("COMPOSITION FIRST"),
    "die Layout-Regel muss vorne stehen — mittendrin wird sie überlesen"
  );
});

test("a prompt stored against the #172 tail is lifted to the current one", () => {
  // That tail began with "Photorealistic premium e-commerce hero shot"; the
  // current one begins with COMPOSITION FIRST, so the splitter must know both.
  const stored =
    "A squat rack by the window.\n\nPhotorealistic premium e-commerce hero shot in a " +
    "bright modern home gym: IMPORTANT COMPOSITION RULE: the left 45% … " +
    "BRAND FIDELITY RULE: … no logos, no brand markings on the equipment.";
  const out = ensureHeroStyleTail(stored);
  assert.ok(out.startsWith("A squat rack by the window."), "Szene bleibt erhalten");
  assert.ok(out.endsWith(HERO_PROMPT_STYLE_TAIL), "aktueller Tail hängt dran");
  assert.ok(!out.includes("left 45%"), "die falsche Breite ist weg");
  assert.ok(!out.includes("no brand markings"), "das Logo-Verbot ist weg");
  assert.equal(ensureHeroStyleTail(out), out, "idempotent");
});
