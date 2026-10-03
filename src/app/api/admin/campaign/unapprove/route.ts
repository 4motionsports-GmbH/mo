// POST /api/admin/campaign/unapprove  { contactId } → { ok }
//
// „Zurücknehmen": takes an approval back before the release job sent the mail;
// it returns to the review queue. 409 when there is no open approval (already
// sent, or taken back). Audit-logged (campaign.approve.revoke).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getContactById, revokeContactApproval } from "@/lib/campaign-store";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;

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
    const revoked = await revokeContactApproval(contactId, null);
    if (!revoked) return adminJsonError("not_approved", "Diese Mail ist nicht (mehr) freigegeben.", 409);
    const contact = await getContactById(contactId);
    await recordAdminAccess(
      {
        action: "campaign.approve.revoke",
        targetCustomerId: contact?.customerId ?? null,
        detail: { contactId, campaignId: contact?.campaignId ?? null },
      },
      req
    );
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/unapprove" });
    return adminJsonError("internal_error", "Die Freigabe konnte nicht zurückgenommen werden.", 500);
  }
}
