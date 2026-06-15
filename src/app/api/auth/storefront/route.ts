// GET /api/auth/storefront — shop-native already-signed-in detection via a
// Shopify APP PROXY (docs/CUSTOMER_ACCOUNT.md §3a).
//
// THE BUG this fixes: a customer who logs in through the SHOP'S OWN login (the
// storefront account icon) — not the chatbot's "Anmelden" — opens the chat and
// still sees login buttons; their name never shows. The widget sits in the theme
// (motionsports.de) and the backend is cross-origin on Vercel, so the backend
// cannot read the storefront session cookie and could only ever recognise the
// CHATBOT-OAuth path. (/api/auth/me resolves a session only when the chatbot OAuth
// linked it + holds a token.)
//
// THE FIX (login-path-agnostic): Shopify's App Proxy forwards a SAME-ORIGIN
// storefront call (https://www.motionsports.de/apps/<proxy>/whoami?session=<sid>)
// to this route, ADDING `logged_in_customer_id` (the LIVE storefront session's
// customer — present regardless of how they logged in) and an HMAC `signature`
// over all params. We verify the signature, trust ONLY Shopify's
// `logged_in_customer_id`, and — now that read_customers is granted — enrich the
// name via the Admin API (no customer token needed). Detection therefore needs
// only to establish IDENTITY; the Admin API supplies the rest.
//
// ⚠️ REQUIRES A STORE / THEME ACTION (Lucas) before it can fire — see the report
// and docs/frontend-handoff/CUSTOMER_ACCOUNT.md §3a:
//   1. Add an App Proxy to the app (Shopify admin → app → App proxy):
//        Subpath prefix: apps   Subpath: chat   URL: https://chat.motionsports.de/api/auth/storefront
//   2. The theme calls the proxied path (same-origin) with ?session=<widget sid>.
//   3. Set SHOPIFY_APP_PROXY_SECRET (the app's API secret key) — falls back to
//      SHOPIFY_CLIENT_SECRET. The spike flagged `logged_in_customer_id` as
//      historically unreliable on NEW customer accounts; re-verify on the live
//      store. Either way this endpoint FAILS CLOSED (no valid signature / no id →
//      signedIn:false), and the chatbot-OAuth "Anmelden" remains the fallback.
//
// Auth model: NOT origin/secret-guarded (the request is server-to-server FROM
// Shopify, no Origin / x-ms-chat-key). The App Proxy HMAC signature IS the auth.
// Fail-closed: anything we can't positively prove returns { signedIn: false }.
// Tokens never appear here (there are none — this is the no-token path).

import { reportError } from "@/lib/observability";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { evaluateAppProxyAuth } from "@/lib/shopify-app-proxy.mjs";
import { fetchAdminCustomerById } from "@/lib/shopify-orders";
import { bindShopifyIdentity } from "@/lib/customer-store";
import {
  displayNameOf,
  resolveMarketingOptInState,
  type MarketingOptInState,
} from "@/lib/signed-in-identity";

export const runtime = "nodejs";
export const maxDuration = 15;

/** The app's API secret key — what Shopify signs App Proxy requests with. */
function appProxySecret(): string | null {
  const v =
    process.env.SHOPIFY_APP_PROXY_SECRET?.trim() || process.env.SHOPIFY_CLIENT_SECRET?.trim();
  return v || null;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // 1) Verify the App Proxy signature + read the Shopify-vouched customer id.
    //    Fail-closed: a bad signature or a logged-out (empty id) session → not
    //    signed in. NO Admin API / DB work happens until this passes.
    const auth = evaluateAppProxyAuth(url.searchParams, appProxySecret());
    if (!auth.ok) return json({ signedIn: false });

    // Per-customer rate limit (the request carries no x-ms-session header — key
    // on the widget session, else the customer id) so a single signed-in session
    // can't hammer the Admin API behind a valid signature.
    const rlReq = new Request(req.url, {
      headers: { "x-ms-session": auth.sessionId ?? `cid:${auth.shopifyCustomerId}` },
    });
    const rl = await checkRateLimit(rlReq, "chat");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    // 2) Enrich IDENTITY → name + verified email via the Admin API (read_customers).
    //    No customer token is involved (shop-native login). Best-effort: a degraded
    //    name still reports signed-in.
    const identity = await fetchAdminCustomerById(auth.shopifyCustomerId);
    const name = identity ? displayNameOf(identity) : null;
    const gid = identity?.gid ?? `gid://shopify/Customer/${auth.shopifyCustomerId}`;

    // 3) Find-or-create the customer row + LINK the widget session (so /api/account/*
    //    history resolves), reusing the same merge the chatbot-OAuth callback uses.
    //    Best-effort — a DB miss degrades to "signed-in, no history", never an error.
    let customerId: number | null = null;
    try {
      const bind = await bindShopifyIdentity({
        shopifyCustomerId: auth.shopifyCustomerId,
        shopifyCustomerGid: gid,
        email: identity?.email ?? null,
        sessionId: auth.sessionId,
      });
      customerId = bind?.customerId ?? null;
    } catch (err) {
      reportError(err, { route: "api/auth/storefront", phase: "bind" });
    }

    // 4) At-sign-in marketing opt-in state — the SAME shared contract as
    //    /api/auth/me (lib/signed-in-identity), so the opt-in card never diverges
    //    between the shop-native and chatbot detection paths.
    const marketing: MarketingOptInState =
      customerId != null
        ? await resolveMarketingOptInState(customerId, "api/auth/storefront")
        : { status: "none", optInActionable: false };

    // Response: nested `identity` (drop-in compatible with /api/auth/me, which the
    // widget already parses) PLUS the flat fields the detection contract names
    // (name / tier / shopify_customer_id), so it satisfies both.
    return json({
      signedIn: true,
      name,
      tier: 3,
      shopify_customer_id: auth.shopifyCustomerId,
      identity: { name, tier: 3 },
      marketing,
    });
  } catch (err) {
    reportError(err, { route: "api/auth/storefront" });
    return json({ signedIn: false });
  }
}
