// POST /api/admin/qa/draft  { conversationId }
//
// Single-conversation knowledge-gap draft (e.g. straight from the Gespräche
// inspector): one Haiku pass, same engine as the bulk scan
// (lib/qa-scan.draftQaForConversation). Explicit action — never auto-runs.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { draftQaForConversation } from "@/lib/qa-scan";
import { isDbConfigured } from "@/lib/db";

export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

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

  await recordAdminAccess({ action: "qa.draft", detail: { conversationId } }, req);

  const outcome = await draftQaForConversation(conversationId);
  if (outcome.status === "error") {
    return adminJsonError("draft_failed", outcome.message, 502);
  }
  return adminJson({ outcome });
}
