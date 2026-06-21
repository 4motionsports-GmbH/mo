// Pure aggregation of Mo discount-code redemptions into the revenue headline.
//
// "Revenue made with Mo" is defined HONESTLY as: the actually-paid totals of real
// Shopify orders that redeemed a UNIQUE single-use discount code minted by Mo's
// marketing flow (MS5-… codes; usageLimit:1, so at most ONE order per code). The
// per-code redemption lookups happen in lib/shopify-orders.fetchCodeRedemption;
// this module folds those results into the figure shown on the dashboard.
//
// Only orders whose money was REALISED count toward revenue — a code can be
// "used" at checkout while payment is still pending/voided, which is not revenue.
// Plain cart links (no code) carry no Mo marker and are not representable here at
// all, so they can never be silently counted.
//
// Plain .mjs (no I/O) so the node:test runner imports it directly.

// Shopify displayFinancialStatus values that mean money was actually received
// (post any partial refund). Mirrors COMPLETED_PURCHASE_STATUSES in
// lib/shopify-orders.ts — duplicated here (a two-element set) so this pure module
// needs no TypeScript import. Anything else (PENDING / AUTHORIZED / VOIDED /
// REFUNDED / EXPIRED / …) is NOT counted as realised revenue.
const REALISED_STATUSES = new Set(["PAID", "PARTIALLY_REFUNDED"]);

/**
 * Whether a Shopify financial status counts as realised (paid) revenue.
 * Case-insensitive; null/blank/unknown → false (fail-closed).
 * @param {string | null | undefined} status
 * @returns {boolean}
 */
export function isRealisedFinancialStatus(status) {
  return typeof status === "string" && REALISED_STATUSES.has(status.trim().toUpperCase());
}

/**
 * @typedef {Object} CodeRedemption
 * @property {"redeemed"|"not_redeemed"|"unknown"} status
 * @property {number|null} [amount]          Order total actually paid.
 * @property {string|null} [currency]        ISO currency of that order.
 * @property {string|null} [financialStatus] Shopify displayFinancialStatus.
 */

/**
 * @typedef {Object} RevenueSummary
 * @property {number} revenueAmount     Sum of realised order totals, cents-rounded.
 * @property {string|null} currency     Currency of the counted orders (first seen).
 * @property {number} orderCount        Orders counted toward revenue.
 * @property {number} redemptionUnknown Codes Shopify couldn't answer for.
 * @property {number} codesChecked      Codes inspected (= results length).
 */

/**
 * Fold per-code redemption results into the revenue headline. Only a redeemed
 * code whose order money is REALISED (and a finite, non-negative amount)
 * contributes. "unknown" results are tallied separately (never counted as zero
 * revenue silently).
 *
 * @param {CodeRedemption[]} results
 * @returns {RevenueSummary}
 */
export function summarizeRedemptions(results) {
  const list = Array.isArray(results) ? results : [];
  let revenueAmount = 0;
  let orderCount = 0;
  let redemptionUnknown = 0;
  /** @type {string|null} */
  let currency = null;

  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    if (r.status === "unknown") {
      redemptionUnknown++;
      continue;
    }
    if (r.status !== "redeemed") continue;
    if (!isRealisedFinancialStatus(r.financialStatus)) continue;
    // A missing amount means "we don't have the money figure" — NOT zero. Guard
    // explicitly because Number(null) coerces to 0 (which would count a phantom
    // zero-revenue order). A genuine 0 total (e.g. a 100%-off code) is kept.
    if (r.amount == null) continue;
    const amt = Number(r.amount);
    if (!Number.isFinite(amt) || amt < 0) continue;
    revenueAmount += amt;
    orderCount++;
    if (currency == null && typeof r.currency === "string" && r.currency) {
      currency = r.currency;
    }
  }

  // Round to cents to avoid float drift when summing decimal money strings.
  revenueAmount = Math.round(revenueAmount * 100) / 100;
  return {
    revenueAmount,
    currency,
    orderCount,
    redemptionUnknown,
    codesChecked: list.length,
  };
}
