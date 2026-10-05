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
// and docs/frontend/ACCOUNT_CONTRACT.md §3a:
//   1. Add an App Proxy to the app (Shopify admin → app → App proxy):
//        Subpath prefix: apps   Subpath: chat   URL: https://mo.motionsports.de/api/auth/storefront
//      (Shopify appends the sub-path, so /apps/chat/whoami lands on ./whoami — same handler)
//   2. The theme calls the proxied path (same-origin) with ?session=<widget sid>.
//   3. Set SHOPIFY_APP_PROXY_SECRET (the app's API secret key) — falls back to
//      SHOPIFY_CLIENT_SECRET. The spike flagged `logged_in_customer_id` as
//      historically unreliable on NEW customer accounts; re-verify on the live
//      store. Either way this endpoint FAILS CLOSED (no valid signature / no id →
//      signedIn:false), and the chatbot-OAuth "Anmelden" remains the fallback.
//
// Auth model: NOT origin/secret-guarded (the request is server-to-server FROM
// Shopify, no Origin / x-ms-chat-key). The App Proxy HMAC signature IS the auth,
// and it must be FRESH (Shopify's signed `timestamp` within 5 minutes) so a
// signed URL cannot be replayed. Fail-closed: anything we can't positively
// prove returns { signedIn: false }. Tokens never appear here.
//
// P0.3 (docs/archive/plans-2026-10-04/P0.3.md): a code is issued only when the session
// will really count as signed in — APP_PROXY_SIGNIN_ENABLED (kill switch) and a
// proof (a live chat token, or the shop proof under
// APP_PROXY_SIGNIN_MAX_AGE_HOURS). If the session is signed in as ANOTHER shop
// customer (a shared browser), that link ends and no code is issued (handover).
// Every recognised request records account_shop_recognised (measurement).

import { reportError } from "@/lib/observability";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { appProxyFailureKind, evaluateAppProxyAuth } from "@/lib/shopify-app-proxy.mjs";
import { fetchAdminCustomerById } from "@/lib/shopify-orders";
import { bindShopifyIdentity } from "@/lib/customer-store";
import {
  currentSignedInLink,
  endAppProxySessionLink,
  endSessionSignedInLink,
  mintSessionLinkGrant,
} from "@/lib/session-link-grants";
import { findChatTokenCustomer, getValidAccessToken } from "@/lib/customer-oauth-store";
import { appProxyShopProofHours, isAppProxySigninEnabled } from "@/lib/platform-flags.mjs";
import { decideShopRecognition } from "@/lib/signed-in-proof.mjs";
import { recordKpiEvent, KPI_ACCOUNT_SHOP_RECOGNISED } from "@/lib/kpi-events";
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

