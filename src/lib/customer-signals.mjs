// The Eingang rules (pure, tested): which customer needs us today, why, and
// how urgent — docs/CUSTOMER_PLATFORM_PLAN.md §11.3. Dedupe keys name the
// EPISODE (the order, chat, click or mail that triggered the rule), never a
// calendar window: while the condition holds the key stays the same, so a
// snoozed or dismissed item is not recreated next week. The job
// (lib/inbox-signals.ts) loads the facts per person and the few extra facts
// some rules need, calls these functions, and upserts the items by dedupe
// key. Every rule is deterministic and spelled out here, so the thresholds
// can be read, tested and tuned by a human.

/** Kind → German label, base priority, whether an e-mail action needs the one consent. */
export const SIGNAL_KINDS = {
  antwort_offen: { label: "Antwort ausstehend", weight: 90, needsConsent: false, group: "jetzt" },
  nicht_zugeordnet: { label: "E-Mail nicht zugeordnet", weight: 85, needsConsent: false, group: "jetzt" },
  datenauskunft: { label: "Datenauskunft angefordert", weight: 95, needsConsent: false, group: "jetzt" },
  kaufabsicht: { label: "Kaufabsicht ohne Kauf", weight: 80, needsConsent: true, group: "jetzt" },
  unzufrieden: { label: "Unzufriedenheit", weight: 80, needsConsent: false, group: "jetzt" },
  angebot_laeuft_ab: { label: "Angebot läuft ab", weight: 70, needsConsent: true, group: "woche" },
  klick_ohne_kauf: { label: "Geklickt, nicht gekauft", weight: 60, needsConsent: true, group: "woche" },
  zubehoer_fenster: { label: "Zubehör-Fenster", weight: 60, needsConsent: true, group: "woche" },
  wiederkauf_faellig: { label: "Wiederkauf fällig", weight: 55, needsConsent: true, group: "woche" },
  abwanderung: { label: "Abwanderungsgefahr", weight: 50, needsConsent: true, group: "woche" },
  top_kunde: { label: "Top-Kunde", weight: 35, needsConsent: false, group: "spaeter" },
  einwilligung_fehlt: { label: "Aktiv, ohne Einwilligung", weight: 25, needsConsent: false, group: "spaeter" },
  zustellproblem: { label: "Zustellproblem", weight: 30, needsConsent: false, group: "spaeter" },
};

/** The kinds the nightly facts pass produces (others come from events). */
export const FACT_SIGNAL_KINDS = [
  "antwort_offen",
  "kaufabsicht",
  "klick_ohne_kauf",
  "zubehoer_fenster",
  "wiederkauf_faellig",
  "abwanderung",
  "top_kunde",
  "einwilligung_fehlt",
];

const DAY = 86_400_000;

const days = (fromIso, now) => {
  if (!fromIso) return null;
  const t = new Date(fromIso).getTime();
  return Number.isNaN(t) ? null : (now.getTime() - t) / DAY;
};

