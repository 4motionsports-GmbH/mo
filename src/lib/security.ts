import { createHash, timingSafeEqual } from "node:crypto";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.motionsports.de",
  "https://motionsports.de",
] as const;

const SECRET_HEADER = "x-ms-chat-key";

export function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) return [...DEFAULT_ALLOWED_ORIGINS];
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_ALLOWED_ORIGINS];
}

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return getAllowedOrigins().includes(origin);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: "Origin",
  };
  if (origin && isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = `Content-Type, ${SECRET_HEADER}, x-ms-session`;
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

export function preflightResponse(req: Request): Response {
  const origin = req.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function constantTimeEquals(a: string, b: string): boolean {
  // Hash both sides so the buffers are always equal length — this prevents
  // leaking the secret's length and avoids timingSafeEqual's length check.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function isSecretValid(req: Request): boolean {
  const expected = process.env.CHAT_SHARED_SECRET;
  if (!expected) return false;
  const provided = req.headers.get(SECRET_HEADER) ?? "";
  return constantTimeEquals(provided, expected);
}

export type GuardResult = { ok: true; origin: string | null } | { ok: false; response: Response };

export function guardRequest(req: Request): GuardResult {
  const origin = req.headers.get("origin");
  // Browsers always send Origin on cross-origin POSTs; missing Origin means
  // a non-browser caller (curl, server-to-server) — those still need the secret.
  if (origin && !isOriginAllowed(origin)) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json", Vary: "Origin" },
      }),
    };
  }
  if (!isSecretValid(req)) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      }),
    };
  }
  return { ok: true, origin };
}
