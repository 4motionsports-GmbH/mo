// GET /api/auth/me?session=<session_id> — widget identity re-hydration.
//
// Called by the widget (cross-origin XHR) on load / after the sign-in redirect
// to learn whether the current localStorage session is linked to a signed-in
// Shopify customer, and to get a display name + tier. Guarded by the origin
// allowlist + shared secret like the other widget endpoints.
//
// Fail-closed: anything we can't positively prove returns { signedIn: false }.
// Tokens NEVER appear in the response — only the resolved name + tier. The name
// is read LIVE from Shopify (authoritative) via the server-held access token, so
// we don't cache customer PII names locally for tier 3 in CA-1.

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import { resolveSignedInCustomer } from "@/lib/customer-store";
import { getValidAccessToken } from "@/lib/customer-oauth-store";
import { fetchCustomerIdentity } from "@/lib/shopify-customer-account";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function OPTIONS(req: Request) {
  return preflightResponse(req, "GET, OPTIONS");
}

function json(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function displayName(identity: {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string | null {
  if (identity.displayName?.trim()) return identity.displayName.trim();
  const joined = [identity.firstName, identity.lastName]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return joined || null;
}

export async function GET(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const headers = corsHeaders(guard.origin, "GET, OPTIONS");

  try {
    const rl = await checkRateLimit(req, "chat");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, headers);

    const url = new URL(req.url);
    const sessionId =
      (url.searchParams.get("session") ?? "").trim() || req.headers.get("x-ms-session");

    const resolved = await resolveSignedInCustomer(sessionId ?? null);
    if (!resolved) return json({ signedIn: false }, headers);

    // Prove the session is still live by obtaining a valid access token
    // (refreshing if needed). No valid token → fail closed (re-auth required).
    const token = await getValidAccessToken(resolved.customerId);
    if (!token) return json({ signedIn: false }, headers);

    let name: string | null = null;
    try {
      const identity = await fetchCustomerIdentity(token);
      if (identity) name = displayName(identity);
    } catch (err) {
      // Identity read failed but the linkage + token are valid — still report
      // signed-in (degraded name) rather than logging the user out.
      reportError(err, { route: "api/auth/me", phase: "fetchIdentity" });
    }

    return json({ signedIn: true, identity: { name, tier: resolved.tier } }, headers);
  } catch (err) {
    reportError(err, { route: "api/auth/me" });
    return json({ signedIn: false }, headers);
  }
}