/** ISO week key (YYYY-Www) — a helper for event rules and reports. */
export function isoWeekKey(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const VALUE_BONUS = { grossgeraet: 10, komponente: 5, klein: 0 };

/**
 * Priority 0–100: the kind's weight, a bonus for value, a small one for
 * freshness. One function, pinned by the tests.
 *
 * @param {string} kind
 * @param {{ valueTier?: string | null, ageDays?: number | null }} [ctx]
 */
export function signalPriority(kind, ctx = {}) {
  const base = SIGNAL_KINDS[kind]?.weight ?? 40;
  const value = VALUE_BONUS[ctx.valueTier ?? ""] ?? 0;
  const fresh = ctx.ageDays != null && ctx.ageDays <= 2 ? 3 : 0;
  return Math.max(0, Math.min(100, base + value + fresh));
}

const eur = (cents) =>
  `${Math.round((Number(cents) || 0) / 100).toLocaleString("de-DE")} €`;

/**
 * @typedef {{
 *   customerId: number,
 *   consentState: string,
 *   blocked: boolean,
 *   ordersCount: number,
 *   totalSpentCents: number,
 *   lastOrderAt: string | null,
 *   lastOrderCents: number | null,
 *   medianIntervalDays: number | null,
 *   valueTier: string | null,
 *   conversationsCount: number,
 *   lastChatAt: string | null,
 *   selectedHandles: string[],
 *   discussedHandles: string[],
 *   lastClickAt: string | null,
 *   lastMarketingAt: string | null,
 *   lastInboundAt: string | null,
 *   unansweredInboundCount: number,
 *   ordersLast12m: number,
 *   topPercentile: boolean,
 *   inOpenCampaign: boolean,
 *   recentBigOrderCents: number | null,
 * }} SignalFacts
 */

/**
 * Candidate items for one person from the nightly facts. Erased / blocked
 * people get none; rules that need consent are skipped without it.
 *
 * @param {SignalFacts} f
 * @param {Date} [now]
 * @returns {Array<{ kind: string, customerId: number, priority: number, title: string, reason: string, evidence: Record<string, unknown>, dedupeKey: string, expiresAt: string | null }>}
 */
export function signalsForCustomer(f, now = new Date()) {
  if (f.blocked) return [];
  const out = [];
  const year = String(now.getUTCFullYear());
  const orderDay = String(f.lastOrderAt).slice(0, 10);
  const consented = f.consentState === "subscribed";
  const sinceOrder = days(f.lastOrderAt, now);
  const sinceChat = days(f.lastChatAt, now);
  const sinceClick = days(f.lastClickAt, now);
  const sinceMail = days(f.lastMarketingAt, now);
  const sinceInbound = days(f.lastInboundAt, now);
  const push = (kind, reason, evidence, dedupeWindow, expiresInDays, ageDays) => {
    const meta = SIGNAL_KINDS[kind];
    if (meta.needsConsent && !consented) return;
    out.push({
      kind,
      customerId: f.customerId,
      priority: signalPriority(kind, { valueTier: f.valueTier, ageDays }),
      title: meta.label,
      reason,
      evidence,
      dedupeKey: `${kind}:${f.customerId}:${dedupeWindow}`,
      expiresAt: expiresInDays ? new Date(now.getTime() + expiresInDays * DAY).toISOString() : null,
    });
  };

  // antwort_offen — they wrote, nobody answered for > 24 h.
  if (f.unansweredInboundCount > 0 && sinceInbound != null && sinceInbound > 1) {
    push(
      "antwort_offen",
      `${f.unansweredInboundCount === 1 ? "Eine E-Mail wartet" : `${f.unansweredInboundCount} E-Mails warten`} seit ${Math.floor(sinceInbound)} ${Math.floor(sinceInbound) === 1 ? "Tag" : "Tagen"} auf Antwort.`,
      { lastInboundAt: f.lastInboundAt, count: f.unansweredInboundCount },
      String(f.lastInboundAt).slice(0, 10),
      null,
      sinceInbound
    );
  }

  // kaufabsicht — a recent chat with a cart / chosen products, no order since.
  const orderedAfterChat = sinceOrder != null && sinceChat != null && sinceOrder < sinceChat;
  if (sinceChat != null && sinceChat <= 7 && !orderedAfterChat && f.selectedHandles.length > 0) {
    push(
      "kaufabsicht",
      `Hat vor ${Math.max(0, Math.round(sinceChat))} Tagen mit Mo gesprochen und ${f.selectedHandles.length === 1 ? "ein Produkt" : `${f.selectedHandles.length} Produkte`} ausgewählt (${f.selectedHandles.slice(0, 3).join(", ")}) — seitdem keine Bestellung.`,
      { lastChatAt: f.lastChatAt, products: f.selectedHandles.slice(0, 5) },
      String(f.lastChatAt).slice(0, 10),
      10,
      sinceChat
    );
  }

  // klick_ohne_kauf — clicked a campaign mail in the last 3 days, no order since.
  if (sinceClick != null && sinceClick <= 3 && !(sinceOrder != null && sinceOrder < sinceClick)) {
    push(
      "klick_ohne_kauf",
      `Hat vor ${Math.max(0, Math.round(sinceClick))} Tagen in einer Kampagnen-Mail geklickt, aber nicht gekauft.`,
      { lastClickAt: f.lastClickAt },
      String(f.lastClickAt).slice(0, 10),
      7,
      sinceClick
    );
  }

  // zubehoer_fenster — an order ≥ 150 € 7–30 days ago, no marketing mail since, not queued.
  if (
    sinceOrder != null &&
    sinceOrder >= 7 &&
    sinceOrder <= 30 &&
    (f.lastOrderCents ?? 0) >= 15000 &&
    !(sinceMail != null && sinceMail < sinceOrder) &&
    !f.inOpenCampaign
  ) {
    push(
      "zubehoer_fenster",
      `Kauf über ${eur(f.lastOrderCents)} vor ${Math.round(sinceOrder)} Tagen — das stärkste Fenster für Zubehör (7–30 Tage), noch keine Mail seitdem.`,
      { lastOrderAt: f.lastOrderAt, lastOrderCents: f.lastOrderCents },
      String(f.lastOrderAt).slice(0, 10),
      30 - Math.floor(sinceOrder),
      null
    );
  }

  // wiederkauf_faellig — a regular buyer is overdue against their own rhythm.
  if (
    f.ordersCount >= 3 &&
    f.medianIntervalDays != null &&
    sinceOrder != null &&
    sinceOrder > 30 &&
    sinceOrder > 1.25 * f.medianIntervalDays &&
    sinceOrder <= 2 * f.medianIntervalDays
  ) {
    push(
      "wiederkauf_faellig",
      `Kauft sonst etwa alle ${Math.round(f.medianIntervalDays)} Tage — der letzte Kauf ist ${Math.round(sinceOrder)} Tage her.`,
      { ordersCount: f.ordersCount, medianIntervalDays: f.medianIntervalDays, lastOrderAt: f.lastOrderAt },
      orderDay,
      14,
      null
    );
  }

  // abwanderung — a valuable customer far beyond their rhythm (180–730 days).
  const valuable = f.valueTier === "komponente" || f.valueTier === "grossgeraet" || f.ordersCount >= 3;
  if (
    valuable &&
    sinceOrder != null &&
    sinceOrder >= 180 &&
    sinceOrder <= 730 &&
    (f.medianIntervalDays == null || sinceOrder > 2 * f.medianIntervalDays)
  ) {
    push(
      "abwanderung",
      `${f.ordersCount} ${f.ordersCount === 1 ? "Bestellung" : "Bestellungen"} über ${eur(f.totalSpentCents)}, letzter Kauf vor ${Math.round(sinceOrder)} Tagen.`,
      { ordersCount: f.ordersCount, totalSpentCents: f.totalSpentCents, lastOrderAt: f.lastOrderAt },
      orderDay,
      30,
      null
    );
  }

  // top_kunde — lifetime top 1 %, or a big order in the last 14 days.
  if (f.topPercentile || (f.recentBigOrderCents ?? 0) >= 150000) {
    push(
      "top_kunde",
      f.recentBigOrderCents && f.recentBigOrderCents >= 150000
        ? `Neue Bestellung über ${eur(f.recentBigOrderCents)} — ein persönlicher Dank lohnt sich (ohne Rabatt).`
        : `Gehört mit ${eur(f.totalSpentCents)} Umsatz zum besten Prozent der Kund:innen.`,
      { totalSpentCents: f.totalSpentCents, recentBigOrderCents: f.recentBigOrderCents },
      f.recentBigOrderCents && f.recentBigOrderCents >= 150000 ? `order:${orderDay}` : year,
      30,
      null
    );
  }

  // einwilligung_fehlt — active, but no consent: reachable by letter or chat only.
  if (!consented && f.consentState !== "unsubscribed" && (f.ordersLast12m >= 2 || f.conversationsCount > 0)) {
    push(
      "einwilligung_fehlt",
      f.ordersLast12m >= 2
        ? `${f.ordersLast12m} Bestellungen in 12 Monaten, aber keine Einwilligung für E-Mail-Werbung.`
        : "Hat mit Mo gesprochen, aber keine Einwilligung für E-Mail-Werbung.",
      { ordersLast12m: f.ordersLast12m, conversationsCount: f.conversationsCount },
      year,
      90,
      null
    );
  }

  return out;
}

/** The three groups of the list, by kind (Jetzt / Diese Woche / Später). */
export function signalGroup(kind) {
  return SIGNAL_KINDS[kind]?.group ?? "woche";
}

const itemFor = (kind, customerId, reason, evidence, dedupeWindow, expiresAt, ctx = {}) => ({
  kind,
  customerId,
  priority: signalPriority(kind, ctx),
  title: SIGNAL_KINDS[kind].label,
  reason,
  evidence,
  dedupeKey: `${kind}:${customerId}:${dedupeWindow}`,
  expiresAt,
});

/**
 * angebot_laeuft_ab — a clicked, unredeemed code or set ends within 48 h.
 * @param {{ customerId: number, sendId: number, campaignName: string | null, endsAt: string, kind: "code" | "set" }} row
 * @param {Date} [now]
 */
export function offerExpiringSignal(row, now = new Date()) {
  const hours = Math.max(0, Math.round((new Date(row.endsAt).getTime() - now.getTime()) / 3_600_000));
  return itemFor(
    "angebot_laeuft_ab",
    row.customerId,
    `${row.kind === "set" ? "Das Set-Angebot" : "Der Rabattcode"}${row.campaignName ? ` aus „${row.campaignName}“` : ""} wurde angeklickt, aber nicht eingelöst — läuft in ${hours} Stunden ab. Eine kurze Erinnerung, kein neuer Rabatt.`,
    { sendId: row.sendId, endsAt: row.endsAt },
    `send${row.sendId}`,
    row.endsAt,
    { ageDays: 0 }
  );
}

/**
 * unzufrieden — a cancellation or refund in the last 14 days.
 * @param {{ customerId: number, orderName: string | null, cancelled: boolean, refundedCents: number, at: string }} row
 */
export function dissatisfiedSignal(row) {
  const what = row.cancelled ? "storniert" : `teilweise erstattet (${eur(row.refundedCents)})`;
  return itemFor(
    "unzufrieden",
    row.customerId,
    `Bestellung ${row.orderName ?? ""} wurde ${what}. Erst intern prüfen (Grund, offene Frage); per Mail nur mit Einwilligung.`.replace("  ", " "),
    { orderName: row.orderName, at: row.at },
    `${row.orderName ?? "order"}:${String(row.at).slice(0, 10)}`,
    new Date(new Date(row.at).getTime() + 21 * DAY).toISOString()
  );
}

/**
 * zustellproblem — a hard bounce for someone who ordered in the last year.
 * @param {{ customerId: number, bouncedAt: string }} row
 */
export function bounceSignal(row) {
  return itemFor(
    "zustellproblem",
    row.customerId,
    "Die E-Mail-Adresse ist unzustellbar (Bounce), obwohl die Person im letzten Jahr bestellt hat — Adresse in Shopify prüfen.",
    { bouncedAt: row.bouncedAt },
    String(row.bouncedAt).slice(0, 10),
    null
  );
}

/** Kinds whose items the nightly job owns (closes when the rule stops firing). */
export const JOB_SIGNAL_KINDS = [...FACT_SIGNAL_KINDS, "angebot_laeuft_ab", "unzufrieden", "zustellproblem"];

/** Low-priority kinds are capped per run so they never flood the Eingang. */
export const SIGNAL_CAPS = { top_kunde: 25, einwilligung_fehlt: 50, abwanderung: 60, wiederkauf_faellig: 60 };

/**
 * Keep the highest-priority candidates per kind within SIGNAL_CAPS.
 * @template {{ kind: string, priority: number }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function capSignals(items) {
  const byKind = new Map();
  for (const it of items) {
    if (!byKind.has(it.kind)) byKind.set(it.kind, []);
    byKind.get(it.kind).push(it);
  }
  const out = [];
  for (const [kind, list] of byKind) {
    const cap = SIGNAL_CAPS[kind];
    const sorted = [...list].sort((a, b) => b.priority - a.priority);
    out.push(...(cap ? sorted.slice(0, cap) : sorted));
  }
  return out;
}
