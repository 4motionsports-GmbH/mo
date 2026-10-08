import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consentStrings,
  CONSENT_COPY_EN_LEGAL_REVIEWED,
  DOI_MAIL_SUBJECTS,
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

test("German v4 strings (chat gate + upgraded headlines) are byte-identical to the approved copy", () => {
  const de = consentStrings("de");
  // Headlines — benefit framing (personalised offers + exclusive discount
  // promotions), NOT part of the consentTextShown audit string.
  assert.equal(
    de.signinHeadline,
    "Persönliche Angebote und exklusive Rabatt-Aktionen — direkt an deine hinterlegte E-Mail-Adresse."
  );
  assert.equal(
    de.chatGateHeadline,
    "Persönliche Angebote und exklusive Rabatt-Aktionen — abgestimmt auf deine Beratung."
  );
  // Chat-gate consent label (typed email, marketing-only) — IS consent text.
  assert.equal(
    de.chatGateLabel,
    "Ja, schickt mir persönliche Angebote und exklusive Rabatt-Aktionen an diese E-Mail-Adresse — nur für Abonnenten. Jederzeit abbestellbar."
  );
  // The sign-in label is unchanged from v3.
  assert.equal(
    de.signinLabel,
    "Ja, schickt mir an meine hinterlegte E-Mail-Adresse exklusive Angebote und Aktionen — nur für Abonnenten. Jederzeit abbestellbar."
  );
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

test("English consent copy is approved as a translation of the German (D-AP3)", () => {
  assert.equal(CONSENT_COPY_EN_LEGAL_REVIEWED, true);
});

test("the approved English consent strings are pinned (a change is a new review and a version bump)", () => {
  const en = consentStrings("en");
  assert.equal(en.marketingLabel, "Yes, I'd like to receive exclusive offers and promotions — subscribers only. Unsubscribe any time.");
  assert.equal(en.consentFooter, "Processing by motion sports in accordance with the privacy policy; withdrawal possible at any time.");
  assert.equal(en.signinLabel, "Yes, send exclusive offers and promotions to my stored email address — subscribers only. Unsubscribe any time.");
  assert.equal(en.chatGateLabel, "Yes, send personalised offers and exclusive discount promotions to this email address — subscribers only. Unsubscribe any time.");
  assert.equal(en.transactionalLabel, "Yes, send me my consultation summary by email (incl. a direct link to checkout).");
});

test("an unsupported locale falls back to the German copy", () => {
  // consentStrings is `en` only for exactly "en"; everything else → German.
  assert.deepEqual(consentStrings("fr"), consentStrings("de"));
});

test("DOI_MAIL_SUBJECTS holds every current DOI subject and never drops an older one (append-only)", () => {
  // verify:live section 10 finds DOI mails in email_messages by these subjects.
  assert.ok(DOI_MAIL_SUBJECTS.includes(consentStrings("de").doiSubject), "current German subject missing — append it");
  assert.ok(DOI_MAIL_SUBJECTS.includes(consentStrings("en").doiSubject), "current English subject missing — append it");
  // The subjects sent since the first DOI mail; new ones go after them.
  assert.deepEqual(DOI_MAIL_SUBJECTS.slice(0, 2), [
    "Bitte bestätige deine Anmeldung bei motion sports",
    "Please confirm your sign-up with motion sports",
  ]);
  assert.equal(new Set(DOI_MAIL_SUBJECTS).size, DOI_MAIL_SUBJECTS.length);
  assert.ok(Object.isFrozen(DOI_MAIL_SUBJECTS));
  // A reply („Re: …“) is not a DOI mail.
  assert.ok(!DOI_MAIL_SUBJECTS.some((s) => s.startsWith("Re:")));
});
