// POST /api/admin/campaigns/refresh  { campaignId } → AudienceRefreshResult
//
// „Zielgruppe aktualisieren“ on the desk: re-match the audience over the
// customer base now (the nightly cron does the same for every active one).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { refreshCampaignAudience } from "@/lib/campaigns-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 120;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let campaignId: number;
  try {
    const body = (await req.json()) as { campaignId?: unknown };
    campaignId = Number(body.campaignId);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return adminJsonError("bad_request", "campaignId required", 400);
  }
  try {
    const result = await refreshCampaignAudience(campaignId);
    if (!result.ok) return adminJsonError("refresh_failed", "Die Zielgruppe konnte nicht aktualisiert werden.", 503);
    return adminJson(result);
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns/refresh" });
    return adminJsonError("internal_error", "Die Zielgruppe konnte nicht aktualisiert werden.", 500);
  }
}
