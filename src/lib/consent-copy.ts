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

  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#111">
  <p>Hallo,</p>
  <p>du hast angegeben, dass dich <strong>motion sports</strong> per E-Mail mit
  persönlichen Empfehlungen und Angeboten kontaktieren darf, die auf deinem
  Beratungsgespräch basieren.</p>
  <p>Bitte bestätige diese Einwilligung mit einem Klick auf den Button:</p>
  <p style="margin:24px 0">
    <a href="${confirmUrl}" style="background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block">Anmeldung bestätigen</a>
  </p>
  <p style="font-size:13px;color:#666">Falls der Button nicht funktioniert, kopiere
  diesen Link in deinen Browser:<br><a href="${confirmUrl}">${confirmUrl}</a></p>
  <p style="font-size:13px;color:#666">Erst nach deiner Bestätigung senden wir dir
  Marketing-E-Mails. Wenn du das nicht angefordert hast, ignoriere diese E-Mail
  einfach — dann passiert nichts.</p>
  <p>Viele Grüße<br>Dein motion sports Team</p>
</div>`;

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
  const html = `<p style="font-size:12px;color:#888;line-height:1.5;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
  Du erhältst diese E-Mail, weil du der Kontaktaufnahme durch motion sports
  zugestimmt hast. Wenn du keine weiteren E-Mails erhalten möchtest, kannst du
  dich hier jederzeit kostenlos abmelden:
  <a href="${unsubscribeUrl}">Abmelden</a>.</p>`;
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
