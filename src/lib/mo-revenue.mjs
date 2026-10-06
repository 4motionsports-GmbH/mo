// „Umsatz durch Mo“ — the pure core of the KPI revenue centre
// (docs/ADMIN_DASHBOARD.md §5.1, design of the attribution: docs/ORDER_ATTRIBUTION.md).
//
// Every order counts ONCE. The ledger is `mo_orders` (orders/create + orders/paid
// webhooks, every order with a Mo marker: the `_mo` cart attribute and/or an
// MS5-/MK- code). Each ledger order gets exactly one tier (the snapshot taken at
// ingest) and exactly one channel — the way it came about — by a fixed
// precedence: a Mo code beats a link marker (MK- → Kampagne, MS5- → persönliche
// Marketing-E-Mail), then the link source (Set-Angebot, Marketing-E-Mail,
// Zusammenfassung), then the widget stamp (Beraten & gekauft / Beraten, anderes
// gekauft). „Mit Mo-Rabattcode“ is a cross-cut over those channels, never added
// on top.
//
// The only orders added to the ledger are coded orders that the cached Shopify
// code lookup (lib/kpi-revenue-store) found but the ledger never saw (placed
// before the webhooks were registered): mergeCodeRedemptions drops every
// redemption whose code or order number is already in the ledger, so an order
// that carries both a code and a marker is counted once, under its code.
//
// Only realised money counts (PAID / PARTIALLY_REFUNDED — kpi-revenue-core);
// other ledger orders are tallied as „nicht bezahlt“. Plain .mjs, no I/O.

import { isRealisedFinancialStatus } from "./kpi-revenue-core.mjs";
import { isMoDiscountCode } from "./order-attribution.mjs";
import { normalizeHandle } from "./kpi-match.mjs";
import { ADMIN_DAY_MONTH, formatAdmin } from "./admin-datetime.mjs";

/** The three honest attribution tiers, in their fixed display (and colour) order. */
export const REVENUE_TIERS = Object.freeze(["assisted", "influenced", "direct"]);

/** German labels of the tiers (ORDER_ATTRIBUTION „Attribution tiers“). */
export const TIER_LABELS = Object.freeze({
  assisted: "Beraten & gekauft",
  influenced: "Beraten, anderes gekauft",
  direct: "Direkt über Mo",
});

/**
 * The channels — HOW an order came about — in display order. Each belongs to
 * exactly one tier; `detail` is the explanation shown behind the (i).
 * `short` is the label of the filter chip.
 * @type {ReadonlyArray<{ key: string, tier: "assisted"|"influenced"|"direct", label: string, short: string, detail: string }>}
 */
export const REVENUE_CHANNELS = Object.freeze([
  {
    key: "beraten_gekauft",
    tier: "assisted",
    label: "Beraten & gekauft",
    short: "Beraten & gekauft",
    detail:
      "Das Widget hat den Warenkorb der Sitzung markiert, und mindestens ein gekauftes Produkt wurde in einer Beratung dieser Sitzung im Zuordnungsfenster gezeigt oder ausgewählt — auch wenn es danach über die Suche in den Warenkorb kam.",
  },
  {
    key: "beraten_anderes",
    tier: "influenced",
    label: "Beraten, anderes gekauft",
    short: "Beraten, anderes",
    detail:
      "Das Widget hat den Warenkorb der Sitzung markiert, aber keines der gekauften Produkte kam in der Beratung vor — Mo hat beraten, gekauft wurde etwas anderes.",
  },
  {
    key: "zusammenfassung",
    tier: "direct",
    label: "Zusammenfassungs-E-Mail",
    short: "Zusammenfassung",
    detail: "Gekauft über den Warenkorb-Link der Chat-Zusammenfassung per E-Mail (der Link trägt die Mo-Markierung).",
  },
  {
    key: "set",
    tier: "direct",
    label: "Set-Angebot",
    short: "Set-Angebot",
    detail:
      "Gekauft über den Link eines persönlichen Set-Angebots (Bundle) — aus dem Chat, einer E-Mail oder einer Kampagne.",
  },
  {
    key: "kampagne",
    tier: "direct",
    label: "Kampagne (MK-Code)",
    short: "Kampagne",
    detail:
      "Der einmalige MK-Code einer Kampagnen-E-Mail (auch der Einzelansprache) wurde eingelöst. Kampagnen-Bestellungen ohne Code sind nur über ein Set-Angebot der Mail zurechenbar.",
  },
  {
    key: "marketing",
    tier: "direct",
    label: "Persönliche Marketing-E-Mail (MS5-)",
    short: "Marketing-Mail",
    detail:
      "Die frühere persönliche Marketing-E-Mail: ihr einmaliger MS5-Code oder ihr Warenkorb-Link. Neue persönliche Mails laufen als Kampagne „Einzelansprache“ (MK-Codes).",
  },
  {
    key: "sonstig",
    tier: "direct",
    label: "Sonstiger Mo-Weg",
    short: "Sonstige",
    detail: "Direkt zugeordnet, aber ohne bekannten Weg (ältere Zeile ohne Quelle).",
  },
]);

