// Pure helpers for the "recommendation → purchase" KPI loop. Kept in plain .mjs
// (no I/O, no types) so it is trivially unit-testable with node:test and shared
// by the TS aggregation module — mirroring the shopify-cart-url.mjs convention.
//
// Matching a recommended catalog product to a purchased Shopify line item is
// inherently fuzzy: our catalog id equals the storefront handle (verified), but
// a real Shopify handle is normalised (lowercased, special characters like "®"
// stripped). We therefore compare NORMALISED handles on both sides so
// "150-kg-atx®-gym-…" lines up with the live handle "150-kg-atx-gym-…".

// Combining diacritical marks (U+0300–U+036F) left behind by NFKD decomposition.
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Normalise a product handle / catalog id to a comparable key: lowercase, any
 * run of non-alphanumeric characters collapsed to a single hyphen, leading and
 * trailing hyphens trimmed. Returns "" for nullish/empty input.
 *
 * @param {string | null | undefined} s
 * @returns {string}
 */
export function normalizeHandle(s) {
  if (s == null) return "";
  return String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * True when any recommended handle appears among the purchased handles, after
 * normalisation. Both arguments are arrays of raw handle/id strings.
 *
 * @param {Array<string | null | undefined>} recommended
 * @param {Array<string | null | undefined>} purchased
 * @returns {boolean}
 */
export function hasRecommendedPurchase(recommended, purchased) {
  const recSet = new Set(recommended.map(normalizeHandle).filter(Boolean));
  if (recSet.size === 0) return false;
  for (const p of purchased) {
    const key = normalizeHandle(p);
    if (key && recSet.has(key)) return true;
  }
  return false;
}
