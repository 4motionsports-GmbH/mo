// The workspace of a Rundmail campaign (server-rendered) — kind 'rundmail'
// has no review desk: one content for everyone, edited, tested, checked and
// released here (docs/CAMPAIGNS.md §9). Loads the content, the figures and
// the KI-Gestalter's stored settings (its first choice per conversation);
// the client workspace (rundmail/) drives everything through
// /api/admin/rundmail.

import { campaignPhase } from "@/lib/campaign-def.mjs";
import type { Campaign } from "@/lib/campaigns-store";
import { createMailing, getMailing, getMailingStats } from "@/lib/mailing-store";
import { MAIL_TEMPLATE_STARTERS } from "@/lib/mail-template-doc.mjs";
import { isCampaignSendsApproved, isSingleOptInAllowed } from "@/lib/campaign-flags.mjs";
import { resolveCampaignSender } from "@/lib/sender-store";
import { listMailTemplateMeta } from "@/lib/mail-template-store";
import { isTemplateImageUploadConfigured } from "@/lib/mail-template-image";
import { getDesignerSettings } from "@/lib/admin-settings-store";
import { RundmailWorkspace } from "./lazy";
import { Callout } from "./ui";

export async function RundmailTab({
  campaign,
  audienceText,
  initialView,
}: {
  campaign: Campaign;
  audienceText: string;
  /** `?view=inhalt|pruefen|versand` — the workspace tab to open. */
  initialView?: string;
}) {
  let mailing = await getMailing(campaign.id);
  if (!mailing) {
    // A Rundmail whose content row is missing (created before 0081 ran, or
    // after a data reset): start it with the newsletter starter.
    const starter = MAIL_TEMPLATE_STARTERS.find((s) => s.key === "newsletter")!;
    await createMailing(campaign.id, { doc: starter.build(), subject: "" });
    mailing = await getMailing(campaign.id);
  }
  if (!mailing) {
    return <Callout tone="destructive">Der Inhalt dieser Rundmail kann nicht geladen werden (Migration 0081?).</Callout>;
  }
  // getDesignerSettings answers the defaults without a database or a stored row.
  const [stats, templates, designerSettings] = await Promise.all([
    getMailingStats(campaign.id),
    listMailTemplateMeta(),
    getDesignerSettings(),
  ]);
  const sender = resolveCampaignSender(campaign.sender);
  return (
    <RundmailWorkspace
      key={campaign.id}
      campaign={{
        id: campaign.id,
        name: campaign.name,
        slug: campaign.slug,
        status: campaign.status,
        phase: campaignPhase(campaign),
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        audienceText,
      }}
      initialMailing={mailing}
      initialStats={stats}
      sendsApproved={isCampaignSendsApproved()}
      allowSingleOptIn={isSingleOptInAllowed()}
      sender={sender.ok ? { ok: true, from: sender.from, replyTo: sender.replyTo ?? null } : { ok: false, message: sender.message }}
      uploadConfigured={isTemplateImageUploadConfigured()}
      aiConfigured={Boolean(process.env.ANTHROPIC_API_KEY)}
      designerSettings={designerSettings}
      templates={templates.map((t) => ({ id: t.id, name: t.name }))}
      initialView={initialView}
    />
  );
}
