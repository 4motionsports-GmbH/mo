// POST /api/admin/inbox/accept  { id } → { contactId, campaignId, drafted }
//
// „Entwurf übernehmen“: the item's suggestion becomes an Einzelansprache —
// the person is added to the built-in campaign with the suggestion as the
// drafter's note (and its discount), the draft is written, and the item is
// marked erledigt. The review card then opens on the desk; nothing is sent.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { decideInboxItem, getInboxItem } from "@/lib/inbox-store";
import { addRecipient, getEinzelCampaign } from "@/lib/campaigns-store";
import { getContactById } from "@/lib/campaign-store";
import { prepareDraftForContact } from "@/lib/campaign-prepare";
import { reportError } from "@/lib/observability";

export const maxDuration = 120;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let id: number;
  try {
    id = Number(((await req.json()) as { id?: unknown }).id);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  if (!Number.isInteger(id) || id <= 0) return adminJsonError("bad_request", "id required", 400);
  try {
    const item = await getInboxItem(id);
    if (!item || item.customerId == null) return adminJsonError("not_found", "Eintrag nicht gefunden.", 404);
    const campaign = await getEinzelCampaign();
    if (!campaign) return adminJsonError("not_found", "Die Einzelansprache fehlt (Migration 0066).", 500);
    const s = item.suggestion;
    const note = [
      `Anlass: ${item.title} — ${item.reason}`,
      s?.warum ? `Warum: ${s.warum}` : null,
      s?.aktion ? `Ziel der Mail: ${s.aktion}` : null,
      s?.text ? `Skizze: ${s.text}` : null,
      s?.produkte?.length ? `Produkte: ${s.produkte.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1500);
    const res = await addRecipient({ campaignId: campaign.id, customerId: item.customerId, adminNote: note });
    if (!res.ok) {
      const message =
        res.reason === "no_consent"
          ? "Keine Einwilligung für E-Mail-Werbung — keine Einzelansprache."
          : res.reason === "blocked"
            ? "Die Adresse ist gesperrt."
            : "Die Person konnte nicht aufgenommen werden.";
      return adminJsonError(res.reason, message, 409);
    }
    let drafted = false;
    const contact = await getContactById(res.contactId);
    if (contact && (contact.status === "pending" || contact.status === "draft_failed")) {
      try {
        drafted =
          (await prepareDraftForContact(contact, s?.rabatt?.prozent ?? campaign.discountPercent, {
            textMode: campaign.textMode ?? undefined,
            discountScope: campaign.discountScope,
          })) !== null;
      } catch (err) {
        reportError(err, { route: "api/admin/inbox/accept", phase: "draft" });
      }
    } else drafted = contact?.status === "drafted";
    await decideInboxItem(id, "erledigt", { action: "einzelansprache" });
    return adminJson({ contactId: res.contactId, campaignId: campaign.id, drafted });
  } catch (err) {
    reportError(err, { route: "api/admin/inbox/accept" });
    return adminJsonError("internal_error", "Übernehmen fehlgeschlagen.", 500);
  }
}
