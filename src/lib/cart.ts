// Prefilled Shopify cart permalink builder.
//
// Given a list of catalog product ids (the ones discussed in a conversation),
// resolve each to its default *numeric* Shopify variant id and assemble a
// storefront prefilled-cart permalink of the form
//   https://<shop>/cart/<variant>:1,<variant>:1
// optionally with a `?discount=CODE` suffix.
//
// Shopify's cart permalinks only accept the NUMERIC variant id — never the SKU,
// handle, or product id (a SKU 404s with "Cannot find variant"). We reuse the
// same parsing/quantity rules as the single-product cart-url helper.
//
// Reusable by BOTH the transactional summary email (no discount — discount is
// marketing-only) and the marketing dashboard (which may append a discount).

import { loadProductCatalog } from "./catalog-store";
import {
  buildCartPermalink,
  parseNumericVariantId,
  SHOP_DOMAIN,
} from "./shopify-cart-url.mjs";
import type { Product } from "./types";

export interface CartLine {
  productId: string;
  /** The resolved numeric variant id, or null when it couldn't be resolved. */
  variantId: string | null;
  /** The matched catalog product, when the id exists in the catalog. */
  product?: Product;
}

export interface PrefilledCart {
  /**
   * The cart permalink, or null when not a single line could be resolved
   * (callers should omit the cart link rather than emit a broken URL).
   */
  url: string | null;
  /** Per-input resolution detail (request order preserved). */
  lines: CartLine[];
  /** Ids that resolved to a usable variant and are present in `url`. */
  resolvedProductIds: string[];
  /** Ids that could not be resolved (unknown product or no numeric variant). */
  unresolvedProductIds: string[];
  /**
   * Ids skipped because the product is sold out AND `excludeSoldOut` was set.
   * Surfaced separately from `unresolvedProductIds` so callers can tell a
   * deliberate availability exclusion apart from a missing-variant failure.
   */
  soldOutProductIds: string[];
}

export interface BuildPrefilledCartOptions {
  /**
   * Optional discount code appended as `?discount=CODE`. MARKETING-ONLY — the
   * transactional summary email must never pass this.
   */
  discountCode?: string;
  /** Units per line. Defaults to 1. */
  quantityPerItem?: number;
  /** Override the shop domain (defaults to the production storefront). */
  shopDomain?: string;
  /**
   * When true, products that are sold out (`inStock === false`) are skipped
   * and reported in `soldOutProductIds` instead of being added to the cart.
   * Used by the quick-checkout path so a sold-out item can never enter a
   * checkout action (stock is sync-fresh — see docs/CATALOG_SYNC.md).
   */
  excludeSoldOut?: boolean;
}

function normalizedQuantity(quantity: number | undefined): number {
  return Number.isFinite(quantity) && (quantity as number) > 0
    ? Math.floor(quantity as number)
    : 1;
}

/**
 * Build a prefilled-cart permalink from already-loaded products. Pure (no I/O)
 * so it's trivially testable and reusable wherever the catalog is in hand.
 *
 * `productIds` drives the order and which lines appear; `productsById` is the
 * lookup. Ids missing from the map, or whose product has no resolvable numeric
 * variant id, are skipped and reported in `unresolvedProductIds`.
 */
export function buildPrefilledCartUrl(
  productIds: string[],
  productsById: Map<string, Product>,
  options: BuildPrefilledCartOptions = {}
): PrefilledCart {
  const qty = normalizedQuantity(options.quantityPerItem);
  const shopDomain = options.shopDomain ?? SHOP_DOMAIN;

  const lines: CartLine[] = [];
  const resolvedProductIds: string[] = [];
  const unresolvedProductIds: string[] = [];
  const soldOutProductIds: string[] = [];
  const variantIds: string[] = [];
  // De-dupe variant ids so the same product isn't added twice (e.g. discussed
  // and also "recommended"), while preserving first-seen order.
  const seenVariants = new Set<string>();

  for (const productId of productIds) {
    const product = productsById.get(productId);
    // Hard guarantee: a sold-out product never enters the checkout link when
    // the caller opts in. We still record it (lines + soldOutProductIds) so the
    // caller can explain the omission rather than silently dropping it.
    if (options.excludeSoldOut && product && product.inStock === false) {
      lines.push({ productId, variantId: null, product });
      soldOutProductIds.push(productId);
      continue;
    }
    const variantId = product
      ? parseNumericVariantId(product.shopifyVariantId ?? null)
      : null;
    lines.push({ productId, variantId, product });
    if (!variantId) {
      unresolvedProductIds.push(productId);
      continue;
    }
    if (seenVariants.has(variantId)) continue;
    seenVariants.add(variantId);
    resolvedProductIds.push(productId);
    variantIds.push(variantId);
  }

  // Delegate the actual permalink assembly to the shared (unit-tested) helper
  // so the single-product and multi-product paths can never drift apart.
  const url = buildCartPermalink(variantIds, {
    quantity: qty,
    discountCode: options.discountCode,
    shopDomain,
  });

  return { url, lines, resolvedProductIds, unresolvedProductIds, soldOutProductIds };
}

/**
 * Convenience wrapper that loads the live catalog and builds the permalink for
 * the given product ids. Use this from routes/email builders that have only the
 * ids in hand.
 */
export async function buildPrefilledCartUrlForIds(
  productIds: string[],
  options: BuildPrefilledCartOptions = {}
): Promise<PrefilledCart> {
  const catalog = await loadProductCatalog();
  const byId = new Map(catalog.map((p) => [p.id, p]));
  return buildPrefilledCartUrl(productIds, byId, options);
}
