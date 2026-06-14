// POST /api/admin/marketing/delete  { sendId }
//
// DELETE an unsent marketing-email draft. STRICT: only rows still in 'draft'
// state are removable (deleteDraftSend guards on status = 'draft'). A 'sent'
// email is immutable (the sent-is-read-only guarantee) and an 'approved' row is
// an in-flight send — neither is deletable. A draft mints no Shopify code and no
// redirect token, and its placeholder/preview state lives entirely on the row,
// so the delete cleans that up and mints nothing. Auth + CSRF via guardAdminPost.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { deleteDraftSend } from "@/lib/marketing-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let sendId: number;
  try {
    const json = (await req.json()) as { sendId?: unknown };
    sendId = Number(json.sendId);
    if (!Number.isInteger(sendId) || sendId <= 0) {
      return adminJsonError("bad_request", "sendId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const deleted = await deleteDraftSend(sendId);
    if (!deleted) {
      return adminJsonError(
        "not_deletable",
        "Draft not found or not deletable (sent emails are immutable; an in-flight send can't be deleted).",
        409
      );
    }
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/marketing/delete" });
    return adminJsonError("internal_error", "Could not delete the draft.", 500);
  }
}
