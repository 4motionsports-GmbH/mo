// POST /api/admin/campaigns/assist
//   { action: "audience", text }                          → { spec, explanation }
//   { action: "brief", name, kind, notes, endsAt?, discountPercent? } → { brief }
//
// AI help in the wizard (writer tier, lib/campaign-assist.ts). Proposals only —
// the operator reviews the description and the count before saving.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { suggestAudienceSpec, suggestCampaignBrief } from "@/lib/campaign-assist";
import { loadProductCatalog } from "@/lib/catalog-store";
import { formatAdmin, ADMIN_DATE } from "@/lib/admin-datetime.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  try {
    if (body.action === "audience") {
      const catalog = await loadProductCatalog().catch(() => []);
      const categories = [...new Set(catalog.map((p) => p.category).filter((c): c is string => Boolean(c)))];
      const res = await suggestAudienceSpec(String(body.text ?? ""), { categories });
      if (!res.ok) return adminJsonError("assist_failed", res.message, 422);
      return adminJson({ spec: res.spec, explanation: res.explanation });
    }
    if (body.action === "brief") {
      const res = await suggestCampaignBrief({
        name: String(body.name ?? "").slice(0, 80),
        kind: body.kind === "laufend" ? "laufend" : "aktion",
        notes: String(body.notes ?? ""),
        endsLabel: body.endsAt ? formatAdmin(String(body.endsAt), ADMIN_DATE) : null,
        discountPercent: Number.isInteger(body.discountPercent) ? Number(body.discountPercent) : 0,
      });
      if (!res.ok) return adminJsonError("assist_failed", res.message, 422);
      return adminJson({ brief: res.brief });
    }
    return adminJsonError("bad_request", "action must be audience or brief", 400);
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns/assist" });
    return adminJsonError("internal_error", "Die KI-Hilfe ist gerade nicht verfügbar.", 500);
  }
}
