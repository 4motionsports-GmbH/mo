import { Redis } from "@upstash/redis";

/**
 * Single source of truth for the Upstash Redis connection.
 *
 * Vercel's Upstash Marketplace integration injects the connection under the
 * KV_* names — KV_REST_API_URL / KV_REST_API_TOKEN — NOT the @upstash/redis
 * SDK's default UPSTASH_REDIS_REST_* names. So we deliberately do NOT use
 * Redis.fromEnv() (which reads the UPSTASH_* names and would silently find
 * nothing) and instead construct the client explicitly from the KV_* names that
 * are actually present. This is the ONLY place a Redis client is built; every
 * consumer (currently the rate limiter) imports getRedis() from here.
 */

let client: Redis | null = null;

/**
 * Read + validate the KV_* connection env. Throws loudly when either var is
 * missing so a misconfiguration is a hard failure, never a silent fallback to
 * "no Redis" — which for the rate limiter would mean an unbounded, unprotected
 * endpoint (a silent rate-limit bypass).
 */
function readConfig(): { url: string; token: string } {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    const missing = [
      !url && "KV_REST_API_URL",
      !token && "KV_REST_API_TOKEN",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `[redis] Missing required env var(s): ${missing}. Vercel's Upstash ` +
        `Marketplace integration injects KV_REST_API_URL and KV_REST_API_TOKEN ` +
        `— set them in your Vercel project (and in .env for local dev). Failing ` +
        `fast so rate limiting can never silently no-op.`
    );
  }
  return { url, token };
}

/** The shared, lazily-constructed Upstash Redis client (one per runtime). */
export function getRedis(): Redis {
  if (!client) {
    const { url, token } = readConfig();
    client = new Redis({ url, token });
  }
  return client;
}

/**
 * Like getRedis(), but returns null instead of throwing when KV is not
 * configured. For BEST-EFFORT uses (e.g. the webhook burst-lock) that must still
 * function — degraded — without Redis, rather than fail closed the way the rate
 * limiter must.
 */
export function tryGetRedis(): Redis | null {
  if (client) return client;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  return getRedis();
}
