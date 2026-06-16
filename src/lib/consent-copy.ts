// ⚠️ CONSENT COPY — LAWYER-APPROVED (CONSENT_COPY_LAWYER_APPROVED = true) ⚠️
//
// The German-facing DOI / marketing / personalisation / transactional copy in
// this file has been REVIEWED AND APPROVED by a lawyer (June 2026), so
// CONSENT_COPY_LAWYER_APPROVED is true. Treat these strings as approved: any
// wording change is a new legal review.
//
// German marketing email to non-purchasers requires a double opt-in (DOI) and
// two *separate*, unbundled consents:
//
//   (A) TRANSACTIONAL — the user asks us to email a copy of the conversation +
//       their cart. A service they request (lawful under Art. 6(1)(b)); no DOI
//       needed, sent immediately.
//   (B) MARKETING — permission to contact them later with personalised offers.
//       Needs a SEPARATE, unchecked-by-default checkbox, explicit text, AND a
//       double opt-in (a confirmation link that must be clicked before any
//       marketing is sent).
//
// Pre-ticked boxes are invalid. Every marketing email needs a working
// unsubscribe link. The exact text shown to the user is stored verbatim with
// the capture (consent_text_shown) as Art. 7 proof.
//
// See docs/CONSENT_FLOW.md for the full flow and the lawyer-review TODO list.

import {
  renderBrandedEmail,
  escapeAttr,
  escapeHtml,
  EMAIL_TEXT_STYLE,
  EMAIL_MUTED_TEXT_STYLE,
} from "./email-template";
import {
  CONSENT_COPY_VERSION,
  composeConsentTextShown,
} from "./consent-copy-version.mjs";

export { CONSENT_COPY_VERSION };

/**
 * Whether the DOI / marketing / personalisation consent copy has been legally
 * approved. Kept as a runtime-visible constant (not just a comment) so the
 * widget payload and the personalisation gate can read a single source of
 * truth. Lawyer-approved June 2026 → true. (The §7(3) Bestandskunden path has
 * its OWN gate, BESTANDSKUNDE_SENDS_APPROVED, which is separate from this.)
 */
export const CONSENT_COPY_LAWYER_APPROVED = true as const;

// ---------------------------------------------------------------------------
// Checkbox labels (rendered by the widget's capture form) — COPY v2
// ---------------------------------------------------------------------------
//
// v2 (client-approved product decision, June 2026): shorter labels, a shared
// one-line Art. 7 footer, and — new versus v1 — BOTH checkboxes start
// UNCHECKED. The version identifier lives in consent-copy-version.mjs
// (CONSENT_COPY_VERSION) and is stored alongside consent_text_shown on every
// capture so v1 and v2 audit records stay distinguishable.

/**
 * (A) Transactional consent — checkbox label. Must be true to submit — it's
 * the very service the user is requesting (Art. 6(1)(b)), not marketing.
 *
 * ⚠️ v2 DECISION — THIS BOX NOW STARTS UNCHECKED TOO (changed from v1, where
 * pre-checking was permitted). The user must actively tick it to get the
 * summary; a submit without it is rejected server-side with the documented
 * `transactional_consent_required` error (see capture-validation.mjs and
 * API_CONTRACT.md §7.1). Lawyer-approved (CONSENT_COPY_LAWYER_APPROVED).
 */
export const TRANSACTIONAL_CHECKBOX_LABEL =
  "Ja, schickt mir meine Beratungs-Zusammenfassung per E-Mail (inkl. Direkt-Link zur Kasse).";

/**
 * (B) Marketing consent — checkbox label. MUST be a SEPARATE checkbox, never
 * bundled with (A).
 *
 * ⚠️ DECISION — THIS BOX IS NEVER PRE-CHECKED. Pre-ticked marketing consent
 * is invalid under the GDPR's clear-affirmative-act requirement (Art. 4(11),
 * Art. 7(2); CJEU C-673/17 "Planet49") and a classic Abmahnung trigger under
 * the German UWG. We deliberately reject pre-checking it, regardless of what
 * other platforms do. Opt-ins are won honestly — through the benefit-led
 * label — not through a pre-tick. The widget MUST render it UNCHECKED and
 * visually independent of (A); making it PROMINENT (placement, styling) is
 * fine and encouraged.
 *
 * COPY CEILING (UWG / dark-pattern exposure — agreed with the client): the
 * label promises "exklusive Angebote …, nur für Abonnenten" and NOTHING more.
 * Accurate scarcity only — NEVER add countdowns, invented urgency, or any
 * concrete discount promise here, and never offer a reward for ticking this
 * box ("freely given", Art. 7(4) GDPR). Lawyer-approved (CONSENT_COPY_LAWYER_APPROVED).
 */
