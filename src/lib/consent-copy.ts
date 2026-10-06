// ⚠️ CONSENT COPY — GERMAN IS LAWYER-APPROVED (CONSENT_COPY_LAWYER_APPROVED) ⚠️
//
// The German-facing DOI / marketing / personalisation / transactional copy in
// this file has been REVIEWED AND APPROVED by a lawyer (v3 set June 2026; the
// v4 additions — chat consent-gate strings, the upgraded personalised-offers
// headlines, and the button-consent mechanic on the marketing surfaces — July
// 2026), so CONSENT_COPY_LAWYER_APPROVED is true. Treat the German strings as
// approved: any wording change is a new legal review.
//
// ENGLISH is approved as a faithful translation of the German
// (CONSENT_COPY_EN_LEGAL_REVIEWED=true, D-AP3, 05.10.2026). The flag rides in
// the served payload (enLegalReviewed). The plain strings live in
// consent-copy-core.mjs (locale-switched, unit-tested); this file assembles the
// emails + payloads around them.
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
  emailTextStyle,
  emailMutedTextStyle,
} from "./email-template";
import {
  CONSENT_COPY_VERSION,
  composeConsentTextShown,
} from "./consent-copy-version.mjs";
import {
  consentStrings,
  CONSENT_COPY_EN_LEGAL_REVIEWED,
} from "./consent-copy-core.mjs";
import type { Locale } from "./locale";
import { activeSigninVariants, pickSigninVariant } from "./consent-variants.mjs";

export { CONSENT_COPY_VERSION, CONSENT_COPY_EN_LEGAL_REVIEWED };

/**
 * Whether the DOI / marketing / personalisation consent copy has been legally
 * approved. Kept as a runtime-visible constant (not just a comment) so the
 * widget payload and the personalisation gate can read a single source of
 * truth. GERMAN is lawyer-approved June 2026 → true. (English approval is
 * tracked separately by CONSENT_COPY_EN_LEGAL_REVIEWED.)
 */
export const CONSENT_COPY_LAWYER_APPROVED = true as const;

/**
 * Imprint / privacy links rendered next to the capture form (the consent text
 * references data use for personalisation, so the form must link the policy —
 * see the CONSENT_FLOW.md lawyer TODO). The imprint URL matches the one in the
 * branded email footer. ⚠️ Verify the privacy URL resolves on the live shop
 * before launch (Shopify's standard policy path is assumed). Locale-agnostic.
 */
const CAPTURE_FORM_IMPRINT_URL =
  "https://motionsports.de/pages/impressum";
const CAPTURE_FORM_PRIVACY_URL =
  "https://motionsports.de/policies/privacy-policy";

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

/** The exact copy the widget needs to render the capture form. */
export interface CaptureConsentCopy {
  /** Identifier of the served copy (CONSENT_COPY_VERSION, currently "v5"). */
  version: string;
  /** Served language ("de" default, "en" on /en). */
  locale: Locale;
  /** (A) Transactional checkbox label (MUST render UNCHECKED — v2+ decision). */
  transactionalLabel: string;
  /** (B) Marketing checkbox label (MUST render unchecked). */
  marketingLabel: string;
  /** Shared one-line footer rendered beneath both checkboxes (Art. 7 minimum). */
  consentFooter: string;
  /**
   * The pre-composed audit string the widget MUST echo back verbatim as
   * `consentTextShown` on POST /api/capture-email. Composed server-side so the
   * Art. 7 record can never diverge from the strings actually served.
   */
  consentTextShown: string;
  /** Imprint / privacy links to show next to the form. */
  imprintUrl: string;
  privacyUrl: string;
  /** Mirrors CONSENT_COPY_LAWYER_APPROVED (German lawyer-approved June 2026). */
  lawyerApproved: boolean;
  /**
   * Whether the SERVED locale's copy is approved: German lawyer-approved,
   * English approved as its translation (D-AP3, 05.10.2026).
   */
  enLegalReviewed: boolean;
  /** Returning-customer hint, rendered near the email input (NOT consent). */
  returningHint: { enabled: boolean; text: string };
}

