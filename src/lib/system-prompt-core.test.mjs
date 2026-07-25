import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildSystemPrompt,
  getPersonaAddendum,
  renderProfileForPrompt,
  productPivotNote,
  browsingPivotNote,
  greetingTriggerText,
} from "./system-prompt-core.mjs";
import {
  emptyProfile,
  fullProfile,
  product,
  goldenCases,
  SEP,
} from "./system-prompt-core.fixtures.mjs";

// The German prompt MUST stay byte-identical to what shipped before i18n (no
// regression). The shared fixtures + the committed golden pin it; the English
// path is asserted to actually switch language without leaking German copy.

test("German prompt is byte-identical to the committed golden (no regression)", () => {
  const goldenPath = fileURLToPath(
    new URL("./system-prompt-core.de.golden.txt", import.meta.url)
  );
  const golden = readFileSync(goldenPath, "utf8");
  const actual = goldenCases()
    .map((c) => buildSystemPrompt({ ...c, locale: "de" }))
    .join(SEP);
  assert.equal(actual, golden);
});

test("default locale is German (omitting locale === passing 'de')", () => {
  const base = { profile: emptyProfile(), archetype: "unknown", retrievedProducts: [] };
  assert.equal(buildSystemPrompt(base), buildSystemPrompt({ ...base, locale: "de" }));
});

test("English prompt switches language and carries the same structure", () => {
  const en = buildSystemPrompt({
    profile: fullProfile(),
    archetype: "pragmatic_beginner",
    retrievedProducts: [product()],
    locale: "en",
  });
  // English persona + knowledge present…
  assert.match(en, /^You are Mo, the AI fitness advisor of motion sports/);
  assert.match(en, /## Your personality/);
  assert.match(en, /14-day right of return \(statutory EU right of withdrawal\)/);
  assert.match(en, /## Consulting mode: Pragmatic Beginner/);
  assert.match(en, /You reply in English, unless the customer writes in another language\./);
  // …and the German base copy must NOT leak into the English prompt.
  assert.doesNotMatch(en, /Du bist Mo, der KI-Fitnessberater/);
  assert.doesNotMatch(en, /14 Tage Rückgaberecht/);
  assert.doesNotMatch(en, /## Deine Persönlichkeit/);
});

// New admin-data fields (rating, accessories/related, >5 specs) must reach the
// pre-retrieved product block in both locales. The golden fixtures predate
// these fields, so this pins the rendering separately.
test("retrieved-product block renders rating, accessories and related products", () => {
  const rich = {
    ...product(),
    detailedDescription:
      "Die Multipresse im Detail.\nTechnische Daten: Breite: 2000 mm Höhe: 2195 mm Belastbarkeit: Rahmenlast 650 kg",
    rating: 4.7,
    ratingCount: 23,
    compatibleWith: ["atx-hantelscheiben-50", "atx-j-hooks"],
    relatedProducts: ["atx-power-rack-620"],
    specifications: Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`Spec${i + 1}`, `v${i + 1}`])
    ),
  };
  const de = buildSystemPrompt({
    profile: emptyProfile(),
    archetype: "unknown",
    retrievedProducts: [rich],
    locale: "de",
  });
  assert.match(de, /- Kundenbewertung: 4\.7\/5 \(23 Bewertungen\)/);
  // The long description (incl. Kurztext) reaches the block, newline-collapsed.
  assert.match(
    de,
    /- Details: Die Multipresse im Detail\. Technische Daten: Breite: 2000 mm/
  );
  assert.match(de, /- Passendes Zubehör \(Produkt-IDs\): atx-hantelscheiben-50, atx-j-hooks/);
  assert.match(de, /- Ähnliche Produkte \(Produkt-IDs\): atx-power-rack-620/);
  // Spec cap raised to 10 — the 10th survives, the 11th is trimmed.
  assert.match(de, /Spec10=v10/);
  assert.doesNotMatch(de, /Spec11=v11/);

  const en = buildSystemPrompt({
    profile: emptyProfile(),
    archetype: "unknown",
    retrievedProducts: [rich],
    locale: "en",
  });
  assert.match(en, /- Customer rating: 4\.7\/5 \(23 reviews\)/);
  assert.match(en, /- Matching accessories \(product ids\): atx-hantelscheiben-50, atx-j-hooks/);
  assert.match(en, /- Related products \(product ids\): atx-power-rack-620/);
});

