// Deterministic facts for every customer (pure, no I/O, zero tokens).
//
// One function turns a customer's order ledger, conversation aggregates,
// marketing and correspondence aggregates into the figures the Kunden list,
// the audiences and the Eingang filter on (stored in customer_facts, 0063).
// Most customers never chatted — these facts are what they are known by until
// an AI profile exists (docs/CUSTOMER_PLATFORM_PLAN.md §6.4, §9.4).
//
// Reuses the measured boundaries instead of inventing new ones:
//   * lifecycle segment → campaign-segments.mjs (resolveCampaignSegment)
//   * value tier        → repurchase-analysis.mjs (VALUE_TIERS, anchor value)
//   * purchase occasions (split checkouts merged) → mergePurchaseOccasions
// RFM scores use FIXED thresholds (never quantiles over the base), so one
// person's score does not move when other people buy.

import { resolveCampaignSegment } from "./campaign-segments.mjs";
import { valueTierKey, anchorValueEur, mergePurchaseOccasions, percentile } from "./repurchase-analysis.mjs";

const DAY_MS = 86_400_000;
const MAX_COMPLEMENTS = 12;
const MAX_HANDLES = 200;

/** Financial statuses that count as a real purchase (money received). */
const REALISED = new Set(["PAID", "PARTIALLY_REFUNDED"]);

/**
 * @typedef {Object} FactsOrder
 * @property {string} processedAt
 * @property {number} totalCents          current total (after refunds/edits)
 * @property {number} [refundedCents]
 * @property {string | null} financialStatus
 * @property {string | null} [cancelledAt]
 * @property {string[]} [discountCodes]
 * @property {Array<{ handle: string | null, quantity: number, unitPrice: number | null }>} lineItems
 *
 * @typedef {Object} FactsInput
 * @property {FactsOrder[]} orders
 * @property {{ count: number, lastAt: string | null, discussed: string[], selected: string[] }} [chats]
 * @property {{ sentCount: number, lastSentAt: string | null, lastClickAt: string | null, clicks90d: number, redemptions: number }} [marketing]
 * @property {{ lastInboundAt: string | null, unanswered: number }} [service]
 * @property {Record<string, { category?: string | null, compatibleWith?: string[] }>} [catalog]
 * @property {Date | string} [now]
 */

/** Is this order a real purchase? Paid (or partly refunded) and not cancelled. */
export function isRealisedOrder(order) {
  if (!order || order.cancelledAt) return false;
  return typeof order.financialStatus === "string" && REALISED.has(order.financialStatus.toUpperCase());
}

function t(iso) {
  if (!iso) return null;
  const v = new Date(iso).getTime();
  return Number.isNaN(v) ? null : v;
}