export function captureConsentCopy(locale: Locale = "de"): CaptureConsentCopy {
  const s = consentStrings(locale);
  return {
    version: CONSENT_COPY_VERSION,
    locale,
    transactionalLabel: s.transactionalLabel,
    marketingLabel: s.marketingLabel,
    consentFooter: s.consentFooter,
    consentTextShown: composeConsentTextShown([
      s.transactionalLabel,
      s.marketingLabel,
      s.consentFooter,
    ]),
    imprintUrl: CAPTURE_FORM_IMPRINT_URL,
    privacyUrl: CAPTURE_FORM_PRIVACY_URL,
    lawyerApproved: CONSENT_COPY_LAWYER_APPROVED,
    enLegalReviewed: locale === "en" ? CONSENT_COPY_EN_LEGAL_REVIEWED : true,
    returningHint: {
      enabled: returningHintEnabled(),
      text: s.returningHint,
    },
  };
}

/**
 * The exact copy the widget needs to render the at-sign-in opt-in.
 *
 * v4 mechanic (lawyer-approved July 2026): this surface is BUTTON-CONSENT —
 * the widget renders `headline` + `marketingLabel` + `consentFooter` fully
 * visible and an explicit "Ja, Angebote aktivieren" tap is the affirmative act
 * (nothing pre-selected, decline equally reachable; `marketingConsent: true`
 * is only ever sent on that tap). The audit string stays label + footer — the
 * button caption is UI chrome, not consent text.
 */
export interface SignInMarketingConsentCopy {
  version: string;
  locale: Locale;
  /** Attractive headline above the consent block (framing — NOT consent text). */
  headline: string;
  /**
   * Up to four short benefit bullets under the headline (framing — NOT consent
   * text, never in consentTextShown). Rendered verbatim, all or nothing;
   * since v5 (05.10.2026) the widget shows no bullets of its own.
   */
  benefits?: string[];
  /** Framing variant id (consent-variants.mjs); echoed on the opt-in POST and the consent_gate_* events. */
  variant?: string;
  /** The marketing consent label (nothing pre-selected). IS the consent text. */
  marketingLabel: string;
  /** Shared one-line Art. 7 footer rendered beneath the label (button-consent, no checkbox). */
  consentFooter: string;
  /**
   * Pre-composed audit string the widget MUST echo back verbatim as
   * `consentTextShown` on POST /api/account/marketing-opt-in. Only the label +
   * footer (the actual consent text) — NOT the headline.
   */
  consentTextShown: string;
  imprintUrl: string;
  privacyUrl: string;
  lawyerApproved: boolean;
  enLegalReviewed: boolean;
}

export function signInMarketingConsentCopy(
  locale: Locale = "de",
  sessionId: string | null = null
): SignInMarketingConsentCopy {
  const s = consentStrings(locale);
  // The framing variant for this session (only "a" unless an A/B test is
  // configured, CONSENT_SIGNIN_VARIANTS); the consent text never varies.
  const v = pickSigninVariant(sessionId, locale, process.env.CONSENT_SIGNIN_VARIANTS);
  return {
    version: CONSENT_COPY_VERSION,
    locale,
    headline: v.headline,
    benefits: [...v.benefits],
    variant: v.id,
    marketingLabel: s.signinLabel,
    consentFooter: s.consentFooter,
    // Audit string = label + footer only (headline and bullets are framing, not consent).
    consentTextShown: composeConsentTextShown([s.signinLabel, s.consentFooter]),
    imprintUrl: CAPTURE_FORM_IMPRINT_URL,
    privacyUrl: CAPTURE_FORM_PRIVACY_URL,
    lawyerApproved: CONSENT_COPY_LAWYER_APPROVED && v.lawyerApproved,
    enLegalReviewed: locale === "en" ? CONSENT_COPY_EN_LEGAL_REVIEWED : true,
  };
}