// The "Wissen" feature: product-level Q&A renders inside the product card;
// general Q&A gets its own knowledge-base section; both absent → byte-identical
// prompt (pinned by the golden, which passes no generalQa and no product qa).
test("Q&A knowledge reaches the prompt (product-level + general block)", () => {
  const withQa = {
    ...product(),
    qa: [
      {
        question: "Welche Deckenhöhe brauche ich?",
        answer: "Mindestens 2,30 m — das Gerät ist 2.195 mm hoch.",
      },
    ],
  };
  const de = buildSystemPrompt({
    profile: emptyProfile(),
    archetype: "unknown",
    retrievedProducts: [withQa],
    generalQa: [
      {
        question: "Bietet motion sports Ratenzahlung an?",
        answer: "Ja, über Klarna in 3 Raten.",
      },
    ],
    locale: "de",
  });
  assert.match(de, /- Geprüfte Kunden-Q&A:/);
  assert.match(de, /Frage: Welche Deckenhöhe brauche ich\? → Antwort: Mindestens 2,30 m/);
  assert.match(de, /## Wissensbasis aus Kundenfragen \(vom motion sports Team beantwortet & geprüft\)/);
  assert.match(de, /- Frage: Bietet motion sports Ratenzahlung an\?\n {2}Antwort: Ja, über Klarna in 3 Raten\./);

  // Empty generalQa → no knowledge-base section at all.
  const bare = buildSystemPrompt({
    profile: emptyProfile(),
    archetype: "unknown",
    retrievedProducts: [product()],
    generalQa: [],
    locale: "de",
  });
  assert.doesNotMatch(bare, /Wissensbasis aus Kundenfragen/);
});

test("German prompt keeps the corrected 14-day return info (both locales agree on 14)", () => {
  const de = buildSystemPrompt({ profile: emptyProfile(), archetype: "unknown", retrievedProducts: [], locale: "de" });
  const en = buildSystemPrompt({ profile: emptyProfile(), archetype: "unknown", retrievedProducts: [], locale: "en" });
  assert.match(de, /14 Tage Rückgaberecht/);
  assert.match(en, /14-day right of return/);
});

test("persona addendum localises every archetype (en has no German heading)", () => {
  const archetypes = [
    "pragmatic_beginner",
    "ambitious_home_athlete",
    "strength_focused",
    "cardio_focused",
    "studio_operator",
    "physio",
    "public_sector",
    "unknown",
  ];
  for (const a of archetypes) {
    const de = getPersonaAddendum(a, "de");
    const en = getPersonaAddendum(a, "en");
    assert.match(de, /^## Beratungsmodus:/);
    assert.match(en, /^## Consulting mode:/);
    assert.notEqual(de, en);
  }
});

test("profile rendering localises labels", () => {
  const p = fullProfile();
  assert.match(renderProfileForPrompt(p, "de"), /## Aktuelles Kundenprofil/);
  assert.match(renderProfileForPrompt(p, "en"), /## Current customer profile/);
});

test("pivot + greeting trigger notes localise", () => {
  const ctx = { id: "p1", name: "Rack X" };
  assert.match(productPivotNote(ctx, "de"), /Hinweis aus dem Storefront/);
  assert.match(productPivotNote(ctx, "en"), /Note from the storefront/);
  const browse = { products: [{ id: "p1", name: "Rack X", inStock: true }], categories: [] };
  assert.match(browsingPivotNote(browse, "de"), /Hinweis aus dem Storefront/);
  assert.match(browsingPivotNote(browse, "en"), /Note from the storefront/);
  assert.match(greetingTriggerText("de", { productName: "Rack X" }), /begrüße den Nutzer/);
  assert.match(greetingTriggerText("en", { productName: "Rack X" }), /greet the user/);
  assert.match(greetingTriggerText("de", {}), /sich der Nutzer im Shop umgesehen/);
  assert.match(greetingTriggerText("en", {}), /browsed the shop/);
});
