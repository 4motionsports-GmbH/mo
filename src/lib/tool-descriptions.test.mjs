import { test } from "node:test";
import assert from "node:assert/strict";
import { toolCopy } from "./tool-descriptions.mjs";

// The German tool copy is the model-facing instruction set that shipped before
// i18n — it must stay byte-identical at the anchors; English is the /en variant.

test("German tool copy keeps its byte-identical anchors", () => {
  const de = toolCopy("de");
  assert.match(de.updateProfileDesc, /^Aktualisiert das Kundenprofil basierend auf neuen Signalen/);
  assert.match(de.searchDesc, /^Sucht im gesamten Produktkatalog/);
  assert.equal(de.fieldSpaceM2, "Verfügbare Stellfläche in m².");
  assert.match(de.offerDesc, /DSGVO-konformes Erfassungsformular/);
});

test("English tool copy switches language for every key", () => {
  const de = toolCopy("de");
  const en = toolCopy("en");
  for (const key of Object.keys(de)) {
    assert.equal(typeof en[key], "string");
    assert.notEqual(en[key], "", `en.${key} must not be empty`);
    assert.notEqual(en[key], de[key], `en.${key} must differ from de.${key}`);
  }
  assert.match(en.updateProfileDesc, /^Updates the customer profile/);
  assert.match(en.searchDesc, /^Searches the entire product catalog/);
  assert.equal(en.fieldSpaceM2, "Available footprint in m².");
  assert.match(en.offerDesc, /GDPR-compliant capture form/);
});

test("an unsupported locale falls back to the German tool copy", () => {
  assert.deepEqual(toolCopy("fr"), toolCopy("de"));
});
