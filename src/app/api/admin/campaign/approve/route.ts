// POST /api/admin/campaign/approve  { contactId, releaseAt? } → { ok, releaseAt }
//
// „Freigeben" on the review desk: the person approves THIS reviewed mail for the
// release job, from `releaseAt` on (ISO; empty = with the next run, at most 30
// days ahead). Every gate the send would run is checked now (without sending);
// the release job sends through approveAndSendCampaign and checks them all
// again. Refusals answer 409 with the reason; nothing is approved then.
// CAMPAIGN_RELEASE_ENABLED must be on. Audit-logged (campaign.approve).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { approveForRelease } from "@/lib/campaign-release";
import { getContactById } from "@/lib/campaign-store";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let contactId: number;
  let releaseAt: unknown;
  try {
    const json = (await req.json()) as { contactId?: unknown; releaseAt?: unknown };
    contactId = Number(json.contactId);
    releaseAt = json.releaseAt ?? null;
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return adminJsonError("bad_request", "contactId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const result = await approveForRelease(contactId, releaseAt);
    if (!result.ok) return adminJsonError(result.reason, result.message, result.reason === "not_found" ? 404 : 409);
    const contact = await getContactById(contactId);
    await recordAdminAccess(
      {
        action: "campaign.approve",
        targetCustomerId: contact?.customerId ?? null,
        detail: { contactId, campaignId: contact?.campaignId ?? null, releaseAt: result.releaseAt },
      },
      req
    );
    return adminJson({ ok: true, releaseAt: result.releaseAt });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/approve" });
    return adminJsonError("internal_error", "Die Freigabe konnte nicht gespeichert werden.", 500);
  }
}