export const MARKETING_CHECKBOX_LABEL =
  "Ja, ich möchte exklusive Angebote und Aktionen erhalten — nur für Abonnenten. Jederzeit abbestellbar.";

/**
 * Shared footer — ONE line rendered beneath both checkboxes (with the
 * imprint/privacy links from CAPTURE_FORM_*_URL placed next to it, as
 * before). The Art. 7 minimum: who processes, under which policy, and that
 * withdrawal is possible at any time. Part of `consentTextShown` (the form
 * displays it as part of the consent block). Lawyer-approved
 * (CONSENT_COPY_LAWYER_APPROVED).
 */
export const CONSENT_SHARED_FOOTER =
  "Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.";

// ---------------------------------------------------------------------------
// Returning-customer hint (served alongside the consent copy — NOT consent)
// ---------------------------------------------------------------------------

/**
 * Short hint rendered near the email input, telling users they can be
 * recognised via email (addresses the "when should I enter my email?"
 * confusion). Served by the backend on the same paths as the consent copy so
 * its wording can change without a theme release — e.g. for tuning after the
 * lawyer clears customer-memory use (CUST-B, see docs/CUSTOMERS.md).
 *
 * INFORMATIONAL ONLY: this hint is NOT part of `consentTextShown` — it
 * describes a feature, it is not consent text. Lawyer-approved
 * (CONSENT_COPY_LAWYER_APPROVED; CUST-B).
 */
export const RETURNING_CUSTOMER_HINT_TEXT =
  "Schon einmal von Mo beraten worden? Gib deine E-Mail an — Mo erkennt dich wieder und knüpft an deine letzte Beratung an.";

/**
 * Server-side kill switch for the returning-customer hint: set
 * RETURNING_HINT_ENABLED=false to make the widget hide it (the text is still
 * served so the payload shape stays stable). Default ON.
 */
