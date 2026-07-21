// POST /api/admin/campaign/unskip  { contactId }
//
// Undo a skip: the contact returns to 'drafted' when its draft still exists
// (straight back into the review queue), otherwise to 'pending' (the client
// then triggers a fresh draft). The inverse of /skip — skips are review
// decisions, not terminal states.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { unskipContact } from "@/lib/campaign-store";
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
    const status = await unskipContact(contactId);
    if (!status) {
      return adminJsonError("not_skipped", "Contact is not skipped.", 409);
    }
    return adminJson({ ok: true, status });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/unskip" });
    return adminJsonError("internal_error", "Could not restore the contact.", 500);
  }
}