const CHANNEL_BY_KEY = new Map(REVENUE_CHANNELS.map((c) => [c.key, c]));

/** Link sources that make an order „Direkt“ (mirrors classifyAttributionTier). */
const DIRECT_LINK_CHANNEL = Object.freeze({
  bundle: "set",
  marketing_email: "marketing",
  summary_email: "zusammenfassung",
});

/** @param {unknown} code */
function codeKind(code) {
  if (!isMoDiscountCode(code)) return null;
  return /^mk-/i.test(String(code).trim()) ? "mk" : "ms5";
}

/** @param {unknown} codes @returns {string[]} the Mo codes (MS5-/MK-) among them, trimmed */
export function moCodesOf(codes) {
  if (!Array.isArray(codes)) return [];
  return codes.map((c) => (c == null ? "" : String(c).trim())).filter((c) => isMoDiscountCode(c));
}

/**
 * Tier and channel of one order. The stored tier (snapshot at ingest) wins; a
 * row without a valid tier is re-classified with the ingest rules. Null when
 * nothing attributable remains (never counted, tallied as „unclassified“).
 *
 * @param {{ tier?: string | null, source?: string | null, discountCodes?: unknown, overlap?: boolean | null }} order
 * @returns {{ tier: "assisted"|"influenced"|"direct", channel: string, moCodes: string[] } | null}
 */
export function classifyRevenueOrder(order) {
  const o = order ?? {};
  const moCodes = moCodesOf(o.discountCodes);
  const source = typeof o.source === "string" ? o.source : null;
  let tier = REVENUE_TIERS.includes(/** @type {any} */ (o.tier)) ? /** @type {"assisted"|"influenced"|"direct"} */ (o.tier) : null;
  if (!tier) {
    if (moCodes.length > 0 || (source && source in DIRECT_LINK_CHANNEL)) tier = "direct";
    else if (source === "widget") tier = o.overlap ? "assisted" : "influenced";
    else return null;
  }
  if (tier === "assisted") return { tier, channel: "beraten_gekauft", moCodes };
  if (tier === "influenced") return { tier, channel: "beraten_anderes", moCodes };
  // Direct: a Mo code beats a link marker (the code is the stronger, exact signal).
  const kinds = moCodes.map(codeKind);
  if (kinds.includes("mk")) return { tier, channel: "kampagne", moCodes };
  if (kinds.includes("ms5")) return { tier, channel: "marketing", moCodes };
  const linkChannel = source ? /** @type {Record<string, string>} */ (DIRECT_LINK_CHANNEL)[source] : undefined;
  return { tier, channel: linkChannel ?? "sonstig", moCodes };
}

