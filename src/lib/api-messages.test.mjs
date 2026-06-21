import { test } from "node:test";
import assert from "node:assert/strict";
import { apiMessage } from "./api-messages.mjs";

// German messages stay byte-identical to the strings that shipped before i18n;
// English is the /en variant.

test("German API messages are byte-identical to the shipped copy", () => {
  assert.equal(apiMessage("invalid_email", "de"), "Ungültige E-Mail-Adresse");
  assert.equal(
    apiMessage("transactional_consent_required", "de"),
    "Bitte bestätige die erste Checkbox — ohne deine Einwilligung können wir dir die Zusammenfassung nicht per E-Mail schicken."
  );
  assert.equal(
    apiMessage("consent_save_failed", "de"),
    "Einwilligung konnte nicht gespeichert werden — bitte später erneut versuchen."
  );
  assert.equal(apiMessage("conversation_not_found", "de"), "Konversation nicht gefunden");
  assert.equal(apiMessage("invalid_json", "de"), "Ungültiger JSON-Body");
  assert.equal(
    apiMessage("offer_expired_heading", "de"),
    "Dieses Angebot ist leider abgelaufen"
  );
});

test("English API messages are English and differ from German", () => {
  assert.equal(apiMessage("invalid_email", "en"), "Invalid email address");
  assert.equal(apiMessage("conversation_not_found", "en"), "Conversation not found");
  assert.equal(apiMessage("invalid_json", "en"), "Invalid JSON body");
  assert.match(apiMessage("transactional_consent_required", "en"), /tick the first checkbox/i);
  assert.match(apiMessage("offer_expired_heading", "en"), /expired/i);

  // Every catalogued id must localise (de present, en present, en ≠ de).
  const ids = [
    "invalid_json",
    "invalid_email",
    "transactional_consent_required",
    "consent_save_failed",
    "summary_delivery_failed",
    "contact_required_fields",
    "email_delivery_failed",
    "feedback_save_failed",
    "conversation_key_missing",
    "conversation_not_found",
    "invalid_conversation_id",
    "title_empty",
    "export_failed",
    "erase_failed",
    "marketing_consent_required",
    "customer_not_found",
    "no_verified_email",
    "offer_expired_title",
    "offer_expired_heading",
    "offer_expired_body",
    "offer_expired_cta",
  ];
  for (const id of ids) {
    const de = apiMessage(id, "de");
    const en = apiMessage(id, "en");
    assert.equal(typeof de, "string");
    assert.equal(typeof en, "string");
    assert.notEqual(en, de, `en/${id} must differ from de/${id}`);
  }
});

test("an unknown id returns the id itself (fails visibly, never throws)", () => {
  assert.equal(apiMessage("does_not_exist", "de"), "does_not_exist");
  assert.equal(apiMessage("does_not_exist", "en"), "does_not_exist");
});