// At most one report per failure kind per instance every 10 minutes; never
// the URL or the query (they carry the customer id, session and signature).
const lastReported = new Map<string, number>();
function reportSignatureFailure(kind: string): void {
  const now = Date.now();
  if (now - (lastReported.get(kind) ?? 0) < 10 * 60_000) return;
  lastReported.set(kind, now);
  reportError(new Error(`App Proxy signature ${kind}`), { route: "api/auth/storefront", phase: kind });
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

    // 1) Verify the App Proxy signature AND its freshness (replay), then read
    //    the Shopify-vouched customer id. Fail-closed: a bad, unsigned or
    //    stale request → not signed in, and it never ends or creates a link.
    //    NO Admin API / DB work happens until this passes.
    const failure = appProxyFailureKind(url.searchParams, appProxySecret(), Date.now());
    if (failure) {
      if (failure !== "unsigned") reportSignatureFailure(failure);
      return json({ signedIn: false });
    }
    const auth = evaluateAppProxyAuth(url.searchParams, appProxySecret());
    if (!auth.ok) {
      // Shopify vouches that this browser is logged OUT of the shop: the
      // session's App Proxy link ends with it (a shop logout signs the chat out).
      if (auth.reason === "not_logged_in") await endAppProxySessionLink(auth.sessionId);
      return json({ signedIn: false });
    }

    // Per-customer rate limit (the request carries no x-ms-session header — key
    // on the widget session, else the customer id) so a single signed-in session
    // can't hammer the Admin API behind a valid signature.
    const rlReq = new Request(req.url, {
      headers: { "x-ms-session": auth.sessionId ?? `cid:${auth.shopifyCustomerId}` },
    });
    const rl = await checkRateLimit(rlReq, "chat");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    // No session → no code possible and nothing to key a measurement on.
    if (!auth.sessionId) return json({ signedIn: false });
    const sessionId = auth.sessionId;

    // 1b) Decide (P0.3): handover, kill switch, proof. Two cheap reads; the
    //     exact token check (refresh) runs only when it decides a code.
    const [current, token] = await Promise.all([
      currentSignedInLink(sessionId),
      findChatTokenCustomer(auth.shopifyCustomerId),
    ]);
    const hours = appProxyShopProofHours();
    const flagOn = isAppProxySigninEnabled();
    const otherCustomerLinked =
      current != null && current.shopifyCustomerId !== auth.shopifyCustomerId;
    const liveToken =
      flagOn && hours === 0 && token.hasToken && token.customerId != null && !otherCustomerLinked
        ? (await getValidAccessToken(token.customerId)) != null
        : token.hasToken;
    const d = decideShopRecognition({
      flagOn,
      shopProofHours: hours,
      hasToken: token.hasToken,
      liveToken,
      linkedShopifyCustomerId: current?.shopifyCustomerId ?? null,
      shopifyCustomerId: auth.shopifyCustomerId,
    });
    const recognised = (codeIssued: boolean, noCode: string | null) =>
      recordKpiEvent({
        sessionId,
        event: KPI_ACCOUNT_SHOP_RECOGNISED,
        data: {
          proof: d.proof,
          hasToken: d.hasToken,
          alreadySignedIn: d.alreadySignedIn,
          codeIssued,
          ...(noCode ? { noCode } : {}),
        },
      });
    if (d.action === "handover") {
      // Another shop customer is signed in to this chat session (shared
      // browser): end that link, issue no code. /api/auth/me then answers
      // signed-out and the widget wipes its transcript and rotates the
      // session; the next tab links the new person on a fresh session.
      await endSessionSignedInLink(sessionId);
      await recognised(false, "handover");
      return json({ signedIn: false });
    }
    if (d.action === "no_code") {
      await recognised(false, d.noCode);
      return json({ signedIn: false });
    }

    // 2) Enrich IDENTITY → name + verified email via the Admin API (read_customers).
    //    No customer token is involved (shop-native login). Best-effort: a degraded
    //    name still reports signed-in.
    const identity = await fetchAdminCustomerById(auth.shopifyCustomerId);
    const name = identity ? displayNameOf(identity) : null;
    const gid = identity?.gid ?? `gid://shopify/Customer/${auth.shopifyCustomerId}`;

    // 3) Find-or-create the customer row (the same merge the chatbot-OAuth
    //    callback uses) and mint a one-time link code for the widget session.
    //    The session is NOT linked here: `session` is a URL parameter anyone can
    //    set, so a stranger could make a logged-in shopper's browser call
    //    whoami?session=<stranger's session>. The code travels only in this
    //    same-origin response to the shopper's own page; the widget redeems it
    //    at POST /api/auth/link with its x-ms-session (migration 0073).
    //    No code (a DB miss) → {signedIn:false}: signedIn:true always carries a code.
    let customerId: number | null = null;
    let linkCode: string | null = null;
    try {
      const bind = await bindShopifyIdentity({
        shopifyCustomerId: auth.shopifyCustomerId,
        shopifyCustomerGid: gid,
        email: identity?.email ?? null,
        sessionId,
      });
      customerId = bind?.customerId ?? null;
      if (customerId != null) {
        linkCode = await mintSessionLinkGrant({ sessionId, customerId, kind: "app_proxy" });
      }
    } catch (err) {
      reportError(err, { route: "api/auth/storefront", phase: "bind" });
    }
    if (linkCode == null) {
      await recognised(false, "failed");
      return json({ signedIn: false });
    }
    await recognised(true, null);

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
      // Redeem at POST /api/auth/link (x-ms-session) — until then the session
      // has no history, export or signed-in chat context.
      linkCode,
    });
  } catch (err) {
    reportError(err, { route: "api/auth/storefront" });
    return json({ signedIn: false });
  }
}