/** @param {unknown} v @returns {number | null} finite, non-negative amount or null */
function amountOf(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** @param {number} n */
function cents(n) {
  return Math.round(n * 100) / 100;
}

/**
 * The currency to sum in: the most frequent among realised orders (first seen
 * wins a tie), EUR when there is none.
 * @param {Array<{ currency?: string | null, financialStatus?: string | null }>} orders
 */
export function mainCurrency(orders) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const o of orders ?? []) {
    if (!o || !isRealisedFinancialStatus(o.financialStatus)) continue;
    const c = typeof o.currency === "string" && o.currency.trim() ? o.currency.trim().toUpperCase() : null;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = "EUR";
  let max = 0;
  for (const [c, n] of counts) {
    if (n > max) {
      best = c;
      max = n;
    }
  }
  return best;
}

/**
 * @typedef {Object} RevenueOrder
 * @property {number | string | null} [total]
 * @property {string | null} [currency]
 * @property {string | null} [financialStatus]
 * @property {string | null} [tier]
 * @property {string | null} [source]
 * @property {unknown} [discountCodes]
 * @property {boolean | null} [overlap]
 * @property {string | Date | null} [processedAt]
 */

/**
 * Fold orders into the revenue centre's figures: totals, per tier, per channel
 * (all channels in display order, zeros included), the code cross-cut and the
 * tallies of what was NOT counted (unpaid, other currency, unclassifiable).
 *
 * @param {RevenueOrder[]} orders
 */
export function summariseRevenue(orders) {
  const list = Array.isArray(orders) ? orders.filter((o) => o && typeof o === "object") : [];
  const currency = mainCurrency(list);
  /** @type {Record<string, { orders: number, revenue: number }>} */
  const byTier = { assisted: { orders: 0, revenue: 0 }, influenced: { orders: 0, revenue: 0 }, direct: { orders: 0, revenue: 0 } };
  /** @type {Map<string, { orders: number, revenue: number }>} */
  const byChannel = new Map(REVENUE_CHANNELS.map((c) => [c.key, { orders: 0, revenue: 0 }]));
  const withMoCode = { orders: 0, revenue: 0 };
  const unrealised = { orders: 0, revenue: 0 };
  let otherCurrency = 0;
  let unclassified = 0;
  let revenue = 0;
  let count = 0;

  for (const o of list) {
    const cls = classifyRevenueOrder(o);
    if (!cls) {
      unclassified++;
      continue;
    }
    const amount = amountOf(o.total);
    if (!isRealisedFinancialStatus(o.financialStatus)) {
      unrealised.orders++;
      if (amount != null) unrealised.revenue = cents(unrealised.revenue + amount);
      continue;
    }
    const cur = typeof o.currency === "string" && o.currency.trim() ? o.currency.trim().toUpperCase() : currency;
    if (cur !== currency) {
      otherCurrency++;
      continue;
    }
    // A paid order without a money figure counts as an order, not as 0 € revenue
    // silently made up — it simply adds nothing to the sum.
    const add = amount ?? 0;
    count++;
    revenue = cents(revenue + add);
    byTier[cls.tier].orders++;
    byTier[cls.tier].revenue = cents(byTier[cls.tier].revenue + add);
    const ch = /** @type {{ orders: number, revenue: number }} */ (byChannel.get(cls.channel));
    ch.orders++;
    ch.revenue = cents(ch.revenue + add);
    if (cls.moCodes.length > 0) {
      withMoCode.orders++;
      withMoCode.revenue = cents(withMoCode.revenue + add);
    }
  }

  return {
    currency,
    revenue,
    orders: count,
    aov: count > 0 ? cents(revenue / count) : null,
    byTier,
    byChannel: REVENUE_CHANNELS.map((c) => {
      const v = /** @type {{ orders: number, revenue: number }} */ (byChannel.get(c.key));
      return {
        key: c.key,
        tier: c.tier,
        label: c.label,
        orders: v.orders,
        revenue: v.revenue,
        share: revenue > 0 ? v.revenue / revenue : null,
        aov: v.orders > 0 ? cents(v.revenue / v.orders) : null,
      };
    }),
    withMoCode,
    unrealised,
    otherCurrency,
    unclassified,
  };
}

/**
 * Change of `current` against `previous` in percent (×100, for the Stat delta),
 * null when the previous value is 0 or missing (`isNew` then says whether there
 * is something now).
 * @param {number | null | undefined} current
 * @param {number | null | undefined} previous
 * @returns {{ value: number | null, isNew: boolean }}
 */
