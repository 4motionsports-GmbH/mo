// Shopify GraphQL transient-failure retry policy — pure + dependency-free so the
// retry/backoff decision is unit-testable without a network (the transport in
// shopify.ts wires it to the real fetch + sleep).
//
// COMPLEMENTS shopify-throttle.mjs. That module rides out cost-based RATE LIMITING
// (HTTP 429 / errors[] code THROTTLED). This one handles the OTHER transient
// class — the momentary infrastructure failures Shopify's edge throws at us:
//   • NETWORK blips — connect timeout, socket reset, DNS hiccup. Node's undici
//     surfaces all of these as `TypeError: fetch failed` (specifics on .cause,
//     e.g. ConnectTimeoutError / ECONNRESET). The request never got a response.
//   • Upstream 5xx — 502/503/504 (and 500), plus 408 Request Timeout, from
//     Shopify's origin or its Cloudflare front. A response came back, but it's a
//     transient server-side failure, not a problem with our query.
// Both are momentary and almost always succeed on a quick retry. Without this, a
// single blip aborts a webhook-driven single-product catalog mutation and surfaces
// as a Sentry error (route=lib/catalog-mutate) even though Shopify was fine 1s later.
//
// IDEMPOTENCY GUARD: only safe-to-repeat operations (GraphQL queries) are
// auto-retried here. A mutation may already have taken effect when the failure
// arrives — a 502 can come back AFTER the origin processed the write, and a
// mid-flight socket reset is ambiguous — so retrying it risks a duplicate side
// effect (e.g. two discount codes). One surfaced error is better than a double
// write. (Throttle retries stay safe for mutations too: a THROTTLED request is
// rejected by the rate limiter BEFORE it runs — see shopify-throttle.mjs.)

export const TRANSIENT_MAX_RETRIES = 3;
export const TRANSIENT_BASE_WAIT_MS = 500;
export const TRANSIENT_MAX_WAIT_MS = 8_000; // cap one wait so retries can't hang the fn

// HTTP statuses worth retrying: transient upstream/gateway failures + request
// timeout. 429 is deliberately EXCLUDED — that is rate limiting, owned by
// shopify-throttle.mjs (retrying it here would double-handle and ignore the
// leaky-bucket refill math).
const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);

/** True for an HTTP status we treat as a transient (retryable) upstream failure. */
export function isTransientStatus(status) {
  return typeof status === "number" && RETRYABLE_STATUS.has(status);
}

/**
 * True when a GraphQL operation is a mutation (a write we must NOT auto-retry on
 * a transport failure — see the idempotency note above). Anonymous operations
 * (`{ ... }`) and `query`/`subscription` are reads-or-safe; only the `mutation`
 * keyword marks a write, so we strip any leading BOM / whitespace / `#` comment
 * lines and test for it. Conservative by construction: anything we can't classify
 * as a mutation is treated as retryable, but a real mutation always carries the
 * keyword, so writes are reliably excluded.
 */
export function isMutation(query) {
  if (typeof query !== "string") return false;
  // Strip a leading BOM, then runs of whitespace / `#` comment lines.
  const stripped = query.replace(/^\uFEFF/, "").replace(/^(?:\s|#[^\n]*\n?)+/, "");
  return /^mutation\b/.test(stripped);
}

/**
 * Exponential backoff for a transient retry: 500ms, 1s, 2s, 4s … clamped to
 * [base, max]. No throttle-status math (unlike shopify-throttle.mjs) — a network
 * blip / 5xx carries no refill signal, so a plain backoff is the right tool.
 *
 * @param {number} attempt  zero-based retry attempt
 */
export function transientWaitMs(attempt, opts = {}) {
  const base = opts.baseWaitMs ?? TRANSIENT_BASE_WAIT_MS;
  const max = opts.maxWaitMs ?? TRANSIENT_MAX_WAIT_MS;
  const backoff = base * Math.pow(2, Math.max(0, attempt));
  return Math.min(Math.max(backoff, base), max);
}

/**
 * Decide whether to retry a transient Shopify transport failure, and how long to
 * wait first. Pass EITHER `networkError: true` (fetch() rejected — no response
 * arrived) OR `httpStatus` (a response came back). Returns no-retry for a
 * non-transient outcome, a non-idempotent op, or once the retry cap is hit — in
 * every such case the caller throws, which (on the webhook path) surfaces a 500 so
 * Shopify redelivers, and on read paths trips the bundled-catalog fallback.
 *
 * @param {{ networkError?: boolean, httpStatus?: number, idempotent?: boolean,
 *   attempt?: number, maxRetries?: number }} args
 * @returns {{ retry: boolean, waitMs: number,
 *   reason: "network"|"http-5xx"|"non-idempotent"|"max-retries-exhausted"|"not-transient" }}
 */
export function planTransientRetry({
  networkError = false,
  httpStatus,
  idempotent = true,
  attempt = 0,
  maxRetries = TRANSIENT_MAX_RETRIES,
}) {
  const transient = networkError || isTransientStatus(httpStatus);
  if (!transient) return { retry: false, waitMs: 0, reason: "not-transient" };
  // Never auto-retry a write — it may already have taken effect (see header note).
  if (!idempotent) return { retry: false, waitMs: 0, reason: "non-idempotent" };
  if (attempt >= maxRetries) return { retry: false, waitMs: 0, reason: "max-retries-exhausted" };
  return {
    retry: true,
    waitMs: transientWaitMs(attempt),
    reason: networkError ? "network" : "http-5xx",
  };
}
