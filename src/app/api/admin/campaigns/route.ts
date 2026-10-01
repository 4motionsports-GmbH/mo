// GET  /api/admin/campaigns            → { campaigns: CampaignWithStats[] }
// POST /api/admin/campaigns  { name, kind, … } → { id }
//
// The campaign list (Kampagnen overview) and "Neue Kampagne" (wizard). The
// input is validated by campaign-def.validateCampaignInput; a new campaign
// starts as Entwurf — nothing is materialised or drafted until it is started.
// docs/CAMPAIGNS.md §2. Auth via guardAdminGet / guardAdminPost.

import { guardAdminGet, guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { createCampaign, listCampaigns, type CampaignInput } from "@/lib/campaigns-store";
import { validateCampaignInput } from "@/lib/campaign-def.mjs";
import { DISCOUNT_PERCENT_MAX } from "@/lib/discount-validation.mjs";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

export async function GET() {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  return adminJson({ campaigns: await listCampaigns({ includeArchived: true }) });
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) return adminJsonError("no_database", "No database configured.", 503);
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  const v = validateCampaignInput(raw, { create: true, maxDiscountPercent: DISCOUNT_PERCENT_MAX });
  if (!v.ok) {
    return adminJsonError("invalid", Object.values(v.errors)[0] ?? "Ungültige Eingabe.", 400);
  }
  try {
    const id = await createCampaign(v.value as unknown as CampaignInput & { name: string; kind: "laufend" | "aktion" });
    if (!id) return adminJsonError("internal_error", "Die Kampagne konnte nicht angelegt werden.", 500);
    return adminJson({ id });
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns", phase: "create" });
    return adminJsonError("internal_error", "Die Kampagne konnte nicht angelegt werden.", 500);
  }
}
