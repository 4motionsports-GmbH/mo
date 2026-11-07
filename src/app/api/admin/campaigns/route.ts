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
import { senderDomains } from "@/lib/sender-store";
import { createMailing } from "@/lib/mailing-store";
import { getMailTemplate } from "@/lib/mail-template-store";
import { MAIL_TEMPLATE_STARTERS, stripMoBlocks } from "@/lib/mail-template-doc.mjs";
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
  const v = validateCampaignInput(raw, {
    create: true,
    maxDiscountPercent: DISCOUNT_PERCENT_MAX,
    senderDomains: senderDomains(),
  });
  if (!v.ok) {
    return adminJsonError("invalid", Object.values(v.errors)[0] ?? "Ungültige Eingabe.", 400);
  }
  try {
    const rundmail = v.value.kind === "rundmail";
    const input = (rundmail ? { ...v.value, audienceMode: "dynamisch" } : v.value) as unknown as CampaignInput & {
      name: string;
      kind: "laufend" | "aktion" | "rundmail";
    };
    const id = await createCampaign(input);
    if (!id) return adminJsonError("internal_error", "Die Kampagne konnte nicht angelegt werden.", 500);
    if (rundmail) {
      // The content starts from a template (its Mo blocks dropped — a
      // Rundmail has no per-recipient AI content) or a starter.
      const templateId = Number(raw.templateId);
      const template = Number.isInteger(templateId) && templateId > 0 ? await getMailTemplate(templateId) : null;
      const starter =
        MAIL_TEMPLATE_STARTERS.find((s) => s.key === raw.starter && s.use !== "personal") ??
        MAIL_TEMPLATE_STARTERS.find((s) => s.key === "newsletter")!;
      const ok = await createMailing(id, {
        doc: template ? stripMoBlocks(template.doc) : starter.build(),
        subject: "",
        sourceTemplateId: template?.id ?? null,
      });
      if (!ok) return adminJsonError("internal_error", "Der Inhalt der Rundmail konnte nicht angelegt werden (Migration 0081?).", 500);
    }
    return adminJson({ id });
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns", phase: "create" });
    return adminJsonError("internal_error", "Die Kampagne konnte nicht angelegt werden.", 500);
  }
}
