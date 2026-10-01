// POST /api/admin/campaigns/add-recipients  { campaignId?, customerIds: number[], adminNote? }
//   → { campaignId, added, alreadyIn, noConsent, blocked, notFound }
//
// Kunden → „Zur Kampagne hinzufügen…“ for a selection (at most 200 people per
// call). Each person goes through addRecipient: the one consent and no hard
// block are required, so people without consent are counted and skipped,
// never added. No campaign id = the Einzelansprache. Nothing is drafted or
// sent here — the desk prepares the drafts.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { addRecipient, getCampaign, getEinzelCampaign } from "@/lib/campaigns-store";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

const MAX_PER_CALL = 200;

export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let body: { campaignId?: unknown; customerIds?: unknown; adminNote?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  const ids = Array.isArray(body.customerIds)
    ? [...new Set(body.customerIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : [];
  if (ids.length === 0) return adminJsonError("bad_request", "customerIds required", 400);
  if (ids.length > MAX_PER_CALL) {
    return adminJsonError("bad_request", `Höchstens ${MAX_PER_CALL} Personen auf einmal.`, 400);
  }
  const note = typeof body.adminNote === "string" ? body.adminNote.trim().slice(0, 2000) || null : null;
  try {
    const campaign =
      body.campaignId != null ? await getCampaign(Number(body.campaignId)) : await getEinzelCampaign();
    if (!campaign) return adminJsonError("not_found", "Kampagne nicht gefunden.", 404);
    if (campaign.status === "beendet" || campaign.status === "archiviert") {
      return adminJsonError("campaign_closed", "Die Kampagne ist beendet.", 409);
    }
    const out = { added: 0, alreadyIn: 0, noConsent: 0, blocked: 0, notFound: 0, failed: 0 };
    for (const customerId of ids) {
      const res = await addRecipient({ campaignId: campaign.id, customerId, adminNote: note });
      if (res.ok) {
        if (res.created) out.added++;
        else out.alreadyIn++;
      } else if (res.reason === "no_consent") out.noConsent++;
      else if (res.reason === "blocked") out.blocked++;
      else if (res.reason === "not_found") out.notFound++;
      else out.failed++;
    }
    await recordAdminAccess(
      { action: "campaign.add_recipients", detail: { campaignId: campaign.id, requested: ids.length, added: out.added } },
      req
    );
    return adminJson({ campaignId: campaign.id, campaignSlug: campaign.slug, ...out });
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns/add-recipients" });
    return adminJsonError("internal_error", "Hinzufügen fehlgeschlagen.", 500);
  }
}
