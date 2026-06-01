// Pure helpers for building Shopify storefront cart URLs from a *numeric*
// variant id. Shared by the runtime Shopify mapping (catalog-mapping.ts), the
// CSV conversion script (scripts/convert-catalog.mjs), and the tests.
//
// Shopify's storefront cart endpoints (`/cart/<id>:<qty>` permalinks and
// `/cart/add?id=<id>`) only accept the NUMERIC variant id — never the SKU,
// handle, or product id. Passing a SKU yields a 404 "Cannot find variant".
// We therefore resolve the numeric variant id and, when it's missing, return
// null so callers can omit `shopifyCartUrl` and let the widget degrade
// gracefully instead of linking to a broken cart.

export const SHOP_DOMAIN = "https://motionsports.de";

/**
 * Extract the numeric Shopify variant id from either a bare numeric id
 * (Admin REST) or a Storefront/Admin GraphQL GID
 * ("gid://shopify/ProductVariant/<numericId>").
 *
 * Returns the digits as a string, or null when the input is missing or is
 * not a numeric id / variant GID (e.g. a SKU like "MS-ATX-FMB-800-B").
 *
 * @param {string | number | null | undefined} idOrGid
 * @returns {string | null}
 */
export function parseNumericVariantId(idOrGid) {
  if (idOrGid == null) return null;
  const s = String(idOrGid).trim();
  if (!s) return null;
  // Already a bare numeric id.
  if (/^\d+$/.test(s)) return s;
  // GraphQL GID, e.g. gid://shopify/ProductVariant/40123456789
  const m = s.match(/\/ProductVariant\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Build a Shopify cart permalink for `quantity` units of the given variant.
 * Prefers the robust permalink form `/cart/<numericVariantId>:<qty>`.
 *
 * Accepts a bare numeric id or a variant GID. Returns null when no numeric
 * variant id can be resolved — callers should omit `shopifyCartUrl` in that
 * case rather than emit a SKU-based (broken) URL.
 *
 * @param {string | number | null | undefined} idOrGid
 * @param {number} [quantity=1]
 * @param {string} [shopDomain=SHOP_DOMAIN]
 * @returns {string | null}
 */
export function buildShopifyCartUrl(idOrGid, quantity = 1, shopDomain = SHOP_DOMAIN) {
  const variantId = parseNumericVariantId(idOrGid);
  if (!variantId) return null;
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
  return `${shopDomain}/cart/${variantId}:${qty}`;
}
