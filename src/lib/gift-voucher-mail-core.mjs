// Geschenkgutscheine — the voucher e-mail, pure (docs/GIFT_VOUCHERS.md).
//
// Everything a voucher mail says is decided here, without I/O, so node:test
// covers it (gift-voucher-mail-core.test.mjs): who gets the mail, the
// subject, the text part and the HTML pieces the branded shell
// (email-template.ts renderBrandedEmail) is filled with, the masked copy for
// the mail log, the Resend idempotency key, and what a failed send means for
// the next try. The I/O half — PDF, download link, Resend, mail log — is
// lib/gift-voucher-mail.ts.
//
// Transactional mail (Art. 6(1)(b) GDPR — the buyer paid for the voucher):
// no marketing, no discount, no promo blocks, no unsubscribe slot. The
// personal message is not repeated (it is on the voucher). Every string a
// customer or an operator typed is escaped here (escapeHtml) — never
// linkified.
//
// SECURITY: the code is bearer value. It appears in the mail body (that is
// the delivery) but never in the subject or the preheader (inbox lists and
// lock-screen notifications show those), and the copy written to the mail
// log (email_messages, which also feeds AI prompts and the admin) is the
// REDACTED one: code masked to its last four characters, no download link.

import { formatEuro, formatGiftVoucherCode, planGiftVoucherRetry, isPlausibleEmail } from "./gift-voucher-core.mjs";
import { classifyResendError } from "./mailing-core.mjs";

/** The `kind` tag of the send (logs, Resend tag) and the e-mail design kind (unknown → classic). */
export const GIFT_VOUCHER_MAIL_KIND = "gift_voucher";

/** How long the Premium-Karte usually takes (the storefront promises the same). */
const PRINT_DELIVERY_DE = "3–6 Werktagen";
const PRINT_DELIVERY_EN = "3–6 working days";

/** @typedef {"de" | "en"} MailLocale */
/** @typedef {"buyer" | "recipient"} GiftVoucherMailAudience */

/** @param {unknown} locale @returns {MailLocale} */
function loc(locale) {
  return locale === "en" ? "en" : "de";
}

/**
 * HTML-escape a value for text and double-quoted attributes (& < > " ').
 * @param {unknown} value
 */
export function escapeMailHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** @param {unknown} v @returns {string | null} */
function clean(v) {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t : null;
}

// ── recipient ────────────────────────────────────────────────────────────────

/**
 * Who gets the voucher mail: a shop voucher goes to the buyer, a voucher an
 * operator issued with delivery „E-Mail“ to the given recipient. Admin
 * vouchers delivered as PDF or card get no mail (mail status `none`); a shop
 * voucher without a usable buyer address cannot be mailed (`skipped`).
 *
 * @param {{ source?: unknown, delivery?: unknown, buyerEmail?: unknown, recipientEmail?: unknown }} voucher
 * @returns {{ ok: true, audience: GiftVoucherMailAudience, to: string } | { ok: false, mailStatus: "none" | "skipped" }}
 */
export function giftVoucherMailTarget(voucher) {
  /** @param {unknown} v */
  const email = (v) => {
    const s = typeof v === "string" ? v.trim().toLowerCase() : "";
    return isPlausibleEmail(s) ? s : null;
  };
  if (voucher?.source === "shop") {
    const to = email(voucher.buyerEmail);
    return to ? { ok: true, audience: "buyer", to } : { ok: false, mailStatus: "skipped" };
  }
  if (voucher?.delivery === "email") {
    const to = email(voucher.recipientEmail);
    return to ? { ok: true, audience: "recipient", to } : { ok: false, mailStatus: "skipped" };
  }
  return { ok: false, mailStatus: "none" };
}

// ── small parts ──────────────────────────────────────────────────────────────