export function periodDelta(current, previous) {
  const c = typeof current === "number" && Number.isFinite(current) ? current : null;
  const p = typeof previous === "number" && Number.isFinite(previous) ? previous : null;
  if (c == null || p == null) return { value: null, isNew: false };
  if (p === 0) return { value: null, isNew: c > 0 };
  return { value: Math.round(((c - p) / Math.abs(p)) * 1000) / 10, isNew: false };
}

/** @param {string} ymd @param {number} days */
function addDays(ymd, days) {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** @param {unknown} v */
function isYmd(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));
}

/**
 * The period of the same length directly before `range` (inclusive days).
 * @param {{ from: string, to: string }} range
 * @returns {{ from: string, to: string, days: number } | null}
 */
export function previousPeriod(range) {
  if (!range || !isYmd(range.from) || !isYmd(range.to) || range.from > range.to) return null;
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: addDays(range.from, -days), to: addDays(range.from, -1), days };
}

/** @param {string | Date | null | undefined} v @returns {string | null} UTC calendar day */
function dayOf(v) {
  if (v == null || v === "") return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** Ranges longer than this are bucketed by week (Monday) instead of by day. */
export const DAILY_SERIES_MAX_DAYS = 92;

/**
 * Realised revenue over time per tier, gap-filled: daily up to
 * DAILY_SERIES_MAX_DAYS, else weekly (buckets start on Monday; the first one
 * at the range start). Only orders counted by summariseRevenue (main currency).
 *
 * @param {RevenueOrder[]} orders
 * @param {{ from: string, to: string }} range
 */
export function revenueSeries(orders, range) {
  if (!range || !isYmd(range.from) || !isYmd(range.to) || range.from > range.to) {
    return { granularity: /** @type {"day"|"week"} */ ("day"), buckets: [] };
  }
  const list = Array.isArray(orders) ? orders : [];
  const currency = mainCurrency(list);
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
  const weekly = days > DAILY_SERIES_MAX_DAYS;
  /** @param {string} ymd */
  const bucketOf = (ymd) => {
    if (!weekly) return ymd;
    const dow = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    const monday = addDays(ymd, -dow);
    return monday < range.from ? range.from : monday;
  };
  /** @type {Map<string, { start: string, assisted: number, influenced: number, direct: number, total: number, orders: number }>} */
  const buckets = new Map();
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const b = bucketOf(d);
    if (!buckets.has(b)) buckets.set(b, { start: b, assisted: 0, influenced: 0, direct: 0, total: 0, orders: 0 });
  }
  for (const o of list) {
    if (!o || !isRealisedFinancialStatus(o.financialStatus)) continue;
    const cur = typeof o.currency === "string" && o.currency.trim() ? o.currency.trim().toUpperCase() : currency;
    if (cur !== currency) continue;
    const cls = classifyRevenueOrder(o);
    const day = dayOf(o.processedAt ?? null);
    if (!cls || !day || day < range.from || day > range.to) continue;
    const b = buckets.get(bucketOf(day));
    if (!b) continue;
    const add = amountOf(o.total) ?? 0;
    b[cls.tier] = cents(b[cls.tier] + add);
    b.total = cents(b.total + add);
    b.orders++;
  }
  return { granularity: /** @type {"day"|"week"} */ (weekly ? "week" : "day"), buckets: [...buckets.values()] };
}

/**
 * Trend points for a stat-tile sparkline: the series' order counts, summed per
 * 7 buckets when a daily series is longer than three weeks (a 60-point line of
 * 0s and 1s reads as noise). `x` is the first bucket of each chunk.
 *
 * @param {Array<{ start: string, orders: number }>} buckets
 * @param {"day"|"week"} granularity
 * @returns {Array<{ x: string, y: number }>}
 */
export function orderTrendPoints(buckets, granularity) {
  const list = Array.isArray(buckets) ? buckets : [];
  const size = granularity === "day" && list.length > 21 ? 7 : 1;
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    const chunk = list.slice(i, i + size);
    out.push({ x: chunk[0].start, y: chunk.reduce((a, b) => a + (Number(b.orders) || 0), 0) });
  }
  return out;
}

