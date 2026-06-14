// AI token-usage persistence + cost aggregation (Cluster A — analytics,
// legitimate interest). Pseudonymous: a chat row links to its conversation FK;
// dashboard/admin/embedding rows carry no conversation and no email.
//
// recordAiUsage() is best-effort and NEVER throws — like the rest of the
// persistence layer, a DB failure (or no DB) is logged and swallowed so it can
// never break a chat response or an admin action. Safe to fire-and-forget.
//
// getAiCostMetrics() turns the stored token counts into EUR via the model→price
// table in ai-pricing.mjs (env-overridable). See docs/DATABASE.md.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import {
  loadModelPrices,
  usdEurRate,
  usdCostForUsage,
  usdToEur,
} from "./ai-pricing.mjs";

/** The AI call sites we attribute spend to. */
export type AiCallSite =
  | "chat"
  | "summary_email"
  // The signed-in (tier-3) "Zusammenfassung herunterladen" download — the same
  // summary generator as `summary_email`, but produced on demand for the widget
  // instead of mailed. Dashboard/admin-side spend (not chat-serving). The row is
  // linked to its conversation so it cascade-deletes on single-chat delete /
  // erasure, like chat usage.
  | "summary_download"
  | "marketing_draft"
  | "customer_profile"
  | "top_questions"
  | "embeddings"
  | "bundle_suggestions"
  // Text-to-speech for voice mode (/api/tts). NB: for this call site the
  // input_tokens column carries CHARACTERS synthesized (not LLM tokens) and
  // output_tokens is 0 — OpenAI TTS is billed per character of input, and its
  // price entry in ai-pricing.mjs is therefore USD per million CHARACTERS. The
  // `estimated` flag is set on these rows to mark the unit difference.
  | "tts";

// Call sites counted as "chat-serving" spend in the dashboard split. Embeddings
// power retrieval for the live chat and TTS reads the chat answers aloud, so
// both sit on the chat side; everything else is dashboard/admin AI usage.
const CHAT_SIDE_CALL_SITES = new Set<AiCallSite>(["chat", "embeddings", "tts"]);

export interface RecordAiUsageInput {
  callSite: AiCallSite;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** True when the counts are estimated rather than provider-reported. */
  estimated?: boolean;
  /** Set for chat usage so the row cascade-deletes with its conversation. */
  conversationId?: number | null;
}

function clampTokens(n: number): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Record one AI call's token usage. Best-effort: no DB ⇒ no-op; any failure is
 * reported and swallowed. A row with zero input AND zero output is skipped (the
 * provider reported nothing useful — recording it would just add noise).
 */
export async function recordAiUsage(
  input: RecordAiUsageInput,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  const inputTokens = clampTokens(input.inputTokens);
  const outputTokens = clampTokens(input.outputTokens);
  if (inputTokens === 0 && outputTokens === 0) return;
  try {
    await sql`
      INSERT INTO ai_usage
        (conversation_id, call_site, model, input_tokens, output_tokens, estimated)
      VALUES
        (${input.conversationId ?? null}, ${input.callSite}, ${input.model},
         ${inputTokens}, ${outputTokens}, ${input.estimated ?? false})
    `;
  } catch (err) {
    reportError(err, { route: "lib/ai-usage-store", phase: "recordAiUsage" });
  }
}

