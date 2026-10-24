// Public „Konfigurator-Rabatt“ of the Home-Gym-Konfigurator
// (docs/CONFIGURATOR.md §5, docs/frontend/API_CONTRACT.md §3c).
//
// The configurator page fetches it once on load: `offer: null` while the
// discount is off (the default), past its „Gültig bis“ day (Europe/Berlin) or
// the guided consultation is switched off in the admin, else the code with its title, text, terms and when the page shows
// the pop-up (configurator-core configuratorOffer). Public storefront data
// only (the code is meant to be shown to every visitor of the page): origin
// allowlist + the `products` rate limit, no secret, like the assortment route.
// A save in the admin reaches it within the settings cache (60 s per
// instance) plus the response's max-age.

import { corsHeaders, guardOriginOnly, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { getCachedConfiguratorSettings } from "@/lib/configurator-store";
import { configuratorOffer } from "@/lib/configurator-core.mjs";

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

    const offer = configuratorOffer(await getCachedConfiguratorSettings());

    return new Response(JSON.stringify({ ok: true, offer }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
        ...cors,
      },
    });
  } catch (err) {
    reportError(err, { route: "api/configurator/offer" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