function maxIso(...values) {
  let best = null;
  for (const v of values) {
    const tv = t(v);
    if (tv !== null && (best === null || tv > best)) best = tv;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** R: days since the last purchase (fixed thresholds). */
export function recencyScore(days) {
  if (days == null) return null;
  if (days <= 30) return 5;
  if (days <= 90) return 4;
  if (days <= 180) return 3;
  if (days <= 365) return 2;
  return 1;
}

/** F: number of purchase occasions. */
export function frequencyScore(occasions) {
  if (!occasions) return null;
  if (occasions >= 6) return 5;
  if (occasions >= 4) return 4;
  return Math.min(3, occasions);
}

/** M: lifetime spend in EUR (value-tier boundaries of the repurchase analysis). */
export function monetaryScore(eur) {
  if (eur == null || eur <= 0) return null;
  if (eur < 150) return 1;
  if (eur < 500) return 2;
  if (eur < 1500) return 3;
  if (eur < 5000) return 4;
  return 5;
}

/**
 * Churn risk from the personal rhythm: days since the last occasion relative
 * to the median gap (or fixed windows for one-time buyers).
 *
 * @returns {"niedrig" | "mittel" | "hoch" | null}
 */
export function churnRisk(daysSinceLast, medianIntervalDays, occasionCount) {
  if (daysSinceLast == null || !occasionCount) return null;
  if (occasionCount >= 2 && medianIntervalDays && medianIntervalDays > 0) {
    const ratio = daysSinceLast / medianIntervalDays;
    if (ratio < 1.25) return "niedrig";
    if (ratio < 2) return "mittel";
    return "hoch";
  }
  if (daysSinceLast < 180) return "niedrig";
  if (daysSinceLast < 365) return "mittel";
  return "hoch";
}

function uniqueLimited(values, max) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    if (typeof v !== "string" || !v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Accessory candidates: the catalog's "Ergänzende Produkte" of everything the
 * customer owns, minus what they own, ranked by how many owned products they
 * fit (the newest purchase's accessories first on ties).
 */
export function complementCandidates(ownedNewestFirst, catalog, max = MAX_COMPLEMENTS) {
  if (!catalog) return [];
  const owned = new Set(ownedNewestFirst);
  const score = new Map();
  const firstSeen = new Map();
  let order = 0;
  for (const handle of ownedNewestFirst) {
    for (const c of catalog[handle]?.compatibleWith ?? []) {
      if (!c || owned.has(c) || !catalog[c]) continue;
      score.set(c, (score.get(c) ?? 0) + 1);
      if (!firstSeen.has(c)) firstSeen.set(c, order++);
    }
  }
  return [...score.keys()]
    .sort((a, b) => score.get(b) - score.get(a) || firstSeen.get(a) - firstSeen.get(b))
    .slice(0, max);
}

/**
 * Compute every fact for one customer.
 *
 * @param {FactsInput} input
 */
export function computeCustomerFacts(input) {
  const now = input?.now ? new Date(input.now) : new Date();
  const nowMs = now.getTime();
  const all = Array.isArray(input?.orders) ? input.orders : [];
  const realised = all.filter(isRealisedOrder).sort((a, b) => t(a.processedAt) - t(b.processedAt));

  const totalCents = realised.reduce((sum, o) => sum + Math.max(0, Number(o.totalCents) || 0), 0);
  const ordersCount = realised.length;
  const firstOrderAt = realised[0]?.processedAt ?? null;
  const lastOrderAt = realised[realised.length - 1]?.processedAt ?? null;

  // Purchase occasions (split checkouts merged) drive rhythm + segment.
  const occasions = mergePurchaseOccasions(
    realised.map((o, i) => ({
      id: String(i),
      createdAt: o.processedAt,
      lineItems: (o.lineItems ?? []).map((li) => ({
        handle: li.handle ?? null,
        quantity: li.quantity,
        unitPriceEur: typeof li.unitPrice === "number" ? li.unitPrice : null,
      })),
    }))
  );
  const gaps = [];
  for (let i = 1; i < occasions.length; i++) {
    gaps.push((t(occasions[i].createdAt) - t(occasions[i - 1].createdAt)) / DAY_MS);
  }
  gaps.sort((a, b) => a - b);
  const medianInterval = gaps.length > 0 ? Math.round(percentile(gaps, 0.5)) : null;
  const lastOccasion = occasions[occasions.length - 1] ?? null;
  const expectedNext =
    lastOccasion && medianInterval ? new Date(t(lastOccasion.createdAt) + medianInterval * DAY_MS).toISOString() : null;

  let maxAnchor = null;
  for (const occ of occasions) {
    const a = anchorValueEur(occ);
    if (a != null && (maxAnchor === null || a > maxAnchor)) maxAnchor = a;
  }

  const segment = lastOccasion
    ? resolveCampaignSegment({ lastOrderAt: lastOccasion.createdAt, anchorEur: anchorValueEur(lastOccasion), now })
    : null;
  const daysSinceLast = lastOccasion ? (nowMs - t(lastOccasion.createdAt)) / DAY_MS : null;

  // Ownership, newest purchase first (drives the accessory ranking).
  const ownedNewestFirst = uniqueLimited(
    [...realised].reverse().flatMap((o) => (o.lineItems ?? []).map((li) => li.handle)),
    MAX_HANDLES
  );
  const catalog = input?.catalog ?? null;
  const categories = catalog
    ? uniqueLimited(ownedNewestFirst.map((h) => catalog[h]?.category ?? null), 20)
    : [];

  const chats = input?.chats ?? { count: 0, lastAt: null, discussed: [], selected: [] };
  const marketing = input?.marketing ?? { sentCount: 0, lastSentAt: null, lastClickAt: null, clicks90d: 0, redemptions: 0 };
  const service = input?.service ?? { lastInboundAt: null, unanswered: 0 };

  return {
    ordersCount,
    totalSpentCents: totalCents,
    firstOrderAt,
    lastOrderAt,
    aovCents: ordersCount > 0 ? Math.round(totalCents / ordersCount) : null,
    medianIntervalDays: medianInterval,
    expectedNextOrderAt: expectedNext,
    refundsCount: all.filter(
      (o) => (Number(o.refundedCents) || 0) > 0 || /REFUNDED/i.test(String(o.financialStatus ?? ""))
    ).length,
    discountOrderShare:
      ordersCount > 0
        ? Math.round((realised.filter((o) => (o.discountCodes ?? []).length > 0).length / ordersCount) * 1000) / 1000
        : null,
    lifecycleSegment: segment?.key ?? null,
    valueTier: valueTierKey(maxAnchor ?? undefined),
    rfmR: recencyScore(daysSinceLast),
    rfmF: frequencyScore(occasions.length),
    rfmM: monetaryScore(totalCents / 100),
    churnRisk: churnRisk(daysSinceLast, medianInterval, occasions.length),
    boughtHandles: ownedNewestFirst,
    boughtCategories: categories,
    complementHandles: complementCandidates(ownedNewestFirst, catalog),
    conversationsCount: Math.max(0, Number(chats.count) || 0),
    lastChatAt: chats.lastAt ?? null,
    discussedHandles: uniqueLimited(chats.discussed ?? [], 50),
    selectedHandles: uniqueLimited(chats.selected ?? [], 50),
    emailsSentCount: Math.max(0, Number(marketing.sentCount) || 0),
    lastMarketingAt: marketing.lastSentAt ?? null,
    lastClickAt: marketing.lastClickAt ?? null,
    clicks90d: Math.max(0, Number(marketing.clicks90d) || 0),
    redemptionsCount: Math.max(0, Number(marketing.redemptions) || 0),
    lastInboundAt: service.lastInboundAt ?? null,
    unansweredInboundCount: Math.max(0, Number(service.unanswered) || 0),
    // Customer-initiated activity only (our own sends are not their activity).
    lastActivityAt: maxIso(lastOrderAt, chats.lastAt, marketing.lastClickAt, service.lastInboundAt),
  };
}

/** German labels for the admin. */
export const CHURN_RISK_LABELS = { niedrig: "Niedrig", mittel: "Mittel", hoch: "Hoch" };

export const VALUE_TIER_LABELS = {
  klein: "Kleinteile",
  komponente: "Komponenten",
  grossgeraet: "Großgeräte",
};
