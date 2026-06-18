// Shopify GraphQL throttle handling — pure, dependency-free so the retry/backoff
// decision is unit-testable without a network (the transport in shopify.ts wires
// it to the real fetch + sleep).
//
// WHY: Shopify's Admin GraphQL API uses a cost-based leaky-bucket rate limiter.
// When a request would exceed the currently-available budget it returns HTTP 200
// with an errors[] entry { message:"Throttled", extensions:{ code:"THROTTLED" } }
// AND a top-level extensions.cost.throttleStatus { maximumAvailable,
// currentlyAvailable, restoreRate }. The bucket refills at restoreRate points/sec.
// The old client threw on the first errors[] entry, so a single throttle during
// the ~33-page catalog pagination aborted the whole fetch and fell back to the
// bundled catalog. Instead we RIDE OUT a throttle: wait long enough for the
// bucket to refill the deficit, then retry — falling back only if a throttle
// genuinely persists past the retry cap.

export const THROTTLE_MAX_RETRIES = 5;
export const THROTTLE_MIN_WAIT_MS = 500;
export const THROTTLE_MAX_WAIT_MS = 20_000; // cap one wait so a stuck call can't hang the 300s fn
const THROTTLE_BUFFER_MS = 250; // small cushion so the bucket is actually refilled on retry
const BACKOFF_BASE_MS = 1000;

/** True when a GraphQL JSON body is a throttle response (errors[] code THROTTLED). */
export function isThrottledResponse(json) {
  const errors = json?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (e) =>
      e?.extensions?.code === "THROTTLED" || /throttled/i.test(String(e?.message ?? ""))
  );
}

/**
 * How long to wait before retrying a throttled request. Prefers the precise
 * refill math from extensions.cost.throttleStatus (deficit ÷ restoreRate), and
 * falls back to exponential backoff when the throttle status is absent (e.g. a
 * bare HTTP 429 with no parseable body). Always clamped to [min, max].
 *
 * @param {{ requestedQueryCost?: number, throttleStatus?: { maximumAvailable?: number,
 *   currentlyAvailable?: number, restoreRate?: number } } | undefined} cost
 * @param {number} attempt  zero-based retry attempt
 */
export function throttleWaitMs(cost, attempt, opts = {}) {
  const minWait = opts.minWaitMs ?? THROTTLE_MIN_WAIT_MS;
  const maxWait = opts.maxWaitMs ?? THROTTLE_MAX_WAIT_MS;
  const status = cost?.throttleStatus;
  const restoreRate = status?.restoreRate;
  const currentlyAvailable = status?.currentlyAvailable;
  const requested = cost?.requestedQueryCost ?? status?.maximumAvailable;

  if (
    typeof restoreRate === "number" &&
    restoreRate > 0 &&
    typeof currentlyAvailable === "number" &&
    typeof requested === "number"
  ) {
    const deficit = Math.max(0, requested - currentlyAvailable);
    const ms = Math.ceil((deficit / restoreRate) * 1000) + THROTTLE_BUFFER_MS;
    return clamp(ms, minWait, maxWait);
  }

  // No throttle status to reason about → exponential backoff (1s, 2s, 4s, …).
  const backoff = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempt));
  return clamp(backoff, minWait, maxWait);
}

function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Decide whether to retry a (possibly throttled) GraphQL response, and for how
 * long to wait first. A THROTTLED body (or HTTP 429) under the retry cap ⇒ retry
 * with a backoff; anything else (a non-throttle error, or the cap exhausted) ⇒
 * no retry, so the caller throws and the LAST-RESORT bundle fallback can kick in.
 *
 * @param {{ json?: any, httpStatus?: number, attempt?: number, maxRetries?: number }} args
 * @returns {{ retry: boolean, waitMs: number, reason: "throttled"|"max-retries-exhausted"|"not-throttled" }}
 */
export function planThrottleRetry({ json, httpStatus, attempt = 0, maxRetries = THROTTLE_MAX_RETRIES }) {
  const throttled = httpStatus === 429 || isThrottledResponse(json);
  if (!throttled) return { retry: false, waitMs: 0, reason: "not-throttled" };
  if (attempt >= maxRetries) return { retry: false, waitMs: 0, reason: "max-retries-exhausted" };
  return { retry: true, waitMs: throttleWaitMs(json?.extensions?.cost, attempt), reason: "throttled" };
}
