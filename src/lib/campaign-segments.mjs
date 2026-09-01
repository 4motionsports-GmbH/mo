// Lifecycle segmentation for campaign e-mails (pure, no I/O — plain .mjs so it
// is unit-testable with node:test, per the locale.mjs convention).
//
// WHAT THIS DECIDES
//
// Given when a contact last bought and how big that purchase was, this module
// answers three questions: which lifecycle segment they are in, WHICH KIND of
// products the mail should recommend, and whether we should be mailing them at
// all right now.
//
// EVERY BOUNDARY BELOW IS MEASURED, NOT ASSUMED. The numbers come from
// scripts/analyze-repurchase.mjs over the full order history (28.541 orders,
// 18.355 customers) — see docs/REPURCHASE_ANALYSIS.md. The findings that shape
// this file:
//
//   1. TIMING DOES NOT SCALE WITH PURCHASE VALUE. Median repurchase interval is
//      88 / 81 / 68 days across the three value tiers — a 20-day spread, and
//      pointing the OPPOSITE way to the original assumption. So there is ONE
//      time schedule for everyone, not a matrix.
//   2. CONTENT DOES SCALE WITH VALUE. Buyers at/above 150 € buy accessories to
//      what they own twice as often as sub-150 € buyers (25,5 % vs 13,0 %), and
//      the relevance holds for a full year; below 150 € it halves by month 3.
//   3. THE STRONGEST WINDOW IS 7–30 DAYS (38,6 % for >= 150 €) — the single
//      highest figure in the dataset.
//   4. AFTER 24 MONTHS almost nobody returns (39 of 3.481 transitions, 1,1 %).
//
// Value tiers come from repurchase-analysis.mjs so the analysis and production
// can never disagree on what "Großgerät" means. The analysis keeps three tiers;
// this module MERGES the top two into one content tier, because their measured
// behaviour is the same (lift 4,6× in both) and Großgeräte alone is too thin to
// carry its own rules (n = 19–54 per window).

import { valueTierKey } from "./repurchase-analysis.mjs";

const DAY_MS = 86_400_000;

/**
 * The two CONTENT tiers. The analysis' `komponente` and `grossgeraet` collapse
 * into one here — see the header for why.
 */
export const CONTENT_TIERS = {
  /** Under 150 €: accessory relevance halves by month 3 (19,7 → 13,6 → 10,0 %). */
  KLEIN: "klein",
  /** From 150 €: accessory relevance holds a full year (37,5 → 23,8 → 23,3 → 20,7 %). */
  GROSS: "gross",
};

/**
 * Which products a mail in this segment should recommend.
 *   complement — accessories (Product.compatibleWith) to what they already own
 *   similarity — the classic embedding-similarity pick (products LIKE the owned
 *                ones); correct once accessory relevance has decayed
 *   winback    — broad representative picks, not tied to an old purchase
 */
export const RECOMMENDATION_STRATEGIES = {
  COMPLEMENT: "complement",
  SIMILARITY: "similarity",
  WINBACK: "winback",
};

/**
 * The segments, in ascending order of days since the last purchase. `maxDays`
 * is exclusive; the last entry is open-ended.
 *
 * `sendable: false` means: do not put this contact into a normal batch. It is
 * not a hard block — an operator can still draft one deliberately — but it
 * keeps the queue off contacts where the data says a mail does nothing.
 */
export const CAMPAIGN_SEGMENTS = [
  {
    key: "frisch",
    label: "Frisch gekauft",
    maxDays: 7,
    sendable: false,
    // Below the purchase-occasion gap: an order this recent is still the same
    // buying episode, the goods have usually not even arrived, and the analysis
    // measured nothing here (every observed gap is >= 7 days by construction).
    reason: "Kauf zu frisch — Ware meist noch nicht geliefert, keine Messdaten.",
    strategy: { klein: null, gross: null },
  },
  {
    key: "ausbauen_frueh",
    label: "Ausbauen — früh",
    maxDays: 30,
    sendable: true,
    // The strongest window in the whole dataset: 38,6 % (>= 150 €) / 19,7 %.
    reason: "Stärkstes Fenster: 38,6 % Zubehör-Quote ab 150 €.",
    strategy: { klein: "complement", gross: "complement" },
  },
  {
    key: "ausbauen",
    label: "Ausbauen",
    maxDays: 90,
    sendable: true,
    reason: "Zubehör trägt weiterhin (23,8 % ab 150 €, 13,6 % darunter).",
    strategy: { klein: "complement", gross: "complement" },
  },
  {
    key: "weiterentwickeln",
    label: "Weiterentwickeln",
    maxDays: 365,
    sendable: true,
    // The one genuine content divergence: >= 150 € holds 23,3 → 20,7 %, while
    // below 150 € accessories have fallen to 10,0 % and similarity is better.
    reason: "Ab 150 € trägt Zubehör ein volles Jahr; darunter ist es abgefallen.",
    strategy: { klein: "similarity", gross: "complement" },
  },
  {
    key: "zurueckholen",
    label: "Zurückholen",
    maxDays: 730,
    sendable: true,
    reason: "Letzte Chance: 13,9 % ab 150 €, 5,0 % darunter.",
    strategy: { klein: "winback", gross: "complement" },
  },
  {
    key: "ruhen",
    label: "Ruhen lassen",
    maxDays: Infinity,
    sendable: false,
    // 39 of 3.481 transitions (1,1 %) happen after 730 days. Mailing dormant
    // addresses also costs deliverability for everyone else.
    reason: "Über 2 Jahre inaktiv — nur 1,1 % aller Rückkehrer kommen später.",
    strategy: { klein: null, gross: null },
  },
];

