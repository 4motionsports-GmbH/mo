// Availability guard — the single predicate for "may we RECOMMEND this product
// right now?". Belt-and-suspenders on top of the sync (Part E webhooks keep stock
// fresh; the daily cron is the baseline). Even in the gap between a stock change
// and the webhook landing, recommendation surfaces filter through here so a
// sold-out item is never put forward; a restocked item becomes recommendable
// again automatically the moment its `inStock` flips back.
//
// Convention (matches the bundle cores): a product is unavailable ONLY when
// `inStock === false`. Missing/undefined stock data (e.g. the committed fallback
// bundle) is treated as available so we never hide products for lack of data.
//
// Pure + dependency-free so it's unit-testable and shareable across the chat
// product tool (retrieval), bundle composition, and marketing drafts.

/**
 * @param {{ inStock?: boolean } | null | undefined} product
 * @returns {boolean} true when the product may be recommended
 */
export function isAvailable(product) {
  return !!product && product.inStock !== false;
}

/**
 * Filter a product list to only the currently-recommendable (available) items,
 * preserving order.
 * @template {{ inStock?: boolean }} T
 * @param {T[]} products
 * @returns {T[]}
 */
export function filterAvailable(products) {
  return (Array.isArray(products) ? products : []).filter(isAvailable);
}
