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
 * Split discussed products into the chosen set (already in the cart link) and
 * the alternatives shown below the checkout button.
 *
 * @template {{ id: string }} P
 * @param {string[]} chosenIds  Product ids present in the cart permalink
 *   (cart.resolvedProductIds). Sold-out/unresolved ids are already excluded
 *   upstream by buildPrefilledCartUrl, so nothing here re-checks availability.
 * @param {P[]} discussedProducts  All discussed (recommended) products.
 * @returns {{ alternatives: P[] }} discussed minus chosen, original order
 *   preserved. Guarantees chosen ∩ alternatives = ∅.
 */
export function partitionSummaryProducts(chosenIds, discussedProducts) {
  const chosen = new Set(chosenIds);
  const alternatives = discussedProducts.filter((p) => !chosen.has(p.id));
  return { alternatives };
}
