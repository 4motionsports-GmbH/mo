// POST /api/admin/conversations/analyze-bulk  { from, to, confirm }
//
// Analyse all un-analysed conversations in a date range — an EXPLICIT, CONFIRMED
// action (never automatic). `confirm: true` is required; the UI shows the
// estimated cost (N × cheap-model cost) before the operator confirms. Processing
// is capped at BULK_ANALYZE_LIMIT per call to stay under maxDuration; the response
// reports how many remain so the UI can run it again.
//
// Each conversation is analysed with the same cheap Haiku pass + cached on its row
// as the single "Analysieren" button. Auth + CSRF: guardAdminPost.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  getAdminConversationDetail,
  saveConversationAnalysis,
  loadUnanalyzedIds,
  countUnanalyzedInRange,
  BULK_ANALYZE_LIMIT,
} from "@/lib/admin-conversations";
import {
  generateConversationAnalysis,
  ANALYSIS_MODEL,
} from "@/lib/conversation-analysis";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";
import { usdEurRate, usdToEur } from "@/lib/ai-pricing.mjs";

export const maxDuration = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let from: string;
  let to: string;
  let confirm: boolean;
  try {
    const body = (await req.json()) as { from?: unknown; to?: unknown; confirm?: unknown };
    from = String(body.from ?? "");
    to = String(body.to ?? "");
    confirm = body.confirm === true;
    if (!YMD.test(from) || !YMD.test(to) || from > to) {
      return adminJsonError("bad_request", "Valid from/to (YYYY-MM-DD) required", 400);
    }
    if (!confirm) {
      return adminJsonError("not_confirmed", "Bulk analysis must be confirmed.", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess(
      { action: "conversation.analyze_bulk", detail: { from, to } },
      req
    );

    const ids = await loadUnanalyzedIds(from, to, BULK_ANALYZE_LIMIT);
    let processed = 0;
    let failed = 0;
    let approxCostUsd = 0;
    let unconfigured = false;

    for (const id of ids) {
      const detail = await getAdminConversationDetail(id);
      if (!detail || detail.transcript.length === 0) continue;
      const result = await generateConversationAnalysis({
        conversationId: id,
        transcript: detail.transcript,
      });
      if (result.ok) {
        await saveConversationAnalysis(id, result.analysis, ANALYSIS_MODEL, result.usage);
        processed += 1;
        approxCostUsd += result.usage.approxCostUsd;
      } else {
        failed += 1;
        // No point hammering the model with the same misconfiguration.
        if (result.reason === "unconfigured") {
          unconfigured = true;
          break;
        }
      }
    }

    const remaining = await countUnanalyzedInRange(from, to);
    return adminJson({
      processed,
      failed,
      remaining,
      unconfigured,
      approxCostUsd,
      costEur: usdToEur(approxCostUsd, usdEurRate()),
      model: ANALYSIS_MODEL,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/conversations/analyze-bulk" });
    return adminJsonError("internal_error", "Bulk analysis failed.", 500);
  }
}
