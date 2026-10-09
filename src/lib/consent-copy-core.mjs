// ⚠️ CONSENT / LEGAL COPY — locale-aware. Kept in plain .mjs (pure) so the
// standalone display strings are unit-testable (German-unchanged + English-path)
// and shared by consent-copy.ts. See that file's header for the DOI / Art. 7
// background.
//
// GERMAN (de): LAWYER-APPROVED. The v3 set was approved June 2026; the v4
// additions/changes (chat consent-gate strings + the upgraded personalised-
// offers headlines, plus the button-consent mechanic) were approved July 2026.
// Any wording change is a new legal review.
//
// ENGLISH (en): APPROVED AS A TRANSLATION (05.10.2026, owner decision D-AP3):
// the English consent / DOI / refund / unsubscribe copy below is a faithful
// translation of the approved German and is approved as such — checked string
// by string against the German on all three surfaces (capture form, sign-in
// opt-in, chat consent gate) and the DOI mail; no wording changed, so the
// served version and every consentTextShown stay the same. A wording change in
// either language is a new review. The flag rides in the served payload
// (consentCopy.enLegalReviewed).

/**
 * Whether the ENGLISH consent/legal copy is approved. German is lawyer-approved
 * (CONSENT_COPY_LAWYER_APPROVED in consent-copy.ts); English is approved as a
 * faithful translation of it (D-AP3, 05.10.2026).
 */
export const CONSENT_COPY_EN_LEGAL_REVIEWED = true;

/**
 * All the standalone consent/DOI/unsubscribe display strings for one locale.
 * The German values are verbatim the lawyer-approved copy; English is the
 * approved translation (D-AP3).
 *
 * @param {"de" | "en"} locale
 */
export function consentStrings(locale) {
  return locale === "en" ? EN : DE;
}

const DE = {
  // (A) Transactional consent — checkbox label.
  transactionalLabel:
    "Ja, schickt mir meine Beratungs-Zusammenfassung per E-Mail (inkl. Direkt-Link zur Kasse).",
  // (B) Marketing consent — checkbox label (separate, never pre-checked).
  marketingLabel:
    "Ja, ich möchte exklusive Angebote und Aktionen erhalten — nur für Abonnenten. Jederzeit abbestellbar.",
  // Shared Art. 7 footer beneath the checkboxes.
  consentFooter:
    "Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.",
  // Returning-customer hint near the email input (informational — NOT consent).
  returningHint:
    "Schon einmal von Mo beraten worden? Gib deine E-Mail an — Mo erkennt dich wieder und knüpft an deine letzte Beratung an.",
  // At-sign-in marketing opt-in. Headline is v4 (upgraded personalised-offers
  // benefit framing, lawyer-approved July 2026) — framing only, NOT part of the
  // consentTextShown audit string. The label is unchanged from v3.
  signinHeadline:
    "Persönliche Angebote und exklusive Rabatt-Aktionen — direkt an deine hinterlegte E-Mail-Adresse.",
  signinLabel:
    "Ja, schickt mir an meine hinterlegte E-Mail-Adresse exklusive Angebote und Aktionen — nur für Abonnenten. Jederzeit abbestellbar.",
  // Chat consent gate (v4): anonymous typed-email, MARKETING-ONLY signup shown
  // once per session after the first chat message. The headline sells
  // personalised offers + exclusive discount promotions (lawyer-approved
  // benefit framing, July 2026) and is NOT part of consentTextShown; the label
  // + shared footer ARE the consent text.
  chatGateHeadline:
    "Persönliche Angebote und exklusive Rabatt-Aktionen — abgestimmt auf deine Beratung.",
  chatGateLabel:
    "Ja, schickt mir persönliche Angebote und exklusive Rabatt-Aktionen an diese E-Mail-Adresse — nur für Abonnenten. Jederzeit abbestellbar.",
  // Email subjects.
  doiSubject: "Bitte bestätige deine Anmeldung bei motion sports",
  summarySubject: "Deine Beratung bei motion sports — Zusammenfassung & Warenkorb",
  // DOI confirmation page.
  doiConfirmedHeading: "Danke, deine Anmeldung ist bestätigt.",
  doiConfirmedBody:
    "Du erhältst ab jetzt persönliche Empfehlungen und Angebote von motion sports. Du kannst dich jederzeit über den Abmeldelink in jeder E-Mail wieder abmelden.",
  doiInvalidHeading: "Dieser Bestätigungslink ist ungültig oder abgelaufen.",
  doiInvalidBody:
    "Bitte fordere im Chat erneut eine Zusammenfassung an, wenn du dich für Empfehlungen und Angebote anmelden möchtest.",
  // Unsubscribe confirmation page.
  unsubscribeConfirmedHeading: "Du wurdest abgemeldet.",
  unsubscribeConfirmedBody:
    "Wir senden dir keine weiteren Marketing-E-Mails mehr. Deine E-Mail-Adresse wurde auf unsere Sperrliste gesetzt.",
  unsubscribeInvalidHeading: "Dieser Abmeldelink ist ungültig.",
  unsubscribeInvalidBody: "Bitte nutze den Abmeldelink aus einer unserer E-Mails.",
};

const EN = {
  transactionalLabel:
    "Yes, send me my consultation summary by email (incl. a direct link to checkout).",
  marketingLabel:
    "Yes, I'd like to receive exclusive offers and promotions — subscribers only. Unsubscribe any time.",
  consentFooter:
    "Processing by motion sports in accordance with the privacy policy; withdrawal possible at any time.",
  returningHint:
    "Been advised by Mo before? Enter your email — Mo recognises you and picks up where your last consultation left off.",
  signinHeadline:
    "Personalised offers and exclusive discount promotions — straight to your stored email address.",
  signinLabel:
    "Yes, send exclusive offers and promotions to my stored email address — subscribers only. Unsubscribe any time.",
  chatGateHeadline:
    "Personalised offers and exclusive discount promotions — tailored to your consultation.",
  chatGateLabel:
    "Yes, send personalised offers and exclusive discount promotions to this email address — subscribers only. Unsubscribe any time.",
  doiSubject: "Please confirm your sign-up with motion sports",
  summarySubject: "Your consultation at motion sports — summary & cart",
  doiConfirmedHeading: "Thanks, your sign-up is confirmed.",
  doiConfirmedBody:
    "From now on you'll receive personal recommendations and offers from motion sports. You can unsubscribe at any time via the unsubscribe link in every email.",
  doiInvalidHeading: "This confirmation link is invalid or has expired.",
  doiInvalidBody:
    "Please request a summary again in the chat if you'd like to sign up for recommendations and offers.",
  unsubscribeConfirmedHeading: "You've been unsubscribed.",
  unsubscribeConfirmedBody:
    "We won't send you any further marketing emails. Your email address has been added to our suppression list.",
  unsubscribeInvalidHeading: "This unsubscribe link is invalid.",
  unsubscribeInvalidBody: "Please use the unsubscribe link from one of our emails.",
};

/**
 * Every DOI-mail subject Mo has ever sent, in any locale — APPEND-ONLY.
 * `email_messages` stores no send kind, so `npm run verify:live` section 10
 * („Einmal-Garantie“) recognises a DOI mail in the mail log by its subject.
 * When a `doiSubject` above changes, add the new string here and keep the old
 * one, or older mails drop out of the count (the test pins both rules).
 */
export const DOI_MAIL_SUBJECTS = Object.freeze([
  "Bitte bestätige deine Anmeldung bei motion sports",
  "Please confirm your sign-up with motion sports",
]);
