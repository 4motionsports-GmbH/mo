import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { errorEnvelope } from "./observability";

const WINDOW = "60 s" as const;
const CHAT_MAX = 20;
const PRODUCTS_MAX = 60;

export type RateLimitBucket = "chat" | "products";

const cached: Partial<Record<RateLimitBucket, Ratelimit>> = {};
let warned = false;
let sharedRedis: Redis | null = null;

function getRedis(): Redis | null {
  if (sharedRedis) return sharedRedis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!warned) {
      console.warn(
        "[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — rate limiting disabled"
      );
      warned = true;
    }
    return null;
  }
  sharedRedis = new Redis({ url, token });
  return sharedRedis;
}

function getLimiter(bucket: RateLimitBucket): Ratelimit | null {
  const existing = cached[bucket];
  if (existing) return existing;
  const redis = getRedis();
  if (!redis) return null;
  const max = bucket === "chat" ? CHAT_MAX : PRODUCTS_MAX;
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(max, WINDOW),
    analytics: false,
    prefix: `ms-${bucket}`,
  });
  cached[bucket] = limiter;
  return limiter;
}

function clientKey(req: Request): string {
  const sid = req.headers.get("x-ms-session");
  if (sid && sid.trim().length > 0) return `sid:${sid.trim().slice(0, 128)}`;
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return `ip:${ip}`;
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfter: number };

export async function checkRateLimit(
  req: Request,
  bucket: RateLimitBucket = "chat"
): Promise<RateLimitResult> {
  const limiter = getLimiter(bucket);
  if (!limiter) return { ok: true };
  const key = clientKey(req);
  const { success, reset } = await limiter.limit(key);
  if (success) return { ok: true };
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return { ok: false, retryAfter };
}

export function rateLimitResponse(
  retryAfter: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(
    JSON.stringify(errorEnvelope("rate_limited", "Too many requests")),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
        ...extraHeaders,
      },
    }
  );
}
