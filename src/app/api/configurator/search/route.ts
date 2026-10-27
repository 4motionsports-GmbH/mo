// Whole-shop search of the Home-Gym-Konfigurator plan (docs/CONFIGURATOR.md §4).
//
// „+ Produkt hinzufügen“ in the plan searches the entire catalog, not only the
// curated assortment: a keyword match (configurator-core searchCatalogCards —
// pure, no embeddings, so a search box costs nothing per keystroke). Public
// storefront fields only, the same cards as /api/configurator/assortment
// (with `rules` on every card — `{}` = one by one — and, while the showroom
// list is known, `showroom` since 2026-10-27); origin allowlist + the
// `products` rate limit like /api/products.

import { corsHeaders, guardOriginOnly, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { loadProductCatalog } from "@/lib/catalog-store";
import { SEARCH_LIMITS, searchCatalogCards } from "@/lib/configurator-core.mjs";
import { getCachedShowroom } from "@/lib/showroom-store";

export const maxDuration = 10;

const ALLOWED_METHODS = "GET, OPTIONS";

export async function OPTIONS(req: Request) {
  return preflightResponse(req, ALLOWED_METHODS);
}

export async function GET(req: Request) {
  const guard = guardOriginOnly(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, ALLOWED_METHODS);

  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < SEARCH_LIMITS.queryMin || q.length > SEARCH_LIMITS.queryMax) {
      return errorResponse(
        "bad_request",
        `q must be ${SEARCH_LIMITS.queryMin}–${SEARCH_LIMITS.queryMax} characters`,
        400,
        cors
      );
    }
    const limitRaw = Number(url.searchParams.get("limit"));
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : SEARCH_LIMITS.defaultResults;

    const rl = await checkRateLimit(req, "products");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);

    const [catalog, showroom] = await Promise.all([loadProductCatalog(), getCachedShowroom()]);
    const products = searchCatalogCards(catalog, q, limit, {
      showroomIds: showroom.known ? showroom.ids : null,
      showroomKnown: showroom.known,
    });
    return new Response(JSON.stringify({ ok: true, products }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        ...cors,
      },
    });
  } catch (err) {
    reportError(err, { route: "api/configurator/search" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
