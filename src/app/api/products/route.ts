// Public product hydration endpoint.
//
// The vanilla-JS Shopify widget can't import the catalog directly the way the
// old React app did. When the chat stream emits show_product /
// compare_products / add_to_cart / suggest_showroom / show_contact_form tool
// calls, the widget calls this route with the product ids to hydrate the
// cards. Returns only public fields already visible on the storefront, so
// no shared-secret auth is required — origin allowlist + rate limit are the
// guardrails.
//
// Since 2026-10-27 every entry carries its product rules (`rules`: pairs, a
// minimum / maximum, the coverage of a floor tile — product-rules.mjs, only
// the fields that apply) and, while the showroom list is known, `showroom`
// (true / false — showroom-store); the cart permalinks use the rules' minimum
// quantity (a pair of plates → `:2`). docs/frontend/API_CONTRACT.md §3.

import {
  corsHeaders,
  guardOriginOnly,
  preflightResponse,
} from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { loadProductCatalog } from "@/lib/catalog-store";
import { buildPrefilledCartUrl } from "@/lib/cart";
import { projectVariant } from "@/lib/product-catalog";
import { publicRules, resolveProductRules } from "@/lib/product-rules.mjs";
import { buildShopifyCartUrl } from "@/lib/shopify-cart-url.mjs";
import { getCachedShowroom, type ShowroomView } from "@/lib/showroom-store";
import {
  parseProductRef,
  productVariants,
  normalizeVariantId,
  isVariantAvailable,
  effectiveVariantPrice,
} from "@/lib/product-ref.mjs";
import type { Product, ProductVariant } from "@/lib/types";

export const maxDuration = 10;

const MAX_IDS_PER_REQUEST = 10;
const ALLOWED_METHODS = "GET, OPTIONS";

export interface PublicProduct {
  id: string;
  name: string;
  slug: string;
  brand: string;
  category: string;
  series?: string;
  price: number;
  salePrice?: number;
  currency: "EUR";
  shortDescription: string;
  features: string[];
  specifications: Record<string, string | number>;
  tags: string[];
  images: string[];
  shopifyUrl: string;
  // Storefront cart permalink (`/cart/<numericVariantId>:1`). Omitted when the
  // product has no resolvable numeric variant id OR when the product is sold
  // out, so the widget can degrade gracefully instead of linking to a checkout
  // for an unavailable item.
  shopifyCartUrl?: string;
  // Stock status (sync-fresh, refreshed by the daily catalog cron — not a live
  // check). `inStock` is the headline flag the widget uses to show a subtle
  // "Ausverkauft" badge. The two optional fields carry richer signals when the
  // sync captured them.
  inStock: boolean;
  inventoryQuantity?: number;
  anyVariantAvailable?: boolean;
  deliveryTime: string;
  // Public PDP facts captured by the sync: article number, review signals.
  sku?: string;
  rating?: number;
  ratingCount?: number;
  // Published customer Q&A pairs (the PDP Q&A tab shows the same list from
  // the product's custom.qa metafield — this mirror lets the widget reuse it).
  // question/answer are German (source of truth); the En pair is present when
  // the publish-time auto-translation ran — fall back to German if absent.
  // answerHtml/answerEnHtml carry pre-rendered, escaped link HTML when the
  // answer contains a product link — render them when present, else the text.
  qa?: Array<{
    question: string;
    answer: string;
    answerHtml?: string;
    questionEn?: string;
    answerEn?: string;
    answerEnHtml?: string;
  }>;
  // ── Variants (additive; absent on pre-variant catalog data) ──
  // All sellable variants of the product. Length >= 1; single-variant products
  // carry one entry with an empty title. `cartUrl` is omitted for unavailable
  // variants (same guarantee as shopifyCartUrl above).
  variants?: Array<{
    id: string | null;
    title: string;
    sku?: string;
    price: number;
    salePrice?: number;
    available: boolean;
    cartUrl?: string;
    isDefault: boolean;
  }>;
  // Set when the request pinned a variant (?ids=handle~variantId): the flat
  // fields above (name, price, cart link, inStock) then describe THAT variant.
  selectedVariantId?: string;
  // Effective price range across variants ("ab 3,60 €" rendering).
  priceMin?: number;
  priceMax?: number;
  // Product rules (2026-10-27, product-rules.mjs publicRules): only the fields
  // that differ from „one by one“ — step (2 = pairs), min, max, coverageM2 (m²
  // one unit covers, floor tiles sized to the whole room; for a pinned variant
  // that variant's — an edge piece or connector has none). On EVERY entry:
  // `{}` = one by one, no limits; no `rules` at all = an older backend.
  rules: { step?: number; min?: number; max?: number; coverageM2?: number };
  // On display in the showroom — only while the showroom list is known
  // (absent = unknown; the widget then keeps its older showroom card).
  showroom?: boolean;
}