/** More than one sign-in framing variant is served (an A/B test is running). */
export function signInVariantsActive(locale: Locale = "de"): boolean {
  return activeSigninVariants(locale, process.env.CONSENT_SIGNIN_VARIANTS).length > 1;
}

/**
 * The sign-in-first path of the chat consent gate (UI chrome, NOT consent
 * text — never part of consentTextShown). Since the one consent
 * (docs/archive/CUSTOMER_PLATFORM_PLAN.md §7), the gate leads with "sign in with your
 * shop account": the person is then the Shopify customer, Mo knows their
 * orders, and the at-sign-in card (surface=signin) asks for the consent in one
 * tap — or they are already subscribed and are never asked. The typed-e-mail
 * consent below stays as the alternative for people without an account.
 */
export interface ChatGateSignInHint {
  /** Lead with the sign-in button (the typed-e-mail consent becomes secondary). */
  preferred: boolean;
  headline: string;
  body: string;
  buttonLabel: string;
  /** Caption of the secondary path (typed e-mail + consent). */
  alternativeLabel: string;
  /** Start of the Customer Account sign-in (top-level navigation, see docs/frontend/ACCOUNT_CONTRACT.md §2). */
  loginPath: string;
}

export function chatGateSignInHint(locale: Locale = "de"): ChatGateSignInHint {
  if (locale === "en") {
    return {
      preferred: true,
      headline: "Already a motion sports customer?",
      body: "Sign in with your shop account — Mo then knows your orders and can advise you personally.",
      buttonLabel: "Sign in with your account",
      alternativeLabel: "No account? Get offers by e-mail instead",
      loginPath: "/api/auth/shopify/login",
    };
  }
  return {
    preferred: true,
    headline: "Schon Kunde bei motion sports?",
    body: "Melde dich mit deinem Kundenkonto an — dann kennt Mo deine Bestellungen und berät dich persönlich.",
    buttonLabel: "Mit Kundenkonto anmelden",
    alternativeLabel: "Kein Konto? Angebote per E-Mail erhalten",
    loginPath: "/api/auth/shopify/login",
  };
}

/**
 * The exact copy the widget needs to render the CHAT CONSENT GATE (v4): an
 * anonymous typed-email, MARKETING-ONLY signup shown once per session after
 * the user's first chat message. Same shape as the sign-in surface — the only
 * differences are the strings (worded for a typed email instead of the stored
 * account address) and the submit endpoint (POST /api/chat-marketing-opt-in).
 *
 * Button-consent mechanic (lawyer-approved July 2026), same as sign-in: the
 * served `marketingLabel` + `consentFooter` are fully visible; the explicit
 * "Ja, Angebote aktivieren" tap is the affirmative act (nothing pre-selected,
 * decline equally reachable). The `headline` is benefit framing — it sells
 * personalised offers and exclusive discount promotions — and is NOT part of
 * the `consentTextShown` audit string (label + footer only).
 */
export function chatGateMarketingConsentCopy(
  locale: Locale = "de"
): SignInMarketingConsentCopy & { signIn: ChatGateSignInHint } {
  const s = consentStrings(locale);
  return {
    signIn: chatGateSignInHint(locale),
    version: CONSENT_COPY_VERSION,
    locale,
    headline: s.chatGateHeadline,
    marketingLabel: s.chatGateLabel,
    consentFooter: s.consentFooter,
    // Audit string = label + footer only (the headline is framing, not consent).
    consentTextShown: composeConsentTextShown([s.chatGateLabel, s.consentFooter]),
    imprintUrl: CAPTURE_FORM_IMPRINT_URL,
    privacyUrl: CAPTURE_FORM_PRIVACY_URL,
    lawyerApproved: CONSENT_COPY_LAWYER_APPROVED,
    enLegalReviewed: locale === "en" ? CONSENT_COPY_EN_LEGAL_REVIEWED : true,
  };
}

// ---------------------------------------------------------------------------
// Email subjects (locale-aware)
// ---------------------------------------------------------------------------

/** DOI email subject. */
export function doiEmailSubject(locale: Locale = "de"): string {
  return consentStrings(locale).doiSubject;
}

