// Thin re-export for backwards compatibility. The real loader lives in
// catalog-store.ts and handles Blob + bundled-JSON fallback with caching.
import { loadProductCatalog } from "./catalog-store";
import {
  parseProductRef,
  resolveProductRef,
  variantDisplayName,
  variantPdpUrl,
  isVariantAvailable,
} from "./product-ref.mjs";
import type { Product, ProductVariant } from "./types";

export { loadProductCatalog };

/**
 * Ref-tolerant product lookup: accepts a bare catalog id (= handle) OR a
 * product ref ("handle~variantId") and returns the PRODUCT either way — legacy
 * consumers that only care about the product keep working when a rail starts
 * carrying refs. Variant-granular consumers use resolveProductSelections.
 */
export async function getProductById(id: string): Promise<Product | undefined> {
  const catalog = await loadProductCatalog();
  const { productId } = parseProductRef(id);
  return catalog.find((p) => p.id === productId);
}

export async function getProductsByIds(ids: string[]): Promise<Product[]> {
  const catalog = await loadProductCatalog();
  return ids
    .map((id) => {
      const { productId } = parseProductRef(id);
      return catalog.find((p) => p.id === productId);
    })
    .filter((p): p is Product => p !== undefined);
}

/**
 * A ref resolved against the catalog, keeping the REF intact (so re-saving a
 * curated selection never silently strips the variant).
 *
 * `display` is the variant-projected Product: the product with its flat
 * commercial fields (name, price, salePrice, sku, variant/cart ids, url,
 * inStock) swapped to the CHOSEN variant — so every Product-shaped renderer
 * (email grids, prompt blocks, public cards) shows the selected variant
 * without knowing about variants. Absent when missingVariant.
 *
 * missingVariant = the ref pinned a variant that no longer exists. Outbound
 * senders must SKIP these (never default-fallback — the operator approved a
 * concrete price; see product-ref.mjs).
 */
export interface ResolvedSelection {
  ref: string;
  product: Product;
  variant: ProductVariant | null;
  missingVariant: boolean;
  available: boolean;
  display: Product | null;
}

/** Flat variant-projection of a product (see ResolvedSelection.display). */
export function projectVariant(product: Product, variant: ProductVariant | null): Product {
  if (!variant) return product;
  const url = variantPdpUrl(product, variant) ?? product.shopifyUrl;
  return {
    ...product,
    name: variantDisplayName(product, variant) || product.name,
    price: variant.price,
    ...(typeof variant.salePrice === "number"
      ? { salePrice: variant.salePrice }
      : { salePrice: undefined }),
    ...(variant.sku ? { sku: variant.sku } : {}),
    ...(variant.barcode ? { barcode: variant.barcode } : {}),
    ...(variant.id ? { shopifyVariantId: variant.id } : {}),
    ...(variant.cartUrl ? { shopifyCartUrl: variant.cartUrl } : {}),
    shopifyUrl: url,
    inStock: isVariantAvailable(product, variant),
  };
}

/**
 * Resolve a list of refs (or bare ids) against the catalog. Unknown products
 * are dropped; refs whose pinned variant vanished are KEPT but flagged
 * (missingVariant, display=null) so callers can hard-block or surface them.
 * Order is preserved.
 */
export async function resolveProductSelections(refs: string[]): Promise<ResolvedSelection[]> {
  const catalog = await loadProductCatalog();
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const out: ResolvedSelection[] = [];
  for (const ref of refs) {
    const resolved = resolveProductRef(byId, ref) as {
      product: Product;
      variant: ProductVariant | null;
      missingVariant: boolean;
    } | null;
    if (!resolved) continue;
    const { product, variant, missingVariant } = resolved;
    out.push({
      ref: String(ref),
      product,
      variant,
      missingVariant,
      available: !missingVariant && isVariantAvailable(product, variant),
      display: missingVariant ? null : projectVariant(product, variant),
    });
  }
  return out;
}
