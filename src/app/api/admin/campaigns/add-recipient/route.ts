// POST /api/admin/campaigns/add-recipient
//   { customerId, campaignId?, adminNote?, conversationId?, draft? } → { contactId, campaignId, created, drafted }
//
// Put one person into a campaign by hand — without campaignId into the
// built-in Einzelansprache (the 1:1 mail from Kunden or an Eingang
// suggestion). Requires the one consent and no block (the send gate checks
// again). `draft: true` writes the draft right away, with the campaign's
// offer settings, so the desk opens on a ready card.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { addRecipient, getCampaign, getEinzelCampaign } from "@/lib/campaigns-store";
import { getContactById } from "@/lib/campaign-store";
import { prepareDraftForContact } from "@/lib/campaign-prepare";
import { reportError } from "@/lib/observability";
import { recordAdminAccess } from "@/lib/admin-access-log";

export const maxDuration = 120;

const REASONS: Record<string, [number, string]> = {
  no_consent: [409, "Für diese Person liegt keine Einwilligung in E-Mail-Werbung vor."],
  blocked: [409, "Die Adresse ist gesperrt (Bounce, Beschwerde oder Löschung)."],
  not_found: [404, "Kunde oder Kampagne nicht gefunden."],
  campaign_closed: [409, "Die Kampagne ist beendet."],
  db: [503, "Datenbank nicht erreichbar."],
};

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  const customerId = Number(body.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) return adminJsonError("bad_request", "customerId required", 400);
  const note = typeof body.adminNote === "string" ? body.adminNote.trim().slice(0, 1500) || null : null;
  const conversationId = Number.isInteger(body.conversationId) ? Number(body.conversationId) : null;
  try {
    const campaign = Number.isInteger(body.campaignId)
      ? await getCampaign(Number(body.campaignId))
      : await getEinzelCampaign();
    if (!campaign) return adminJsonError("not_found", "Kampagne nicht gefunden.", 404);
    const res = await addRecipient({ campaignId: campaign.id, customerId, adminNote: note, conversationId });
    if (!res.ok) {
      const [status, message] = REASONS[res.reason] ?? [500, "Fehler."];
      return adminJsonError(res.reason, message, status);
    }
    let drafted = false;
    if (body.draft === true) {
      const contact = await getContactById(res.contactId);
      if (contact && (contact.status === "pending" || contact.status === "draft_failed")) {
        try {
          drafted = (await prepareDraftForContact(contact, campaign.discountPercent, {
            textMode: campaign.textMode ?? undefined,
            discountScope: campaign.discountScope,
          })) !== null;
        } catch (err) {
          reportError(err, { route: "api/admin/campaigns/add-recipient", phase: "draft" });
        }
      } else drafted = contact?.status === "drafted";
    }
    await recordAdminAccess(
      { action: "campaign.add_recipient", targetCustomerId: customerId, detail: { campaignId: campaign.id, contactId: res.contactId, drafted } },
      req
    );
    return adminJson({ contactId: res.contactId, campaignId: campaign.id, created: res.created, drafted });
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns/add-recipient" });
    return adminJsonError("internal_error", "Die Person konnte nicht aufgenommen werden.", 500);
  }
}