/**
 * @typedef {Object} CodeRedemptionRow  A redeemed Mo code found by the Shopify lookup.
 * @property {string} code
 * @property {string | null} [orderName]
 * @property {string | null} [createdAt]
 * @property {number | null} [amount]
 * @property {string | null} [currency]
 * @property {string | null} [financialStatus]
 */

/**
 * The coded orders the Shopify lookup found that the ledger does NOT hold —
 * shaped like ledger orders (tier direct, channel by prefix), so they can be
 * summed with them. A redemption whose code (case-insensitive) or order number
 * is already in the ledger is dropped: that order is counted once, from the
 * ledger.
 *
 * @param {{ ledgerCodes?: string[], ledgerOrderNames?: string[], redemptions?: CodeRedemptionRow[] }} args
 */
export function mergeCodeRedemptions({ ledgerCodes = [], ledgerOrderNames = [], redemptions = [] } = {}) {
  const codes = new Set((ledgerCodes ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean));
  const names = new Set((ledgerOrderNames ?? []).map((n) => String(n).trim()).filter(Boolean));
  /** @type {Set<string>} */
  const seen = new Set();
  const extra = [];
  let alreadyCounted = 0;
  for (const r of Array.isArray(redemptions) ? redemptions : []) {
    if (!r || !isMoDiscountCode(r.code)) continue;
    const code = String(r.code).trim();
    const key = code.toUpperCase();
    const name = r.orderName ? String(r.orderName).trim() : "";
    if (codes.has(key) || (name && names.has(name))) {
      alreadyCounted++;
      continue;
    }
    // The same order found twice (two codes on one order) counts once.
    const dedupe = name || key;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    extra.push({
      origin: /** @type {const} */ ("shopify_code"),
      orderName: name || null,
      processedAt: r.createdAt ?? null,
      total: amountOf(r.amount),
      currency: r.currency ?? null,
      financialStatus: r.financialStatus ?? null,
      tier: "direct",
      source: "discount_code",
      discountCodes: [code],
      overlap: false,
    });
  }
  return { extra, alreadyCounted };
}

/**
 * Line items of an order with a flag for the products that came up in the
 * consultation (normalised handles, kpi-match).
 *
 * @param {unknown} lineItems  [{ title, quantity, price, handle }]
 * @param {Array<string | null | undefined>} consulted
 * @returns {Array<{ title: string, quantity: number, price: number | null, consulted: boolean }>}
 */
export function markConsultedLines(lineItems, consulted) {
  const keys = new Set((consulted ?? []).map(normalizeHandle).filter(Boolean));
  if (!Array.isArray(lineItems)) return [];
  return lineItems
    .filter((li) => li && typeof li === "object")
    .map((li) => {
      const q = Number(li.quantity);
      const handle = li.handle == null ? "" : normalizeHandle(li.handle);
      return {
        title: String(li.title ?? "").trim() || "Unbenannter Artikel",
        quantity: Number.isFinite(q) && q > 0 ? Math.floor(q) : 1,
        price: amountOf(li.price),
        consulted: Boolean(handle) && keys.has(handle),
      };
    });
}

/**
 * Whole days from the last consultation to the order (never negative); null
 * when either is missing.
 * @param {string | Date | null | undefined} chatAt
 * @param {string | Date | null | undefined} orderAt
 */
