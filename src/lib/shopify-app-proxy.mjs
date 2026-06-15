// Shopify App Proxy request verification — the trust anchor for shop-native
// already-signed-in detection (docs/CUSTOMER_ACCOUNT.md §3a).
//
// WHY THIS EXISTS. The chat widget lives in the theme (motionsports.de); the
// backend is cross-origin on Vercel (chat.motionsports.de). The backend therefore
// CANNOT read the storefront customer session cookie, so it cannot tell — on its
// own — whether the visitor is logged in to their Shopify account via the SHOP'S
// OWN login. The CA-3 design only ever recognised customers who signed in through
// the CHATBOT's OAuth ("Anmelden"); a shop-native login was invisible.
//
// The one mechanism where Shopify itself vouches for the logged-in customer to a
// cross-origin backend is an APP PROXY: the storefront calls a same-origin path
// (e.g. https://www.motionsports.de/apps/chat/whoami) which Shopify forwards to
// our backend, ADDING `logged_in_customer_id` (the live storefront session's
// customer) and an HMAC `signature` over all query params, keyed by the app's
// secret. We verify that signature here and trust ONLY Shopify-injected
// `logged_in_customer_id` — never a client-supplied id, which is forgeable.
//
// Signature algorithm (Shopify App Proxy — DISTINCT from the webhook/OAuth HMAC):
//   1. take every query param EXCEPT `signature`;
//   2. a repeated key's values are joined with "," ;
//   3. sort the params by key;
//   4. concatenate as `key=value` pairs with NO separator between pairs;
//   5. HMAC-SHA256 with the app secret, lower-case HEX;
//   6. constant-time compare to `signature`.
//   Ref: https://shopify.dev/docs/apps/build/online-store/display-dynamic-data#calculate-a-digital-signature
//
// Pure + dependency-light (only node:crypto) and INJECTED inputs, so the
// security-critical verification is unit-tested in isolation (shopify-app-proxy
// .test.mjs), matching the customer-account-oauth.mjs convention.

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Normalise the proxied query into a Map<key, string[]>, from either a
 * URLSearchParams (the route) or a plain object (tests). Repeated keys collect
 * all their values in order.
 * @param {URLSearchParams | Record<string, string|string[]>} query
 * @returns {Map<string,string[]>}
 */
function toMultiMap(query) {
  const map = new Map();
  const push = (k, v) => {
    const arr = map.get(k) ?? [];
    arr.push(String(v));
    map.set(k, arr);
  };
  if (query && typeof query.entries === "function" && !Array.isArray(query)) {
    // URLSearchParams (or a Map-like).
    for (const [k, v] of query.entries()) push(k, v);
  } else if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) for (const item of v) push(k, item);
      else push(k, v);
    }
  }
  return map;
}

/**
 * Build the exact string Shopify signs for an App Proxy request: params (minus
 * `signature`) sorted by key, each rendered `key=value` (array values joined by
 * ","), concatenated with no separator.
 * @param {Map<string,string[]>} map
 * @returns {string}
 */
function signatureBaseString(map) {
  const keys = [...map.keys()].filter((k) => k !== "signature").sort();
  return keys.map((k) => `${k}=${map.get(k).join(",")}`).join("");
}

function hexEqualsConstantTime(aHex, bHex) {
  if (typeof aHex !== "string" || typeof bHex !== "string") return false;
  // timingSafeEqual throws on length mismatch — guard first (a length difference
  // is already a non-match; no secret length leaks because both are HMAC-hex).
  if (aHex.length !== bHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(aHex, "utf8"), Buffer.from(bHex, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Verify a Shopify App Proxy request signature. Fail-closed: false on a missing
 * signature, a missing/blank secret, or any mismatch.
 * @param {URLSearchParams | Record<string, string|string[]>} query
 * @param {string|null|undefined} secret  the app's API secret key
 * @returns {boolean}
 */
export function verifyAppProxySignature(query, secret) {
  if (!secret || typeof secret !== "string") return false;
  const map = toMultiMap(query);
  const provided = map.get("signature")?.[0] ?? "";
  if (!provided) return false;
  const expected = createHmac("sha256", secret).update(signatureBaseString(map)).digest("hex");
  return hexEqualsConstantTime(provided, expected.toLowerCase());
}

/**
 * Decide the storefront auth state from a (signed) App Proxy request. The ONLY
 * trusted identity is Shopify's injected `logged_in_customer_id`.
 *
 * @param {URLSearchParams | Record<string, string|string[]>} query
 * @param {string|null|undefined} secret
 * @returns {{ ok: true, shopifyCustomerId: string, sessionId: string|null }
 *          | { ok: false, reason: "bad_signature" | "not_logged_in" }}
 */
export function evaluateAppProxyAuth(query, secret) {
  if (!verifyAppProxySignature(query, secret)) {
    return { ok: false, reason: "bad_signature" };
  }
  const map = toMultiMap(query);
  const id = (map.get("logged_in_customer_id")?.[0] ?? "").trim();
  // Shopify sends the param empty when logged out; trust only a POSITIVE numeric
  // customer id (the GID numeric, no leading zeros). Empty / "0" / non-numeric →
  // not signed in (fail closed) — never bind a bogus customer 0.
  if (!/^[1-9]\d*$/.test(id)) return { ok: false, reason: "not_logged_in" };
  const sessionId = (map.get("session")?.[0] ?? "").trim() || null;
  return { ok: true, shopifyCustomerId: id, sessionId };
}