function returningHintEnabled(): boolean {
  const raw = process.env.RETURNING_HINT_ENABLED;
  if (typeof raw !== "string" || !raw.trim()) return true;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Capture-form consent copy payload (served to the widget)
// ---------------------------------------------------------------------------
//
// The widget must NEVER hard-code the strings above: `consent_text_shown` is
// our Art. 7 proof of consent, so a manually-copied snapshot in the theme
// could silently drift from what the audit record claims was shown. Instead
// the backend serves the canonical copy on two paths and the widget renders
// it verbatim:
//
//   1. attached to the `offer_email_summary` tool RESULT (the tool part's
//      `output` in the chat stream), and
//   2. via GET /api/consent-copy for capture forms not triggered by the tool
//      (e.g. a proactive share-form entry point).
//
// Both paths build their payload here, so a lawyer copy change ships with a
// backend deploy and requires NO widget release.

/**
 * Imprint / privacy links rendered next to the capture form (the consent text
 * references data use for personalisation, so the form must link the policy —
 * see the CONSENT_FLOW.md lawyer TODO). The imprint URL matches the one in the
 * branded email footer. ⚠️ Verify the privacy URL resolves on the live shop
 * before launch (Shopify's standard policy path is assumed).
 */
export const CAPTURE_FORM_IMPRINT_URL =
  "https://motionsports.de/pages/impressum";
export const CAPTURE_FORM_PRIVACY_URL =
  "https://motionsports.de/policies/privacy-policy";

/** The exact copy the widget needs to render the capture form. */
export interface CaptureConsentCopy {
  /**
   * Identifier of the served copy (CONSENT_COPY_VERSION, currently "v3").
   * Stored alongside `consent_text_shown` on every capture so prior-version
   * audit records stay distinguishable.
   */
  version: string;
  /** (A) Transactional checkbox label (MUST render UNCHECKED — v2+ decision). */
  transactionalLabel: string;
  /** (B) Marketing checkbox label (MUST render unchecked — see above). */
  marketingLabel: string;
  /** Shared one-line footer rendered beneath both checkboxes (Art. 7 minimum). */
  consentFooter: string;
  /**
   * The pre-composed audit string the widget MUST echo back verbatim as
   * `consentTextShown` on POST /api/capture-email. Composed server-side so
   * the Art. 7 record can never diverge from the strings actually served.
   */
  consentTextShown: string;
  /** Imprint / privacy links to show next to the form. */
  imprintUrl: string;
  privacyUrl: string;
  /** Mirrors CONSENT_COPY_LAWYER_APPROVED (true — lawyer-approved June 2026). */
  lawyerApproved: boolean;
  /**
   * Returning-customer hint, rendered near the email input. Informational —
   * NOT part of `consentTextShown`. `enabled: false` (server-side switch)
   * means the widget must hide it.
   */
  returningHint: { enabled: boolean; text: string };
}

export function captureConsentCopy(): CaptureConsentCopy {
  return {
    version: CONSENT_COPY_VERSION,
    transactionalLabel: TRANSACTIONAL_CHECKBOX_LABEL,
    marketingLabel: MARKETING_CHECKBOX_LABEL,
    consentFooter: CONSENT_SHARED_FOOTER,
    consentTextShown: composeConsentTextShown([
      TRANSACTIONAL_CHECKBOX_LABEL,
      MARKETING_CHECKBOX_LABEL,
      CONSENT_SHARED_FOOTER,
    ]),
    imprintUrl: CAPTURE_FORM_IMPRINT_URL,
    privacyUrl: CAPTURE_FORM_PRIVACY_URL,
    lawyerApproved: CONSENT_COPY_LAWYER_APPROVED,
    returningHint: {
      enabled: returningHintEnabled(),
      text: RETURNING_CUSTOMER_HINT_TEXT,
    },
  };
}

// ---------------------------------------------------------------------------
// At-sign-in marketing opt-in (COPY v3) — served to SIGNED-IN customers
// ---------------------------------------------------------------------------
//
// PRESENTATION-MAXIMISED, STILL FULLY LAWFUL. A signed-in Shopify customer can
// opt into marketing right at/after sign-in. The ONLY thing the account removes
// is the "type your email" step — we already hold their VERIFIED email — so the
// opt-in is one tick instead of a form. Everything else is IDENTICAL to the
// in-chat capture flow:
//   * a Shopify account NEVER implies consent — there is NO auto-enrol and NO
//     pre-tick. The checkbox renders UNCHECKED and the customer must actively
//     tick it (clear affirmative act, Art. 4(11)/7(2) GDPR; CJEU C-673/17).
//   * it runs the EXISTING double-opt-in: the tick only sets DOI 'pending' and
//     sends the confirmation email; consent becomes 'confirmed' only after the
//     customer clicks the link. Withdrawable any time via the same unsubscribe.
//   * the exact label + footer shown are stored verbatim as `consent_text_shown`
//     with the SAME `consent_copy_version` stamp (now "v3").
//
// COPY CEILING (unchanged from v2): benefit-framed and prominent is fine; the
// promise stays "exklusive Angebote …, nur für Abonnenten" — accurate scarcity
// only, NO countdowns, NO invented urgency, NO concrete discount promise, and it
// must never offer a reward for ticking (Art. 7(4) "freely given").
// Lawyer-approved (CONSENT_COPY_LAWYER_APPROVED; v3 is the approved revision).

/**
 * Attractive headline shown ABOVE the sign-in opt-in checkbox. Framing only —
 * NOT part of `consentTextShown` (it sells the benefit; it is not consent
 * text), exactly like the returning-customer hint. Lawyer-approved.
 */
export const SIGNIN_MARKETING_OPTIN_HEADLINE =
  "Bleib auf dem Laufenden — als angemeldete:r Kund:in.";

/**
 * (B) Marketing consent — checkbox label for the SIGNED-IN opt-in. This IS the
 * consent text (stored verbatim). MUST render UNCHECKED and independent; making
 * it prominent is encouraged, pre-ticking it is never permitted. Same scarcity
 * ceiling as MARKETING_CHECKBOX_LABEL. The phrasing acknowledges we already
 * know the address (no email field), but the act of consent stays explicit.
 * Lawyer-approved (CONSENT_COPY_LAWYER_APPROVED).
 */
export const SIGNIN_MARKETING_OPTIN_LABEL =
  "Ja, schickt mir an meine hinterlegte E-Mail-Adresse exklusive Angebote und Aktionen — nur für Abonnenten. Jederzeit abbestellbar.";

/** The exact copy the widget needs to render the at-sign-in opt-in. */
export interface SignInMarketingConsentCopy {
  /** CONSENT_COPY_VERSION (currently "v3") — stamped on the resulting capture. */
  version: string;
  /** Attractive headline above the checkbox (framing — NOT consent text). */
  headline: string;
  /** The marketing checkbox label (MUST render UNCHECKED). IS the consent text. */
  marketingLabel: string;
  /** Shared one-line Art. 7 footer rendered beneath the checkbox. */
  consentFooter: string;
  /**
   * Pre-composed audit string the widget MUST echo back verbatim as
   * `consentTextShown` on POST /api/account/marketing-opt-in. Only the label +
   * footer (the actual consent text) — NOT the headline. Composed server-side
   * so the Art. 7 record can never diverge from what was shown.
   */
  consentTextShown: string;
  /** Imprint / privacy links to show next to the opt-in. */
  imprintUrl: string;
  privacyUrl: string;
  /** Mirrors CONSENT_COPY_LAWYER_APPROVED (true — lawyer-approved June 2026). */
  lawyerApproved: boolean;
}

export function signInMarketingConsentCopy(): SignInMarketingConsentCopy {
  return {
    version: CONSENT_COPY_VERSION,
    headline: SIGNIN_MARKETING_OPTIN_HEADLINE,
    marketingLabel: SIGNIN_MARKETING_OPTIN_LABEL,
    consentFooter: CONSENT_SHARED_FOOTER,
    // Audit string = label + footer only (the headline is framing, not consent).
    consentTextShown: composeConsentTextShown([
      SIGNIN_MARKETING_OPTIN_LABEL,
      CONSENT_SHARED_FOOTER,
    ]),
    imprintUrl: CAPTURE_FORM_IMPRINT_URL,
    privacyUrl: CAPTURE_FORM_PRIVACY_URL,
    lawyerApproved: CONSENT_COPY_LAWYER_APPROVED,
  };
}

// ---------------------------------------------------------------------------
// Double-opt-in confirmation email (sent when marketing consent is ticked)
// ---------------------------------------------------------------------------

/** DOI email subject. Lawyer-approved (CONSENT_COPY_LAWYER_APPROVED). */
export const DOI_EMAIL_SUBJECT =
  "Bitte bestätige deine Anmeldung bei motion sports";

/**
 * DOI email body. `confirmUrl` is the link to GET /api/confirm-marketing. It
 * states the purpose and asks the user to confirm by clicking the link. NO
 * marketing content is sent until this link is clicked. Lawyer-approved
 * (CONSENT_COPY_LAWYER_APPROVED).
 */
export function doiEmailBody(confirmUrl: string): { text: string; html: string } {
  const text = [
    "Hallo,",
    "",
    "du hast angegeben, dass dich motion sports per E-Mail mit persönlichen",
    "Empfehlungen und Angeboten kontaktieren darf, die auf deinem",
    "Beratungsgespräch basieren.",
    "",
    "Bitte bestätige diese Einwilligung mit einem Klick auf den folgenden Link:",
    confirmUrl,
    "",
    "Erst nach deiner Bestätigung senden wir dir Marketing-E-Mails. Wenn du das",
    "nicht angefordert hast, ignoriere diese E-Mail einfach — dann passiert",
    "nichts.",
    "",
    "Viele Grüße",
    "Dein motion sports Team",
  ].join("\n");

  // HTML part — rendered through the shared branded template. The legal copy
  // (purpose statement, "nothing happens until you confirm", fallback link)
  // stays verbatim; only the shell around it is shared.
  const html = renderBrandedEmail({
    subject: DOI_EMAIL_SUBJECT,
    preheader:
      "Bitte bestätige deine Einwilligung mit einem Klick — erst danach senden wir dir Marketing-E-Mails.",
    heading: "Anmeldung bestätigen",
    bodyHtml: `
                                  <p style="${EMAIL_TEXT_STYLE}" align="left">Hallo,</p>
                                  <p style="${EMAIL_TEXT_STYLE} padding-top: 10px;" align="left">du hast angegeben, dass dich <strong>motion sports</strong> per E-Mail mit
                                  pers&#246;nlichen Empfehlungen und Angeboten kontaktieren darf, die auf deinem
                                  Beratungsgespr&#228;ch basieren.</p>
                                  <p style="${EMAIL_TEXT_STYLE} padding-top: 10px;" align="left">Bitte best&#228;tige diese Einwilligung mit einem Klick auf den Button:</p>`,
    ctas: [{ label: "Anmeldung bestätigen", url: confirmUrl }],
    footnoteHtml: `
                  <p style="${EMAIL_MUTED_TEXT_STYLE}" align="center">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br><a href="${escapeAttr(confirmUrl)}" style="color: #212121; word-wrap: break-word;">${escapeHtml(confirmUrl)}</a></p>
                  <p style="${EMAIL_MUTED_TEXT_STYLE} padding-top: 10px;" align="center">Erst nach deiner Best&#228;tigung senden wir dir Marketing-E-Mails. Wenn du das nicht angefordert hast, ignoriere diese E-Mail einfach &#8212; dann passiert nichts.</p>
                  <p style="${EMAIL_TEXT_STYLE} padding-top: 10px; padding-bottom: 10px;" align="center">Viele Gr&#252;&#223;e<br>Dein motion sports Team</p>`,
  });

  return { text, html };
}

// ---------------------------------------------------------------------------
// Confirmation page (shown after the DOI link is clicked)
// ---------------------------------------------------------------------------

/** Heading + body for the marketing-DOI confirmation page. Lawyer-approved. */
export const DOI_CONFIRMED_HEADING = "Danke, deine Anmeldung ist bestätigt.";
export const DOI_CONFIRMED_BODY =
  "Du erhältst ab jetzt persönliche Empfehlungen und Angebote von motion sports. Du kannst dich jederzeit über den Abmeldelink in jeder E-Mail wieder abmelden.";

/** Shown when a DOI token is invalid or expired. Lawyer-approved. */
export const DOI_INVALID_HEADING = "Dieser Bestätigungslink ist ungültig oder abgelaufen.";
export const DOI_INVALID_BODY =
  "Bitte fordere im Chat erneut eine Zusammenfassung an, wenn du dich für Empfehlungen und Angebote anmelden möchtest.";

// ---------------------------------------------------------------------------
// Unsubscribe (every marketing email must carry an unsubscribe link)
// ---------------------------------------------------------------------------

/**
 * Footer line placed at the bottom of every marketing email. `unsubscribeUrl`
 * points at GET /api/unsubscribe. Lawyer-approved (CONSENT_COPY_LAWYER_APPROVED).
 */
export function unsubscribeFooter(unsubscribeUrl: string): { text: string; html: string } {
  const text =
    `Du erhältst diese E-Mail, weil du der Kontaktaufnahme durch motion sports ` +
    `zugestimmt hast. Wenn du keine weiteren E-Mails erhalten möchtest, kannst ` +
    `du dich hier jederzeit kostenlos abmelden: ${unsubscribeUrl}`;
  // Styled for the shared branded template (which renders this in its own
  // bordered footer section). The legal sentence itself is unchanged.
  const html = `<p style="${EMAIL_MUTED_TEXT_STYLE} padding-top: 10px; padding-bottom: 10px;" align="center">
  Du erh&#228;ltst diese E-Mail, weil du der Kontaktaufnahme durch motion sports
  zugestimmt hast. Wenn du keine weiteren E-Mails erhalten m&#246;chtest, kannst du
  dich hier jederzeit kostenlos abmelden:
  <a href="${escapeAttr(unsubscribeUrl)}" style="color: #212121; text-decoration: underline !important; word-wrap: break-word;">Abmelden</a>.</p>`;
  return { text, html };
}

/** Heading + body for the unsubscribe confirmation page. Lawyer-approved. */
export const UNSUBSCRIBE_CONFIRMED_HEADING = "Du wurdest abgemeldet.";
export const UNSUBSCRIBE_CONFIRMED_BODY =
  "Wir senden dir keine weiteren Marketing-E-Mails mehr. Deine E-Mail-Adresse wurde auf unsere Sperrliste gesetzt.";
export const UNSUBSCRIBE_INVALID_HEADING = "Dieser Abmeldelink ist ungültig.";
export const UNSUBSCRIBE_INVALID_BODY =
  "Bitte nutze den Abmeldelink aus einer unserer E-Mails.";

// ---------------------------------------------------------------------------
// Transactional summary email subject (the service the user requested)
// ---------------------------------------------------------------------------

/** Subject of the transactional conversation-summary email. Lawyer-approved. */
export const SUMMARY_EMAIL_SUBJECT =
  "Deine Beratung bei motion sports — Zusammenfassung & Warenkorb";
