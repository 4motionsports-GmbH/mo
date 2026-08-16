// Canonical product/variant reference — the ONE place that knows how a
// "product ref" string is built, parsed and resolved against the catalog.
//
// A ref is either a bare catalog id (= Shopify handle, meaning "the product /
// its default variant") or `<handle>~<numericVariantId>` pinning a specific
// variant. Every rail that today carries product-id strings (chat tool params,
// campaign_drafts.recommended_product_ids, marketing_sends.product_ids,
// conversation selections) can carry refs unchanged — no schema migrations.
//
// The separator is `~`: it cannot appear in a Shopify handle and is URL-safe
// (RFC 3986 unreserved), so refs survive query strings without encoding — a
// `#` would start a URL fragment and be silently truncated.
//
// Back-compat contract: catalogs written before the variants[] field exists
// (old blob, committed CSV fallback) still resolve — `productVariants()`
// synthesizes the default variant from the product's flat top-level fields.
//
// Resolution outcomes are deliberately three-way so senders can hard-block:
//   - null                                → product unknown
//   - { product, variant, missingVariant:false } → resolved (default or pinned)
//   - { product, variant:null, missingVariant:true }
//         → a SPECIFIC variant was requested but no longer exists. Outbound
//           rendering (marketing/campaign email, cart links) must NEVER
//           silently downgrade this to the default variant — the admin
//           approved a concrete price (PAngV). Skip + surface instead.

export const PRODUCT_REF_SEPARATOR = "~";

/**
 * Build a ref string. A nullish/empty variantId yields the bare product id.
 * @param {string} productId
 * @param {string|number|null|undefined} [variantId]
 * @returns {string}
 */
export function formatProductRef(productId, variantId) {
  const id = String(productId ?? "").trim();
  const v = variantId == null ? "" : String(variantId).trim();
  if (!id) return "";
  return v ? `${id}${PRODUCT_REF_SEPARATOR}${v}` : id;
}

/**
 * Parse a ref. The variant part must be purely numeric (Shopify numeric
 * variant id); a malformed suffix (e.g. "handle~16kg") is NOT split — the
 * whole string is returned as productId so downstream catalog lookups fail
 * visibly instead of silently resolving to the wrong variant.
 * @param {unknown} ref
 * @returns {{ productId: string, variantId: string|null }}
 */
export function parseProductRef(ref) {
  const s = typeof ref === "string" ? ref.trim() : ref == null ? "" : String(ref).trim();
  const idx = s.lastIndexOf(PRODUCT_REF_SEPARATOR);
  if (idx > 0 && idx < s.length - 1) {
    const suffix = s.slice(idx + 1);
    if (/^\d+$/.test(suffix)) {
      return { productId: s.slice(0, idx), variantId: suffix };
    }
  }
  return { productId: s, variantId: null };
}

/** True when the string carries a variant suffix. */
export function isVariantRef(ref) {
  return parseProductRef(ref).variantId != null;
}

/** Numeric form of a variant id (bare digits or the digits of a variant GID). */
export function normalizeVariantId(id) {
  if (id == null) return null;
  const s = String(id).trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/ProductVariant\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Effective (customer-facing) price of a variant: sale price when a genuine
 * one exists, else the regular price. Mirrors the convention used across the
 * codebase for the flat Product fields.
 * @param {{ price?: number, salePrice?: number }|null|undefined} variant
 * @returns {number|null}
 */
export function effectiveVariantPrice(variant) {
  if (!variant) return null;
  const { price, salePrice } = variant;
  if (typeof salePrice === "number" && salePrice > 0) return salePrice;
  return typeof price === "number" ? price : null;
}

/**
 * The product's variants, normalized: the real variants[] array when the
 * catalog carries one, else a single default variant synthesized from the
 * flat top-level fields (old blob / CSV fallback / pre-variant data).
 * Always returns length >= 1 for a well-formed product.
 * @param {object|null|undefined} product Product-shaped object
 * @returns {Array<object>} ProductVariant-shaped objects
 */
export function productVariants(product) {
  if (!product) return [];
  if (Array.isArray(product.variants) && product.variants.length > 0) {
    return product.variants;
  }
  return [
    {
      id: product.shopifyVariantId ?? null,
      title: "",
      options: [],
      ...(product.sku ? { sku: product.sku } : {}),
      ...(product.barcode ? { barcode: product.barcode } : {}),
      price: product.price,
      ...(typeof product.salePrice === "number" ? { salePrice: product.salePrice } : {}),
      available: product.inStock !== false,
      ...(product.shopifyCartUrl ? { cartUrl: product.shopifyCartUrl } : {}),
      isDefault: true,
    },
  ];
}

/** The product's default variant (Shopify position 1), via productVariants(). */
export function defaultVariant(product) {
  const variants = productVariants(product);
  return variants.find((v) => v && v.isDefault) ?? variants[0] ?? null;
}

/**
 * Resolve a ref against the catalog.
 * @param {Map<string, object>} catalogById Map of product id → Product
 * @param {unknown} ref
 * @returns {null | { product: object, variant: object|null, variantId: string|null, missingVariant: boolean }}
 *   - null: product unknown (or malformed ref — its lookup fails)
 *   - variant: the pinned variant when the ref carries one and it exists,
 *     else the default variant; null ONLY when missingVariant is true.
 *   - missingVariant: a specific variant was requested but is gone. Callers
 *     rendering outbound content must skip these (see module doc).
 */
export function resolveProductRef(catalogById, ref) {
  const { productId, variantId } = parseProductRef(ref);
  if (!productId) return null;
  const product = catalogById?.get?.(productId) ?? null;
  if (!product) return null;
  const variants = productVariants(product);
  if (variantId != null) {
    // Tolerant id compare: catalog variant ids are numeric strings, but a
    // legacy synthesized default may carry a full GID — match on the digits.
    const match =
      variants.find((v) => v && normalizeVariantId(v.id) === variantId) ?? null;
    if (!match) return { product, variant: null, variantId, missingVariant: true };
    return { product, variant: match, variantId, missingVariant: false };
  }
  return { product, variant: defaultVariant(product), variantId: null, missingVariant: false };
}

/**
 * Availability of a resolved variant: the variant's own availableForSale-based
 * flag, backstopped by the product-level inStock (a sold-out product never
 * offers an "available" variant to recommenders).
 */
export function isVariantAvailable(product, variant) {
  if (!product || product.inStock === false) return false;
  return !variant || variant.available !== false;
}

/**
 * Display name for a resolved selection: "Produktname – Variantentitel" when a
 * meaningful variant title exists, else the bare product name.
 */
export function variantDisplayName(product, variant) {
  const name = (product?.name ?? "").trim();
  const title = (variant?.title ?? "").trim();
  return title ? `${name} – ${title}` : name;
}

/**
 * Storefront PDP url for a resolved selection — deep-links the variant via
 * Shopify's standard `?variant=<numericId>` parameter when one is pinned.
 */
export function variantPdpUrl(product, variant) {
  const base = product?.shopifyUrl ?? null;
  if (!base) return null;
  const id = variant?.id != null ? String(variant.id) : "";
  if (!id || !/^\d+$/.test(id)) return base;
  return `${base}${base.includes("?") ? "&" : "?"}variant=${id}`;
}

/**
 * Effective price range across a product's variants.
 * @returns {{ min: number, max: number }|null}
 */
export function productPriceRange(product) {
  const prices = productVariants(product)
    .map((v) => effectiveVariantPrice(v))
    .filter((n) => typeof n === "number" && n > 0);
  if (!prices.length) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
