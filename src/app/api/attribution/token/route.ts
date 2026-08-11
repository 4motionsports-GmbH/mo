// POST /api/attribution/token — mint (or reuse) the session's cart-stamp
// attribution token for the widget.
//
// The widget calls this once per session (after the storefront's consent
// state allows analytics — the CONSENT GATE FOR STAMPING LIVES IN THE WIDGET,
// see docs/ORDER_ATTRIBUTION.md §widget) and then stamps the LIVE storefront
// cart via a same-origin POST /cart/update.js with the returned attributes.
// From then on, whatever ends up in that cart — Mo's card checkout or a
// manually searched product — the resulting order carries the marker and the
// orders webhook can attribute it (tier assisted/influenced).
//
// Guards mirror /api/capture-email (origin allowlist + shared secret +
// session header): the token feeds a revenue KPI, so unlike /api/kpi it is
// NOT an unauthenticated fire-and-forget surface.
//
// Response: { ok, token, cartAttributes } where cartAttributes is the exact
// `attributes` object to pass to /cart/update.js.

import {
  corsHeaders,
  guardRequest,
  preflightResponse,
} from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { isDbConfigured } from "@/lib/db";
import { mintAttributionToken } from "@/lib/mo-orders-store";
import { MO_CART_ATTRIBUTE } from "@/lib/order-attribution.mjs";

export const maxDuration = 10;

const ALLOWED_METHODS = "POST, OPTIONS";
const MAX_SESSION_CHARS = 128;

export async function OPTIONS(req: Request) {
  return preflightResponse(req, ALLOWED_METHODS);
}

export async function POST(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, ALLOWED_METHODS);

  try {
    const rl = await checkRateLimit(req, "kpi");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);

    const sessionId =
      req.headers.get("x-ms-session")?.trim().slice(0, MAX_SESSION_CHARS) || null;
    if (!sessionId) {
      return errorResponse("bad_request", "Missing x-ms-session header", 400, cors);
    }
    if (!isDbConfigured()) {
      return errorResponse("upstream_unavailable", "No database configured", 503, cors);
    }

    const token = await mintAttributionToken(sessionId, "widget");
    if (!token) {
      return errorResponse("upstream_unavailable", "Could not mint token", 503, cors);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        token,
        cartAttributes: { [MO_CART_ATTRIBUTE]: token },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...cors,
        },
      }
    );
  } catch (err) {
    reportError(err, { route: "api/attribution/token" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
