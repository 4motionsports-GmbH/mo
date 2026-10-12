// What a marketing mail offers — ONE of two things, never both (owner,
// 12.10.2026):
//
//   - "items": single-product recommendations (the product grid), optionally
//     with a discount code (all items or only the recommended ones);
//   - "set":   one set offer (bundle_offers, docs/BUNDLES.md). The set price IS
//     the concession — a set mail carries NO discount code and NO single-item
//     grid.
//
// The kind is DERIVED from whether an active set is attached to the draft (no
// column): attaching a set turns the mail into a set mail, removing it turns it
// back. This module is the one rule the desk, the routes, the drafting prompts,
// the review checks, the send gates and the renderers share, so they can never
// disagree about what a mail is.

/** @typedef {"items" | "set"} OfferKind */

export const OFFER_ITEMS = "items";
export const OFFER_SET = "set";

/**
 * @param {boolean | null | undefined} hasActiveBundle  an active, unexpired set is attached
 * @returns {OfferKind}
 */
export function offerKind(hasActiveBundle) {
  return hasActiveBundle ? OFFER_SET : OFFER_ITEMS;
}

/**
 * The conflict the send paths refuse (fail closed): a set mail that still
 * carries a discount. New drafts cannot get there (creating a set clears the
 * discount, the discount route refuses while a set is attached, a regenerate
 * with a set drafts without one) — this catches drafts from before the rule.
 *
 * @param {{ discountPercent?: number | null, hasActiveBundle?: boolean | null }} input
 * @returns {boolean}
 */
export function offerConflict({ discountPercent, hasActiveBundle }) {
  const discount = Number(discountPercent);
  return Boolean(hasActiveBundle) && Number.isFinite(discount) && discount > 0;
}

/** German refusal text for the conflict (routes, preflight, review check). */
export const OFFER_CONFLICT_MESSAGE =
  "Eine Set-Mail trägt keinen Rabattcode — der Set-Preis ist das Angebot. Rabatt entfernen oder das Set abhängen.";

/**
 * The discount a draft may carry for its offer kind: a set mail none, an item
 * mail the requested one. Used where a depth is chosen from a default (the
 * campaign, the prepare popover, the Eingang suggestion) so a regenerate can
 * never write a code into a set mail.
 *
 * @param {number | null | undefined} discountPercent
 * @param {boolean | null | undefined} hasActiveBundle
 * @returns {number}
 */
export function discountForOffer(discountPercent, hasActiveBundle) {
  if (hasActiveBundle) return 0;
  const discount = Number(discountPercent);
  return Number.isFinite(discount) && discount > 0 ? discount : 0;
}