export function daysAfterChat(chatAt, orderAt) {
  const a = chatAt instanceof Date ? chatAt.getTime() : Date.parse(String(chatAt ?? ""));
  const b = orderAt instanceof Date ? orderAt.getTime() : Date.parse(String(orderAt ?? ""));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

/** @param {number | null} days */
function lagText(days) {
  if (days == null) return null;
  if (days === 0) return "am selben Tag gekauft";
  return days === 1 ? "1 Tag später gekauft" : `${days} Tage später gekauft`;
}

/**
 * „Was genau passiert ist“ for one order, as short German phrases: what led to
 * it, when it followed the consultation, and how much of the basket came from
 * the consultation.
 *
 * @param {{ channel: string, moCodes?: string[], lastChatAt?: string | Date | null, processedAt?: string | Date | null,
 *           lines?: Array<{ consulted: boolean }>, origin?: string }} o
 * @returns {{ lead: string, lag: string | null, match: string | null }}
 */
export function orderPathSummary(o) {
  const code = o.moCodes?.[0] ?? null;
  const chatDay = o.lastChatAt ? formatAdmin(o.lastChatAt, ADMIN_DAY_MONTH, "") : "";
  const days = daysAfterChat(o.lastChatAt ?? null, o.processedAt ?? null);
  const lines = Array.isArray(o.lines) ? o.lines : [];
  const consulted = lines.filter((l) => l.consulted).length;
  const consultedText =
    lines.length === 0 ? null : consulted === 0 ? "kein Produkt aus der Beratung" : `${consulted} von ${lines.length} ${lines.length === 1 ? "Produkt" : "Produkten"} aus der Beratung`;
  switch (o.channel) {
    case "beraten_gekauft":
    case "beraten_anderes":
      return {
        lead: chatDay ? `Beraten am ${chatDay}` : "Im Chat beraten",
        lag: lagText(days),
        match: consultedText,
      };
    case "zusammenfassung":
      return {
        lead: "Link der Zusammenfassungs-E-Mail",
        lag: chatDay ? `nach der Beratung am ${chatDay}` : null,
        match: consultedText,
      };
    case "set":
      return { lead: "Set-Angebot über den Mo-Link gekauft", lag: chatDay ? `nach der Beratung am ${chatDay}` : null, match: null };
    case "kampagne":
      return {
        lead: code ? `Kampagnen-Code ${code} eingelöst` : "Kampagnen-Code eingelöst",
        lag: o.origin === "shopify_code" ? "per Code-Abgleich in Shopify gefunden" : chatDay ? `zuletzt beraten am ${chatDay}` : null,
        match: null,
      };
    case "marketing":
      return {
        lead: code ? `Persönlicher Code ${code} eingelöst` : "Link der persönlichen Marketing-E-Mail",
        lag: o.origin === "shopify_code" ? "per Code-Abgleich in Shopify gefunden" : chatDay ? `nach der Beratung am ${chatDay}` : null,
        match: consultedText,
      };
    default:
      return { lead: "Direkt über Mo zugeordnet", lag: null, match: null };
  }
}

/**
 * What the drill-down rows say at a glance: the median number of days from the
 * last chat to the order (paid orders with a chat before them), and how many
 * paid orders of the two consultation tiers contained a product from the
 * consultation.
 *
 * @param {Array<{ realised: boolean, tier: string, daysAfterChat: number | null, lines: Array<{ consulted: boolean }> }>} rows
 */
export function drillInsights(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.realised) : [];
  const days = list
    .map((r) => r.daysAfterChat)
    .filter((d) => typeof d === "number" && Number.isFinite(d))
    .sort((a, b) => a - b);
  let median = null;
  if (days.length > 0) {
    const mid = Math.floor(days.length / 2);
    median = days.length % 2 === 1 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
  }
  const consulting = list.filter((r) => r.tier === "assisted" || r.tier === "influenced");
  const withConsulted = consulting.filter((r) => Array.isArray(r.lines) && r.lines.some((l) => l.consulted)).length;
  return {
    medianDaysToOrder: median,
    ordersWithChat: days.length,
    consultingOrders: consulting.length,
    withConsultedProduct: withConsulted,
  };
}

/**
 * Mo revenue per euro of AI cost (null without a positive cost).
 * @param {number | null | undefined} revenue
 * @param {number | null | undefined} cost
 */
export function revenuePerAiEuro(revenue, cost) {
  if (typeof revenue !== "number" || !Number.isFinite(revenue)) return null;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost <= 0) return null;
  return Math.round((revenue / cost) * 100) / 100;
}

/** @param {string} key */
export function channelInfo(key) {
  return CHANNEL_BY_KEY.get(key) ?? CHANNEL_BY_KEY.get("sonstig");
}
