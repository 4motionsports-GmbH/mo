// GET /api/auth/shopify/logout?session=<session_id>&return_url=<url>
//
// Server-INITIATED logout, mirroring /api/auth/shopify/login. The widget points
// the TOP-LEVEL window here (a full-page navigation, not an XHR), so there is no
// CORS/secret guard — the open-redirect allowlist on return_url is the
// protection, exactly like login and the email-clicked routes.
//
// The widget cannot build Shopify's OIDC end_session URL itself (it never sees
// discovery metadata or tokens), so we resolve it from discovery and 302 the
// browser to Shopify's end_session_endpoint with post_logout_redirect_uri =
// /api/auth/shopify/logout/return (carrying the session + return_url). Shopify
// ends its session and bounces back there, which drops our server-side tokens
// and returns the browser to the storefront with ?ms_auth=logged_out.
//
// DEGRADED FALLBACK: if the store doesn't advertise an end_session_endpoint, we
// skip Shopify and redirect straight to the logout-return route — a LOCAL
// sign-out (our tokens dropped, signed-in UI cleared) with no Shopify round-trip
// and no functional loss for the widget.
//
// Logout ends the SESSION, not the account: the customer row + history stay
// (full erasure is the distinct POST /api/account/erase).

import { reportError } from "@/lib/observability";
import { getAllowedOrigins } from "@/lib/security";
import {
  buildEndSessionUrl,
  customerAccountLogoutReturnUri,
} from "@/lib/shopify-customer-account";
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

  // Our registered Logout URI, carrying the session + storefront target so it
  // can drop the tokens and bounce the browser back with ?ms_auth=logged_out.
  const logoutReturn = new URL(customerAccountLogoutReturnUri(req));
  if (sessionId) logoutReturn.searchParams.set("session", sessionId);
  logoutReturn.searchParams.set("return_url", returnUrl);
  const postLogoutRedirectUri = logoutReturn.toString();

  try {
    const endSessionUrl = await buildEndSessionUrl({ postLogoutRedirectUri });
    // No Shopify end_session advertised → degrade to a local sign-out (the
    // logout-return route drops the tokens and bounces). Still fully functional.
    return redirect(endSessionUrl ?? postLogoutRedirectUri);
  } catch (err) {
    reportError(err, { route: "api/auth/shopify/logout" });
    // On any failure, still complete a local sign-out rather than stranding the
    // user — the logout-return route is self-contained and safe.
    return redirect(postLogoutRedirectUri);
  }
}
