// POST /api/admin/campaign/update  { contactId, subject, body }
//
// Persist the admin's edits to a campaign draft (subject + body). Only while
// the contact is still in review ('drafted') — a sent record is immutable.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { updateCampaignDraftText } from "@/lib/campaign-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let contactId: number;
  let subject: string;
  let body: string;
  try {
    const json = (await req.json()) as {
      contactId?: unknown;
      subject?: unknown;
      body?: unknown;
    };
    contactId = Number(json.contactId);
    subject = typeof json.subject === "string" ? json.subject.trim() : "";
    body = typeof json.body === "string" ? json.body : "";
    if (!Number.isInteger(contactId) || contactId <= 0 || !subject || !body.trim()) {
      return adminJsonError("bad_request", "contactId, subject and body required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const updated = await updateCampaignDraftText(contactId, subject, body);
    if (!updated) {
      return adminJsonError(
        "not_editable",
        "Draft not found or no longer editable (already sent?).",
        409
      );
    }
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/update" });
    return adminJsonError("internal_error", "Could not save the draft.", 500);
  }
}
