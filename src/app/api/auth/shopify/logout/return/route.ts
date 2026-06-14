// GET /api/auth/shopify/logout/return — the registered Customer Account Logout
// URI. Shopify redirects the TOP-LEVEL window here after end_session at its
// managed auth subdomain. Top-level navigation → no CORS/secret guard.
//
// We optionally drop the server-side tokens for the session (so the next
// /api/auth/me reports signed-out), then bounce the browser back to the
// storefront. We do NOT clear the IDENTITY linkage (the customer row / its
// history stays — logging out ends the SESSION, not the account).
//
// The widget initiates logout by sending the browser to Shopify's
// end_session_endpoint with post_logout_redirect_uri = this route.

import { reportError } from "@/lib/observability";
import { getAllowedOrigins } from "@/lib/security";
import { resolveSignedInCustomer } from "@/lib/customer-store";
import { deleteCustomerTokens } from "@/lib/customer-oauth-store";
import { safeReturnUrl } from "@/lib/customer-account-oauth.mjs";

export const runtime = "nodejs";
export const maxDuration = 15;

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = (url.searchParams.get("session") ?? "").trim();
  const allowed = getAllowedOrigins();
  const returnUrl =
    safeReturnUrl(url.searchParams.get("return_url"), allowed) ??
    `${allowed[0] ?? "https://www.motionsports.de"}/`;

  try {
    if (sessionId) {
      const resolved = await resolveSignedInCustomer(sessionId);
      if (resolved) await deleteCustomerTokens(resolved.customerId);
    }
  } catch (err) {
    reportError(err, { route: "api/auth/shopify/logout/return" });
  }

  try {
    const u = new URL(returnUrl);
    u.searchParams.set("ms_auth", "logged_out");
    return redirect(u.toString());
  } catch {
    return redirect(returnUrl);
  }
}
