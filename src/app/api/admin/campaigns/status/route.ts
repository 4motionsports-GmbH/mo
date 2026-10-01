// POST /api/admin/campaigns/status  { id, status } → { campaign, refresh }
//
// Starten / Pausieren / Fortsetzen / Beenden / Archivieren. Allowed moves are
// campaign-def.canTransition; starting materialises the audience at once.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { setCampaignStatus, type CampaignStatus } from "@/lib/campaigns-store";
import { CAMPAIGN_STATUSES } from "@/lib/campaign-def.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 120;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let id: number;
  let status: string;
  try {
    const body = (await req.json()) as { id?: unknown; status?: unknown };
    id = Number(body.id);
    status = String(body.status ?? "");
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  if (!Number.isInteger(id) || id <= 0) return adminJsonError("bad_request", "id required", 400);
  if (!(CAMPAIGN_STATUSES as readonly string[]).includes(status)) {
    return adminJsonError("bad_request", "Unbekannter Status.", 400);
  }
  try {
    const res = await setCampaignStatus(id, status as CampaignStatus);
    if (!res.ok) {
      if (res.reason === "not_found") return adminJsonError("not_found", "Kampagne nicht gefunden.", 404);
      if (res.reason === "invalid_transition") {
        return adminJsonError("invalid_transition", "Dieser Statuswechsel ist nicht möglich.", 409);
      }
      return adminJsonError("internal_error", "Der Status konnte nicht geändert werden.", 500);
    }
    return adminJson({ campaign: res.campaign, refresh: res.refresh });
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns/status" });
    return adminJsonError("internal_error", "Der Status konnte nicht geändert werden.", 500);
  }
}
