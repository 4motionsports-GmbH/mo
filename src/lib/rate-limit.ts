import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { errorEnvelope } from "./observability";

export type RateLimitBucket =
  | "chat"
  | "products"
  | "kpi"
  | "tts"
  | "tts-stream"
  | "feedback"
  // Keyed by the RECIPIENT email (not the session) — caps how many capture
  // sends a single address can receive, see /api/capture-email.
  | "capture-recipient"
  // Keyed by the client IP — caps contact-form inbox spam, see /api/contact.
  | "contact-ip";

// Per-bucket sliding-window config: max requests over the given Upstash
// duration string. Each bucket gets its own window so we can mix short (chat,
// 60 s) and longer (tts, 5 min) limits.
const BUCKET_CONFIG: Record<RateLimitBucket, { max: number; window: `${number} ${"s" | "m"}` }> = {
  chat: { max: 20, window: "60 s" },
  products: { max: 60, window: "60 s" },
  // Telemetry is cheap and high-volume (the widget fires events on many
  // interactions), so the KPI bucket is generous on purpose.
  kpi: { max: 120, window: "60 s" },
  // Text-to-speech (voice mode): each call is a billed OpenAI synthesis of up
  // to ~2000 chars, so this bucket is tighter than chat and uses a longer
  // window. 20 / 5 min comfortably covers a real consultation — the widget
  // calls /api/tts once per assistant message the user plays, plus the
  // occasional replay — while capping a scraper's spend (≤20 syntheses / 5 min
  // / session, each ≤2000 chars) and matching the per-session keying below.
  tts: { max: 20, window: "300 s" },
  // Streaming voice mode (ChatGPT-style): the widget fires /api/tts once per
  // SENTENCE/CLAUSE as the answer streams in, so a single played answer is
  // several requests instead of one. This bucket is sized for that
  // granularity — a real consultation plays a handful of multi-sentence
  // answers — while each chunk stays small (the widget sends one sentence,
  // the server still caps at MAX_TTS_CHARS). Total synthesized characters per
  // window therefore stay bounded and comparable to the single-shot `tts`
  // path, while the higher request COUNT no longer trips the tight 20/5-min
  // bucket the full-message fallback keeps.
  "tts-stream": { max: 120, window: "300 s" },
  // Customer feedback: a deliberate, low-frequency action (a person types a
  // comment and submits it once). Its own tight bucket is the light abuse
  // protection for the endpoint — 5 / 5 min / session comfortably covers a
  // genuine "leave feedback, fix a typo, resubmit" while stopping a script from
  // flooding the table, complementing the per-message length cap in
  // feedback-validation.mjs.
  feedback: { max: 5, window: "300 s" },
  // Per-RECIPIENT cap on the value-triggered capture send: at most a few
  // confirmation/summary emails to the SAME address per hour, keyed by the
  // recipient email rather than the client session — so rotating the
  // (client-supplied) session header can't turn /api/capture-email into an
  // email-bombing relay against a chosen victim. Generous for a real "capture,
  // fix a typo, re-capture" while hard-capping abuse.
  "capture-recipient": { max: 3, window: "60 m" },
  // Per-IP cap on the contact form. Its destination is our own inbox, so abuse
  // is inbox spam; the form is a deliberate, low-frequency human action, so a
  // tight per-source-IP bucket complements the session bucket it already uses.
  "contact-ip": { max: 8, window: "60 m" },
};

const cached: Partial<Record<RateLimitBucket, Ratelimit>> = {};
let warned = false;
let sharedRedis: Redis | null = null;

function getRedis(): Redis | null {
  if (sharedRedis) return sharedRedis;
  // Accept either the explicit UPSTASH_REDIS_REST_* names or the KV_REST_API_*
  // names that Vercel's Upstash Marketplace integration auto-injects.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    if (!warned) {
      console.warn(
        "[rate-limit] Upstash Redis env vars not set (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN) — rate limiting disabled"
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
  const { max, window } = BUCKET_CONFIG[bucket];
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(max, window),
    analytics: false,
    prefix: `ms-${bucket}`,
  });
  cached[bucket] = limiter;
  return limiter;
}

/** Best-effort client IP for IP-keyed limits (the platform sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function clientKey(req: Request): string {
  const sid = req.headers.get("x-ms-session");
  if (sid && sid.trim().length > 0) return `sid:${sid.trim().slice(0, 128)}`;
  return `ip:${clientIp(req)}`;
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

/**
 * Rate-limit against an EXPLICIT key (e.g. a recipient email or a client IP)
 * instead of the per-session/IP key checkRateLimit derives. Used to cap abuse
 * vectors a client could otherwise sidestep by rotating its session header.
 */
export async function checkRateLimitKeyed(
  bucket: RateLimitBucket,
  key: string
): Promise<RateLimitResult> {
  const limiter = getLimiter(bucket);
  if (!limiter) return { ok: true };
  const { success, reset } = await limiter.limit(key.slice(0, 256));
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
