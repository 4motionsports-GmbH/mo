// POST /api/admin/conversations/analyze  { conversationId, force? }
//
// On-demand, CACHED AI analysis of ONE conversation (the "Analysieren" button).
//
//   - force !== true  → return the cached analysis if one exists (ZERO tokens),
//                       else run the model once and cache it.
//   - force === true  → always (re)analyse and overwrite the cache.
//
// NEVER auto-runs: only this explicit POST triggers the model. The cheap Haiku
// model is used (lib/conversation-analysis); usage is recorded against the
// conversation FK so it cascade-deletes with it on retention / erasure.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  getAdminConversationDetail,
  saveConversationAnalysis,
} from "@/lib/admin-conversations";
import {
  generateConversationAnalysis,
  ANALYSIS_MODEL,
} from "@/lib/conversation-analysis";
import { shouldRegenerate } from "@/lib/conversation-analysis-core.mjs";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let conversationId: number;
  let force: boolean;
  try {
    const body = (await req.json()) as { conversationId?: unknown; force?: unknown };
    conversationId = Number(body.conversationId);
    force = body.force === true;
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
    const detail = await getAdminConversationDetail(conversationId);
    if (!detail) return adminJsonError("not_found", "Conversation not found.", 404);

    // Re-opening an analysed conversation costs ZERO tokens — serve the cache.
    if (!shouldRegenerate({ hasCached: detail.analysis != null, force })) {
      return adminJson({ analysis: detail.analysis, usage: null, cached: true });
    }

    // Generating reads the transcript — audit it like the customer profile pass.
    await recordAdminAccess(
      { action: "conversation.analyze", detail: { conversationId, force } },
      req
    );

    const result = await generateConversationAnalysis({
      conversationId,
      transcript: detail.transcript,
    });
    if (!result.ok) {
      const status =
        result.reason === "unconfigured" ? 503 : result.reason === "no_data" ? 409 : 502;
      return adminJsonError(`analysis_${result.reason}`, result.message, status);
    }

    const saved = await saveConversationAnalysis(
      conversationId,
      result.analysis,
      ANALYSIS_MODEL,
      result.usage
    );

    // Re-read the canonical cached analysis (priced via the shared JS path) so the
    // response matches a later cache read. The model tokens were spent regardless,
    // so still return the result + a warning if the save failed.
    const fresh = await getAdminConversationDetail(conversationId);
    return adminJson({
      analysis: fresh?.analysis ?? null,
      usage: result.usage,
      cached: saved,
      ...(saved ? {} : { warning: "Analyse erstellt, konnte aber nicht gespeichert werden." }),
    });
  } catch (err) {
    reportError(err, { route: "api/admin/conversations/analyze" });
    return adminJsonError("internal_error", "Analysis failed.", 500);
  }
}