/**
 * Public projection. `p` is the (possibly variant-projected) product whose
 * flat fields the card shows; `base` is the underlying catalog product the
 * variant list comes from (defaults to `p`).
 */
function toPublic(
  p: Product,
  showroom: ShowroomView,
  base?: Product,
  selectedVariantId?: string,
  selectedVariant?: ProductVariant | null
): PublicProduct {
  const source = base ?? p;
  const rules = resolveProductRules(source, {
    showroomIds: showroom.known ? showroom.ids : null,
    variant: selectedVariant ?? null,
  });
  const pub = publicRules(rules);
  // A cart link carries the rules' minimum (a pair of plates → :2).
  const cartLink = (variantId: string | null | undefined, stored: string | undefined) =>
    rules.min > 1 ? (buildShopifyCartUrl(variantId ?? null, rules.min) ?? stored) : stored;
  const variants = (productVariants(source) as ProductVariant[]).map((v) => {
    const cartUrl = v.cartUrl && isVariantAvailable(source, v) ? cartLink(v.id, v.cartUrl) : undefined;
    return {
      id: v.id ?? null,
      title: v.title ?? "",
      ...(v.sku ? { sku: v.sku } : {}),
      price: v.price,
      ...(typeof v.salePrice === "number" && v.salePrice > 0 ? { salePrice: v.salePrice } : {}),
      available: isVariantAvailable(source, v),
      ...(cartUrl ? { cartUrl } : {}),
      isDefault: v.isDefault === true,
    };
  });
  const shopifyCartUrl = p.shopifyCartUrl && p.inStock ? cartLink(p.shopifyVariantId, p.shopifyCartUrl) : undefined;
  return {
    id: source.id,
    name: p.name,
    slug: p.slug,
    brand: p.brand,
    category: p.category,
    series: p.series,
    price: p.price,
    salePrice: p.salePrice,
    currency: p.currency,
    shortDescription: p.shortDescription,
    features: p.features,
    specifications: p.specifications,
    tags: p.tags,
    images: p.images,
    shopifyUrl: p.shopifyUrl,
    // Never expose a quick-checkout link for a sold-out product — that keeps a
    // sold-out item out of the checkout even at the single-product card level.
    ...(shopifyCartUrl ? { shopifyCartUrl } : {}),
    inStock: p.inStock,
    ...(typeof p.inventoryQuantity === "number" ? { inventoryQuantity: p.inventoryQuantity } : {}),
    ...(typeof p.anyVariantAvailable === "boolean" ? { anyVariantAvailable: p.anyVariantAvailable } : {}),
    deliveryTime: p.deliveryTime,
    ...(p.sku ? { sku: p.sku } : {}),
    ...(typeof p.rating === "number" ? { rating: p.rating } : {}),
    ...(typeof p.ratingCount === "number" ? { ratingCount: p.ratingCount } : {}),
    ...(p.qa?.length ? { qa: p.qa } : {}),
    ...(variants.length ? { variants } : {}),
    ...(selectedVariantId ? { selectedVariantId } : {}),
    ...(source.priceMin != null ? { priceMin: source.priceMin } : {}),
    ...(source.priceMax != null ? { priceMax: source.priceMax } : {}),
    // Always present: {} tells the widget this backend knows rules (no pair heuristic for a kettlebell).
    rules: pub ?? {},
    ...(showroom.known ? { showroom: rules.showroom } : {}),
  };
}

