// POST /api/admin/conversations/detail  { conversationId }
//
// The conversation inspector's transcript view: returns ONE conversation's
// readable transcript + derived tier/outcome signals + the CACHED analysis. A
// pure DB read — ZERO model calls, zero tokens (it never triggers analysis). It
// is a POST (not GET) only to ride the same JSON/CSRF guard as the other admin
// endpoints; nothing is mutated.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getAdminConversationDetail } from "@/lib/admin-conversations";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let conversationId: number;
  try {
    const body = (await req.json()) as { conversationId?: unknown };
    conversationId = Number(body.conversationId);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return adminJsonError("bad_request", "conversationId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    // Audit: this read returns the full transcript of one conversation.
    await recordAdminAccess({ action: "conversation.view", detail: { conversationId } }, req);
    const detail = await getAdminConversationDetail(conversationId);
    if (!detail) return adminJsonError("not_found", "Conversation not found.", 404);
    return adminJson({ detail });
  } catch (err) {
    reportError(err, { route: "api/admin/conversations/detail" });
    return adminJsonError("internal_error", "Unexpected server error", 500);
  }
}