/** Contacts we have no purchase date for — behave exactly as today. */
export const UNKNOWN_SEGMENT = {
  key: "unbekannt",
  label: "Unbekannt",
  sendable: true,
  reason: "Kein Kaufdatum bekannt — unverändertes Verhalten.",
};

/**
 * Map an anchor value in EUR to a CONTENT tier, merging the analysis' top two
 * tiers. Null/unknown value → null (caller falls back to today's behaviour
 * rather than guessing a tier).
 *
 * @param {number|null|undefined} eur
 * @returns {"klein"|"gross"|null}
 */
export function contentTierForAnchor(eur) {
  const tier = valueTierKey(eur);
  if (tier === null) return null;
  return tier === "klein" ? CONTENT_TIERS.KLEIN : CONTENT_TIERS.GROSS;
}

/** Whole days between two instants, or null when either is unusable. */
export function daysSince(lastIso, now) {
  const then = new Date(lastIso).getTime();
  const ref = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (Number.isNaN(then) || Number.isNaN(ref)) return null;
  return (ref - then) / DAY_MS;
}

/**
 * Resolve the lifecycle segment for one contact.
 *
 * Fail-soft by design: no purchase date, an unparseable one, or a purchase in
 * the future all resolve to the UNKNOWN segment with today's similarity
 * strategy — a segmentation gap must never stop a campaign from going out.
 *
 * @param {{ lastOrderAt?: string|Date|null, anchorEur?: number|null, now?: Date|string }} input
 * @returns {{
 *   key: string, label: string, sendable: boolean, reason: string,
 *   strategy: string, contentTier: "klein"|"gross"|null, days: number|null
 * }}
 */
export function resolveCampaignSegment(input) {
  const now = input?.now ?? new Date();
  const days = input?.lastOrderAt == null ? null : daysSince(input.lastOrderAt, now);
  const contentTier = contentTierForAnchor(input?.anchorEur);

  // No usable date (or a clock skew putting the order in the future) → today's
  // behaviour, unchanged.
  if (days === null || days < 0) {
    return {
      ...UNKNOWN_SEGMENT,
      strategy: RECOMMENDATION_STRATEGIES.SIMILARITY,
      contentTier,
      days: null,
    };
  }

  const segment =
    CAMPAIGN_SEGMENTS.find((s) => days < s.maxDays) ??
    CAMPAIGN_SEGMENTS[CAMPAIGN_SEGMENTS.length - 1];

  // Without a tier we cannot pick the tier-specific strategy — fall back to
  // similarity rather than guessing that a contact is a big spender.
  const strategy =
    (contentTier && segment.strategy[contentTier]) ??
    (segment.sendable ? RECOMMENDATION_STRATEGIES.SIMILARITY : null);

  return {
    key: segment.key,
    label: segment.label,
    sendable: segment.sendable,
    reason: segment.reason,
    strategy,
    contentTier,
    days,
  };
}

/** Look up a segment definition by key (admin labels, stored values). */
export function campaignSegmentByKey(key) {
  if (key === UNKNOWN_SEGMENT.key) return UNKNOWN_SEGMENT;
  return CAMPAIGN_SEGMENTS.find((s) => s.key === key) ?? null;
}

/** Every valid stored segment key — the DB check constraint mirrors this. */
export const CAMPAIGN_SEGMENT_KEYS = [
  ...CAMPAIGN_SEGMENTS.map((s) => s.key),
  UNKNOWN_SEGMENT.key,
];

/**
 * Queue priority: how much a contact is worth working on first, from the
 * MEASURED product of repeat rate × accessory rate per value tier
 * (Kleinteile 9,2 % × 13,0 % = 1,2 % · ab 150 € ≈ 3,7–5,4 %). A contact at or
 * above 150 € is roughly three times as likely to become a repeat accessory
 * buyer, so it sorts first in the review queue.
 *
 * Higher is more urgent. Non-sendable segments sort last.
 *
 * @param {{ sendable: boolean, contentTier: string|null, key: string }} segment
 * @returns {number}
 */
export function campaignQueuePriority(segment) {
  if (!segment?.sendable) return 0;
  const tierWeight = segment.contentTier === CONTENT_TIERS.GROSS ? 3 : 1;
  // The early window converts best — work it before it closes.
  const windowWeight = segment.key === "ausbauen_frueh" ? 2 : 1;
  return tierWeight * windowWeight;
}

/**
 * The day range in which a contact is worth drafting, derived from the segment
 * table so it can never drift from it: the lower bound is where the first
 * sendable segment starts, the upper bound where the last one ends.
 *
 * The review queue uses this to skip contacts the data says not to mail —
 * a purchase too fresh (goods usually not even delivered) or a contact dormant
 * beyond two years (1,1 % of returners). Contacts with NO known purchase date
 * are never excluded by it: unknown means unchanged behaviour.
 *
 * @returns {{ minDays: number, maxDays: number }}
 */
export function sendableDayRange() {
  let lower = 0;
  let minDays = 0;
  let maxDays = Infinity;
  let seenSendable = false;
  for (const segment of CAMPAIGN_SEGMENTS) {
    if (segment.sendable) {
      if (!seenSendable) {
        minDays = lower;
        seenSendable = true;
      }
      maxDays = segment.maxDays;
    }
    lower = segment.maxDays;
  }
  return { minDays, maxDays };
}
