// ⚠️ CONSENT / LEGAL COPY — locale-aware. Kept in plain .mjs (pure) so the
// standalone display strings are unit-testable (German-unchanged + English-path)
// and shared by consent-copy.ts. See that file's header for the DOI / Art. 7
// background.
//
// GERMAN (de): LAWYER-APPROVED (June 2026). Byte-identical to the strings that
// shipped before i18n — any change is a new legal review.
//
// ENGLISH (en): ⚠️ NOT YET LEGALLY REVIEWED. CONSENT_COPY_EN_LEGAL_REVIEWED is
// false. The English consent / DOI / refund / unsubscribe copy below is a
// faithful translation of the approved German, provided so the /en storefront is
// functional — but it MUST get a human/legal review (English-market GDPR/UWG
// equivalents, refund-period wording) before it is relied upon. The flag is
// surfaced in the served payload (consentCopy.enLegalReviewed) so the widget /
// legal can gate on it.

/**
 * Whether the ENGLISH consent/legal copy has been legally reviewed. German is
 * approved (CONSENT_COPY_LAWYER_APPROVED in consent-copy.ts); English is NOT —
 * deliberately surfaced so nothing relies on unreviewed legal text silently.
 */
export const CONSENT_COPY_EN_LEGAL_REVIEWED = false;

/**
 * All the standalone consent/DOI/unsubscribe display strings for one locale.
 * The German values are verbatim the lawyer-approved copy; English is the
 * (not-yet-reviewed) translation.
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
  // At-sign-in marketing opt-in.
  signinHeadline: "Bleib auf dem Laufenden — als angemeldete:r Kund:in.",
  signinLabel:
    "Ja, schickt mir an meine hinterlegte E-Mail-Adresse exklusive Angebote und Aktionen — nur für Abonnenten. Jederzeit abbestellbar.",
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
  signinHeadline: "Stay in the loop — as a signed-in customer.",
  signinLabel:
    "Yes, send exclusive offers and promotions to my stored email address — subscribers only. Unsubscribe any time.",
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
