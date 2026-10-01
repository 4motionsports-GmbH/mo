// One customer's activity as a single timeline (pure, tested): orders, Mo
// chats, campaign mails, consent changes and correspondence, newest first.
// The Kunden „Aktivität“ tab renders it; lib/customer-detail.ts gathers the
// inputs (all already loaded for the detail — no extra queries).

import { money, plural } from "./admin-format.mjs";

/**
 * @typedef {{
 *   at: string,
 *   kind: "order" | "chat" | "campaign" | "consent" | "mail_in" | "mail_out",
 *   title: string,
 *   detail: string | null,
 * }} TimelineEntry
 */

const euro = (cents, currency) => money((Number(cents) || 0) / 100, currency || "EUR");

const STATE_TITLES = {
  subscribed: "Für E-Mail-Werbung angemeldet",
  pending: "Anmeldung begonnen (Bestätigung ausstehend)",
  unsubscribed: "Von E-Mail-Werbung abgemeldet",
  not_subscribed: "Keine Einwilligung",
};

/**
 * @param {{
 *   orders?: Array<{ processedAt: string, name: string | null, totalCents: number, currency: string | null, cancelledAt: string | null, lineItems: Array<{ title: string, quantity: number }> }>,
 *   sessions?: Array<{ createdAt: string | null, messageCount: number, personaDisplay: string | null }>,
 *   campaigns?: Array<{ sentAt: string | null, campaignName: string, subject: string | null, clickedAt: string | null }>,
 *   consentEvents?: Array<{ occurredAt: string, state: string, sourceLabel: string, note: string | null }>,
 *   messages?: Array<{ occurredAt: string | null, direction: "sent" | "received", subject: string | null, marketingSendId: number | null }>,
 * }} input
 * @param {number} [limit]
 * @returns {TimelineEntry[]}
 */
export function buildCustomerTimeline(input, limit = 80) {
  /** @type {TimelineEntry[]} */
  const out = [];
  for (const o of input.orders ?? []) {
    const items = (o.lineItems ?? []).slice(0, 3).map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.title}`);
    const more = (o.lineItems?.length ?? 0) > 3 ? ` +${o.lineItems.length - 3}` : "";
    out.push({
      at: o.processedAt,
      kind: "order",
      title: `Bestellung ${o.name ?? ""} · ${euro(o.totalCents, o.currency)}${o.cancelledAt ? " (storniert)" : ""}`.replace("  ", " "),
      detail: items.length ? items.join(", ") + more : null,
    });
  }
  for (const s of input.sessions ?? []) {
    if (!s.createdAt) continue;
    out.push({
      at: s.createdAt,
      kind: "chat",
      title: `Gespräch mit Mo · ${plural(s.messageCount, "Nachricht", "Nachrichten")}`,
      detail: s.personaDisplay,
    });
  }
  for (const c of input.campaigns ?? []) {
    if (!c.sentAt) continue;
    out.push({
      at: c.sentAt,
      kind: "campaign",
      title: `${c.campaignName}: „${c.subject ?? "—"}“`,
      detail: c.clickedAt ? "angeklickt" : null,
    });
  }
  for (const e of input.consentEvents ?? []) {
    out.push({
      at: e.occurredAt,
      kind: "consent",
      title: STATE_TITLES[e.state] ?? e.state,
      detail: [e.sourceLabel, e.note].filter(Boolean).join(" · ") || null,
    });
  }
  for (const m of input.messages ?? []) {
    if (!m.occurredAt) continue;
    // Campaign mails already appear as campaign entries.
    if (m.direction === "sent" && m.marketingSendId == null && (input.campaigns ?? []).some((c) => c.sentAt && c.subject === m.subject)) continue;
    out.push({
      at: m.occurredAt,
      kind: m.direction === "received" ? "mail_in" : "mail_out",
      title: `${m.direction === "received" ? "E-Mail erhalten" : "E-Mail gesendet"}: „${m.subject ?? "—"}“`,
      detail: null,
    });
  }
  return out
    .filter((e) => !Number.isNaN(new Date(e.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}
