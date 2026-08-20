// Shopify throttle BACKPRESSURE — pure helpers behind the shared throttle gate
// and the pending-refresh queue (the Redis I/O lives in shopify-throttle-gate.ts).
//
// WHY: a bulk change in Shopify (ERP stock sync, app re-saving products) fires
// hundreds of product/inventory webhooks within minutes. Every delivery used to
// make 2–3 Admin GraphQL calls immediately, so the CONCURRENT invocations drained
// the cost-based leaky bucket together — per-invocation retry math (deficit ÷
// restoreRate, see shopify-throttle.mjs) assumes a single client and can never
// win against a storm of competitors. Each invocation exhausted its retries,
// threw, surfaced a Sentry error (route=lib/catalog-mutate) and returned 500 —
// which made Shopify REDELIVER, feeding the storm (observed 2026-08-20: 1.4k
// 5xx in 5 minutes on /api/webhooks/shopify).
//
// THE FIX (wired up in shopify.ts / catalog-mutate.ts / the webhook route):
//   • GATE  — the first invocation to see THROTTLED trips a shared, short-lived
//     Redis flag. While it holds, webhook invocations don't call Shopify at all:
//     they enqueue the product/inventory-item GID and ack 200 immediately.
//   • QUEUE — a Redis SET of pending refresh targets. A set coalesces for free
//     (the same product enqueued 50× during a burst is ONE entry), and a refresh
//     always re-fetches CURRENT truth from Shopify (never applies the webhook
//     payload), so coalescing and reordering are safe by construction.
//   • DRAIN — after each successful webhook mutation (bucket demonstrably has
//     budget again), a few queued entries are drained opportunistically. The
//     daily full sync remains the final reconciliation backstop, and the queue
//     key expires after PENDING_REFRESH_TTL_S so it can never grow stale forever.
//
// Pure + dependency-free so the entry encoding and gate cooldown math are
// unit-testable without Redis.

import { THROTTLE_MAX_WAIT_MS } from "./shopify-throttle.mjs";

/** Redis key holding the shared "Shopify is throttling us" flag (PX-expired). */
export const THROTTLE_GATE_KEY = "shopify:throttle:gate";
/** Redis SET of pending refresh targets ("<kind>:<gid>" entries). */
export const PENDING_REFRESH_KEY = "catalog:refresh:pending";
/** Queue TTL — refreshed on every enqueue; the daily sync reconciles anything
 *  older anyway, so an untouched queue may simply expire. */
export const PENDING_REFRESH_TTL_S = 48 * 60 * 60;

/** Gate floor: even a sub-second refill deficit holds the gate ≥ this long so a
 *  webhook burst arriving in the same second still defers. */
export const GATE_MIN_MS = 1_000;
/** Gate hold after a retry-cap exhaustion — the bucket is under sustained
 *  demand, so back off decisively rather than by one request's deficit. */
export const GATE_EXHAUSTED_MS = 30_000;

/** How many queued entries one webhook invocation drains after its own work. */
export const DRAIN_MAX_ITEMS = 3;
/** Drain wall-clock budget — the route's maxDuration is 60s and the main
 *  mutation already spent part of it; draining must never push us into a
 *  function timeout (a 504 is exactly the 5xx we're eliminating). */
export const DRAIN_TIME_BUDGET_MS = 15_000;

const KINDS = new Set(["product", "inventory_item"]);

/**
 * Encode a pending-refresh target as a queue entry, e.g.
 * "product:gid://shopify/Product/123". Returns null for an unknown kind or a
 * non-GID id — an invalid target must never reach the queue.
 *
 * @param {"product"|"inventory_item"} kind
 * @param {string} gid
 * @returns {string | null}
 */
export function pendingEntry(kind, gid) {
  if (!KINDS.has(kind)) return null;
  if (typeof gid !== "string" || !gid.startsWith("gid://")) return null;
  return `${kind}:${gid}`;
}

/**
 * Decode a queue entry back to its target. Returns null for anything malformed
 * (a foreign value in the set is skipped, never dispatched).
 *
 * @param {string} entry
 * @returns {{ kind: "product"|"inventory_item", gid: string } | null}
 */
export function parsePendingEntry(entry) {
  if (typeof entry !== "string") return null;
  const sep = entry.indexOf(":");
  if (sep <= 0) return null;
  const kind = entry.slice(0, sep);
  const gid = entry.slice(sep + 1);
  if (!KINDS.has(kind) || !gid.startsWith("gid://")) return null;
  return { kind, gid };
}

/**
 * How long the shared gate should hold. A retryable throttle gates for its own
 * computed wait (clamped to [GATE_MIN_MS, THROTTLE_MAX_WAIT_MS]); an exhausted
 * retry cap gates for the fixed, longer GATE_EXHAUSTED_MS.
 *
 * @param {{ waitMs?: number, exhausted?: boolean }} args
 * @returns {number} milliseconds
 */
export function gateCooldownMs({ waitMs, exhausted = false } = {}) {
  if (exhausted) return GATE_EXHAUSTED_MS;
  const ms = typeof waitMs === "number" && waitMs > 0 ? waitMs : GATE_MIN_MS;
  return Math.min(Math.max(ms, GATE_MIN_MS), THROTTLE_MAX_WAIT_MS);
}
