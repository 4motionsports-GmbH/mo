// POST /api/account/erase — the DISTINCT full "delete my data" path for a
// signed-in (tier-3) customer. SEPARATE from the single-chat delete
// (DELETE /api/account/conversations/[id]).
//
// This is a GDPR erasure of the PERSON, not one transcript:
//   * PURGE every linked conversation (all transcripts + messages + chat
//     ai_usage cascade) — across every device;
//   * CLEAR the durable profile + cached Shopify summaries (they live on the
//     customers row, deleted here);
//   * REVOKE the OAuth tokens (customer_oauth_tokens cascade with the row);
//   * SUPPRESS the email (reason 'erasure') + purge its consent record so a
//     future sign-in can't silently re-attach the old data.
//
// After this the session no longer resolves to a customer — every subsequent
// /api/account/* call (and /api/auth/me) fails closed. The widget should clear
// its signed-in UI; the customer may also log out of Shopify itself.
//
// Gated by the CA-1 signed-in resolver; anonymous / email-only fail closed.

import { preflightResponse } from "@/lib/security";
import { errorResponse, reportError } from "@/lib/observability";
import { requireSignedInCustomer } from "@/lib/account-guard";
import { eraseSignedInCustomer } from "@/lib/account-history";

export const runtime = "nodejs";
export const maxDuration = 20;

const METHODS = "POST, OPTIONS";

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

export async function POST(req: Request) {
  const guard = await requireSignedInCustomer(req, METHODS);
  if (!guard.ok) return guard.response;

  try {
    const result = await eraseSignedInCustomer(guard.customerId);
    if (!result) {
      // No DB / hard failure — be honest rather than claim a phantom erasure.
      return errorResponse(
        "upstream_unavailable",
        "Löschung konnte nicht durchgeführt werden — bitte später erneut versuchen.",
        503,
        guard.headers
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        erased: true,
        deletedConversations: result.deletedConversations,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...guard.headers,
        },
      }
    );
  } catch (err) {
    reportError(err, { route: "api/account/erase" });
    return errorResponse("internal_error", "Unexpected server error", 500, guard.headers);
  }
}
