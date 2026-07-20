import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCampaignLanguage } from "./campaign-language.mjs";

test("locale wins: de* → de, anything else → en", () => {
  assert.equal(deriveCampaignLanguage({ locale: "de" }), "de");
  assert.equal(deriveCampaignLanguage({ locale: "de-DE" }), "de");
  assert.equal(deriveCampaignLanguage({ locale: "de_AT" }), "de");
  assert.equal(deriveCampaignLanguage({ locale: "DE" }), "de");
  assert.equal(deriveCampaignLanguage({ locale: "en" }), "en");
  assert.equal(deriveCampaignLanguage({ locale: "en-GB" }), "en");
  // A non-German, non-English locale is NOT German — the customer chose
  // another language, so English is the safer of our two.
  assert.equal(deriveCampaignLanguage({ locale: "fr" }), "en");
  // Locale beats country when both are present.
  assert.equal(deriveCampaignLanguage({ locale: "en", countryCode: "DE" }), "en");
  assert.equal(deriveCampaignLanguage({ locale: "de", countryCode: "US" }), "de");
});

test("country fallback: DE/AT/CH → de, elsewhere → en", () => {
  assert.equal(deriveCampaignLanguage({ countryCode: "DE" }), "de");
  assert.equal(deriveCampaignLanguage({ countryCode: "AT" }), "de");
  assert.equal(deriveCampaignLanguage({ countryCode: "CH" }), "de");
  assert.equal(deriveCampaignLanguage({ countryCode: "ch" }), "de");
  assert.equal(deriveCampaignLanguage({ countryCode: "US" }), "en");
  assert.equal(deriveCampaignLanguage({ countryCode: "FR" }), "en");
});

test("final fallback is German (German store default)", () => {
  assert.equal(deriveCampaignLanguage({}), "de");
  assert.equal(deriveCampaignLanguage({ locale: null, countryCode: null }), "de");
  assert.equal(deriveCampaignLanguage({ locale: "  ", countryCode: "" }), "de");
  assert.equal(deriveCampaignLanguage(), "de");
});
