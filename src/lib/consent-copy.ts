// ⚠️ LAWYER-REVIEW-REQUIRED — PLACEHOLDER CONSENT COPY ⚠️
//
// Every German-facing string in this file is a PLACEHOLDER and MUST be reviewed
// and approved by a lawyer before going live. German marketing email to
// non-purchasers requires a double opt-in (DOI) and two *separate*, unbundled
// consents:
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

/**
 * Marks a copy block as not-yet-legally-approved. Kept as a runtime-visible
 * constant (not just a comment) so reviewers and tooling can find every string
 * that still needs sign-off. DO NOT set to false until Legal approves.
 */
export const CONSENT_COPY_LAWYER_APPROVED = false as const;

// ---------------------------------------------------------------------------
// Checkbox labels (rendered by the widget's capture form)
// ---------------------------------------------------------------------------

/**
 * (A) Transactional consent — checkbox label. The user must tick this to
 * receive the summary + cart email (it's the service they're requesting).
 * PLACEHOLDER — lawyer review required.
 */
export const TRANSACTIONAL_CHECKBOX_LABEL =
  "Ja, sendet mir eine Zusammenfassung dieses Gesprächs und meinen Warenkorb per E-Mail.";

/**
 * (B) Marketing consent — checkbox label. MUST be a SEPARATE checkbox,
 * UNCHECKED by default, never bundled with (A). PLACEHOLDER — lawyer review
 * required.
 */
export const MARKETING_CHECKBOX_LABEL =
  "Ja, motion sports darf mich per E-Mail mit persönlichen Empfehlungen und Angeboten kontaktieren, die auf diesem Beratungsgespräch basieren. Der Chat-Inhalt wird zur Personalisierung verwendet. Die Einwilligung kann ich jederzeit kostenlos widerrufen (Abmeldelink in jeder E-Mail).";

// ---------------------------------------------------------------------------
// Double-opt-in confirmation email (sent when marketing consent is ticked)
// ---------------------------------------------------------------------------

/** DOI email subject. PLACEHOLDER — lawyer review required. */
export const DOI_EMAIL_SUBJECT =
  "Bitte bestätige deine Anmeldung bei motion sports";

/**
 * DOI email body. `confirmUrl` is the link to GET /api/confirm-marketing. It
 * states the purpose and asks the user to confirm by clicking the link. NO
 * marketing content is sent until this link is clicked. PLACEHOLDER — lawyer
 * review required.
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

/** Heading + body for the marketing-DOI confirmation page. PLACEHOLDER. */
export const DOI_CONFIRMED_HEADING = "Danke, deine Anmeldung ist bestätigt.";
export const DOI_CONFIRMED_BODY =
  "Du erhältst ab jetzt persönliche Empfehlungen und Angebote von motion sports. Du kannst dich jederzeit über den Abmeldelink in jeder E-Mail wieder abmelden.";

/** Shown when a DOI token is invalid or expired. PLACEHOLDER. */
export const DOI_INVALID_HEADING = "Dieser Bestätigungslink ist ungültig oder abgelaufen.";
export const DOI_INVALID_BODY =
  "Bitte fordere im Chat erneut eine Zusammenfassung an, wenn du dich für Empfehlungen und Angebote anmelden möchtest.";

// ---------------------------------------------------------------------------
// Unsubscribe (every marketing email must carry an unsubscribe link)
// ---------------------------------------------------------------------------

/**
 * Footer line placed at the bottom of every marketing email. `unsubscribeUrl`
 * points at GET /api/unsubscribe. PLACEHOLDER — lawyer review required.
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

/** Heading + body for the unsubscribe confirmation page. PLACEHOLDER. */
export const UNSUBSCRIBE_CONFIRMED_HEADING = "Du wurdest abgemeldet.";
export const UNSUBSCRIBE_CONFIRMED_BODY =
  "Wir senden dir keine weiteren Marketing-E-Mails mehr. Deine E-Mail-Adresse wurde auf unsere Sperrliste gesetzt.";
export const UNSUBSCRIBE_INVALID_HEADING = "Dieser Abmeldelink ist ungültig.";
export const UNSUBSCRIBE_INVALID_BODY =
  "Bitte nutze den Abmeldelink aus einer unserer E-Mails.";

// ---------------------------------------------------------------------------
// Transactional summary email subject (the service the user requested)
// ---------------------------------------------------------------------------

/** Subject of the transactional conversation-summary email. PLACEHOLDER. */
export const SUMMARY_EMAIL_SUBJECT =
  "Deine Beratung bei motion sports — Zusammenfassung & Warenkorb";
