// GET /api/auth/me?session=<session_id> — widget identity re-hydration.
//
// Called by the widget (cross-origin XHR) on load / after the sign-in redirect
// to learn whether the current localStorage session is linked to a signed-in
// Shopify customer, and to get a display name + tier. Guarded by the origin
// allowlist + shared secret like the other widget endpoints.
//
// Fail-closed: anything we can't positively prove returns { signedIn: false }.
// Tokens NEVER appear in the response — only the resolved name + tier. With a
// chat sign-in (token proof) the name is read LIVE from Shopify via the
// server-held access token; with the shop proof (App Proxy, D-AP1 — no token)
// it comes from the cached account summary or the Admin API
// (lib/signed-in-session).

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import { getCustomerById } from "@/lib/customer-store";
import { deleteCustomerTokens } from "@/lib/customer-oauth-store";
import { resolveLiveSignedInCustomer } from "@/lib/signed-in-session";
import { signOutSessionLinks } from "@/lib/session-link-grants";
import { fetchCustomerIdentity } from "@/lib/shopify-customer-account";
import { isRevokedTokenError } from "@/lib/customer-account-oauth.mjs";
import { fetchAdminCustomerById } from "@/lib/shopify-orders";
import { displayNameOf, resolveMarketingOptInState } from "@/lib/signed-in-identity";
import { recordConsentAskEligible } from "@/lib/consent-ask-kpi";
import { resolveLocale } from "@/lib/locale";

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

    // Prove the session is still live: a valid access token (refreshed if
    // needed) for a chat sign-in, or a fresh shop proof (App Proxy). Nothing
    // proven → fail closed (re-auth required).
    const resolved = await resolveLiveSignedInCustomer(sessionId ?? null);
    if ("fail" in resolved) return json({ signedIn: false }, headers);
    const token = resolved.accessToken;

    let name: string | null = null;
    if (resolved.proof === "shop") {
      try {
        const cached = await getCustomerById(resolved.customerId);
        name = cached?.shopifyAccountSummary?.displayName?.trim() || null;
      } catch (err) {
        reportError(err, { route: "api/auth/me", phase: "cachedName" });
      }
    } else if (token) {
      try {
        const identity = await fetchCustomerIdentity(token);
        if (identity) name = displayNameOf(identity);
      } catch (err) {
        // A 401 here means the access token is revoked/invalid — the customer
        // logged out of Shopify OUT-OF-BAND (our own widget logout deletes the
        // tokens, but a logout on Shopify directly never reaches us). That is an
        // authoritative "signed out": drop the dead tokens so the next call fails
        // closed at getValidAccessToken, and report signed-out NOW — do NOT fall
        // through to the Admin-API name fallback, which would mask the logout.
        if (isRevokedTokenError(err)) {
          await deleteCustomerTokens(resolved.customerId);
          await signOutSessionLinks({ customerId: resolved.customerId, sessionId: sessionId ?? null });
          return json({ signedIn: false }, headers);
        }
        // Any other error (transient 5xx / network / CA schema drift): the token
        // is still valid, so keep the user signed in with a degraded name rather
        // than logging them out over a hiccup.
        reportError(err, { route: "api/auth/me", phase: "fetchIdentity" });
      }
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
    // Welcome-voucher test (OPTIN_REWARD T6): an askable session counts once per
    // 24 h with the variant its sign-in copy assigns (x-ms-locale) — the
    // intention-to-treat base. Best-effort, never fails the answer.
    await recordConsentAskEligible({
      sessionId,
      locale: resolveLocale(req),
      optInActionable: marketing.optInActionable,
    });

    return json(
      {
        signedIn: true,
        identity: { name, tier: 3 },
        marketing,
      },
      headers
    );
  } catch (err) {
    reportError(err, { route: "api/auth/me" });
    return json({ signedIn: false }, headers);
  }
}