/** Subject of the transactional conversation-summary email. */
export function summaryEmailSubject(locale: Locale = "de"): string {
  return consentStrings(locale).summarySubject;
}

// ---------------------------------------------------------------------------
// Double-opt-in confirmation email (sent when marketing consent is ticked)
// ---------------------------------------------------------------------------

/**
 * DOI email body. `confirmUrl` is the link to GET /api/confirm-marketing. It
 * states the purpose and asks the user to confirm by clicking the link. NO
 * marketing content is sent until this link is clicked. The German branch is
 * byte-identical to the lawyer-approved copy.
 */
export function doiEmailBody(
  confirmUrl: string,
  locale: Locale = "de"
): { text: string; html: string } {
  if (locale === "en") {
    const text = [
      "Hello,",
      "",
      "you indicated that motion sports may contact you by email with personal",
      "recommendations and offers based on your consultation.",
      "",
      "Please confirm this consent with a click on the following link:",
      confirmUrl,
      "",
      "We will only send you marketing emails after your confirmation. If you did",
      "not request this, simply ignore this email — then nothing happens.",
      "",
      "Best regards",
      "Your motion sports team",
    ].join("\n");

    const html = renderBrandedEmail({
      subject: doiEmailSubject(locale),
      preheader:
        "Please confirm your consent with a click — only then will we send you marketing emails.",
      heading: "Confirm sign-up",
      bodyHtml: `
                                  <p style="${emailTextStyle()}" align="left">Hello,</p>
                                  <p style="${emailTextStyle()} padding-top: 10px;" align="left">you indicated that <strong>motion sports</strong> may contact you by email with
                                  personal recommendations and offers based on your consultation.</p>
                                  <p style="${emailTextStyle()} padding-top: 10px;" align="left">Please confirm this consent with a click on the button:</p>`,
      ctas: [{ label: "Confirm sign-up", url: confirmUrl }],
      footnoteHtml: `
                  <p style="${emailMutedTextStyle()}" align="center">If the button doesn't work, copy this link into your browser:<br><a href="${escapeAttr(confirmUrl)}" style="color: #000000; word-wrap: break-word;">${escapeHtml(confirmUrl)}</a></p>
                  <p style="${emailMutedTextStyle()} padding-top: 10px;" align="center">We will only send you marketing emails after your confirmation. If you did not request this, simply ignore this email &#8212; then nothing happens.</p>
                  <p style="${emailTextStyle()} padding-top: 10px; padding-bottom: 10px;" align="center">Best regards<br>Your motion sports team</p>`,
      locale,
    });
    return { text, html };
  }

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
    subject: doiEmailSubject(locale),
    preheader:
      "Bitte bestätige deine Einwilligung mit einem Klick — erst danach senden wir dir Marketing-E-Mails.",
    heading: "Anmeldung bestätigen",
    bodyHtml: `
                                  <p style="${emailTextStyle()}" align="left">Hallo,</p>
                                  <p style="${emailTextStyle()} padding-top: 10px;" align="left">du hast angegeben, dass dich <strong>motion sports</strong> per E-Mail mit
                                  pers&#246;nlichen Empfehlungen und Angeboten kontaktieren darf, die auf deinem
                                  Beratungsgespr&#228;ch basieren.</p>
                                  <p style="${emailTextStyle()} padding-top: 10px;" align="left">Bitte best&#228;tige diese Einwilligung mit einem Klick auf den Button:</p>`,
    ctas: [{ label: "Anmeldung bestätigen", url: confirmUrl }],
    footnoteHtml: `
                  <p style="${emailMutedTextStyle()}" align="center">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br><a href="${escapeAttr(confirmUrl)}" style="color: #000000; word-wrap: break-word;">${escapeHtml(confirmUrl)}</a></p>
                  <p style="${emailMutedTextStyle()} padding-top: 10px;" align="center">Erst nach deiner Best&#228;tigung senden wir dir Marketing-E-Mails. Wenn du das nicht angefordert hast, ignoriere diese E-Mail einfach &#8212; dann passiert nichts.</p>
                  <p style="${emailTextStyle()} padding-top: 10px; padding-bottom: 10px;" align="center">Viele Gr&#252;&#223;e<br>Dein motion sports Team</p>`,
    locale,
  });

  return { text, html };
}

