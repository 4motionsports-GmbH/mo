// Rundmail (bulk mail) — the checks before release („Prüfen & senden“).
// Pure and tested (mailing-checks.test.mjs). A Rundmail goes to thousands of
// people at once and nobody looks at each mail, so everything that can be
// checked by a machine is checked here, ONCE, on the exact content that will
// be frozen:
//
//   errors   — block the release (the route refuses too)
//   warnings — deliverability and quality hints (spam filters, phones)
//   infos    — what will happen (recipients, duration, personalisation)
//
// The legal gates per recipient (consent, opt-in level, block list,
// frequency cap) run again for every recipient at send time
// (mailing-send.ts → campaign-gates.mjs) — these checks never replace them.

import { MAIL_FOOTER_MARKER } from "./mail-template-render.mjs";
import { leftoverPlaceholders, rewriteLinkHrefs } from "./mailing-core.mjs";
import { formatMailingDuration, mailingDurationMinutes, realMailingRate } from "./mailing-schedule.mjs";

/** Gmail clips a mail above 102 KB — the unsubscribe footer would vanish. */
export const MAILING_HTML_HARD_LIMIT = 100 * 1024;
export const MAILING_HTML_SOFT_LIMIT = 80 * 1024;
export const SUBJECT_MAX_CHARS = 150;
export const SUBJECT_MOBILE_CHARS = 60;

const SHORTENERS = ["bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at"];
// Words spam filters weigh — a hint, never a block (German shop copy uses
// some of them legitimately).
const SPAM_WORDS = [
  "gratis",
  "kostenlos",
  "100%",
  "100 %",
  "gewinn",
  "gewinnspiel",
  "jetzt kaufen",
  "nur heute",
  "garantiert",
  "free",
  "winner",
  "click here",
  "hier klicken",
  "€€€",
  "!!!",
];

/**
 * @typedef {{ key: string, level: "error" | "warning" | "info", message: string, blockId?: string | null }} MailingCheck
 */

