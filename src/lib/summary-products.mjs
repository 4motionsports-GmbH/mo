// Pure partition of a consultation's products for the summary email.
//
// The CHOSEN set is whatever the prefilled-cart permalink actually contains
// (cart.resolvedProductIds) — the cart builder has already dropped sold-out and
// unresolvable items, so this module just inherits that decision. The OTHER
// discussed products are everything that was discussed minus that chosen set;
// they render under "Vielleicht auch interessant:".
//
// Kept dependency-free and in .mjs so `node --test` can exercise it directly
// (same pattern as shopify-cart-url.mjs, imported by lib/cart.ts).

/**
 * At most this many „Vielleicht auch interessant“ cards. A long consultation
 * can touch 20+ products, and every card is ~3 KB of mail: past ~20 the
 * summary went over Gmail's 102-KB limit, which clips the mail and hides the
 * company / Impressum footer (13.10.2026). The first-discussed ones stay.
 */
export const SUMMARY_MAX_ALTERNATIVES = 12;

/**
 * Split discussed products into the chosen set (already in the cart link) and
 * the alternatives shown below the checkout button.
 *
 * @template {{ id: string }} P
 * @param {string[]} chosenIds  Product ids present in the cart permalink
 *   (cart.resolvedProductIds). Sold-out/unresolved ids are already excluded
 *   upstream by buildPrefilledCartUrl, so nothing here re-checks availability.
 * @param {P[]} discussedProducts  All discussed (recommended) products.
 * @returns {{ alternatives: P[] }} discussed minus chosen, each product once,
 *   original order preserved, at most SUMMARY_MAX_ALTERNATIVES. Guarantees
 *   chosen ∩ alternatives = ∅.
 */
export function partitionSummaryProducts(chosenIds, discussedProducts) {
  const chosen = new Set(chosenIds);
  const seen = new Set();
  const alternatives = [];
  for (const p of discussedProducts) {
    // The same product can arrive twice (its plain ref and a variant ref map
    // to one Product) — one card each.
    if (chosen.has(p.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    alternatives.push(p);
    if (alternatives.length === SUMMARY_MAX_ALTERNATIVES) break;
  }
  return { alternatives };
}