// ---------------------------------------------------------------------------
// Confirmation page (shown after the DOI link is clicked)
// ---------------------------------------------------------------------------

/** Heading + body for the marketing-DOI confirmation page (success + invalid). */
export function doiPageCopy(locale: Locale = "de"): {
  confirmedHeading: string;
  confirmedBody: string;
  invalidHeading: string;
  invalidBody: string;
} {
  const s = consentStrings(locale);
  return {
    confirmedHeading: s.doiConfirmedHeading,
    confirmedBody: s.doiConfirmedBody,
    invalidHeading: s.doiInvalidHeading,
    invalidBody: s.doiInvalidBody,
  };
}

// ---------------------------------------------------------------------------
// Unsubscribe (every marketing email must carry an unsubscribe link)
// ---------------------------------------------------------------------------

/**
 * Footer line placed at the bottom of every marketing email. `unsubscribeUrl`
 * points at GET /api/unsubscribe. The German branch is byte-identical to the
 * lawyer-approved copy.
 */
export function unsubscribeFooter(
  unsubscribeUrl: string,
  locale: Locale = "de",
  /** The signed "delete all my data" link (/api/erase-data). Appended as its
   *  own sentence AFTER the approved unsubscribe sentence; omitted when null. */
  erasureUrl: string | null = null
): { text: string; html: string } {
  const base = unsubscribeFooterBase(unsubscribeUrl, locale);
  if (!erasureUrl) return base;
  const en = locale === "en";
  const text =
    `${base.text}\n` +
    (en
      ? `You can also have all your data deleted from our systems at any time: ${erasureUrl}`
      : `Du kannst außerdem jederzeit alle deine Daten bei uns löschen lassen: ${erasureUrl}`);
  const html =
    `${base.html}\n<p style="${emailMutedTextStyle()} padding-bottom: 10px;" align="center">` +
    (en
      ? `You can also have all your data deleted from our systems at any time: `
      : `Du kannst au&#223;erdem jederzeit alle deine Daten bei uns l&#246;schen lassen: `) +
    `<a href="${escapeAttr(erasureUrl)}" style="color: #000000; text-decoration: underline !important; word-wrap: break-word;">` +
    (en ? "Delete my data" : "Daten l&#246;schen") +
    `</a>.</p>`;
  return { text, html };
}

function unsubscribeFooterBase(
  unsubscribeUrl: string,
  locale: Locale
): { text: string; html: string } {
  if (locale === "en") {
    const text =
      `You're receiving this email because you consented to being contacted by ` +
      `motion sports. If you no longer wish to receive emails, you can unsubscribe ` +
      `here free of charge at any time: ${unsubscribeUrl}`;
    const html = `<p style="${emailMutedTextStyle()} padding-top: 10px; padding-bottom: 10px;" align="center">
  You&#39;re receiving this email because you consented to being contacted by motion
  sports. If you no longer wish to receive emails, you can unsubscribe here free of
  charge at any time:
  <a href="${escapeAttr(unsubscribeUrl)}" style="color: #000000; text-decoration: underline !important; word-wrap: break-word;">Unsubscribe</a>.</p>`;
    return { text, html };
  }

  const text =
    `Du erhältst diese E-Mail, weil du der Kontaktaufnahme durch motion sports ` +
    `zugestimmt hast. Wenn du keine weiteren E-Mails erhalten möchtest, kannst ` +
    `du dich hier jederzeit kostenlos abmelden: ${unsubscribeUrl}`;
  // Styled for the shared branded template (which renders this in its own
  // bordered footer section). The legal sentence itself is unchanged.
  const html = `<p style="${emailMutedTextStyle()} padding-top: 10px; padding-bottom: 10px;" align="center">
  Du erh&#228;ltst diese E-Mail, weil du der Kontaktaufnahme durch motion sports
  zugestimmt hast. Wenn du keine weiteren E-Mails erhalten m&#246;chtest, kannst du
  dich hier jederzeit kostenlos abmelden:
  <a href="${escapeAttr(unsubscribeUrl)}" style="color: #000000; text-decoration: underline !important; word-wrap: break-word;">Abmelden</a>.</p>`;
  return { text, html };
}

