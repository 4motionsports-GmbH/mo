// POST /api/admin/campaign/skip  { contactId }
//
// Review decision: skip this contact (status 'skipped', queue moves on). A
// skipped contact is never mailed by this campaign round; the row stays for
// the audit trail and the counts.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { markContactSkipped } from "@/lib/campaign-store";
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
    const skipped = await markContactSkipped(contactId);
    if (!skipped) {
      return adminJsonError(
        "not_skippable",
        "Contact not found or not in a skippable state.",
        409
      );
    }
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/skip" });
    return adminJsonError("internal_error", "Could not skip the contact.", 500);
  }
}
