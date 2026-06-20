// Card-selection contract — the single source of truth for "which products get
// a CARD in a chat turn."
//
// The visible product cards are driven EXCLUSIVELY by the model's explicit tool
// calls, never by the retrieval candidate set. The retrieved Top-K products only
// ever reach the system prompt (grounding context); they are never streamed to
// the widget. So a card exists iff the model called a product tool for it. This
// module turns a turn's tool calls into the ordered, availability-guarded set of
// RECOMMENDED product ids, so every server-side consumer (turn persistence, the
// summary cart, observability) — and the documented widget contract — agree on
// one definition instead of each re-deriving it.
//
// Pure + dependency-light (only the availability predicate) and kept in .mjs so
// `node --test` can exercise it directly, like availability.mjs / summary-
// products.mjs / email-offer-trigger.mjs.

import { isAvailable } from "./availability.mjs";

// Tool inputs that reference catalog product ids — the DISCUSSED universe
// (everything that came up, including compared-and-rejected alternatives).
// Mirrors the set persisted as conversations.recommended_product_ids.
export const PRODUCT_CARD_TOOLS = new Set([
  "show_product",
  "compare_products",
  "add_to_cart",
  "suggest_showroom",
  "show_contact_form",
  "offer_email_summary",
]);

// The ONE tool that declares an explicit RECOMMENDATION card: Mo calls
// show_product once per product it actually endorses in its prose, in
// recommendation order. compare_products is a comparison surface (a table that
// may weigh options it does NOT end up recommending); add_to_cart is the buy
// CTA. Neither is the "this is my pick" declaration — so the ordered card set
// the widget should mirror is the show_product calls.
const RECOMMENDATION_CARD_TOOLS = new Set(["show_product"]);

// The buy SELECTION: the direct-checkout CTA. The latest call replaces earlier
// ones (a switch to an alternative drops the rejected product).
const SELECTION_TOOLS = new Set(["add_to_cart"]);

/**
 * Read every catalog product id a single tool call references — both the single
 * `productId` and the multi `productIds` shapes. Returns [] for a tool that
 * doesn't reference catalog products or for malformed input.
 *
 * @param {{ toolName?: string, input?: unknown } | null | undefined} inv
 * @returns {string[]}
 */
export function productIdsFromToolCall(inv) {
  if (!inv || typeof inv.toolName !== "string" || !PRODUCT_CARD_TOOLS.has(inv.toolName)) {
    return [];
  }
  const input = inv.input;
  if (!input || typeof input !== "object") return [];
  const obj = /** @type {Record<string, unknown>} */ (input);
  const out = [];
  if (typeof obj.productId === "string") out.push(obj.productId);
  if (Array.isArray(obj.productIds)) {
    for (const p of obj.productIds) if (typeof p === "string") out.push(p);
  }
  return out;
}

/**
 * DISCUSSED set: every product id referenced by any product tool across the
 * given (chronological) tool calls, de-duped, first-seen order preserved.
 *
 * @param {ReadonlyArray<{ toolName?: string, input?: unknown }>} toolCalls
 * @returns {string[]}
 */
export function collectDiscussedProductIds(toolCalls) {
  return dedupe(flatIds(toolCalls, () => true));
}

/**
 * The current buy SELECTION: the product ids of the LATEST add_to_cart call in
 * the given (chronological) tool calls, or null when none fired. The latest call
 * REPLACES earlier ones — the tool call IS the signal, no NLP over the
 * transcript.
 *
 * @param {ReadonlyArray<{ toolName?: string, input?: unknown }>} toolCalls
 * @returns {string[] | null}
 */
export function latestSelectedProductIds(toolCalls) {
  let latest = null;
  for (const inv of toolCalls ?? []) {
    if (!inv || !SELECTION_TOOLS.has(inv.toolName)) continue;
    const ids = dedupe(productIdsFromToolCall(inv));
    if (ids.length > 0) latest = ids;
  }
  return latest;
}

/**
 * RECOMMENDATION cards in order: the ids Mo explicitly put forward as cards via
 * show_product, in call order (= the order it recommends them in its prose),
 * de-duped. This is the declaration the widget renders — NOT the retrieval set,
 * and NOT mere mentions/comparisons.
 *
 * @param {ReadonlyArray<{ toolName?: string, input?: unknown }>} toolCalls
 * @returns {string[]}
 */
export function recommendedCardIdsInOrder(toolCalls) {
  return dedupe(
    flatIds(toolCalls, (inv) => RECOMMENDATION_CARD_TOOLS.has(inv.toolName))
  );
}

/**
 * Apply the load-bearing guards to an ordered id list:
 *  - MEMBERSHIP: drop ids that are not in the catalog (never card a phantom id).
 *  - AVAILABILITY: drop ids that are sold out (never card a sold-out item as a
 *    recommendation — the same guard retrieval already applies upstream).
 * Order is preserved. The dropped ids are returned too, so callers can surface a
 * regression (the model recommending something invalid) instead of shipping a
 * wrong card silently.
 *
 * @param {ReadonlyArray<string>} orderedIds
 * @param {Map<string, { inStock?: boolean }> | Record<string, { inStock?: boolean }>} catalogById
 * @returns {{ cardIds: string[], droppedUnknown: string[], droppedSoldOut: string[] }}
 */
export function guardRecommendedCardIds(orderedIds, catalogById) {
  const lookup = (id) =>
    catalogById instanceof Map ? catalogById.get(id) : catalogById?.[id];
  const cardIds = [];
  const droppedUnknown = [];
  const droppedSoldOut = [];
  for (const id of orderedIds ?? []) {
    const product = lookup(id);
    if (!product) {
      droppedUnknown.push(id);
    } else if (!isAvailable(product)) {
      droppedSoldOut.push(id);
    } else {
      cardIds.push(id);
    }
  }
  return { cardIds, droppedUnknown, droppedSoldOut };
}

/**
 * Convenience: the guarded, ordered recommendation card ids for a turn's tool
 * calls — exactly the cards the widget should render, in order.
 *
 * @param {ReadonlyArray<{ toolName?: string, input?: unknown }>} toolCalls
 * @param {Map<string, { inStock?: boolean }> | Record<string, { inStock?: boolean }>} catalogById
 * @returns {{ cardIds: string[], droppedUnknown: string[], droppedSoldOut: string[] }}
 */
export function selectRecommendedCards(toolCalls, catalogById) {
  return guardRecommendedCardIds(recommendedCardIdsInOrder(toolCalls), catalogById);
}

// --- internals -------------------------------------------------------------

/**
 * @param {ReadonlyArray<{ toolName?: string, input?: unknown }>} toolCalls
 * @param {(inv: { toolName?: string, input?: unknown }) => boolean} pick
 * @returns {string[]}
 */
function flatIds(toolCalls, pick) {
  const out = [];
  for (const inv of toolCalls ?? []) {
    if (!inv || !pick(inv)) continue;
    for (const id of productIdsFromToolCall(inv)) out.push(id);
  }
  return out;
}

/**
 * @param {ReadonlyArray<string>} ids
 * @returns {string[]}
 */
function dedupe(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
