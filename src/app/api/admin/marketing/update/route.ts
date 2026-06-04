// POST /api/admin/marketing/update  { sendId, subject, body }
//
// Save admin edits to a draft's subject + text. Only mutates rows still in a
// non-sent state (updateDraftText guards on status <> 'sent'); a sent email is
// immutable. Auth + CSRF via guardAdminPost.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { updateDraftText } from "@/lib/marketing-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;

const MAX_SUBJECT = 300;
const MAX_BODY = 20_000;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let sendId: number;
  let subject: string;
  let body: string;
  try {
    const json = (await req.json()) as { sendId?: unknown; subject?: unknown; body?: unknown };
    sendId = Number(json.sendId);
    subject = typeof json.subject === "string" ? json.subject.slice(0, MAX_SUBJECT) : "";
    body = typeof json.body === "string" ? json.body.slice(0, MAX_BODY) : "";
    if (!Number.isInteger(sendId) || sendId <= 0) {
      return adminJsonError("bad_request", "sendId required", 400);
    }
    if (!body.trim()) {
      return adminJsonError("bad_request", "body must not be empty", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const updated = await updateDraftText(sendId, subject, body);
    if (!updated) {
      return adminJsonError(
        "not_editable",
        "Draft not found or already sent (sent emails are immutable).",
        409
      );
    }
    return adminJson({ send: updated });
  } catch (err) {
    reportError(err, { route: "api/admin/marketing/update" });
    return adminJsonError("internal_error", "Could not save the draft.", 500);
  }
}
