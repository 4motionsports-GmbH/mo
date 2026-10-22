// Public assortment of the Home-Gym-Konfigurator (docs/CONFIGURATOR.md §4).
//
// The configurator page's „+ Produkt hinzufügen“ lists the curated assortment
// (the Shopify tag of the settings plus the extra handles) so a visitor can
// put a product into the plan himself. Public storefront fields only (same
// guardrails as /api/products: origin allowlist + rate limit, no secret); the
// widget hydrates a picked product through /api/products as usual. Empty
// when the configurator is switched off in the admin.

import { corsHeaders, guardOriginOnly, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { getCachedConfiguratorSettings, loadConfiguratorAssortment } from "@/lib/configurator-store";
import { assortmentCards } from "@/lib/configurator-core.mjs";

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
    const rl = await checkRateLimit(req, "products");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);

    const settings = await getCachedConfiguratorSettings();
    const products = settings.enabled
      ? assortmentCards((await loadConfiguratorAssortment(settings)).products)
      : [];

    return new Response(JSON.stringify({ ok: true, products }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
        ...cors,
      },
    });
  } catch (err) {
    reportError(err, { route: "api/configurator/assortment" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
