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
  // product has no resolvable numeric variant id, so the widget can degrade
  // gracefully instead of linking to a broken cart.
  shopifyCartUrl?: string;
  inStock: boolean;
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
    ...(p.shopifyCartUrl ? { shopifyCartUrl: p.shopifyCartUrl } : {}),
    inStock: p.inStock,
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

    return new Response(JSON.stringify({ products }), {
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
