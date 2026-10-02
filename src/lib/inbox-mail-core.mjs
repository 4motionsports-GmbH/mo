// E-Mails im Eingang — the pure rules (tested in inbox-mail-core.test.mjs).
//
// Every incoming mail of a known customer (Resend Inbound, an assigned
// „nicht zugeordnet“ mail, a contact-form request) opens — or refreshes — ONE
// Eingang item „E-Mail beantworten“ per customer: further mails before the
// answer join it. Sending a reply (from the item or the Korrespondenz tab)
// closes it. The AI writes a summary and a reply draft — a service reply,
// never advertising; a person edits and sends. docs/ADMIN_DASHBOARD.md §3.1.

export const MAIL_ITEM_KIND = "antwort_offen";
export const MAIL_ITEM_TITLE = "E-Mail beantworten";
export const MAIL_ITEM_PRIORITY = 90;
const MAX_IDS = 20;

/** @param {string | null | undefined} s @param {number} max */
function clip(s, max) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The evidence of a mail item after one more mail arrived.
 * @param {Record<string, unknown> | null | undefined} prev
 * @param {{ emailMessageId: number, subject: string | null, occurredAt: string, source?: string }} mail
 */
export function mergeMailEvidence(prev, mail) {
  const ids = Array.isArray(prev?.messageIds) ? prev.messageIds.map(Number).filter(Number.isFinite) : [];
  if (!ids.includes(mail.emailMessageId)) ids.push(mail.emailMessageId);
  const kept = ids.slice(-MAX_IDS);
  return {
    messageIds: kept,
    count: kept.length,
    lastInboundAt: mail.occurredAt,
    lastSubject: mail.subject ? clip(mail.subject, 200) : null,
    lastMessageId: mail.emailMessageId,
    source: mail.source === "kontaktformular" ? "kontaktformular" : "email",
  };
}

/**
 * The list snippet of an incoming mail: the start of what is new (quoted
 * history removed), falling back to the provider snippet.
 * @param {string | null | undefined} bodyText @param {string | null | undefined} bodyHtml @param {string | null | undefined} fallback
 */
export function mailSnippet(bodyText, bodyHtml, fallback) {
  const raw = bodyText || htmlToText(bodyHtml) || "";
  const fresh = stripQuoted(raw);
  return fresh ? clip(fresh, 200) : fallback ? clip(fallback, 200) : null;
}

/**
 * The one-line reason of a mail item: subject and the start of the text.
 * @param {{ subject: string | null, snippet: string | null, count: number, source?: string }} m
 */
export function mailItemReason(m) {
  const contact = m.source === "kontaktformular";
  const what = contact ? "Kontaktanfrage" : m.count > 1 ? `${m.count} E-Mails` : "E-Mail";
  const topic = contact && m.subject ? m.subject.replace(/^Kontaktanfrage:\s*/i, "") : m.subject;
  const subject = topic ? `„${clip(topic, 90)}“` : "(ohne Betreff)";
  const snippet = m.snippet ? ` — ${clip(m.snippet, 220)}` : "";
  return `${what}: ${subject}${snippet}`;
}

/**
 * A NEW mail item (no open one for this customer yet). The dedupe key names
 * the first mail of the episode, so a decided item never swallows a later mail.
 * @param {{ customerId: number, emailMessageId: number, subject: string | null, snippet: string | null,
 *           occurredAt: string, source?: string }} mail
 */
export function newMailItem(mail) {
  const evidence = mergeMailEvidence(null, mail);
  return {
    kind: MAIL_ITEM_KIND,
    customerId: mail.customerId,
    priority: MAIL_ITEM_PRIORITY,
    title: MAIL_ITEM_TITLE,
    reason: mailItemReason({ subject: mail.subject, snippet: mail.snippet, count: 1, source: evidence.source }),
    evidence,
    dedupeKey: `${MAIL_ITEM_KIND}:${mail.customerId}:m${mail.emailMessageId}`,
    expiresAt: null,
  };
}

/** Split „Vorname Nachname“ for a new prospect. @param {string | null | undefined} full */
export function splitName(full) {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0].slice(0, 100), lastName: null };
  return { firstName: parts.slice(0, -1).join(" ").slice(0, 100), lastName: parts[parts.length - 1].slice(0, 100) };
}

/**
 * A contact-form request as a received message for Mo's mail log.
 * @param {{ reasonLabel: string, name: string, email: string, organization?: string | null,
 *           phone?: string | null, message: string, products?: string[] }} p
 */
export function contactFormMessage(p) {
  const lines = [
    `Kontaktanfrage über motionsports.de (${p.reasonLabel})`,
    `Name: ${p.name.trim()}`,
    p.organization?.trim() ? `Organisation: ${p.organization.trim()}` : null,
    p.phone?.trim() ? `Telefon: ${p.phone.trim()}` : null,
    p.products?.length ? `Produkte: ${p.products.join(", ")}` : null,
    "",
    p.message.trim(),
  ].filter((l) => l !== null);
  const bodyText = lines.join("\n");
  return {
    subject: `Kontaktanfrage: ${p.reasonLabel}`,
    bodyText,
    snippet: clip(p.message, 200),
  };
}

/** Rough HTML → text for mails that came without a text part. @param {string | null | undefined} html */
export function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Drop the quoted history under a reply („Am … schrieb …“, „On … wrote:“,
 * „> …“ lines) so the model and the operator see what is new.
 * @param {string} text
 */
