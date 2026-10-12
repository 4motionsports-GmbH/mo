// The card-facing shape of one recommended product — shared by the Kampagne
// screen loader (KampagneTab), the draft route and the recommendations route,
// so the review desk sees the same fields (name, link, image, price, stock)
// whether the list came with the page or from a patch after a regenerate.

import type { ResolvedSelection } from "./product-catalog";
import { firstProductImageUrl } from "./email-products";
import { effectiveVariantPrice, isVariantRef } from "./product-ref.mjs";
import { recommendationStock } from "./stock-level.mjs";

export interface CampaignRecommendationView {
  /** The stored ref — a bare catalog id or a variant-pinned "handle~variantId". */
  id: string;
  name: string;
  url: string | null;
  imageUrl: string | null;
  /** The price the mail shows (sale price when there is one), EUR — also the
   *  unit price a set built from this ref snapshots. */
  price: number | null;
  /** null = the ref could not be resolved against the current catalog (the
   *  product is gone, or its pinned variant is). */
  available: boolean | null;
  /** Units in stock to show next to the row, or null when unknown / not
   *  tracked (stock-level.mjs). For a bare ref of a multi-variant product it
   *  is the product total (`stockScope: "product"`). */
  stock: number | null;
  stockScope: "variant" | "product";
  /** Units of the variant a set would use (pinned, else default) — the set
   *  dialog caps its count with it. null = unknown. */
  unitStock: number | null;
}

/**
 * Project a resolved selection (variant-aware) into the view. An unresolved
 * ref keeps its id as the name so the operator can still remove it.
 */
export function recommendationView(
  ref: string,
  selection: ResolvedSelection | undefined
): CampaignRecommendationView {
  const product = selection?.display ?? selection?.product ?? null;
  const resolved = selection && !selection.missingVariant ? selection : null;
  const stock = resolved
    ? recommendationStock(resolved.product, resolved.variant, { pinned: isVariantRef(ref) })
    : { stock: null, stockScope: "variant" as const, unitStock: null };
  return {
    id: ref,
    name: product?.name ?? ref,
    url: product?.shopifyUrl ?? null,
    imageUrl: firstProductImageUrl(product),
    // Same rule as the set snapshot (effectiveVariantPrice): a sale price
    // counts only when it is a real, positive amount.
    price: resolved ? effectiveVariantPrice(resolved.display ?? resolved.product) : null,
    available: resolved ? resolved.available : null,
    stock: stock.stock,
    stockScope: stock.stockScope,
    unitStock: stock.unitStock,
  };
}
