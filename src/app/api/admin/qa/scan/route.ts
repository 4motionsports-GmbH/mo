// POST /api/admin/qa/scan  { limit? }
//
// Bulk knowledge-gap scan: run the Q&A draft pass over up to `limit` (default
// 10, max 25) eligible, not-yet-scanned conversations — analysis flagged
// unmet_need/dropped_off OR the contact form was shown. NEVER auto-runs: only
// this explicit POST spends tokens (cheap Haiku, ~like the bulk analysis).
// Conclusive outcomes stamp qa_scanned_at, so re-clicking never re-pays for
// the same conversation.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { listScanCandidates } from "@/lib/qa-store";
import { draftQaForConversation } from "@/lib/qa-scan";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";

export const maxDuration = 300;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  let limit = DEFAULT_LIMIT;
  try {
    const body = (await req.json()) as { limit?: unknown };
    if (body.limit != null) {
      const n = Number(body.limit);
      if (Number.isFinite(n)) limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  await recordAdminAccess({ action: "qa.scan", detail: { limit } }, req);

  const candidates = await listScanCandidates(limit);
  let created = 0;
  let noGap = 0;
  let duplicates = 0;
  let errors = 0;
  for (const c of candidates) {
    try {
      const outcome = await draftQaForConversation(c.conversationId);
      if (outcome.status === "created") created++;
      else if (outcome.status === "duplicate") duplicates++;
      else if (outcome.status === "error") errors++;
      else noGap++;
    } catch (err) {
      errors++;
      reportError(err, { route: "api/admin/qa/scan", phase: "draft" });
    }
  }

  return adminJson({
    scanned: candidates.length,
    created,
    noGap,
    duplicates,
    errors,
  });
}
