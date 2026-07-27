// POST /api/admin/campaign/mark-done  { contactId }
//
// The COPY workflow's explicit completion step: after the admin copied the
// draft text out (Copy never mutates state by itself), this marks the contact
// 'sent' with a sent_via='copy' campaign_sends record (body hash of the draft
// at completion time; no discount code is minted on this path — the copied
// text carries the placeholder, which the UI warns about).
//
// Deliberately NOT gated by CAMPAIGN_SENDS_APPROVED: nothing is delivered by
// the system here — the flag gates system sends, Copy always works.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  getContactById,
  getDraftForContact,
  hashCampaignBody,
  markContactSent,
  recordCampaignSend,
} from "@/lib/campaign-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let contactId: number;
  try {
    const json = (await req.json()) as { contactId?: unknown };
    contactId = Number(json.contactId);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return adminJsonError("bad_request", "contactId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const contact = await getContactById(contactId);
    if (!contact) return adminJsonError("not_found", "Contact not found.", 404);
    const draft = await getDraftForContact(contactId);
    if (!draft || contact.status !== "drafted") {
      return adminJsonError(
        "not_markable",
        "Contact has no reviewable draft (already sent or skipped?).",
        409
      );
    }

    // Flip FIRST (double-send-proof guard), then append the audit record.
    const marked = await markContactSent(contactId);
    if (!marked) {
      return adminJsonError("not_markable", "Contact is no longer markable.", 409);
    }
    await recordCampaignSend({
      contactId,
      email: contact.email,
      subject: draft.subject,
      bodyHash: hashCampaignBody(draft.body),
      // Retain the copied prose (0038); no HTML was delivered on this path.
      bodyText: draft.body,
      bodyHtml: null,
      sentVia: "copy",
      discountCode: null,
      discountCodeGid: null,
      discountExpiresAt: null,
    });
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/mark-done" });
    return adminJsonError("internal_error", "Could not mark the contact done.", 500);
  }
}
