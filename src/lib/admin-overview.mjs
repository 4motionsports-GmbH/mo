// Pure, I/O-free derivations for the admin OVERVIEW (Übersicht) tab. Kept in
// plain .mjs — like email-offer-trigger.mjs — so the
// aggregation maths is trivially unit-testable with node:test and shared by the
// server-rendered OverviewTab. NOTHING here fetches or mutates: callers pass in
// data already read from the existing stores (listMarketingTargets, …), and we
// only bucket / sort / cap it for display.

/**
 * @typedef {Object} MarketingTargetLike
 * @property {string} email
 * @property {string|null} confirmedAt
 * @property {{ status: string }} purchase
 */

/**
 * Bucket the already-fetched marketing-eligible targets by purchase status.
 * Mirrors the Marketing tab's own buckets (see MarketingList.matchesStatus) so
 * the overview headline numbers agree with the list the operator drills into.
 *
 * @param {MarketingTargetLike[]} targets
 * @returns {{ eligible: number, notPurchased: number, purchased: number, unknown: number }}
 */
export function summarizeMarketingTargets(targets) {
  const list = Array.isArray(targets) ? targets : [];
  let notPurchased = 0;
  let purchased = 0;
  let unknown = 0;
  for (const t of list) {
    const status = t?.purchase?.status;
    if (status === "no_purchase") notPurchased++;
    else if (status === "purchased") purchased++;
    else unknown++;
  }
  return { eligible: list.length, notPurchased, purchased, unknown };
}

/**
 * The most recently DOI-confirmed contacts, newest first, capped to `limit`.
 * Targets arrive already ordered by confirmation date, but we sort defensively
 * (and drop entries without a parseable confirmation date) so the recent-activity
 * list is stable regardless of input order.
 *
 * @param {MarketingTargetLike[]} targets
 * @param {number} [limit]
 * @returns {{ email: string, confirmedAt: string }[]}
 */
export function recentConfirmedContacts(targets, limit = 5) {
  const list = Array.isArray(targets) ? targets : [];
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
  return list
    .filter(
      (t) =>
        t &&
        typeof t.email === "string" &&
        t.email &&
        typeof t.confirmedAt === "string" &&
        !Number.isNaN(Date.parse(t.confirmedAt))
    )
    .map((t) => ({ email: String(t.email), confirmedAt: String(t.confirmedAt) }))
    .sort((a, b) => Date.parse(b.confirmedAt) - Date.parse(a.confirmedAt))
    .slice(0, cap);
}
