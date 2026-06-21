import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isLocale,
  normalizeLocale,
  pick,
} from "./locale.mjs";

test("default locale is German and the supported set is de + en", () => {
  assert.equal(DEFAULT_LOCALE, "de");
  assert.deepEqual([...SUPPORTED_LOCALES].sort(), ["de", "en"]);
});

test("isLocale only accepts the two supported codes", () => {
  assert.equal(isLocale("de"), true);
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("EN"), false);
  assert.equal(isLocale("fr"), false);
  assert.equal(isLocale(null), false);
  assert.equal(isLocale(undefined), false);
});

test("normalizeLocale resolves English variants and fails soft to German", () => {
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("EN"), "en");
  assert.equal(normalizeLocale("en-GB"), "en");
  assert.equal(normalizeLocale("en_US"), "en");
  assert.equal(normalizeLocale("de"), "de");
  assert.equal(normalizeLocale("de-DE"), "de");
  // Anything unsupported / malformed → German (never throws, never escalates).
  assert.equal(normalizeLocale("fr"), "de");
  assert.equal(normalizeLocale(""), "de");
  assert.equal(normalizeLocale("   "), "de");
  assert.equal(normalizeLocale(null), "de");
  assert.equal(normalizeLocale(undefined), "de");
  assert.equal(normalizeLocale(42), "de");
});

test("pick returns the locale's value and falls back to German", () => {
  assert.equal(pick("de", { de: "A", en: "B" }), "A");
  assert.equal(pick("en", { de: "A", en: "B" }), "B");
  // A map without an `en` entry degrades to German rather than undefined.
  assert.equal(pick("en", { de: "only-de" }), "only-de");
});
