// POST /api/admin/campaign/reset-queue  { campaignId }
//
// Rebuild one campaign's review queue: delete the drafts of ALL its recipients still in review
// ('drafted') and return them to 'pending', so the next "Nächste 50
// vorbereiten" regenerates them with the CURRENT generation code (used after a
// deploy that changed prompts/recommendations). Destructive for the open
// drafts' edits — the UI confirms before calling. Sent/skipped/suppressed
// contacts and attached bundle offers are untouched.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { resetDraftedContacts } from "@/lib/campaign-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let campaignId: number;
  try {
    const body = (await req.json().catch(() => ({}))) as { campaignId?: unknown };
    campaignId = Number(body.campaignId);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return adminJsonError("bad_request", "campaignId required.", 400);
  }
  try {
    const reset = await resetDraftedContacts(campaignId);
    return adminJson({ ok: true, reset });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/reset-queue" });
    return adminJsonError("internal_error", "Could not reset the queue.", 500);
  }
}
