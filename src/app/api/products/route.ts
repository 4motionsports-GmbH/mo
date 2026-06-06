// Public product hydration endpoint.
//
// The vanilla-JS Shopify widget can't import the catalog directly the way the
// old React app did. When the chat stream emits show_product /
// compare_products / add_to_cart / suggest_showroom / show_contact_form tool
// calls, the widget calls this route with the product ids to hydrate the
// cards. Returns only public fields already visible on the storefront, so
// no shared-secret auth is required — origin allowlist + rate limit are the
// guardrails.

import {
  corsHeaders,
  guardOriginOnly,
  preflightResponse,
} from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { loadProductCatalog } from "@/lib/catalog-store";
import { buildPrefilledCartUrl } from "@/lib/cart";
import type { Product } from "@/lib/types";

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
}

function toPublic(p: Product): PublicProduct {
  return {
    id: p.id,
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
    ...(p.shopifyCartUrl && p.inStock ? { shopifyCartUrl: p.shopifyCartUrl } : {}),
    inStock: p.inStock,
    ...(typeof p.inventoryQuantity === "number" ? { inventoryQuantity: p.inventoryQuantity } : {}),
    ...(typeof p.anyVariantAvailable === "boolean" ? { anyVariantAvailable: p.anyVariantAvailable } : {}),
    deliveryTime: p.deliveryTime,
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

    const catalog = await loadProductCatalog();
    const byId = new Map(catalog.map((p) => [p.id, p]));
    // Preserve request order and represent unknown ids as null entries so
    // the widget can render partial results without a 404.
    const products = ids.map((id) => {
      const p = byId.get(id);
      return p ? toPublic(p) : null;
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
    const cartUrl = buildPrefilledCartUrl(ids, byId, { excludeSoldOut: true }).url;

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
