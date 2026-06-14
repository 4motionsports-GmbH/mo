// GET /api/account/conversations — list the SIGNED-IN customer's past
// conversations, ACROSS all their devices, most recent first.
//
// Gated by the CA-1 signed-in resolver (see lib/account-guard.ts): anonymous
// and email-only callers fail closed (401). Because every device's session for
// a signed-in customer links to the same customers row (keyed by
// shopify_customer_id), this lists the customer's whole history regardless of
// which device opened each conversation.
//
// Each item carries a cheap TITLE (custom title if renamed, else the first
// user message trimmed — NO model call per render), created/updated timestamps,
// and a readable message count. Transcripts are fetched on demand via
// /api/account/conversations/[id]. Widget XHR → origin + secret guarded.

import { preflightResponse } from "@/lib/security";
import { errorResponse, reportError } from "@/lib/observability";
import { requireSignedInCustomer } from "@/lib/account-guard";
import { listCustomerConversations } from "@/lib/account-history";

export const runtime = "nodejs";
export const maxDuration = 15;

const METHODS = "GET, OPTIONS";

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

function json(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export async function GET(req: Request) {
  const guard = await requireSignedInCustomer(req, METHODS);
  if (!guard.ok) return guard.response;

  try {
    const conversations = await listCustomerConversations(guard.customerId);
    return json({ conversations }, guard.headers);
  } catch (err) {
    reportError(err, { route: "api/account/conversations" });
    return errorResponse("internal_error", "Unexpected server error", 500, guard.headers);
  }
}