/**
 * The subject. Never carries the code. Buyer: „Dein Geschenkgutschein über
 * 50,00 € ist da“; recipient of an operator's voucher: „Ein Geschenkgutschein
 * für dich“.
 * @param {{ audience: GiftVoucherMailAudience, locale?: unknown, amountCents: number }} input
 */
export function giftVoucherMailSubject({ audience, locale, amountCents }) {
  const l = loc(locale);
  if (audience === "recipient") return l === "en" ? "A gift voucher for you" : "Ein Geschenkgutschein für dich";
  return l === "en"
    ? `Your gift voucher for ${formatEuro(amountCents, "en")} is here`
    : `Dein Geschenkgutschein über ${formatEuro(amountCents, "de")} ist da`;
}

/**
 * A code for logs and the admin: only the last four characters stay,
 * "•••• •••• •••• NPQR". Idempotent (a masked code masks to itself).
 * @param {unknown} code
 */
export function maskGiftVoucherCode(code) {
  const s = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `•••• •••• •••• ${s.length >= 4 ? s.slice(-4) : "••••"}`;
}

/**
 * The attachment's file name: "Gutschein-G-2026-00042.pdf" (the download
 * route uses the same name).
 * @param {unknown} number
 */
export function giftVoucherPdfFilename(number) {
  const safe = String(number ?? "").replace(/[^A-Za-z0-9-]/g, "");
  return `Gutschein-${safe || "Geschenkgutschein"}.pdf`;
}

const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * A YYYY-MM-DD date as people read it: "31.12.2029" (de) / "31 December
 * 2029" (en); null for anything else.
 * @param {unknown} isoDate
 * @param {unknown} [locale]
 */
export function formatGiftVoucherMailDate(isoDate, locale = "de") {
  const m = typeof isoDate === "string" ? isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return loc(locale) === "en" ? `${day} ${EN_MONTHS[month - 1]} ${m[1]}` : `${m[3]}.${m[2]}.${m[1]}`;
}

/**
 * The Resend idempotency key of one mail attempt: a repeat of the SAME
 * attempt (a worker died after Resend took the mail, two workers raced) is
 * refused by Resend instead of delivered twice; every concluded attempt
 * counts up mail_attempts, so a resend gets a fresh key.
 * @param {number} id
 * @param {number} mailAttempts
 */
export function giftVoucherMailIdempotencyKey(id, mailAttempts) {
  const n = Number.isSafeInteger(mailAttempts) && mailAttempts >= 0 ? mailAttempts : 0;
  return `gift-voucher-mail-${id}-${n}`;
}

/**
 * The e-mailed download link: <base>/api/gift-vouchers/download?t=<token>.
 * @param {string} baseUrl  without a trailing slash (getBaseUrl())
 * @param {string} token    the plain download token (only its hash is stored)
 */
export function giftVoucherDownloadUrl(baseUrl, token) {
  return `${String(baseUrl).replace(/\/+$/, "")}/api/gift-vouchers/download?t=${encodeURIComponent(token)}`;
}

// ── the mail ─────────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   audience: GiftVoucherMailAudience,
 *   locale?: MailLocale,
 *   amountCents: number,
 *   number: string,
 *   code: string,
 *   expiresOn?: string | null,
 *   recipientName?: string | null,
 *   senderName?: string | null,
 *   orderName?: string | null,
 *   downloadUrl?: string | null,
 *   hasAttachment?: boolean,
 *   print?: { name: string | null, postalCode: string | null, city: string | null } | null,
 *   pageUrl?: string | null,
 *   termsUrl?: string | null,
 *   redacted?: boolean,
 *   hadDownloadLink?: boolean,
 * }} GiftVoucherMailParams
 *   `redacted` / `hadDownloadLink` are set by redactGiftVoucherMailParams only.
 *
 * @typedef {{ text: string, muted: string, link: string }} GiftVoucherMailStyles
 *   Inline CSS of the active e-mail design (emailTextStyle, emailMutedTextStyle, emailLinkStyle).
 *
 * @typedef {{
 *   subject: string, preheader: string, heading: string, text: string,
 *   bodyHtml: string, cta: { label: string, url: string } | null, footnoteHtml: string, signOffHtml: string,
 * }} GiftVoucherMailContent
 */

