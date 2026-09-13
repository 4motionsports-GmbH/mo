// The card-facing shape of one recommended product — shared by the Kampagne
// screen loader (KampagneTab), the draft route and the recommendations route,
// so the review desk sees the same fields (name, link, image, price, stock)
// whether the list came with the page or from a patch after a regenerate.

import type { ResolvedSelection } from "./product-catalog";
import { firstProductImageUrl } from "./email-products";

export interface CampaignRecommendationView {
  /** The stored ref — a bare catalog id or a variant-pinned "handle~variantId". */
  id: string;
  name: string;
  url: string | null;
  imageUrl: string | null;
  /** The price the mail shows (sale price when there is one), EUR. */
  price: number | null;
  /** null = the ref could not be resolved against the current catalog. */
  available: boolean | null;
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
  return {
    id: ref,
    name: product?.name ?? ref,
    url: product?.shopifyUrl ?? null,
    imageUrl: firstProductImageUrl(product),
    price: product ? (typeof product.salePrice === "number" ? product.salePrice : product.price) : null,
    available: selection ? selection.available : null,
  };
}