export interface AiCostMetrics {
  /** ISO timestamp of the earliest recorded usage row, or null when none. */
  capturedSince: string | null;
  /** Conversations that have at least one chat-usage row. */
  consultationCount: number;
  /** Mean chat cost per consultation, EUR. */
  avgCostPerConsultationEur: number;
  /** Median chat cost per consultation, EUR. */
  medianCostPerConsultationEur: number;
  /** Total spend across ALL call sites in the period, EUR. */
  totalSpendEur: number;
  /** Chat-serving spend (chat + embeddings), EUR. */
  chatSpendEur: number;
  /** Dashboard/admin AI spend (drafts, profiles, top-questions, …), EUR. */
  adminSpendEur: number;
  /** True when any counted usage was estimated rather than provider-reported. */
  estimated: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Aggregate AI spend for the KPI tab. Returns null when no DB is configured.
 * All cost maths runs in JS over per-(conversation,model) and per-(call_site,
 * model) token sums, so the env-overridable price table applies without baking
 * prices into SQL.
 */
export async function getAiCostMetrics(
  sql: Sql | null = getSql()
): Promise<AiCostMetrics | null> {
  if (!sql) return null;

  const prices = loadModelPrices();
  const rate = usdEurRate();

  try {
    const [sinceRows, chatRows, totalRows] = await Promise.all([
      sql`SELECT min(created_at) AS since FROM ai_usage`,
      // Per-conversation chat usage, split by model so each row prices correctly.
      sql`
        SELECT conversation_id,
               model,
               sum(input_tokens)::bigint  AS in_tok,
               sum(output_tokens)::bigint AS out_tok
          FROM ai_usage
         WHERE call_site = 'chat' AND conversation_id IS NOT NULL
         GROUP BY conversation_id, model
      `,
      // Everything, grouped by call_site + model, for the totals + the split.
      sql`
        SELECT call_site,
               model,
               sum(input_tokens)::bigint  AS in_tok,
               sum(output_tokens)::bigint AS out_tok,
               bool_or(estimated)         AS estimated
          FROM ai_usage
         GROUP BY call_site, model
      `,
    ]);

    const capturedSince = (() => {
      const v = (sinceRows[0] as { since?: unknown })?.since;
      if (v instanceof Date) return v.toISOString();
      return v ? String(v) : null;
    })();

    // Cost per consultation (chat only): sum each conversation's per-model cost.
    const perConversationEur = new Map<number, number>();
    for (const r of chatRows as Array<{
      conversation_id: number;
      model: string;
      in_tok: string | number;
      out_tok: string | number;
    }>) {
      const eur = usdToEur(
        usdCostForUsage(
          { model: r.model, inputTokens: Number(r.in_tok), outputTokens: Number(r.out_tok) },
          prices
        ),
        rate
      );
      perConversationEur.set(
        r.conversation_id,
        (perConversationEur.get(r.conversation_id) ?? 0) + eur
      );
    }
    const consultationCosts = [...perConversationEur.values()];
    const consultationCount = consultationCosts.length;
    const totalChatConsultation = consultationCosts.reduce((a, b) => a + b, 0);
    const avgCostPerConsultationEur =
      consultationCount > 0 ? totalChatConsultation / consultationCount : 0;
    const medianCostPerConsultationEur = median(consultationCosts);

    // Totals + chat/admin split across every call site.
    let totalSpendEur = 0;
    let chatSpendEur = 0;
    let adminSpendEur = 0;
    let estimated = false;
    for (const r of totalRows as Array<{
      call_site: string;
      model: string;
      in_tok: string | number;
      out_tok: string | number;
      estimated: boolean;
    }>) {
      const eur = usdToEur(
        usdCostForUsage(
          { model: r.model, inputTokens: Number(r.in_tok), outputTokens: Number(r.out_tok) },
          prices
        ),
        rate
      );
      totalSpendEur += eur;
      if (CHAT_SIDE_CALL_SITES.has(r.call_site as AiCallSite)) chatSpendEur += eur;
      else adminSpendEur += eur;
      if (r.estimated && eur > 0) estimated = true;
    }

    return {
      capturedSince,
      consultationCount,
      avgCostPerConsultationEur,
      medianCostPerConsultationEur,
      totalSpendEur,
      chatSpendEur,
      adminSpendEur,
      estimated,
    } satisfies AiCostMetrics;
  } catch (err) {
    reportError(err, { route: "lib/ai-usage-store", phase: "getAiCostMetrics" });
    return null;
  }
}
