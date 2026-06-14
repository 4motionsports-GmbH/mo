// Shared guard for the signed-in (tier-3) account endpoints
// (/api/account/*). Combines the widget-XHR security posture with the CA-1
// signed-in resolver into a single fail-closed gate:
//
//   1. guardRequest      — origin allowlist + shared secret (like /api/chat).
//   2. rate limit        — the chat bucket (same widget surface).
//   3. resolveSignedInCustomer(session) — the conversation's session must link
//      to a customer with a shopify_customer_id. Anonymous (no customer) and
//      email-only (tier-2, no shopify_customer_id) callers resolve to null →
//      FAIL CLOSED here, before any history is touched.
//   4. getValidAccessToken — prove the session is STILL authenticated (refresh
//      if needed), exactly like /api/auth/me. A logged-out / expired session
//      can't read or mutate history.
//
// On success the caller gets the resolved customer id + the CORS headers to
// attach to its response. On any failure it gets a ready-made Response.

import { corsHeaders, guardRequest } from "./security";
import { checkRateLimit, rateLimitResponse } from "./rate-limit";
import { errorResponse } from "./observability";
import { resolveSignedInCustomer } from "./customer-store";
import { getValidAccessToken } from "./customer-oauth-store";

export type SignedInGuard =
  | {
      ok: true;
      customerId: number;
      shopifyCustomerId: string;
      headers: Record<string, string>;
    }
  | { ok: false; response: Response };

/** Read the opaque widget session from the query string or the x-ms-session header. */
export function readSession(req: Request): string | null {
  const url = new URL(req.url);
  const fromQuery = (url.searchParams.get("session") ?? "").trim();
  return fromQuery || req.headers.get("x-ms-session");
}

/**
 * Gate a request to the signed-in customer it belongs to. `methods` is the
 * allowed-methods string for the CORS headers (e.g. "GET, OPTIONS").
 */
export async function requireSignedInCustomer(
  req: Request,
  methods: string
): Promise<SignedInGuard> {
  const guard = guardRequest(req);
  if (!guard.ok) return { ok: false, response: guard.response };
  const headers = corsHeaders(guard.origin, methods);

  const rl = await checkRateLimit(req, "chat");
  if (!rl.ok) return { ok: false, response: rateLimitResponse(rl.retryAfter, headers) };

  const sessionId = readSession(req);
  const resolved = await resolveSignedInCustomer(sessionId);
  if (!resolved) {
    // Anonymous / email-only / unlinked session → fail closed.
    return {
      ok: false,
      response: errorResponse("unauthorized", "Nicht angemeldet", 401, headers),
    };
  }

  // Prove the session is still live (refresh if needed) before exposing any
  // history — a logged-out / expired session resolves to nothing.
  const token = await getValidAccessToken(resolved.customerId);
  if (!token) {
    return {
      ok: false,
      response: errorResponse("unauthorized", "Sitzung abgelaufen", 401, headers),
    };
  }

  return {
    ok: true,
    customerId: resolved.customerId,
    shopifyCustomerId: resolved.shopifyCustomerId,
    headers,
  };
}
