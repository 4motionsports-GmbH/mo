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

test("get_order_status copy: own orders only, no identification questions, actions go to the form", () => {
  const de = toolCopy("de");
  const en = toolCopy("en");
  assert.match(de.orderStatusDesc, /^Schlägt den Stand der EIGENEN Bestellungen/);
  assert.match(de.orderStatusDesc, /frage NIE nach E-Mail-Adresse/);
  assert.match(de.orderStatusDesc, /keine Bestellnummern, Beträge oder Sendungsnummern/);
  assert.match(de.orderStatusDesc, /show_contact_form mit reason="order_support"/);
  assert.match(en.orderStatusDesc, /^Looks up the state of the customer's OWN orders/);
  assert.match(en.orderStatusDesc, /NEVER ask for an email address/);
  assert.match(en.orderStatusDesc, /show_contact_form with reason="order_support"/);
  // Every state and payment value of the core is explained to the model.
  for (const c of [de, en]) {
    for (const v of [
      "not_shipped", "being_prepared", "partially_shipped", "shipped", "in_transit", "out_for_delivery",
      "delivered", "delivery_problem", "on_hold", "cancelled",
      "paid", "pending", "refunded_partial", "refunded_full", "voided",
      "sign_in_required", "unavailable", "not_found", "no_orders",
    ]) {
      assert.ok(c.orderStatusDesc.includes(v), v);
    }
  }
});

test("the contact-form variant for get_order_status changes only the order_support bullet", () => {
  for (const locale of ["de", "en"]) {
    const c = toolCopy(locale);
    // The replaced passage was found (otherwise the variant equals the base).
    assert.notEqual(c.contactDescOrderStatus, c.contactDesc, locale);
    assert.match(c.contactDescOrderStatus, /get_order_status/);
    assert.doesNotMatch(c.contactDesc, /get_order_status/);
    // Same head and tail as the base copy.
    const head = c.contactDesc.split("order_support")[0];
    assert.ok(c.contactDescOrderStatus.startsWith(head), locale);
    const tail = c.contactDesc.slice(c.contactDesc.indexOf("- When a matter") >= 0 ? c.contactDesc.indexOf("- When a matter") : c.contactDesc.indexOf("- Wenn ein Anliegen"));
    assert.ok(tail.length > 50 && c.contactDescOrderStatus.endsWith(tail), locale);
  }
  // The base (switch off) still routes order status to the form, as before.
  assert.match(toolCopy("de").contactDesc, /Bestellstatus\/Sendungsverfolgung, eine Retoure/);
});
