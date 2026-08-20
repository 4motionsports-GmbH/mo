// Redis I/O for the shared Shopify throttle gate + pending-refresh queue.
// The decision logic and key/TTL constants are pure (shopify-backpressure.mjs);
// this module is the thin, BEST-EFFORT wrapper around Upstash: without Redis
// every function degrades to "gate never active / nothing queued", which is
// exactly the pre-gate behavior (in-function retries, 5xx → Shopify redelivery).
// A Redis hiccup must never take down a webhook, so every call swallows.

import { tryGetRedis } from "./redis";
import {
  THROTTLE_GATE_KEY,
  PENDING_REFRESH_KEY,
  PENDING_REFRESH_TTL_S,
  gateCooldownMs,
  pendingEntry,
} from "./shopify-backpressure.mjs";

export type PendingKind = "product" | "inventory_item";

/** True while a recent Shopify THROTTLED response says "back off" — callers on
 *  the webhook path defer (enqueue + ack) instead of calling Shopify. */
export async function isThrottleGateActive(): Promise<boolean> {
  const redis = tryGetRedis();
  if (!redis) return false;
  try {
    return (await redis.exists(THROTTLE_GATE_KEY)) === 1;
  } catch {
    return false;
  }
}

/** Raise the shared gate (called from the GraphQL transport whenever Shopify
 *  throttles), so CONCURRENT invocations stop competing for the same bucket. */
export async function tripThrottleGate(args: { waitMs?: number; exhausted?: boolean }): Promise<void> {
  const redis = tryGetRedis();
  if (!redis) return;
  try {
    await redis.set(THROTTLE_GATE_KEY, "1", { px: gateCooldownMs(args) });
  } catch {
    // best-effort — without the gate we just fall back to per-invocation retries
  }
}

/** Queue a refresh target for later draining. Returns false when it could NOT
 *  be queued (no Redis / bad target / Redis error) — the caller must then keep
 *  the old failure path (5xx → Shopify redelivery) so the update isn't lost. */
export async function enqueuePendingRefresh(kind: PendingKind, gid: string): Promise<boolean> {
  const entry = pendingEntry(kind, gid);
  if (!entry) return false;
  return requeuePendingEntry(entry);
}

/** Re-add an already-encoded entry (drain hit the gate / a failure). */
export async function requeuePendingEntry(entry: string): Promise<boolean> {
  const redis = tryGetRedis();
  if (!redis) return false;
  try {
    await redis.sadd(PENDING_REFRESH_KEY, entry);
    await redis.expire(PENDING_REFRESH_KEY, PENDING_REFRESH_TTL_S);
    return true;
  } catch {
    return false;
  }
}

/** Pop up to `max` queued entries (random order — safe: a refresh re-fetches
 *  current truth from Shopify, it never replays a stale payload). */
export async function takePendingRefreshes(max: number): Promise<string[]> {
  const redis = tryGetRedis();
  if (!redis || max <= 0) return [];
  try {
    const popped = await redis.spop<string[]>(PENDING_REFRESH_KEY, max);
    return Array.isArray(popped) ? popped : [];
  } catch {
    return [];
  }
}
