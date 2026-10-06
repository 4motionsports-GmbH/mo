// GET /api/auth/shopify/logout/return — the registered Customer Account Logout
// URI. Shopify redirects the TOP-LEVEL window here after end_session at its
// managed auth subdomain. Top-level navigation → no CORS/secret guard.
//
// We drop the server-side tokens and the signed-in session links (so the next
// /api/auth/me reports signed-out), then bounce the browser back to the
// storefront. The tokens are per customer, so EVERY signed-in link of that
// customer ends with them — Customer Account and App Proxy alike
// (unlinkSignedInSessions) — otherwise a later sign-in on another device
// would revive a session left behind on a shared computer (0073). The
// customer row and its history stay — logging out ends the session, not the
// account.
//
// The widget initiates logout by sending the browser to Shopify's
// end_session_endpoint with post_logout_redirect_uri = this route.

import { reportError } from "@/lib/observability";
import { getAllowedOrigins } from "@/lib/security";
import { resolveSignedInCustomer } from "@/lib/customer-store";
import { deleteCustomerTokens } from "@/lib/customer-oauth-store";
import { signOutSessionLinks } from "@/lib/session-link-grants";
import { safeReturnUrl, withAuthMarker } from "@/lib/customer-account-oauth.mjs";

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
      if (resolved) {
        await deleteCustomerTokens(resolved.customerId);
        await signOutSessionLinks({ customerId: resolved.customerId, sessionId });
      }
    }
  } catch (err) {
    reportError(err, { route: "api/auth/shopify/logout/return" });
  }

  return redirect(withAuthMarker(returnUrl, "logged_out"));
}