/**
 * The copy for the mail log: the code masked to its last four characters,
 * no download link — the rest identical.
 * @param {GiftVoucherMailParams} params
 * @returns {GiftVoucherMailParams}
 */
export function redactGiftVoucherMailParams(params) {
  return {
    ...params,
    code: maskGiftVoucherCode(params.code),
    downloadUrl: null,
    redacted: true,
    hadDownloadLink: params.redacted === true ? params.hadDownloadLink === true : clean(params.downloadUrl) !== null,
  };
}

const COPY = {
  de: {
    heading: { buyer: "Dein Geschenkgutschein", recipient: "Ein Geschenkgutschein für dich" },
    hello: "Hallo",
    preheaderBuyer: () => "Vielen Dank für deinen Einkauf — dein Gutschein ist fertig und sofort einlösbar.",
    /** @param {string} value */
    preheaderRecipient: (value) => `Für dich: ein Gutschein über ${value} für den Shop von motion sports.`,
    introBuyer: "vielen Dank für deinen Einkauf bei motion sports! Dein Geschenkgutschein ist fertig und ab sofort im Shop einlösbar.",
    /** @param {string} value */
    introRecipient: (value) => `du bekommst einen Geschenkgutschein über ${value} für den Shop von motion sports. Er ist ab sofort einlösbar.`,
    attached: "Du findest ihn als PDF im Anhang – zum Ausdrucken oder Weiterleiten.",
    viaButton: "Über den Button unten lädst du ihn als PDF herunter – zum Ausdrucken oder Weiterleiten.",
    noPdf: "Das PDF schicken wir dir auf Nachfrage gern noch einmal.",
    for: "Für",
    from: "Von",
    value: "Wert",
    validUntil: "Gültig bis",
    validity: "Gültigkeit",
    unlimited: "unbegrenzt gültig",
    number: "Gutschein-Nr.",
    order: "Bestellung",
    codeLabel: "Dein Gutscheincode",
    redeem: "So löst du ihn ein: Code im Checkout auf motionsports.de eingeben. Restguthaben bleibt erhalten. Keine Barauszahlung.",
    /** @param {string} who @param {string} where */
    printTo: (who, where) => `Die Premium-Karte wird gedruckt und an ${who} in ${where} geschickt — meist in ${PRINT_DELIVERY_DE}.`,
    printGeneric: `Die Premium-Karte wird gedruckt und per Post verschickt — meist in ${PRINT_DELIVERY_DE}.`,
    cta: "Gutschein herunterladen (PDF)",
    ctaText: "Gutschein als PDF herunterladen",
    linkHidden: "Download-Link (im Mail-Protokoll ausgeblendet)",
    cash: "Behandle den Code wie Bargeld: Wer ihn kennt, kann ihn einlösen.",
    balance: "Guthaben prüfen",
    terms: "Gutscheinbedingungen",
    questions: "Bei Fragen kannst du jederzeit auf diese E-Mail antworten.",
    regards: "Viele Grüße",
    team: "Dein motion sports Team",
  },
  en: {
    heading: { buyer: "Your gift voucher", recipient: "A gift voucher for you" },
    hello: "Hello",
    preheaderBuyer: () => "Thank you for your purchase — your voucher is ready and can be used right away.",
    /** @param {string} value */
    preheaderRecipient: (value) => `For you: a gift voucher for ${value} for the motion sports shop.`,
    introBuyer: "thank you for shopping at motion sports! Your gift voucher is ready and can be redeemed in our shop right away.",
    /** @param {string} value */
    introRecipient: (value) => `you have received a gift voucher for ${value} for the motion sports shop. It can be redeemed right away.`,
    attached: "You will find it attached as a PDF – to print or forward.",
    viaButton: "Use the button below to download it as a PDF – to print or forward.",
    noPdf: "Just reply to this email if you would like the PDF sent again.",
    for: "For",
    from: "From",
    value: "Value",
    validUntil: "Valid until",
    validity: "Validity",
    unlimited: "no expiry date",
    number: "Voucher no.",
    order: "Order",
    codeLabel: "Your voucher code",
    redeem: "How to redeem: enter the code at checkout on motionsports.de. Any remaining balance is kept. No cash payout.",
    /** @param {string} who @param {string} where */
    printTo: (who, where) => `The premium card is being printed and sent to ${who} in ${where} — usually within ${PRINT_DELIVERY_EN}.`,
    printGeneric: `The premium card is being printed and sent by post — usually within ${PRINT_DELIVERY_EN}.`,
    cta: "Download voucher (PDF)",
    ctaText: "Download the voucher as a PDF",
    linkHidden: "Download link (hidden in the mail log)",
    cash: "Treat the code like cash: anyone who knows it can redeem it.",
    balance: "Check balance",
    terms: "Voucher terms",
    questions: "If you have any questions, simply reply to this email.",
    regards: "Best regards",
    team: "Your motion sports team",
  },
};

