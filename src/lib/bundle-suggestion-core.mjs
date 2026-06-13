// Pure, dependency-free core logic for the AI BUNDLE SUGGESTION (S11).
//
// Side-effect-free helpers so the suggestion's hard guarantees — never propose a
// product the customer already OWNS, never propose a SOLD-OUT (or unpriceable /
// variant-less) product, and never trust a hallucinated product id from the
// model — are unit-testable without a database, a catalog blob, or the AI SDK.
// The TS wrapper (bundle-suggestion.ts) composes these with the live catalog +
// generateObject.
//
// See docs/BUNDLES.md (compose-time sold-out refusal) — the candidate set is the
// FIRST place that rule is applied, so the model is never even offered a product
// that S10's createBundleOffer would later reject.

/** Min / max products a bundle suggestion may contain (the editable list). */
export const BUNDLE_MIN_PRODUCTS = 2;
export const BUNDLE_MAX_PRODUCTS = 5;

/**
 * The catalog products the model is ALLOWED to bundle for this customer:
 * in-stock, priceable, with a resolvable Shopify variant, and NOT already owned.
 * Pure — takes the catalog + owned handles, returns the eligible subset
 * (original order preserved). Catalog product ids ARE Shopify handles, so the
 * purchase history's handles exclude owned products directly.
 *
 * @param {Array<{ id: string, inStock?: boolean, shopifyVariantId?: string,
 *   price?: number, salePrice?: number }>} catalog
 * @param {Iterable<string>} ownedHandles
 * @returns {Array<object>} the eligible candidate products
 */
export function selectBundleCandidates(catalog, ownedHandles = []) {
  const owned = new Set(ownedHandles);
  const list = Array.isArray(catalog) ? catalog : [];
  return list.filter((p) => {
    if (!p || typeof p.id !== "string") return false;
    if (owned.has(p.id)) return false; // never re-bundle an owned product
    if (p.inStock === false) return false; // sold-out is refused by S10 anyway
    if (!p.shopifyVariantId) return false; // no variant ⇒ no bundle component
    const price = p.salePrice != null ? p.salePrice : p.price;
    if (!(typeof price === "number" && Number.isFinite(price) && price > 0)) return false;
    return true;
  });
}

/**
 * Sanitize the model's chosen products against the allowed candidate ids: drop
 * any id NOT in the candidate set (a hallucination, an owned item, or a sold-out
 * product the model slipped in), de-duplicate (first rationale wins), and clamp
 * to at most BUNDLE_MAX_PRODUCTS. Returns the surviving picks in model order.
 *
 * The min is intentionally NOT enforced here (the caller decides how to surface
 * "too few survived") — this function's job is to guarantee every returned id is
 * genuinely bundle-eligible.
 *
 * @param {Array<{ productId?: string, rationale?: string }>} rawPicks
 * @param {Iterable<string>} allowedIds
 * @param {{ max?: number }} [opts]
 * @returns {Array<{ productId: string, rationale: string }>}
 */
export function sanitizeBundleSuggestion(rawPicks, allowedIds, opts = {}) {
  const allowed = new Set(allowedIds);
  const max = Number.isInteger(opts.max) && opts.max > 0 ? opts.max : BUNDLE_MAX_PRODUCTS;
  const seen = new Set();
  const out = [];
  for (const pick of Array.isArray(rawPicks) ? rawPicks : []) {
    const productId = String(pick?.productId ?? "").trim();
    if (!productId || !allowed.has(productId) || seen.has(productId)) continue;
    seen.add(productId);
    out.push({
      productId,
      rationale: typeof pick?.rationale === "string" ? pick.rationale.trim() : "",
    });
    if (out.length >= max) break;
  }
  return out;
}
