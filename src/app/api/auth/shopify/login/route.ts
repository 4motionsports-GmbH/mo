// GET /api/auth/shopify/login?session=<session_id>&return_url=<url>&prompt=none
//
// Step 1 of the Customer Account sign-in (PKCE authorization-code flow). The
// widget points the TOP-LEVEL window here (a full-page navigation, not an XHR),
// so there is no CORS/secret guard — it is protected by the signed `state` and
// the server-side pending record instead, exactly like the email-clicked
// confirm/unsubscribe routes.
//
// It mints a PKCE verifier + nonce + signed state, stores a short-lived
// pending-auth record (session_id + verifier + nonce + return_url), and 302s the
// browser to Shopify's discovered authorization endpoint. Pass `prompt=none` for
// silent already-signed-in detection (returns a code with no UI when a
// storefront session exists, else error=login_required at the callback).
//
// All redirect/callback URLs are built from PUBLIC_BASE_URL — never hardcoded —
// so the later DNS cutover is just an env flip.

import { getAllowedOrigins } from "@/lib/security";
import { reportError } from "@/lib/observability";
import {
  buildAuthorizationUrl,
  customerAccountRedirectUri,
  isCustomerAccountConfigured,
  authStateSecret,
  pendingAuthTtlMinutes,
} from "@/lib/shopify-customer-account";
import { createPendingAuth } from "@/lib/customer-oauth-store";
import {
  generateCodeVerifier,
  randomToken,
  signState,
  safeReturnUrl,
} from "@/lib/customer-account-oauth.mjs";

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
  const promptNone = url.searchParams.get("prompt") === "none";

  // Validate the return target against the storefront origin allowlist (open
  // redirect guard). Default to the storefront root when absent/invalid.
  const allowed = getAllowedOrigins();
  const returnUrl =
    safeReturnUrl(url.searchParams.get("return_url"), allowed) ??
    `${allowed[0] ?? "https://www.motionsports.de"}/`;

  try {
    if (!isCustomerAccountConfigured()) {
      return new Response("Customer Account sign-in is not configured", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (!sessionId) {
      return new Response("Missing session", {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const secret = authStateSecret();
    if (!secret) {
      return new Response("Auth state secret not configured", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const codeVerifier = generateCodeVerifier();
    const nonce = randomToken();
    const stateRandom = randomToken();
    const signedState = signState(stateRandom, secret);

    const stored = await createPendingAuth({
      state: stateRandom,
      sessionId,
      codeVerifier,
      nonce,
      returnUrl,
      promptNone,
      ttlMinutes: pendingAuthTtlMinutes(),
    });
    if (!stored) {
      return new Response("Could not start sign-in (no store available)", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const authUrl = await buildAuthorizationUrl({
      state: signedState,
      nonce,
      codeVerifier,
      redirectUri: customerAccountRedirectUri(req),
      promptNone,
    });
    return redirect(authUrl);
  } catch (err) {
    reportError(err, { route: "api/auth/shopify/login" });
    // Fail back to the storefront rather than showing a backend error page.
    return redirect(returnUrl);
  }
}
