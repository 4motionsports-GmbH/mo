// POST /api/admin/campaigns/update  { id, …fields } → { campaign }
//
// Edit a campaign (wizard / „Bearbeiten“). Only the fields present are
// validated and written (campaign-def.validateCampaignInput); the
// Einzelansprache keeps its audience and schedule. A changed audience of an
// active campaign is re-materialised right away.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getCampaign, refreshCampaignAudience, updateCampaign, type CampaignInput } from "@/lib/campaigns-store";
import { validateCampaignInput } from "@/lib/campaign-def.mjs";
import { senderDomains } from "@/lib/sender-store";
import { sameSenderIdentity, type SenderIdentity } from "@/lib/sender-identities.mjs";
import { clearMailingTest } from "@/lib/mailing-store";
import { DISCOUNT_PERCENT_MAX } from "@/lib/discount-validation.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 120;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  const id = Number(raw.id);
  if (!Number.isInteger(id) || id <= 0) return adminJsonError("bad_request", "id required", 400);
  const { id: _omit, kind: _kind, ...fields } = raw;
  void _omit;
  void _kind;
  try {
    const current = await getCampaign(id);
    if (!current) return adminJsonError("not_found", "Kampagne nicht gefunden.", 404);
    // A released Rundmail (0081) keeps its audience, sender and schedule —
    // they are frozen with the content; only the name may still change.
    const locked = current.kind === "rundmail" && current.status !== "entwurf";
    const input = locked ? { ...(typeof fields.name === "string" ? { name: fields.name } : {}) } : fields;
    const v = validateCampaignInput(input, {
      maxDiscountPercent: DISCOUNT_PERCENT_MAX,
      current,
      senderDomains: senderDomains(),
    });
    if (!v.ok) return adminJsonError("invalid", Object.values(v.errors)[0] ?? "Ungültige Eingabe.", 400);
    const value = locked ? { ...(v.value.name ? { name: v.value.name } : {}) } : v.value;
    const ok = await updateCampaign(id, value as unknown as CampaignInput);
    if (!ok) return adminJsonError("not_found", "Kampagne nicht gefunden.", 404);
    // A Rundmail's test mail showed the old sender — require a new one.
    if (current.kind === "rundmail" && !locked && "sender" in value && !sameSenderIdentity(current.sender, (value.sender ?? null) as SenderIdentity | null)) {
      await clearMailingTest(id);
    }
    let campaign = await getCampaign(id);
    if (campaign && campaign.status === "aktiv" && campaign.kind !== "rundmail" && ("audience" in value || "audienceMode" in value)) {
      await refreshCampaignAudience(id);
      campaign = await getCampaign(id);
    }
    return adminJson({ campaign });
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns/update" });
    return adminJsonError("internal_error", "Die Kampagne konnte nicht gespeichert werden.", 500);
  }
}
