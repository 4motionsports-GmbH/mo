// GET /api/auth/me?session=<session_id> — widget identity re-hydration.
//
// Called by the widget (cross-origin XHR) on load / after the sign-in redirect
// to learn whether the current localStorage session is linked to a signed-in
// Shopify customer, and to get a display name + tier. Guarded by the origin
// allowlist + shared secret like the other widget endpoints.
//
// Fail-closed: anything we can't positively prove returns { signedIn: false }.
// Tokens NEVER appear in the response — only the resolved name + tier. The name
// is read LIVE from Shopify (authoritative) via the server-held access token, so
// we don't cache customer PII names locally for tier 3 in CA-1.

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import { resolveSignedInCustomer } from "@/lib/customer-store";
import { getValidAccessToken } from "@/lib/customer-oauth-store";
import { fetchCustomerIdentity } from "@/lib/shopify-customer-account";
import { fetchAdminCustomerById } from "@/lib/shopify-orders";
import { displayNameOf, resolveMarketingOptInState } from "@/lib/signed-in-identity";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function OPTIONS(req: Request) {
  return preflightResponse(req, "GET, OPTIONS");
}

function json(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export async function GET(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const headers = corsHeaders(guard.origin, "GET, OPTIONS");

  try {
    const rl = await checkRateLimit(req, "chat");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, headers);

    const url = new URL(req.url);
    const sessionId =
      (url.searchParams.get("session") ?? "").trim() || req.headers.get("x-ms-session");

    const resolved = await resolveSignedInCustomer(sessionId ?? null);
    if (!resolved) return json({ signedIn: false }, headers);

    // Prove the session is still live by obtaining a valid access token
    // (refreshing if needed). No valid token → fail closed (re-auth required).
    const token = await getValidAccessToken(resolved.customerId);
    if (!token) return json({ signedIn: false }, headers);

    let name: string | null = null;
    try {
      const identity = await fetchCustomerIdentity(token);
      if (identity) name = displayNameOf(identity);
    } catch (err) {
      // Identity read failed but the linkage + token are valid — still report
      // signed-in (degraded name) rather than logging the user out.
      reportError(err, { route: "api/auth/me", phase: "fetchIdentity" });
    }

    // Name fallback via the Admin API (read_customers): if the Customer-Account
    // identity read came back empty (CA schema drift, etc.), resolve the name from
    // the same authoritative source the shop-native detection uses, keyed by the
    // resolved shopify_customer_id. Best-effort — never downgrades signed-in.
    if (!name && resolved.shopifyCustomerId) {
      try {
        const admin = await fetchAdminCustomerById(resolved.shopifyCustomerId);
        if (admin) name = displayNameOf(admin);
      } catch (err) {
        reportError(err, { route: "api/auth/me", phase: "adminIdentity" });
      }
    }

    // At-sign-in marketing opt-in state (CA-4) — the SHARED contract (the widget
    // gates its opt-in card on `optInActionable`). Identical rule on the
    // shop-native detection path; see lib/signed-in-identity.
    const marketing = await resolveMarketingOptInState(resolved.customerId, "api/auth/me");

    return json(
      {
        signedIn: true,
        identity: { name, tier: resolved.tier },
        marketing,
      },
      headers
    );
  } catch (err) {
    reportError(err, { route: "api/auth/me" });
    return json({ signedIn: false }, headers);
  }
}
