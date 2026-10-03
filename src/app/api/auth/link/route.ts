// POST /api/auth/link  { code }   (headers: x-ms-chat-key, x-ms-session)
//   → { ok: true, signedIn: true }  |  400 bad_request „Anmeldung abgelaufen …“
//
// Step 3 of a sign-in (migration 0073): the widget redeems the one-time code it
// received — `?ms_code=` on the return from the Customer Account sign-in
// (callback) or `linkCode` in the App Proxy whoami response — with its OWN
// session. Only when that session is the one the sign-in was started for is it
// linked as signed in (customer-link-grant.redeemLinkGrant); the code is used
// up on the first attempt either way. Afterwards the widget probes
// /api/auth/me as before.
//
// Why: the session id of the sign-in comes from a URL (login?session=…,
// whoami?session=…) anyone can prepare. Without this step a stranger could have
// a logged-in shopper's browser complete a sign-in for the stranger's session.
//
// Widget route: origin allowlist + shared secret (guardRequest), rate-limited.

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { readSession } from "@/lib/account-guard";
import { redeemSessionLinkGrant } from "@/lib/session-link-grants";
import { recordKpiEvent, KPI_ACCOUNT_SIGNIN_LINKED, KPI_ACCOUNT_SIGNIN_LINK_REFUSED } from "@/lib/kpi-events";

export const runtime = "nodejs";
export const maxDuration = 15;

const METHODS = "POST, OPTIONS";

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

export async function POST(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const headers = corsHeaders(guard.origin, METHODS);
  try {
    const rl = await checkRateLimit(req, "chat");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, headers);
    let code: unknown = null;
    try {
      code = ((await req.json()) as { code?: unknown }).code;
    } catch {
      return errorResponse("bad_request", "Invalid JSON body", 400, headers);
    }
    const sessionId = readSession(req);
    const result = await redeemSessionLinkGrant({ code, sessionId });
    // Pseudonymous, session-keyed: the KPI tab's sign-in funnel ends here (a
    // Shopify sign-in only counts once the chat redeemed it), and refusals show
    // a widget that redeems wrongly — or a planted link (session_mismatch).
    if (result.ok) {
      await recordKpiEvent({ sessionId, event: KPI_ACCOUNT_SIGNIN_LINKED, data: { kind: result.kind } });
    } else if (result.reason !== "unavailable") {
      await recordKpiEvent({ sessionId, event: KPI_ACCOUNT_SIGNIN_LINK_REFUSED, data: { reason: result.reason } });
    }
    if (!result.ok) {
      if (result.reason === "unavailable") {
        return errorResponse("upstream_unavailable", "Anmeldung gerade nicht möglich — bitte später erneut versuchen.", 503, headers);
      }
      return errorResponse("bad_request", "Anmeldung abgelaufen — bitte erneut anmelden.", 400, headers);
    }
    return new Response(JSON.stringify({ ok: true, signedIn: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
    });
  } catch (err) {
    reportError(err, { route: "api/auth/link" });
    return errorResponse("internal_error", "Anmeldung gerade nicht möglich.", 500, headers);
  }
}
