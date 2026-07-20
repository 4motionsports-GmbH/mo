// POST /api/admin/campaign/send  { contactId }
//
// Approve & send the (possibly edited) campaign draft THROUGH THE SYSTEM. All
// the legal guarantees live in approveAndSendCampaign (lib/campaign-email):
// the CAMPAIGN_SENDS_APPROVED master gate, the opt-in-level gate, the send-time
// suppression re-check, the cross-channel frequency cap, the mandatory
// unsubscribe link + List-Unsubscribe header, MK- code minting, and the
// immutable campaign_sends record. While the master flag is false this route
// refuses EVERY send — via UI or direct API call.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { approveAndSendCampaign } from "@/lib/campaign-email";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

// Map the domain refusal reasons to HTTP statuses (mirrors the marketing send
// route; the frequency cap is a 429 per spec).
const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  no_draft: 409,
  already_sent: 409,
  sends_not_approved: 403,
  opt_in_blocked: 403,
  not_eligible: 409,
  too_soon: 429,
  no_unsubscribe: 503,
  claim_failed: 409,
  discount_mismatch: 409,
  discount_failed: 502,
  email_not_configured: 503,
  send_failed: 502,
};

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let contactId: number;
  try {
    const json = (await req.json()) as { contactId?: unknown };
    contactId = Number(json.contactId);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return adminJsonError("bad_request", "contactId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const result = await approveAndSendCampaign(contactId);
    if (result.ok) {
      return adminJson({ ok: true, sentTo: result.sentTo });
    }
    const status = STATUS_BY_REASON[result.reason] ?? 400;
    return adminJsonError(result.reason, result.message, status);
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/send" });
    return adminJsonError("internal_error", "Send failed.", 500);
  }
}
