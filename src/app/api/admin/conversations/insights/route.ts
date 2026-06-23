// POST /api/admin/conversations/insights  { from, to, force? }
//
// The aggregate insights rollup over a date range (the "refinement engine"):
//
//   - force !== true  → return the cached rollup for the exact window if present
//                       (ZERO tokens), else generate it.
//   - force === true  → always (re)generate and overwrite the cache.
//
// TOKEN EFFICIENCY: the rollup summarises the already-CACHED per-conversation
// summaries (Part 2), NOT raw transcripts (lib/conversation-insights). NEVER auto-
// runs. Auth + CSRF: guardAdminPost.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getCachedInsights } from "@/lib/admin-conversations";
import { generateConversationInsights } from "@/lib/conversation-insights";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let from: string;
  let to: string;
  let force: boolean;
  try {
    const body = (await req.json()) as { from?: unknown; to?: unknown; force?: unknown };
    from = String(body.from ?? "");
    to = String(body.to ?? "");
    force = body.force === true;
    if (!YMD.test(from) || !YMD.test(to) || from > to) {
      return adminJsonError("bad_request", "Valid from/to (YYYY-MM-DD) required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    if (!force) {
      const cached = await getCachedInsights(from, to);
      if (cached) return adminJson({ insights: cached });
    }
    // Generating reads the cached summaries (not transcripts) for the window.
    await recordAdminAccess(
      { action: "conversation.insights", detail: { from, to, force } },
      req
    );
    const insights = await generateConversationInsights(from, to);
    return adminJson({ insights });
  } catch (err) {
    reportError(err, { route: "api/admin/conversations/insights" });
    return adminJsonError("internal_error", "Insights generation failed.", 500);
  }
}
