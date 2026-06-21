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
