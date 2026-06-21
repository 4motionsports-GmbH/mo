import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consentStrings,
  CONSENT_COPY_EN_LEGAL_REVIEWED,
} from "./consent-copy-core.mjs";

// The German values are lawyer-approved and MUST stay byte-identical (no
// regression). English is the /en translation — present, English, and flagged
// as NOT legally reviewed.

test("German consent strings are byte-identical to the lawyer-approved copy", () => {
  const de = consentStrings("de");
  assert.equal(
    de.transactionalLabel,
    "Ja, schickt mir meine Beratungs-Zusammenfassung per E-Mail (inkl. Direkt-Link zur Kasse)."
  );
  assert.equal(
    de.marketingLabel,
    "Ja, ich möchte exklusive Angebote und Aktionen erhalten — nur für Abonnenten. Jederzeit abbestellbar."
  );
  assert.equal(
    de.consentFooter,
    "Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich."
  );
  assert.equal(de.doiSubject, "Bitte bestätige deine Anmeldung bei motion sports");
  assert.equal(
    de.summarySubject,
    "Deine Beratung bei motion sports — Zusammenfassung & Warenkorb"
  );
  assert.equal(de.doiConfirmedHeading, "Danke, deine Anmeldung ist bestätigt.");
  assert.equal(de.unsubscribeConfirmedHeading, "Du wurdest abgemeldet.");
  assert.equal(de.unsubscribeInvalidHeading, "Dieser Abmeldelink ist ungültig.");
});

test("English consent strings are present, in English, and distinct from German", () => {
  const de = consentStrings("de");
  const en = consentStrings("en");
  for (const key of Object.keys(de)) {
    assert.equal(typeof en[key], "string");
    assert.notEqual(en[key], "", `en.${key} must not be empty`);
    assert.notEqual(en[key], de[key], `en.${key} must differ from de.${key}`);
  }
  // Spot-check the legally load-bearing ones read as English.
  assert.match(en.transactionalLabel, /summary by email/i);
  assert.match(en.doiSubject, /confirm your sign-up/i);
  assert.match(en.summarySubject, /summary/i);
  assert.match(en.unsubscribeConfirmedHeading, /unsubscribed/i);
});

test("English consent copy is flagged NOT legally reviewed (pending human/legal eye)", () => {
  assert.equal(CONSENT_COPY_EN_LEGAL_REVIEWED, false);
});

test("an unsupported locale falls back to the German copy", () => {
  // consentStrings is `en` only for exactly "en"; everything else → German.
  assert.deepEqual(consentStrings("fr"), consentStrings("de"));
});
