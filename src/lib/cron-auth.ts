// Shared authorization gate for the Vercel Cron routes (/api/cron/*).
//
// Every cron is protected by CRON_SECRET — Vercel Cron sends it as
// `Authorization: Bearer <secret>`. This check used to be copy-pasted (byte for
// byte) into all four cron handlers; centralising it removes the drift risk on
// auth logic and lets the comparison be constant-time, matching the secret
// checks already used elsewhere (lib/security `constantTimeEquals`, lib/admin-
// auth `timingSafeEqual`). Fails closed when CRON_SECRET is unset.
//
// Node runtime only (uses node:crypto, like lib/security) — the cron routes run
// on Node and are never imported by the Edge proxy, so this is safe here.

import { createHash, timingSafeEqual } from "node:crypto";

function constantTimeEquals(a: string, b: string): boolean {
  // Hash both sides so the buffers are always equal length — this prevents
  // leaking the secret's length and avoids timingSafeEqual's own length check.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * True when the request carries the correct `Authorization: Bearer <CRON_SECRET>`.
 * Returns false (fail closed) when CRON_SECRET is not configured.
 */
export function isCronAuthorized(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return constantTimeEquals(m[1], expected);
}

/**
 * Gate a cron route. Returns a ready-made 401 Response to short-circuit with,
 * or null when the request is authorized and the handler may proceed. The
 * envelope mirrors the previous inline `{ error: "Unauthorized" }` 401.
 */
export function requireCronAuth(req: Request): Response | null {
  if (isCronAuthorized(req)) return null;
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