function parseIds(req: Request): string[] {
  const url = new URL(req.url);
  const out: string[] = [];
  for (const v of url.searchParams.getAll("ids")) {
    for (const id of v.split(",")) {
      const trimmed = id.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  for (const v of url.searchParams.getAll("id")) {
    const trimmed = v.trim();
    if (trimmed) out.push(trimmed);
  }
  // De-duplicate while preserving order.
  const seen = new Set<string>();
  return out.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req, ALLOWED_METHODS);
}

export async function GET(req: Request) {
  const guard = guardOriginOnly(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, ALLOWED_METHODS);

  try {
    const rl = await checkRateLimit(req, "products");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);

    const ids = parseIds(req);
    if (ids.length === 0) {
      return errorResponse(
        "bad_request",
        "Missing ids parameter (use ?ids=id1,id2 or repeated ?id=)",
        400,
        cors
      );
    }
    if (ids.length > MAX_IDS_PER_REQUEST) {
      return errorResponse(
        "payload_too_large",
        `Too many ids (max ${MAX_IDS_PER_REQUEST})`,
        400,
        cors
      );
    }

    const [catalog, showroom] = await Promise.all([loadProductCatalog(), getCachedShowroom()]);
    const byId = new Map(catalog.map((p) => [p.id, p]));
    // Preserve request order and represent unknown ids as null entries so
    // the widget can render partial results without a 404. An id may be a
    // variant-pinned ref ("handle~variantId") — the entry then carries the
    // CHOSEN variant in its flat fields plus selectedVariantId. A pinned
    // variant that doesn't exist is treated as unknown (null), never silently
    // downgraded to the default variant.
    const products = ids.map((id) => {
      const { productId, variantId } = parseProductRef(id);
      const p = byId.get(productId);
      if (!p) return null;
      if (variantId != null) {
        const variant =
          (productVariants(p) as ProductVariant[]).find(
            (v) => normalizeVariantId(v.id) === variantId
          ) ?? null;
        if (!variant || effectiveVariantPrice(variant) == null) return null;
        return toPublic(projectVariant(p, variant), showroom, p, variantId, variant);
      }
      return toPublic(p, showroom);
    });

    // Combined prefilled-cart permalink covering ALL requested (resolvable)
    // variants in ONE cart — built via the shared lib/cart.ts helper so the
    // single- and multi-product checkout paths can never drift apart. Lets a
    // multi-product `add_to_cart` (productIds) render a single checkout button
    // without the widget having to stitch variant ids out of per-product URLs.
    // No discount (that is marketing-only). Null when nothing resolves; for a
    // single id it equals that product's own cart permalink.
    //
    // excludeSoldOut: the quick-checkout action must NEVER contain a sold-out
    // item, so we drop them here as a hard guarantee on top of the system
    // prompt instructing Mo not to include them. Stock is sync-fresh (daily).
    //
    // quantityFor: each line carries the product rules' minimum (2026-10-27 —
    // a pair of plates goes into the checkout as 2, like the cards' links).
    const cartUrl = buildPrefilledCartUrl(ids, byId, {
      excludeSoldOut: true,
      quantityFor: (product, variant) => resolveProductRules(product, { variant }).min,
    }).url;

    return new Response(JSON.stringify({ products, cartUrl }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        ...cors,
      },
    });
  } catch (err) {
    reportError(err, { route: "api/products" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
