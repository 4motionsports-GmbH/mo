// GET /api/auth/shopify/callback?code&state[&error]
//
// Step 2 of the Customer Account sign-in. Shopify redirects the TOP-LEVEL window
// here after authentication (or immediately, for prompt=none). This route:
//   1. validates the signed `state` and consumes the single-use pending record;
//   2. exchanges the `code` (+ PKCE code_verifier) for tokens SERVER-SIDE;
//   3. verifies the id_token against the JWKS (signature + iss/aud/nonce/exp);
//   4. reads customer { id } → shopify_customer_id (keyed on the GID numeric);
//   5. runs the email↔Shopify merge and persists the encrypted tokens;
//   6. 302s the browser back to the storefront return_url with an ?ms_auth marker.
//
// Tokens NEVER reach the browser. On any error we still redirect back to the
// storefront (with ?ms_auth=error / login_required) so the widget can recover —
// we never strand the user on a backend page.

import { reportError } from "@/lib/observability";
import { getAllowedOrigins } from "@/lib/security";
import {
  exchangeAuthorizationCode,
  verifyIdToken,
  fetchCustomerIdentity,
  customerAccountRedirectUri,
  authStateSecret,
} from "@/lib/shopify-customer-account";
import { consumePendingAuth, saveCustomerTokens } from "@/lib/customer-oauth-store";
import { bindShopifyIdentity } from "@/lib/customer-store";
import { refreshSignedInCustomerCache } from "@/lib/customer-account-cache";
import { verifyState } from "@/lib/customer-account-oauth.mjs";
import { numericFromCustomerGid } from "@/lib/customer-merge.mjs";

export const runtime = "nodejs";
export const maxDuration = 30;

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

function withMarker(returnUrl: string, marker: string): string {
  try {
    const u = new URL(returnUrl);
    u.searchParams.set("ms_auth", marker);
    return u.toString();
  } catch {
    return returnUrl;
  }
}

function storefrontFallback(): string {
  const allowed = getAllowedOrigins();
  return `${allowed[0] ?? "https://www.motionsports.de"}/`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const signedState = url.searchParams.get("state") ?? "";
  const oauthError = url.searchParams.get("error");

  // Default landing if we can't recover a return_url (validated again below).
  let returnUrl = storefrontFallback();

  try {
    const secret = authStateSecret();
    const stateRandom = secret ? verifyState(signedState, secret) : null;
    if (!stateRandom) {
      // Forged/garbage state — we have no trustworthy return target.
      return redirect(withMarker(returnUrl, "error"));
    }

    // Consume the pending record (single-use). Even on an OAuth error we need it
    // to recover the return_url and whether this was a silent attempt.
    const pending = await consumePendingAuth(stateRandom);
    if (!pending) {
      return redirect(withMarker(returnUrl, "error"));
    }
    returnUrl = pending.returnUrl;

    // Shopify returned an error (commonly login_required for prompt=none when
    // logged out). Bounce back so the widget can show a one-click sign-in.
    if (oauthError) {
      const marker = oauthError === "login_required" ? "login_required" : "error";
      return redirect(withMarker(returnUrl, marker));
    }
    if (!code) {
      return redirect(withMarker(returnUrl, "error"));
    }

    // 2. Server-side token exchange (PKCE).
    const tokens = await exchangeAuthorizationCode({
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri: customerAccountRedirectUri(req),
    });

    // 3. Verify the id_token (signature + iss/aud/nonce/exp).
    let idTokenSub: string | null = null;
    if (tokens.idToken) {
      const claims = await verifyIdToken(tokens.idToken, { nonce: pending.nonce });
      idTokenSub = claims.sub;
    }

    // 4. Read the canonical customer identity (key on the GID numeric).
    const identity = await fetchCustomerIdentity(tokens.accessToken);
    if (!identity?.gid) {
      return redirect(withMarker(returnUrl, "error"));
    }
    const shopifyCustomerId = numericFromCustomerGid(identity.gid);
    if (!shopifyCustomerId) {
      return redirect(withMarker(returnUrl, "error"));
    }

    // 5. Merge (email↔shopify) + persist encrypted tokens.
    const bind = await bindShopifyIdentity({
      shopifyCustomerId,
      shopifyCustomerGid: identity.gid,
      email: identity.email,
      idTokenSub,
      sessionId: pending.sessionId,
    });
    if (!bind) {
      // Identity couldn't be stored (no DB) — still send the user back; the
      // widget degrades to anonymous rather than erroring.
      return redirect(withMarker(returnUrl, "error"));
    }

    await saveCustomerTokens(bind.customerId, tokens, idTokenSub);

    // Warm the tier-3 cache (name + address context + order history) from the
    // Customer Account API so the live chat and the marketing profile have it on
    // the very next turn. Best-effort: never block the redirect on it.
    await refreshSignedInCustomerCache(bind.customerId);

    return redirect(withMarker(returnUrl, "ok"));
  } catch (err) {
    reportError(err, { route: "api/auth/shopify/callback" });
    return redirect(withMarker(returnUrl, "error"));
  }
}