/**
 * Copy for the "Daten löschen" page (/api/erase-data) and the widget's erase
 * confirmation (/api/consent-copy?surface=erase): the confirmation step (a
 * button — mail scanners open links, so the GET never deletes), the result and
 * the invalid-link state. `includesShop` (the one erasure, SHOPIFY_ERASURE_SYNC
 * on): the shop customer account is deleted too, while orders stay in the
 * shop for the statutory retention periods.
 */
export function erasurePageCopy(locale: Locale = "de", includesShop = false): {
  confirmHeading: string;
  confirmBody: string;
  confirmButton: string;
  doneHeading: string;
  doneBody: string;
  invalidHeading: string;
  invalidBody: string;
  failedBody: string;
} {
  if (locale === "en") {
    return {
      confirmHeading: "Delete all your data?",
      confirmBody: includesShop
        ? "This deletes everything motion sports holds about you: your chats with Mo, your customer profile, our emails and letters to you, your newsletter subscription and your customer account in the shop. It cannot be undone. Your orders stay stored in the shop for as long as the law requires us to keep them (e.g. for tax purposes)."
        : "This deletes everything motion sports holds about you: your chats with Mo, your customer profile, our emails and letters to you and your newsletter subscription. It cannot be undone. Your orders in the shop are not affected.",
      confirmButton: "Delete my data permanently",
      doneHeading: "Your data has been deleted",
      doneBody:
        "We have deleted all data we held about you and will not contact you again.",
      invalidHeading: "This link is not valid",
      invalidBody: "The link is incomplete or has been changed. Please use the link from the email.",
      failedBody: "Nothing has been deleted — please try again in a moment.",
    };
  }
  return {
    confirmHeading: "Alle deine Daten löschen?",
    confirmBody: includesShop
      ? "Damit löschen wir alles, was motion sports über dich gespeichert hat: deine Gespräche mit Mo, dein Kundenprofil, unsere E-Mails und Briefe an dich, dein Newsletter-Abo und dein Kundenkonto im Shop. Das lässt sich nicht rückgängig machen. Deine Bestellungen bleiben im Shop so lange gespeichert, wie das Gesetz es verlangt (z. B. aus steuerlichen Gründen)."
      : "Damit löschen wir alles, was motion sports über dich gespeichert hat: deine Gespräche mit Mo, dein Kundenprofil, unsere E-Mails und Briefe an dich und dein Newsletter-Abo. Das lässt sich nicht rückgängig machen. Deine Bestellungen im Shop sind davon nicht betroffen.",
    confirmButton: "Meine Daten endgültig löschen",
    doneHeading: "Deine Daten wurden gelöscht",
    doneBody:
      "Wir haben alle Daten gelöscht, die wir über dich gespeichert hatten, und melden uns nicht mehr bei dir.",
    invalidHeading: "Dieser Link ist ungültig",
    invalidBody: "Der Link ist unvollständig oder wurde verändert. Bitte nutze den Link aus der E-Mail.",
    failedBody: "Es wurde nichts gelöscht — bitte versuch es gleich noch einmal.",
  };
}

/** Heading + body for the unsubscribe confirmation page (success + invalid). */
export function unsubscribePageCopy(locale: Locale = "de"): {
  confirmedHeading: string;
  confirmedBody: string;
  invalidHeading: string;
  invalidBody: string;
} {
  const s = consentStrings(locale);
  return {
    confirmedHeading: s.unsubscribeConfirmedHeading,
    confirmedBody: s.unsubscribeConfirmedBody,
    invalidHeading: s.unsubscribeInvalidHeading,
    invalidBody: s.unsubscribeInvalidBody,
  };
}
