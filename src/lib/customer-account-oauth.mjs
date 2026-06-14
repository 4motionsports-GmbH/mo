// Pure OAuth 2.0 / PKCE + signed-state helpers for the Shopify Customer Account
// sign-in flow. Kept in plain .mjs (no I/O, no network) so the security-critical
// bits — PKCE S256 derivation, constant-time state verification, return-URL
// allowlisting — are trivially unit-testable, mirroring the
// capture-validation.mjs / email-offer-trigger.mjs convention.
//
// See docs/CUSTOMER_ACCOUNT.md (PKCE flow) and the authoritative spike
// docs/CUSTOMER_ACCOUNT_SPIKE.md §3.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 4648 §5 base64url (no padding). */
export function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A high-entropy PKCE code_verifier (RFC 7636): 32 random bytes → 43-char
 * base64url string (well within the 43–128 char spec range).
 */
export function generateCodeVerifier() {
  return base64url(randomBytes(32));
}

/** PKCE S256 challenge: base64url(SHA-256(code_verifier)). */
export function codeChallengeS256(codeVerifier) {
  return base64url(createHash("sha256").update(codeVerifier).digest());
}

/** A random, URL-safe nonce / state component. */
export function randomToken(bytes = 32) {
  return base64url(randomBytes(bytes));
}

// ---------------------------------------------------------------------------
// Signed state — defense in depth on top of the server-side pending record.
//
// The OAuth `state` we send is `<random>.<hmac(random)>`. The random component
// is the primary key of the customer_auth_pending row (which holds the
// session_id, code_verifier, nonce and return_url server-side). The HMAC lets
// the callback reject a forged/tampered state cheaply, before any DB lookup, and
// proves the value originated from us.
// ---------------------------------------------------------------------------

/** Sign a random state token: returns `<state>.<sig>`. */
export function signState(state, secret) {
  const sig = createHmac("sha256", secret).update(state).digest();
  return `${state}.${base64url(sig)}`;
}

/**
 * Verify a signed state. Returns the random state component when the signature
 * is valid, else null. Constant-time comparison; never throws.
 */
export function verifyState(signed, secret) {
  if (typeof signed !== "string" || !signed.includes(".")) return null;
  const idx = signed.lastIndexOf(".");
  const state = signed.slice(0, idx);
  const provided = signed.slice(idx + 1);
  if (!state || !provided) return null;
  const expected = base64url(createHmac("sha256", secret).update(state).digest());
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  try {
    return timingSafeEqual(a, b) ? state : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Return-URL allowlisting — the callback redirects the browser back to the
// storefront page it came from. That target is attacker-influencable (it rides
// in the login request), so it MUST be constrained to the origin allowlist to
// prevent an open redirect.
// ---------------------------------------------------------------------------

/**
 * Validate and normalise the storefront return URL against the allowed
 * origins. Returns the URL string when its origin is allow-listed, else null
 * (the caller falls back to a safe default).
 *
 * @param {unknown} candidate
 * @param {string[]} allowedOrigins
 * @returns {string | null}
 */
export function safeReturnUrl(candidate, allowedOrigins) {
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.includes(url.origin)) {
    return null;
  }
  return url.toString();
}

/**
 * Append query params to a URL string without clobbering existing ones.
 * @param {string} urlStr
 * @param {Record<string, string>} params
 */
export function withParams(urlStr, params) {
  const url = new URL(urlStr);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v);
  }
  return url.toString();
}

/**
 * Stamp the storefront return URL with the `?ms_auth=<marker>` re-hydration
 * signal the widget keys on (ok | login_required | logged_out | error). The
 * widget reads + strips it, then probes /api/auth/me — so a missing or wrong
 * marker means it never re-probes and never flips to signed-in.
 *
 * Returns the URL unchanged when it can't be parsed (the caller has already
 * allow-listed it; this is just defensive). Never throws.
 *
 * @param {string} returnUrl
 * @param {string} marker
 * @returns {string}
 */
export function withAuthMarker(returnUrl, marker) {
  try {
    const u = new URL(returnUrl);
    u.searchParams.set("ms_auth", marker);
    return u.toString();
  } catch {
    return returnUrl;
  }
}