export function stripQuoted(text) {
  const lines = String(text ?? "").split("\n");
  const out = [];
  for (const line of lines) {
    if (/^\s*(Am .+ schrieb .+:|On .+ wrote:|-----\s*Original Message|Von: .+|From: .+)\s*$/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

export const MAIL_INTENTS = ["produktfrage", "bestellung_lieferung", "reklamation_rueckgabe", "rechnung_zahlung", "beratung", "sonstiges"];
export const MAIL_INTENT_LABELS = {
  produktfrage: "Produktfrage",
  bestellung_lieferung: "Bestellung & Lieferung",
  reklamation_rueckgabe: "Reklamation & Rückgabe",
  rechnung_zahlung: "Rechnung & Zahlung",
  beratung: "Beratung",
  sonstiges: "Sonstiges",
};

/**
 * The prompt for the summary + reply draft. Sources only — no tool access.
 * @param {{ customerName: string | null, language: "de" | "en",
 *           messages: Array<{ direction: "sent" | "received", at: string | null, subject: string | null, text: string }>,
 *           orders: Array<{ at: string | null, status: string | null, items: string[] }>,
 *           profile: string | null }} ctx
 */
export function buildMailReplyPrompt(ctx) {
  const system =
    "Du hilfst dem Kundenservice von motion sports (Fitness- und Kraftsportgeräte, Online-Shop motionsports.de). " +
    "Lies die letzte E-Mail der Person und schreib (1) eine kurze Zusammenfassung für das Team und (2) einen " +
    "Antwortentwurf, den ein Mensch prüft und sendet.\n\n" +
    "Regeln für den Entwurf:\n" +
    `- Sprache: die der letzten Mail der Person (im Zweifel ${ctx.language === "en" ? "Englisch" : "Deutsch"}). Sprich die Person so an, wie sie schreibt (du oder Sie); wenn unklar: Sie.\n` +
    "- Eine Service-Antwort: beantworte genau das Anliegen. KEINE Werbung, keine Produktempfehlung, die nicht erfragt wurde, keine Rabatte, keine Gutscheine.\n" +
    "- Erfinde nichts: keine Liefertermine, Preise, Lagerbestände, Erstattungen oder Zusagen, die nicht in den Quellen stehen. " +
    "Wo eine Angabe fehlt, schreib einen Platzhalter in eckigen Klammern, z. B. [Liefertermin prüfen], und nenne ihn in offene_punkte.\n" +
    "- Kurz und freundlich, ohne Floskeln. Abschluss: „Viele Grüße“ und „Dein motion sports Team“ (bei Sie: „Ihr motion sports Team“; Englisch: „Best regards“ / „The motion sports team“).\n" +
    "- betreff: der Betreff der Antwort (meist „Re: …“).\n" +
    "- zusammenfassung: 1–2 Sätze für das Team, was die Person will.\n" +
    "- naechster_schritt: ein Satz, was das Team vor dem Senden tun sollte (z. B. Lieferstatus in Shopify prüfen).";
  const msgs = ctx.messages
    .map(
      (m) =>
        `### ${m.direction === "received" ? "Von der Person" : "Von uns"} · ${m.at ? m.at.slice(0, 16).replace("T", " ") : "?"}\n` +
        `Betreff: ${m.subject ?? "(ohne)"}\n${clipBlock(m.text, 3000)}`
    )
    .join("\n\n");
  const orders = ctx.orders.length
    ? ctx.orders
        .map((o) => `- Bestellung vom ${o.at ? o.at.slice(0, 10) : "?"}${o.status ? ` (${o.status})` : ""}: ${o.items.slice(0, 6).join(", ") || "—"}`)
        .join("\n")
    : "(keine Bestellungen)";
  const prompt =
    `## Person\n${ctx.customerName ?? "(Name unbekannt)"}\n\n` +
    `## Letzte Bestellungen\n${orders}\n\n` +
    `## Kundenverständnis\n${ctx.profile ?? "(keins)"}\n\n` +
    `## E-Mail-Verlauf (älteste zuerst)\n${msgs || "(leer)"}\n\n` +
    "Schreib Zusammenfassung und Antwortentwurf auf die LETZTE Mail der Person.";
  return { system, prompt };
}

/** @param {string} text @param {number} max */
function clipBlock(text, max) {
  const t = String(text ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}\n[…gekürzt]` : t;
}

/**
 * Clean the model's answer into the item's suggestion.
 * @param {{ zusammenfassung?: string, anliegen?: string, dringlichkeit?: string, naechster_schritt?: string,
 *           betreff?: string | null, text?: string, offene_punkte?: string[] }} o
 * @param {{ fallbackSubject: string }} opts
 */
export function sanitizeMailDraft(o, opts) {
  const anliegen = MAIL_INTENTS.includes(String(o.anliegen)) ? String(o.anliegen) : "sonstiges";
  const dringlichkeit = ["niedrig", "mittel", "hoch"].includes(String(o.dringlichkeit)) ? String(o.dringlichkeit) : "mittel";
  const betreff = clip(o.betreff || opts.fallbackSubject, 200) || opts.fallbackSubject;
  return {
    warum: clip(o.zusammenfassung, 600),
    aktion: clip(o.naechster_schritt, 300),
    kanal: "antwort",
    betreff,
    text: String(o.text ?? "").trim().slice(0, 6000),
    rabatt: null,
    produkte: [],
    anliegen,
    dringlichkeit,
    offenePunkte: Array.isArray(o.offene_punkte) ? o.offene_punkte.map((p) => clip(p, 160)).filter(Boolean).slice(0, 6) : [],
  };
}