/** Visible text of mail HTML (rough — for the text/image balance). */
export function visibleText(html) {
  return String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script|title)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<div style="display: none[\s\S]*?<\/div>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#8204;|&#847;/g, " ")
    .replace(/&[a-z#0-9]+;/gi, "x")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The blocking checks that depend on the RENDERED mail: its size (Gmail clips
 * above 102 KB and hides the unsubscribe link), pictures over http://,
 * javascript:/data: links and — for the frozen render (`frozen`: its HTML,
 * text and subject) — placeholders other than Mo's own per-recipient ones.
 * Part of mailingChecks; run again on its own on the content rendered anew
 * at the send start (mailing-send.ts), with the same rules and messages.
 * @param {{ html: string, bytes?: number, frozen?: string }} input
 * @returns {MailingCheck[]}
 */
export function renderedMailErrors(input) {
  /** @type {MailingCheck[]} */
  const errors = [];
  const html = String(input.html ?? "");
  const bytes = input.bytes ?? new TextEncoder().encode(html).length;
  if (bytes > MAILING_HTML_HARD_LIMIT) {
    errors.push({
      key: "size",
      level: "error",
      message: `Die Mail ist ${Math.round(bytes / 1024)} KB groß — Gmail kürzt ab 102 KB und versteckt dann den Abmelde-Link. Bausteine oder eigenes HTML kürzen.`,
    });
  }
  if (/<img\b[^>]*\ssrc\s*=\s*"http:\/\//i.test(html)) {
    errors.push({ key: "insecure_image", level: "error", message: "Ein Bild wird über http:// geladen — nur https-Bilder werden sicher angezeigt." });
  }
  if (/\shref\s*=\s*"(?:javascript|data|vbscript):/i.test(html)) {
    errors.push({ key: "bad_link", level: "error", message: "Ein Link hat ein unzulässiges Ziel (javascript:/data:)." });
  }
  if (input.frozen !== undefined) {
    const bad = leftoverPlaceholders(input.frozen).filter((p) => !/^\{\{mo:/.test(p));
    if (bad.length > 0) errors.push({ key: "placeholders", level: "error", message: `Unbekannte Platzhalter: ${bad.join(", ")}` });
  }
  return errors;
}

/**
 * Run every check.
 * @param {{
 *   subject: string,
 *   preheader: string | null,
 *   html: string,
 *   docIssues: { errors: Array<{ blockId: string | null, message: string }>, warnings: Array<{ blockId: string | null, message: string }> },
 *   sender: { ok: true, from: string } | { ok: false, message: string },
 *   sendsApproved: boolean,
 *   allowSingleOptIn: boolean,
 *   audience: { total: number, confirmed: number } | null,
 *   contentVersion: number,
 *   testVersion: number | null,
 *   usesFirstName: boolean,
 *   ratePerMinute: number,
 *   unknownSubjectFields: string[],
 *   bytes?: number,
 *   products?: { soldOut: string[], unknown: string[], emptyBlocks: number },
 *   audiencePending?: string | null,
 * }} input  `audiencePending`: the name of a Rundmail the audience depends on
 *   („Hat Rundmail <X> erhalten“) that has not finished sending — an empty
 *   audience is then expected (it is matched at this Rundmail's start).
 * @returns {{ errors: MailingCheck[], warnings: MailingCheck[], infos: MailingCheck[], ok: boolean }}
 */
export function mailingChecks(input) {
  /** @type {MailingCheck[]} */
  const errors = [];
  /** @type {MailingCheck[]} */
  const warnings = [];
  /** @type {MailingCheck[]} */
  const infos = [];
  const subject = String(input.subject ?? "").trim();
  const html = String(input.html ?? "");
  const bytes = input.bytes ?? new TextEncoder().encode(html).length;

  // ── blocking ──
  if (!input.sendsApproved) {
    errors.push({ key: "sends_not_approved", level: "error", message: "Versand gesperrt: CAMPAIGN_SENDS_APPROVED ist aus — ohne diesen Schalter verlässt keine Kampagnen-Mail das System." });
  }
  if (!subject) errors.push({ key: "subject_missing", level: "error", message: "Betreff fehlt." });
  else if (subject.length > SUBJECT_MAX_CHARS) errors.push({ key: "subject_long", level: "error", message: `Betreff ist zu lang (max. ${SUBJECT_MAX_CHARS} Zeichen).` });
  for (const bad of input.unknownSubjectFields ?? []) {
    errors.push({ key: "subject_field", level: "error", message: `Unbekannter Platzhalter im Betreff: ${bad} — erlaubt ist {{vorname}} bzw. {{vorname|Ersatz}}.` });
  }
  for (const issue of input.docIssues?.errors ?? []) errors.push({ key: "content", level: "error", message: issue.message, blockId: issue.blockId });
  if (!input.sender.ok) errors.push({ key: "sender", level: "error", message: input.sender.message });
  if (input.audience && input.audience.total === 0) {
    if (input.audiencePending) {
      warnings.push({
        key: "audience_pending",
        level: "warning",
        message: `Die Zielgruppe ist gerade leer: Sie hängt an der Rundmail „${input.audiencePending}“, die noch nicht fertig versendet ist, und wird beim Versandstart ermittelt — den Start erst nach deren Versand planen.`,
      });
    } else {
      errors.push({ key: "audience_empty", level: "error", message: "Die Zielgruppe ist leer — niemand mit Einwilligung passt." });
    }
  }
  if (input.testVersion !== input.contentVersion) {
    errors.push({
      key: "test_missing",
      level: "error",
      message: "Testmail fehlt: Schicke den aktuellen Stand an dich selbst und prüfe ihn auf dem Handy und am Rechner (nach jeder Änderung neu).",
    });
  }
  errors.push(...renderedMailErrors({ html, bytes }));

  // ── deliverability hints ──
  if (subject) {
    if (subject.length > SUBJECT_MOBILE_CHARS) {
      warnings.push({ key: "subject_mobile", level: "warning", message: `Betreff hat ${subject.length} Zeichen — auf dem Handy sind nur etwa ${SUBJECT_MOBILE_CHARS} sichtbar.` });
    }
    const letters = subject.replace(/[^A-Za-zÄÖÜäöüß]/g, "");
    const upper = letters.replace(/[^A-ZÄÖÜ]/g, "");
    if (letters.length >= 10 && upper.length / letters.length > 0.7) {
      warnings.push({ key: "subject_caps", level: "warning", message: "Betreff fast nur in GROSSBUCHSTABEN — Spamfilter werten das negativ." });
    }
    if ((subject.match(/!/g) ?? []).length >= 2) {
      warnings.push({ key: "subject_bang", level: "warning", message: "Mehrere Ausrufezeichen im Betreff — Spamfilter werten das negativ." });
    }
  }
  // Only what the operator wrote: the legal footer must say „kostenlos abmelden“.
  const contentHtml = html.split(MAIL_FOOTER_MARKER)[0];
  const lowerAll = `${subject} ${String(input.preheader ?? "")} ${visibleText(contentHtml)}`.toLowerCase();
  const spam = SPAM_WORDS.filter((w) => lowerAll.includes(w));
  if (spam.length > 0) {
    warnings.push({ key: "spam_words", level: "warning", message: `Typische Spam-Wörter: ${spam.map((w) => `„${w}“`).join(", ")} — sparsam einsetzen.` });
  }
  if (!String(input.preheader ?? "").trim()) {
    warnings.push({ key: "preheader", level: "warning", message: "Vorschauzeile fehlt — sie steht im Posteingang neben dem Betreff und erhöht die Öffnungsrate." });
  }
  if (bytes > MAILING_HTML_SOFT_LIMIT && bytes <= MAILING_HTML_HARD_LIMIT) {
    warnings.push({ key: "size_soft", level: "warning", message: `Die Mail ist ${Math.round(bytes / 1024)} KB groß — nah an Gmails Grenze von 102 KB.` });
  }
  // The operator's content only — the legal footer alone has ~480 visible
  // characters and its own icons, so counting it hid every image-only mail.
  // The countdown's phone twin (class "cd-phone", mail-template-render.mjs)
  // is the same picture at another width: one image, not two.
  const imgCount = (contentHtml.match(/<img\b(?![^>]*\bclass="cd-phone")/gi) ?? []).length;
  const textChars = visibleText(contentHtml).length;
  if (imgCount >= 2 && textChars < 400) {
    warnings.push({ key: "image_heavy", level: "warning", message: "Viele Bilder, wenig Text — Spamfilter mögen reine Bild-Mails nicht, und bei blockierten Bildern sieht man kaum etwas. Etwas Text ergänzen." });
  }
  // The click targets only — the web-font stylesheet (<link href>) is no link.
  const hrefs = [];
  rewriteLinkHrefs(html, (value) => {
    hrefs.push(value);
    return null;
  });
  const httpLinks = hrefs.filter((h) => /^https?:\/\//i.test(h));
  if (new Set(httpLinks).size > 30) {
    warnings.push({ key: "many_links", level: "warning", message: `${new Set(httpLinks).size} verschiedene Links — weniger Links wirken seriöser.` });
  }
  const shortened = httpLinks.filter((h) => {
    try {
      return SHORTENERS.includes(new URL(h.replace(/&amp;/g, "&")).hostname.replace(/^www\./, "").toLowerCase());
    } catch {
      return false;
    }
  });
  if (shortened.length > 0) {
    warnings.push({ key: "shortener", level: "warning", message: "Link-Kürzer (bit.ly & Co.) sind ein starkes Spam-Signal — den vollständigen Link verwenden." });
  }
  if (httpLinks.some((h) => /^http:\/\//i.test(h))) {
    warnings.push({ key: "http_link", level: "warning", message: "Ein Link beginnt mit http:// — besser https://." });
  }
  for (const issue of input.docIssues?.warnings ?? []) warnings.push({ key: "content", level: "warning", message: issue.message, blockId: issue.blockId });
  // Products prepared ahead (sold out may be added on purpose): prices and
  // availability are taken at the send start (a planned Rundmail is rendered
  // again then, mailing-schedule.mjs), so what is still sold out then is
  // missing from the whole Rundmail.
  const products = input.products;
  if (products?.soldOut?.length) {
    warnings.push({
      key: "products_sold_out",
      level: "warning",
      message: `Gerade ausverkauft: ${products.soldOut.join(", ")} — fehlt in der Rundmail, wenn es beim Versandstart noch nicht lieferbar ist.`,
    });
  }
  if (products?.unknown?.length) {
    warnings.push({
      key: "products_unknown",
      level: "warning",
      message: `Nicht mehr im Katalog: ${products.unknown.join(", ")} — fehlt in der Rundmail.`,
    });
  }
  if (products?.emptyBlocks) {
    warnings.push({
      key: "products_block_empty",
      level: "warning",
      message:
        products.emptyBlocks === 1
          ? "Ein Produkt-Baustein hat gerade kein lieferbares Produkt — er fehlt in der Rundmail."
          : `${products.emptyBlocks} Produkt-Bausteine haben gerade kein lieferbares Produkt — sie fehlen in der Rundmail.`,
    });
  }
  if (input.audience && !input.allowSingleOptIn) {
    const unconfirmed = Math.max(0, input.audience.total - input.audience.confirmed);
    if (unconfirmed > 0) {
      warnings.push({
        key: "single_opt_in",
        level: "warning",
        message: `${unconfirmed} Empfänger:innen ohne nachweisbares Double-Opt-in werden übersprungen (CAMPAIGN_ALLOW_SINGLE_OPT_IN ist aus).`,
      });
    }
  }

  // ── what will happen ──
  if (input.audience) {
    const reach = input.allowSingleOptIn ? input.audience.total : input.audience.confirmed;
    // At the measured real speed (about 80 % of the tempo label).
    const duration = formatMailingDuration(mailingDurationMinutes(reach, input.ratePerMinute));
    infos.push({
      key: "reach",
      level: "info",
      message:
        reach > 0
          ? `Geht an etwa ${reach} Empfänger:innen — Dauer ${duration} (Tempo ${input.ratePerMinute} pro Minute, real etwa ${realMailingRate(input.ratePerMinute)}).`
          : "Geht nach heutigem Stand an niemanden — die Zielgruppe wird beim Versandstart frisch ermittelt.",
    });
  }
  if (input.usesFirstName) {
    infos.push({ key: "first_name", level: "info", message: "Persönliche Anrede: Wo kein Vorname bekannt ist, steht der Ersatztext." });
  }
  if (input.sender.ok) infos.push({ key: "from", level: "info", message: `Absender: ${input.sender.from}` });
  infos.push({ key: "unsubscribe", level: "info", message: "Abmelde-Link und Ein-Klick-Abmeldung (List-Unsubscribe) sind in jeder Mail." });

  return { errors, warnings, infos, ok: errors.length === 0 };
}
