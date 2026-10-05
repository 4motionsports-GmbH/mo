// Shared guard for the signed-in (tier-3) account endpoints
// (/api/account/*). Combines the widget-XHR security posture with the CA-1
// signed-in resolver into a single fail-closed gate:
//
//   1. guardRequest      — origin allowlist + shared secret (like /api/chat).
//   2. rate limit        — the chat bucket (same widget surface).
//   3. resolveLiveSignedInCustomer(session) — the session must be signed in
//      (a chat sign-in or the shop's App Proxy; a typed e-mail never counts)
//      AND still live, exactly like /api/auth/me: a valid access token
//      (refreshed if needed) for a chat sign-in, or a fresh shop proof under
//      APP_PROXY_SIGNIN_MAX_AGE_HOURS (D-AP1). Anything else FAILS CLOSED here,
//      before any history is touched. The guard returns the proof, so a route
//      can record it (the opt-in's consent evidence).
//
// On success the caller gets the resolved customer id + the CORS headers to
// attach to its response. On any failure it gets a ready-made Response.

import { corsHeaders, guardRequest } from "./security";
import { checkRateLimit, rateLimitResponse } from "./rate-limit";
import { errorResponse } from "./observability";
import { resolveLiveSignedInCustomer, type SignedInProof } from "./signed-in-session";

export type SignedInGuard =
  | {
      ok: true;
      customerId: number;
      shopifyCustomerId: string;
      /** token = chat sign-in with a live token; shop = App Proxy shop proof. */
      proof: SignedInProof;
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
  const resolved = await resolveLiveSignedInCustomer(sessionId);
  if ("fail" in resolved) {
    // Anonymous / email-only / unlinked → „Nicht angemeldet“; a signed-in
    // link whose proof ran out (no live token, shop proof too old) →
    // „Sitzung abgelaufen“.
    return {
      ok: false,
      response: errorResponse(
        "unauthorized",
        resolved.fail === "expired" ? "Sitzung abgelaufen" : "Nicht angemeldet",
        401,
        headers
      ),
    };
  }

  return {
    ok: true,
    customerId: resolved.customerId,
    shopifyCustomerId: resolved.shopifyCustomerId,
    proof: resolved.proof,
    headers,
  };
}
