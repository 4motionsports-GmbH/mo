import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isLocale,
  normalizeLocale,
  pick,
  withLocaleParam,
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

test("withLocaleParam adds locale=en for English only, with the right separator", () => {
  assert.equal(withLocaleParam("https://x.de/api/r/tok", "en"), "https://x.de/api/r/tok?locale=en");
  assert.equal(
    withLocaleParam("https://x.de/api/unsubscribe?token=a.b", "en"),
    "https://x.de/api/unsubscribe?token=a.b&locale=en"
  );
  assert.equal(withLocaleParam("https://x.de/api/r/tok", "en-GB"), "https://x.de/api/r/tok?locale=en");
  // German (and anything unknown) leaves the link byte-identical — old links stay German.
  assert.equal(withLocaleParam("https://x.de/api/r/tok", "de"), "https://x.de/api/r/tok");
  assert.equal(withLocaleParam("https://x.de/api/r/tok", null), "https://x.de/api/r/tok");
  assert.equal(withLocaleParam("https://x.de/api/r/tok", "fr"), "https://x.de/api/r/tok");
});