/**
 * The voucher mail: subject, preheader, heading band, the plain-text part and
 * the HTML pieces of the branded shell (body, CTA, footnote, sign-off). Pure;
 * `styles` are the active design's inline styles. With `redacted` (see
 * redactGiftVoucherMailParams) the code shows only its last four characters
 * and no download link appears anywhere.
 *
 * @param {GiftVoucherMailParams} params
 * @param {GiftVoucherMailStyles} styles
 * @returns {GiftVoucherMailContent}
 */
export function buildGiftVoucherMail(params, styles) {
  const l = loc(params.locale);
  const t = COPY[l];
  const e = escapeMailHtml;
  const audience = params.audience === "recipient" ? "recipient" : "buyer";
  const redacted = params.redacted === true;
  const value = formatEuro(params.amountCents, l);
  const code = redacted ? maskGiftVoucherCode(params.code) : formatGiftVoucherCode(params.code);
  const downloadUrl = redacted ? null : clean(params.downloadUrl);
  // The log copy mirrors the real mail: it mentions the (hidden) link only
  // when the real mail had one.
  const linkPresent = redacted ? params.hadDownloadLink === true : downloadUrl !== null;
  const recipientName = clean(params.recipientName);
  const senderName = clean(params.senderName);
  const orderName = audience === "buyer" ? clean(params.orderName) : null;
  const expiry = formatGiftVoucherMailDate(params.expiresOn, l);
  const hasAttachment = params.hasAttachment === true;
  const pageUrl = clean(params.pageUrl);
  const termsUrl = clean(params.termsUrl);

  const subject = giftVoucherMailSubject({ audience, locale: l, amountCents: params.amountCents });
  const preheader = audience === "recipient" ? t.preheaderRecipient(value) : t.preheaderBuyer();
  const heading = t.heading[audience];
  const greeting = audience === "recipient" && recipientName ? `${t.hello} ${recipientName},` : `${t.hello},`;
  const intro = audience === "recipient" ? t.introRecipient(value) : t.introBuyer;
  // Where the PDF is: attached, behind the button — or, when neither could
  // be prepared (render and download link both failed), on request.
  const pdfHint = hasAttachment ? t.attached : linkPresent ? t.viaButton : t.noPdf;

  /** @type {Array<[string, string]>} */
  const rows = [];
  if (recipientName && audience === "buyer") rows.push([t.for, recipientName]);
  if (senderName) rows.push([t.from, senderName]);
  rows.push([t.value, value]);
  rows.push(expiry ? [t.validUntil, expiry] : [t.validity, t.unlimited]);
  rows.push([t.number, String(params.number ?? "")]);
  if (orderName) rows.push([t.order, orderName]);

  // The Premium-Karte note (shop buyers whose voucher comes as a card).
  let printNote = null;
  if (params.print) {
    const who = clean(params.print.name);
    const where = [clean(params.print.postalCode), clean(params.print.city)].filter(Boolean).join(" ");
    printNote = who && where ? t.printTo(who, where) : t.printGeneric;
  }

  // ── text part (same order as the HTML) ──
  const lines = [greeting, "", `${intro} ${pdfHint}`, ""];
  for (const [label, val] of rows) lines.push(`${label}: ${val}`);
  lines.push("", `${t.codeLabel}: ${code}`, "", t.redeem);
  if (printNote) lines.push("", printNote);
  if (downloadUrl) lines.push("", `${t.ctaText}:`, downloadUrl);
  else if (redacted && linkPresent) lines.push("", t.linkHidden);
  lines.push("", t.cash);
  if (pageUrl) lines.push(`${t.balance}: ${pageUrl}#guthaben`);
  if (termsUrl) lines.push(`${t.terms}: ${termsUrl}`);
  lines.push("", t.questions, "", t.regards, t.team);
  const text = lines.join("\n");

  // ── HTML pieces (margins, not padding: Outlook ignores padding on <p>) ──
  const rowHtml = rows
    .map(
      ([label, val]) => `
                      <tr>
                        <td style="${styles.muted} padding: 3px 12px 3px 0;" width="40%" valign="top">${e(label)}</td>
                        <td style="${styles.text} padding: 3px 0;" valign="top"><strong>${e(val)}</strong></td>
                      </tr>`
    )
    .join("");
  const bodyHtml = `
                    <p style="${styles.text}" align="left">${e(greeting)}</p>
                    <p style="${styles.text} Margin-top: 10px; Margin-bottom: 14px;" align="left">${e(intro)} ${e(pdfHint)}</p>
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" style="min-width: 100%; direction: ltr;" role="presentation">${rowHtml}
                    </table>
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" style="min-width: 100%; direction: ltr; Margin-top: 16px;" role="presentation">
                      <tr>
                        <td style="mso-line-height-rule: exactly; padding: 16px 20px;" align="center" bgcolor="#eeeeee" valign="top">
                          <p style="${styles.muted}" align="center">${e(t.codeLabel)}</p>
                          <p style="${styles.text} font-size: 22px; line-height: 1.35; font-weight: 700; letter-spacing: 3px; Margin-top: 6px;" align="center">${e(code)}</p>
                        </td>
                      </tr>
                    </table>
                    <p style="${styles.text} Margin-top: 16px;" align="left">${e(t.redeem)}</p>${
                      printNote
                        ? `
                    <p style="${styles.text} Margin-top: 10px;" align="left">${e(printNote)}</p>`
                        : ""
                    }${
                      redacted && linkPresent
                        ? `
                    <p style="${styles.muted} Margin-top: 10px;" align="left">${e(t.linkHidden)}</p>`
                        : ""
                    }`;

  const links = [];
  if (pageUrl) links.push(`<a href="${e(`${pageUrl}#guthaben`)}" target="_blank" style="${styles.link}">${e(t.balance)}</a>`);
  if (termsUrl) links.push(`<a href="${e(termsUrl)}" target="_blank" style="${styles.link}">${e(t.terms)}</a>`);
  const footnoteHtml = `
                    <p style="${styles.muted}" align="center">${e(t.cash)}</p>${
                      links.length
                        ? `
                    <p style="${styles.muted} Margin-top: 6px;" align="center">${links.join(" &#183; ")}</p>`
                        : ""
                    }`;

  const signOffHtml = `
                    <p style="${styles.text}" align="center">${e(t.questions)}</p>
                    <p style="${styles.text} Margin-top: 10px;" align="center">${e(t.regards)}<br>${e(t.team)}</p>`;

  return {
    subject,
    preheader,
    heading,
    text,
    bodyHtml,
    cta: downloadUrl ? { label: t.cta, url: downloadUrl } : null,
    footnoteHtml,
    signOffHtml,
  };
}

// ── after a failed send ──────────────────────────────────────────────────────

const MAIL_NOT_CONFIGURED = "E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY / CONTACT_FROM_EMAIL).";
const MAIL_CONFLICT =
  "Resend kannte diesen Versand schon (gleicher Idempotenz-Schlüssel) — die E-Mail ging bereits raus, kein zweiter Versand.";
const MAIL_CONCURRENT = "Ein anderer Versand dieser E-Mail lief gerade — Mo prüft gleich noch einmal.";

/**
 * What a send that did not go through means for the mail state. `attempts`
 * is mail_attempts BEFORE this try.
 *   · not configured (sendEmail skipped) → retry by the plan, then failed;
 *   · Resend refused the key as already used for another payload → this
 *     attempt was taken before (a worker died after the send, or raced):
 *     counts as sent, never mailed twice;
 *   · the same attempt is still in flight elsewhere → look again in 2
 *     minutes with the SAME key (no attempt counted);
 *   · refused as invalid (address, payload) → failed (an operator resends);
 *   · everything else (rate limit, quota, configuration, network, 5xx) →
 *     retry by planGiftVoucherRetry (1, 2, 5 … 720 minutes), failed after
 *     the tenth try.
 *
 * @param {{ skipped?: boolean, error?: unknown, attempts: number, now?: number }} input
 * @returns {{ status: "sent" | "pending" | "failed", countAttempt: boolean, nextAttemptAt: Date | null, error: string, outcome: "sent" | "skipped" | "failed" }}
 */
export function planGiftVoucherMailFailure(input) {
  const now = typeof input.now === "number" ? input.now : Date.now();
  const attempts = Number.isSafeInteger(input.attempts) && input.attempts >= 0 ? input.attempts : 0;
  /** @param {string} error @param {"skipped" | "failed"} outcome */
  const retry = (error, outcome) => {
    const minutes = planGiftVoucherRetry(attempts + 1);
    return minutes == null
      ? { status: /** @type {const} */ ("failed"), countAttempt: true, nextAttemptAt: null, error: `${error} Aufgegeben nach ${attempts + 1} Versuchen.`, outcome }
      : { status: /** @type {const} */ ("pending"), countAttempt: true, nextAttemptAt: new Date(now + minutes * 60_000), error, outcome };
  };
  if (input.skipped) return retry(MAIL_NOT_CONFIGURED, "skipped");

  const err = /** @type {{ name?: unknown, statusCode?: unknown, message?: unknown } | null} */ (
    input.error && typeof input.error === "object" ? input.error : null
  );
  const name = typeof err?.name === "string" ? err.name : "";
  const detail = typeof err?.message === "string" && err.message.trim() ? err.message.trim().slice(0, 200) : "unbekannter Fehler";
  if (name === "invalid_idempotent_request") {
    return { status: "sent", countAttempt: true, nextAttemptAt: null, error: MAIL_CONFLICT, outcome: "sent" };
  }
  if (name === "concurrent_idempotent_requests") {
    return { status: "pending", countAttempt: false, nextAttemptAt: new Date(now + 2 * 60_000), error: MAIL_CONCURRENT, outcome: "failed" };
  }
  const cls = classifyResendError(
    err ? { name: name || null, statusCode: typeof err.statusCode === "number" ? err.statusCode : null } : null
  );
  if (cls === "invalid" || cls === "conflict") {
    return { status: "failed", countAttempt: true, nextAttemptAt: null, error: `Resend hat die E-Mail abgelehnt: ${detail}`, outcome: "failed" };
  }
  return retry(`E-Mail nicht gesendet (${cls}): ${detail}.`, "failed");
}
