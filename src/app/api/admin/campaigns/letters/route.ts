// POST /api/admin/campaigns/letters — letters as a campaign channel (0074,
// docs/CAMPAIGNS.md §8), the desk's „Briefe“ view:
//   { action: "list", campaignId }              → LetterDeskData
//   { action: "fill_addresses", campaignId }    → one address step (purchase addresses)
//   { action: "draft", campaignId }             → one drafting step (pending letters)
//   { action: "redraft", id }                   → a new AI draft for one letter
//   { action: "save", id, subject, body }       → the operator's text (back to review)
//   { action: "approve" | "unapprove", id }     → release / take back ONE letter
//   { action: "skip" | "unskip", id }
//   { action: "send_step", campaignId }         → post released letters (every gate re-checked)
//
// Auth + CSRF via guardAdminPost; letter sends and releases go to the admin
// access log.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { getCampaign } from "@/lib/campaigns-store";
import {
  approveCampaignLetter,
  getCampaignLetter,
  saveCampaignLetterText,
  skipCampaignLetter,
  unapproveCampaignLetter,
} from "@/lib/campaign-letters-store";
import {
  draftCampaignLetters,
  fillCampaignLetterAddresses,
  letterDeskData,
  sendCampaignLetterStep,
} from "@/lib/campaign-letters";
import { draftCampaignLetter } from "@/lib/campaign-letter-draft";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";

export const maxDuration = 300;

/** Per step: addresses (one Admin API call per 50), drafts (one AI call each), sends (three Pingen calls each). */
const ADDRESS_BATCH = 50;
const DRAFT_BATCH = 5;
const SEND_BATCH = 5;

const intId = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

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
  const action = String(raw.action ?? "");

  try {
    if (["list", "fill_addresses", "draft", "send_step"].includes(action)) {
      const campaignId = intId(raw.campaignId);
      if (!campaignId) return adminJsonError("bad_request", "campaignId required", 400);
      const campaign = await getCampaign(campaignId);
      if (!campaign) return adminJsonError("not_found", "Kampagne nicht gefunden.", 404);
      if (action === "list") return adminJson(await letterDeskData(campaign));
      if (campaign.letterMode === "aus") {
        return adminJsonError("letters_off", "Für diese Kampagne sind Briefe ausgeschaltet (Bearbeiten → Brief).", 409);
      }
      if (action === "fill_addresses") {
        const r = await fillCampaignLetterAddresses(campaignId, ADDRESS_BATCH);
        if (!r.ok && r.reason === "flag_off") {
          return adminJsonError("flag_off", "Briefversand ist nicht freigeschaltet — Adressen werden dann nicht geholt.", 403);
        }
        if (!r.ok && r.reason === "shopify_not_configured") {
          return adminJsonError("shopify_not_configured", "Shopify ist nicht konfiguriert.", 503);
        }
        return adminJson(r);
      }
      if (action === "draft") return adminJson(await draftCampaignLetters(campaignId, DRAFT_BATCH));
      const step = await sendCampaignLetterStep(campaignId, SEND_BATCH);
      if (step.sent > 0 || step.refused.length > 0) {
        await recordAdminAccess(
          { action: "campaign.letters_send", targetCustomerId: null, detail: { campaignId, sent: step.sent, refused: step.refused.length } },
          req
        );
      }
      return step.ok ? adminJson(step) : adminJsonError("internal_error", "Versand-Schritt fehlgeschlagen.", 500);
    }

    const id = intId(raw.id);
    if (!id) return adminJsonError("bad_request", "id required", 400);
    const letter = await getCampaignLetter(id);
    if (!letter) return adminJsonError("not_found", "Brief nicht gefunden.", 404);

    switch (action) {
      case "redraft": {
        if (letter.postalObjectionAt) return adminJsonError("objection", "Widerspruch gegen Briefwerbung — kein Entwurf.", 409);
        const ok = await draftCampaignLetter(id);
        return ok ? adminJson({ ok: true }) : adminJsonError("conflict", "Für diesen Brief kann kein Entwurf mehr geschrieben werden.", 409);
      }
      case "save": {
        const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
        const body = typeof raw.body === "string" ? raw.body.trim() : "";
        if (!subject || subject.length > 200 || !body || body.length > 8000) {
          return adminJsonError("bad_request", "Betreff (bis 200 Zeichen) und Text (bis 8.000 Zeichen) angeben.", 400);
        }
        const ok = await saveCampaignLetterText(id, { subject, body, edited: true });
        return ok ? adminJson({ ok: true }) : adminJsonError("conflict", "Dieser Brief kann nicht mehr geändert werden.", 409);
      }
      case "approve": {
        if (letter.postalObjectionAt) {
          return adminJsonError("objection", "Widerspruch gegen Briefwerbung (Art. 21 DSGVO) — kein Brief.", 409);
        }
        const ok = await approveCampaignLetter(id);
        if (!ok) return adminJsonError("conflict", "Nur ein Entwurf mit Betreff und Text kann freigegeben werden.", 409);
        await recordAdminAccess(
          { action: "campaign.letter_approve", targetCustomerId: letter.customerId, detail: { letterId: id, campaignId: letter.campaignId } },
          req
        );
        return adminJson({ ok: true });
      }
      case "unapprove": {
        const ok = await unapproveCampaignLetter(id);
        return ok ? adminJson({ ok: true }) : adminJsonError("conflict", "Der Brief ist nicht freigegeben.", 409);
      }
      case "skip":
      case "unskip": {
        const ok = await skipCampaignLetter(id, action === "skip");
        return ok ? adminJson({ ok: true }) : adminJsonError("conflict", "Status passt nicht.", 409);
      }
      default:
        return adminJsonError("bad_request", "Unknown action", 400);
    }
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns/letters", phase: action });
    return adminJsonError("internal_error", "Die Aktion ist fehlgeschlagen.", 500);
  }
}
