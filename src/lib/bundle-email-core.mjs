// Pure, dependency-free core logic for the bundle SPECIAL-OFFER email block (S11).
//
// The two decisions the special-offer block hinges on, isolated so they are
// unit-testable without the email template / catalog / DB:
//   1. shouldRenderBundleBlock — the block appears ONLY when a created, still
//      active bundle is attached to the send (never for a draft with no bundle,
//      and never for an expired/failed/pending offer).
//   2. bundleStattPrice — the PAngV "statt €X" strike price is the genuine
//      snapshotted component sum, and ONLY when the bundle truly costs less than
//      its parts (reuses the S10 compare-at rule so the email and the Shopify
//      compareAtPrice can never disagree).

import { computeCompareAtPrice } from "./bundle-offer-core.mjs";

/**
 * Whether the personalized email should carry a special-offer block. True ONLY
 * for an attached, ACTIVE bundle offer; false for no bundle (null/undefined) or
 * any non-active lifecycle state (pending/expired/failed) — a dead offer must
 * never be advertised.
 *
 * @param {{ status?: string } | null | undefined} bundle
 * @returns {boolean}
 */
export function shouldRenderBundleBlock(bundle) {
  return Boolean(bundle && bundle.status === "active");
}

/**
 * The "statt €X" strike price for the email, or null when none should be shown.
 * It is the TRUE component sum, and present ONLY when bundlePrice < componentsSum
 * (PAngV: never invent a strike price; an at-or-above-sum bundle simply omits the
 * "statt" line). Delegates to the S10 compare-at rule so the displayed strike and
 * the Shopify compareAtPrice are computed identically.
 *
 * @param {string | number} bundlePrice
 * @param {string | number} componentsSum
 * @returns {string | null}  Money string (e.g. "298.00") or null
 */
export function bundleStattPrice(bundlePrice, componentsSum) {
  return computeCompareAtPrice(bundlePrice, componentsSum);
}
