// Data layer for the admin conversation inspector ("Gespräche"). Cluster A
// (analytics, legitimate interest) — pseudonymous, read-only over conversations
// and messages, plus the analysis cache (columns on conversations) and the
// insights rollup cache (conversation_insights).
//
// CRITICAL — ZERO MODEL CALLS. Nothing in this file imports the AI SDK or calls a
// model. The list + transcript (Part 1) and the cache reads cost no tokens; the
// AI passes live in conversation-analysis.ts / conversation-insights.ts and only
// run on an explicit button. Re-opening an analysed conversation reads the cached
// columns here for free.
//
// Identity guardrail: the tier is derived from booleans only (is there a
// Shopify-linked / email-linked customer) — this file NEVER selects an email or
// any identity value. Anonymous sessions show the tier label, not a person.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { resolveKpiRange, type KpiRange } from "./kpi-range";
import {
  loadModelPrices,
  usdEurRate,
  usdCostForUsage,
  usdToEur,
} from "./ai-pricing.mjs";
import {
  classifyTier,
  TIERS,
  CATEGORY_LABELS,
  QUALITY_LABELS,
} from "./conversation-analysis-core.mjs";

/** Conversations per list page. */
export const PAGE_SIZE = 25;
/** Hard cap on conversations a single bulk-analyze call processes (keeps the
 *  request comfortably under maxDuration; the UI reports how many remain so the
 *  operator can run it again for the rest). */
export const BULK_ANALYZE_LIMIT = 20;

export type AdminTier = "anonymous" | "email-only" | "signed-in";

export interface CachedAnalysis {
  summary: string | null;
  category: string | null;
  tags: string[];
  quality: string | null;
  model: string | null;
  updatedAt: string;
  /** Cached approximate cost in EUR (priced in JS from cached token counts). */
  costEur: number;
}

export interface AdminConversationListItem {
  id: number;
  conversationKey: string;
  createdAt: string;
  updatedAt: string;
  /** Readable-turn count (tool rows excluded — matches the transcript). */
  messageCount: number;
  tier: AdminTier;
  personaLabel: string | null;
  toolsFired: string[];
  /** A checkout/cart button was OFFERED (add_to_cart fired). */
  checkoutOffered: boolean;
  /** A cart/checkout link was actually USED (clicked) — session-grained. */
  cartUsed: boolean;
  /** An email was captured for the session — session-grained. */
  emailCaptured: boolean;
  /** Error proxy: a user turn with no bot reply at all (see note in the route). */
  noReply: boolean;
  /** Cached analysis, or null when never analysed. NEVER computed on list load. */
  analysis: CachedAnalysis | null;
}

export interface AdminTranscriptTurn {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AdminConversationDetail {
  id: number;
  conversationKey: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  status: string;
  tier: AdminTier;
  personaLabel: string | null;
  messageCount: number;
  transcript: AdminTranscriptTurn[];
  outcomes: {
    toolsFired: string[];
    checkoutOffered: boolean;
    cartUsed: boolean;
    emailCaptured: boolean;
    noReply: boolean;
  };
  analysis: CachedAnalysis | null;
}

export interface CategoryCount {
  category: string;
  label: string;
  count: number;
}
export interface QualityCount {
  quality: string;
  label: string;
  count: number;
}
export interface ConversationStats {
  total: number;
  analyzedCount: number;
  categories: CategoryCount[];
  qualities: QualityCount[];
}

export interface RollupAnalysis {
  summary: string;
  category: string | null;
  quality: string | null;
  tags: string[];
}

export interface InsightsRollup {
  from: string;
  to: string;
  summaryMd: string;
  analyzedCount: number;
  model: string | null;
  costEur: number;
  generatedAt: string;
  cached: boolean;
}

export interface AdminConversationFilter {
  range: KpiRange;
  tier: AdminTier | null;
  hasError: boolean;
  page: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return v ? String(v) : "";
}

/** Approximate EUR cost from cached token counts (no model call). */
function analysisCostEur(
  model: string | null,
  inTok: number | null,
  outTok: number | null
): number {
  if (!model) return 0;
  const usd = usdCostForUsage(
    { model, inputTokens: Number(inTok ?? 0), outputTokens: Number(outTok ?? 0) },
    loadModelPrices()
  );
  return usdToEur(usd, usdEurRate());
}

/**
 * Parse the inspector's URL params into a validated filter. The date window
 * reuses the KPI range resolver (same presets/clamping as the KPI tab), so an
 * invalid/partial input falls back safely. Unknown tier → no tier filter.
 */
export function parseAdminConversationFilter(params: {
  grange?: string | null;
  gfrom?: string | null;
  gto?: string | null;
  gtier?: string | null;
  gerr?: string | null;
  gpage?: string | null;
}): AdminConversationFilter {
  const range = resolveKpiRange({
    kpiRange: params.grange,
    kpiFrom: params.gfrom,
    kpiTo: params.gto,
  });
  const tier =
    params.gtier && (TIERS as string[]).includes(params.gtier)
      ? (params.gtier as AdminTier)
      : null;
  const hasError = params.gerr === "1" || params.gerr === "true";
  const pageNum = Number.parseInt(params.gpage ?? "1", 10);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
  return { range, tier, hasError, page };
}

interface ListRow {
  id: number;
  conversation_key: string;
  session_id: string;
  created_at: unknown;
  updated_at: unknown;
  persona_label: string | null;
  signed_in: boolean;
  identified: boolean;
  message_count: number;
  no_reply: boolean;
  tools_fired: string[];
  checkout_offered: boolean;
  analysis_summary: string | null;
  analysis_category: string | null;
  analysis_tags: string[] | null;
  analysis_quality: string | null;
  analysis_model: string | null;
  analysis_input_tokens: number | null;
  analysis_output_tokens: number | null;
  analysis_updated_at: unknown;
}

function rowToAnalysis(r: {
  analysis_summary: string | null;
  analysis_category: string | null;
  analysis_tags: string[] | null;
  analysis_quality: string | null;
  analysis_model: string | null;
  analysis_input_tokens: number | null;
  analysis_output_tokens: number | null;
  analysis_updated_at: unknown;
}): CachedAnalysis | null {
  if (!r.analysis_updated_at) return null;
  return {
    summary: r.analysis_summary,
    category: r.analysis_category,
    tags: Array.isArray(r.analysis_tags) ? r.analysis_tags : [],
    quality: r.analysis_quality,
    model: r.analysis_model,
    updatedAt: toIso(r.analysis_updated_at),
    costEur: analysisCostEur(
      r.analysis_model,
      r.analysis_input_tokens,
      r.analysis_output_tokens
    ),
  };
}

/** Batch the two session-keyed outcome probes for a page of sessions. */
async function loadSessionSignals(
  sessionIds: string[],
  sql: Sql
): Promise<{ emailed: Set<string>; carted: Set<string> }> {
  if (sessionIds.length === 0) return { emailed: new Set(), carted: new Set() };
  const [emailRows, cartRows] = await Promise.all([
    sql`SELECT DISTINCT session_id FROM email_captures WHERE session_id = ANY(${sessionIds}::text[])`,
    sql`SELECT DISTINCT session_id FROM kpi_events
         WHERE session_id = ANY(${sessionIds}::text[])
           AND (event ILIKE '%cart%' OR event ILIKE '%checkout%')`,
  ]);
  const emailed = new Set(
    (emailRows as Array<{ session_id: string }>).map((r) => r.session_id)
  );
  const carted = new Set(
    (cartRows as Array<{ session_id: string }>).map((r) => r.session_id)
  );
  return { emailed, carted };
}

// ── Part 1: list + transcript (pure DB, zero tokens) ──────────────────────────

/**
 * One page of conversations, newest first, with derived tier + outcome signals +
 * the CACHED analysis (read-only; never triggers a model call). The message-
 * derived fields are computed by LATERALs bounded to the page (the CTE LIMITs
 * first), and the two session-keyed signals are batch-probed for the page.
 */
export async function listAdminConversations(
  filter: AdminConversationFilter,
  sql: Sql | null = getSql()
): Promise<{ items: AdminConversationListItem[]; total: number }> {
  if (!sql) return { items: [], total: 0 };
  const { tier, hasError, page } = filter;
  const from = filter.range.from;
  const to = filter.range.to;
  const offset = (page - 1) * PAGE_SIZE;

  try {
    const [pageRows, countRows] = await Promise.all([
      sql`
        WITH page AS (
          SELECT c.id, c.conversation_key, c.session_id, c.created_at, c.updated_at,
                 c.persona_label, c.selected_product_ids,
                 c.analysis_summary, c.analysis_category, c.analysis_tags, c.analysis_quality,
                 c.analysis_model, c.analysis_input_tokens, c.analysis_output_tokens,
                 c.analysis_updated_at,
                 (cu.shopify_customer_id IS NOT NULL OR cul.shopify_customer_id IS NOT NULL) AS signed_in,
                 (c.customer_id IS NOT NULL OR csl.customer_id IS NOT NULL) AS identified
            FROM conversations c
            LEFT JOIN customers cu ON cu.id = c.customer_id
            LEFT JOIN customer_session_links csl ON csl.session_id = c.session_id
            LEFT JOIN customers cul ON cul.id = csl.customer_id
           WHERE c.created_at >= ${from}::date AND c.created_at < (${to}::date + 1)
             AND (
               ${tier}::text IS NULL
               OR (${tier} = 'signed-in'
                     AND (cu.shopify_customer_id IS NOT NULL OR cul.shopify_customer_id IS NOT NULL))
               OR (${tier} = 'email-only'
                     AND cu.shopify_customer_id IS NULL AND cul.shopify_customer_id IS NULL
                     AND (c.customer_id IS NOT NULL OR csl.customer_id IS NOT NULL))
               OR (${tier} = 'anonymous'
                     AND cu.shopify_customer_id IS NULL AND cul.shopify_customer_id IS NULL
                     AND c.customer_id IS NULL AND csl.customer_id IS NULL)
             )
             AND (
               ${hasError} = false OR (
                 EXISTS (SELECT 1 FROM messages mu
                          WHERE mu.conversation_id = c.id AND mu.role = 'user'
                            AND mu.tool_name IS NULL AND length(btrim(mu.content)) > 0)
                 AND NOT EXISTS (SELECT 1 FROM messages ma
                          WHERE ma.conversation_id = c.id AND ma.role = 'assistant'
                            AND ma.tool_name IS NULL AND length(btrim(ma.content)) > 0)
               )
             )
           ORDER BY c.created_at DESC, c.id DESC
           LIMIT ${PAGE_SIZE} OFFSET ${offset}
        )
        SELECT p.id, p.conversation_key, p.session_id, p.created_at, p.updated_at,
               p.persona_label, p.signed_in, p.identified,
               p.analysis_summary, p.analysis_category, p.analysis_tags, p.analysis_quality,
               p.analysis_model, p.analysis_input_tokens, p.analysis_output_tokens,
               p.analysis_updated_at,
               COALESCE(rt.readable_count, 0)::int AS message_count,
               (COALESCE(rt.user_count, 0) > 0 AND COALESCE(rt.assistant_count, 0) = 0) AS no_reply,
               COALESCE(tf.tools, '{}') AS tools_fired,
               (COALESCE(array_length(p.selected_product_ids, 1), 0) > 0) AS checkout_offered
          FROM page p
          LEFT JOIN LATERAL (
            SELECT count(*) AS readable_count,
                   count(*) FILTER (WHERE m.role = 'user') AS user_count,
                   count(*) FILTER (WHERE m.role = 'assistant') AS assistant_count
              FROM messages m
             WHERE m.conversation_id = p.id AND m.tool_name IS NULL
               AND length(btrim(m.content)) > 0
          ) rt ON true
          LEFT JOIN LATERAL (
            SELECT array_agg(DISTINCT m.tool_name ORDER BY m.tool_name) AS tools
              FROM messages m
             WHERE m.conversation_id = p.id AND m.tool_name IS NOT NULL
          ) tf ON true
         ORDER BY p.created_at DESC, p.id DESC
      `,
      sql`
        SELECT count(*)::int AS n
          FROM conversations c
          LEFT JOIN customers cu ON cu.id = c.customer_id
          LEFT JOIN customer_session_links csl ON csl.session_id = c.session_id
          LEFT JOIN customers cul ON cul.id = csl.customer_id
         WHERE c.created_at >= ${from}::date AND c.created_at < (${to}::date + 1)
           AND (
             ${tier}::text IS NULL
             OR (${tier} = 'signed-in'
                   AND (cu.shopify_customer_id IS NOT NULL OR cul.shopify_customer_id IS NOT NULL))
             OR (${tier} = 'email-only'
                   AND cu.shopify_customer_id IS NULL AND cul.shopify_customer_id IS NULL
                   AND (c.customer_id IS NOT NULL OR csl.customer_id IS NOT NULL))
             OR (${tier} = 'anonymous'
                   AND cu.shopify_customer_id IS NULL AND cul.shopify_customer_id IS NULL
                   AND c.customer_id IS NULL AND csl.customer_id IS NULL)
           )
           AND (
             ${hasError} = false OR (
               EXISTS (SELECT 1 FROM messages mu
                        WHERE mu.conversation_id = c.id AND mu.role = 'user'
                          AND mu.tool_name IS NULL AND length(btrim(mu.content)) > 0)
               AND NOT EXISTS (SELECT 1 FROM messages ma
                        WHERE ma.conversation_id = c.id AND ma.role = 'assistant'
                          AND ma.tool_name IS NULL AND length(btrim(ma.content)) > 0)
             )
           )
      `,
    ]);

    const rows = pageRows as unknown as ListRow[];
    const total = Number((countRows[0] as { n?: number })?.n ?? 0);

    const sessionIds = [
      ...new Set(rows.map((r) => r.session_id).filter((s): s is string => Boolean(s))),
    ];
    const { emailed, carted } = await loadSessionSignals(sessionIds, sql);

    const items: AdminConversationListItem[] = rows.map((r) => ({
      id: Number(r.id),
      conversationKey: r.conversation_key,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
      messageCount: Number(r.message_count),
      tier: classifyTier({ signedIn: r.signed_in, identified: r.identified }),
      personaLabel: r.persona_label ?? null,
      toolsFired: Array.isArray(r.tools_fired) ? r.tools_fired : [],
      checkoutOffered: Boolean(r.checkout_offered),
      cartUsed: carted.has(r.session_id),
      emailCaptured: emailed.has(r.session_id),
      noReply: Boolean(r.no_reply),
      analysis: rowToAnalysis(r),
    }));

    return { items, total };
  } catch (err) {
    reportError(err, { route: "lib/admin-conversations", phase: "list" });
    return { items: [], total: 0 };
  }
}

/**
 * One conversation's readable transcript (reusing the canonical readable-turn
 * filter, applied in SQL) + derived tier + outcomes + the cached analysis.
 * Zero model calls. Returns null when the conversation does not exist / no DB.
 */
export async function getAdminConversationDetail(
  conversationId: number,
  sql: Sql | null = getSql()
): Promise<AdminConversationDetail | null> {
  if (!sql) return null;
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  try {
    const metaRows = (await sql`
      SELECT c.id, c.conversation_key, c.session_id, c.created_at, c.updated_at,
             c.last_activity_at, c.status, c.persona_label, c.selected_product_ids,
             c.analysis_summary, c.analysis_category, c.analysis_tags, c.analysis_quality,
             c.analysis_model, c.analysis_input_tokens, c.analysis_output_tokens,
             c.analysis_updated_at,
             (cu.shopify_customer_id IS NOT NULL OR cul.shopify_customer_id IS NOT NULL) AS signed_in,
             (c.customer_id IS NOT NULL OR csl.customer_id IS NOT NULL) AS identified
        FROM conversations c
        LEFT JOIN customers cu ON cu.id = c.customer_id
        LEFT JOIN customer_session_links csl ON csl.session_id = c.session_id
        LEFT JOIN customers cul ON cul.id = csl.customer_id
       WHERE c.id = ${conversationId}
    `) as Array<
      ListRow & {
        last_activity_at: unknown;
        status: string;
        selected_product_ids: string[] | null;
      }
    >;
    const meta = metaRows[0];
    if (!meta) return null;

    // Readable turns only — SAME predicate as the session/account transcript
    // views (tool-bookkeeping rows dropped), here pushed into SQL.
    const turnRows = (await sql`
      SELECT role, content, created_at
        FROM messages
       WHERE conversation_id = ${conversationId}
         AND role IN ('user', 'assistant')
         AND tool_name IS NULL
         AND length(btrim(content)) > 0
       ORDER BY created_at ASC, id ASC
       LIMIT 500
    `) as Array<{ role: "user" | "assistant"; content: string; created_at: unknown }>;

    const toolRows = (await sql`
      SELECT array_agg(DISTINCT tool_name ORDER BY tool_name) AS tools
        FROM messages
       WHERE conversation_id = ${conversationId} AND tool_name IS NOT NULL
    `) as Array<{ tools: string[] | null }>;

    const session = meta.session_id;
    const { emailed, carted } = await loadSessionSignals(session ? [session] : [], sql);

    const transcript: AdminTranscriptTurn[] = turnRows.map((t) => ({
      role: t.role,
      content: t.content,
      createdAt: toIso(t.created_at),
    }));
    const userTurns = transcript.filter((t) => t.role === "user").length;
    const assistantTurns = transcript.filter((t) => t.role === "assistant").length;

    return {
      id: Number(meta.id),
      conversationKey: meta.conversation_key,
      createdAt: toIso(meta.created_at),
      updatedAt: toIso(meta.updated_at),
      lastActivityAt: toIso(meta.last_activity_at),
      status: meta.status,
      tier: classifyTier({ signedIn: meta.signed_in, identified: meta.identified }),
      personaLabel: meta.persona_label ?? null,
      messageCount: transcript.length,
      transcript,
      outcomes: {
        toolsFired: Array.isArray(toolRows[0]?.tools) ? (toolRows[0].tools as string[]) : [],
        checkoutOffered:
          Array.isArray(meta.selected_product_ids) && meta.selected_product_ids.length > 0,
        cartUsed: session ? carted.has(session) : false,
        emailCaptured: session ? emailed.has(session) : false,
        noReply: userTurns > 0 && assistantTurns === 0,
      },
      analysis: rowToAnalysis(meta),
    };
  } catch (err) {
    reportError(err, { route: "lib/admin-conversations", phase: "detail" });
    return null;
  }
}

// ── Part 2: per-conversation analysis cache (columns on the row) ──────────────

/** Persist a fresh analysis onto the conversation row. Returns false on failure. */
export async function saveConversationAnalysis(
  conversationId: number,
  analysis: { summary: string; category: string; tags: string[]; quality: string },
  model: string,
  usage: { inputTokens: number; outputTokens: number },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE conversations SET
        analysis_summary = ${analysis.summary},
        analysis_category = ${analysis.category},
        analysis_tags = ${analysis.tags}::text[],
        analysis_quality = ${analysis.quality},
        analysis_model = ${model},
        analysis_input_tokens = ${usage.inputTokens},
        analysis_output_tokens = ${usage.outputTokens},
        analysis_updated_at = now()
       WHERE id = ${conversationId}
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/admin-conversations", phase: "saveAnalysis" });
    return false;
  }
}

/** Conversations in the window that are not yet analysed but have readable
 *  content to analyse — the bulk-action work list. */
export async function loadUnanalyzedIds(
  from: string,
  to: string,
  limit: number,
  sql: Sql | null = getSql()
): Promise<number[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT c.id
        FROM conversations c
       WHERE c.analysis_updated_at IS NULL
         AND c.created_at >= ${from}::date AND c.created_at < (${to}::date + 1)
         AND EXISTS (SELECT 1 FROM messages m
                      WHERE m.conversation_id = c.id AND m.role = 'user'
                        AND m.tool_name IS NULL AND length(btrim(m.content)) > 0)
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ${limit}
    `) as Array<{ id: number }>;
    return rows.map((r) => Number(r.id));
  } catch (err) {
    reportError(err, { route: "lib/admin-conversations", phase: "loadUnanalyzed" });
    return [];
  }
}

/** Count of un-analysed-but-analysable conversations in the window (estimate). */
export async function countUnanalyzedInRange(
  from: string,
  to: string,
  sql: Sql | null = getSql()
): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = (await sql`
      SELECT count(*)::int AS n
        FROM conversations c
       WHERE c.analysis_updated_at IS NULL
         AND c.created_at >= ${from}::date AND c.created_at < (${to}::date + 1)
         AND EXISTS (SELECT 1 FROM messages m
                      WHERE m.conversation_id = c.id AND m.role = 'user'
                        AND m.tool_name IS NULL AND length(btrim(m.content)) > 0)
    `) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    reportError(err, { route: "lib/admin-conversations", phase: "countUnanalyzed" });
    return 0;
  }
}

// ── Part 3: insights rollup cache + the free category distribution ────────────

/**
 * Cheap distribution stats for the insights panel — a free SQL GROUP BY over the
 * CACHED analysis columns (no model call). Powers the category/quality breakdown
 * shown alongside the cached rollup narrative.
 */
export async function getConversationStats(
  from: string,
  to: string,
  sql: Sql | null = getSql()
): Promise<ConversationStats> {
  const empty: ConversationStats = {
    total: 0,
    analyzedCount: 0,
    categories: [],
    qualities: [],
  };
  if (!sql) return empty;
  try {
    const [totalRows, analyzedRows, catRows, qualRows] = await Promise.all([
      sql`SELECT count(*)::int AS n FROM conversations
           WHERE created_at >= ${from}::date AND created_at < (${to}::date + 1)`,
      sql`SELECT count(*)::int AS n FROM conversations
           WHERE analysis_updated_at IS NOT NULL
             AND created_at >= ${from}::date AND created_at < (${to}::date + 1)`,
      sql`SELECT analysis_category AS category, count(*)::int AS n FROM conversations
           WHERE analysis_updated_at IS NOT NULL AND analysis_category IS NOT NULL
             AND created_at >= ${from}::date AND created_at < (${to}::date + 1)
           GROUP BY analysis_category ORDER BY count(*) DESC, analysis_category ASC`,
      sql`SELECT analysis_quality AS quality, count(*)::int AS n FROM conversations
           WHERE analysis_updated_at IS NOT NULL AND analysis_quality IS NOT NULL
             AND created_at >= ${from}::date AND created_at < (${to}::date + 1)
           GROUP BY analysis_quality ORDER BY count(*) DESC, analysis_quality ASC`,
    ]);
    const categories = (catRows as Array<{ category: string; n: number }>).map((r) => ({
      category: r.category,
      label: (CATEGORY_LABELS as Record<string, string>)[r.category] ?? r.category,
      count: Number(r.n),
    }));
    const qualities = (qualRows as Array<{ quality: string; n: number }>).map((r) => ({
      quality: r.quality,
      label: (QUALITY_LABELS as Record<string, string>)[r.quality] ?? r.quality,
      count: Number(r.n),
    }));
    return {
      total: Number((totalRows[0] as { n?: number })?.n ?? 0),
      analyzedCount: Number((analyzedRows[0] as { n?: number })?.n ?? 0),
      categories,
      qualities,
    };
  } catch (err) {
    reportError(err, { route: "lib/admin-conversations", phase: "stats" });
    return empty;
  }
}

/**
 * Load the CACHED per-conversation analyses for the rollup — summaries +
 * categories + quality + tags ONLY, never transcripts. This is what makes the
 * insights pass cheap: it summarises summaries.
 */
export async function loadAnalysesForRollup(
  from: string,
  to: string,
  limit = 500,
  sql: Sql | null = getSql()
): Promise<RollupAnalysis[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT analysis_summary AS summary,
             analysis_category AS category,
             analysis_quality AS quality,
             analysis_tags AS tags
        FROM conversations
       WHERE analysis_updated_at IS NOT NULL
         AND analysis_summary IS NOT NULL AND length(btrim(analysis_summary)) > 0
         AND created_at >= ${from}::date AND created_at < (${to}::date + 1)
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit}
    `) as Array<{
      summary: string;
      category: string | null;
      quality: string | null;
      tags: string[] | null;
    }>;
    return rows.map((r) => ({
      summary: r.summary,
      category: r.category,
      quality: r.quality,
      tags: Array.isArray(r.tags) ? r.tags : [],
    }));
  } catch (err) {
    reportError(err, { route: "lib/admin-conversations", phase: "loadRollup" });
    return [];
  }
}

function mapInsights(r: Record<string, unknown>, cached: boolean): InsightsRollup {
  const model = (r.model as string | null) ?? null;
  return {
    from: toIso(r.date_from).slice(0, 10),
    to: toIso(r.date_to).slice(0, 10),
    summaryMd: String(r.summary_md ?? ""),
    analyzedCount: Number(r.analyzed_count ?? 0),
    model,
    costEur: analysisCostEur(
      model,
      r.input_tokens as number | null,
      r.output_tokens as number | null
    ),
    generatedAt: toIso(r.generated_at),
    cached,
  };
}

/** The cached insights rollup for an exact [from, to] window, or null. */
export async function getCachedInsights(
  from: string,
  to: string,
  sql: Sql | null = getSql()
): Promise<InsightsRollup | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT date_from, date_to, summary_md, analyzed_count, model,
             input_tokens, output_tokens, generated_at
        FROM conversation_insights
       WHERE date_from = ${from}::date AND date_to = ${to}::date
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapInsights(rows[0], true) : null;
  } catch (err) {
    reportError(err, { route: "lib/admin-conversations", phase: "getInsights" });
    return null;
  }
}

/** Upsert the insights rollup for its [from, to] window. */
export async function saveInsights(
  rollup: {
    from: string;
    to: string;
    summaryMd: string;
    analyzedCount: number;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
  },
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    await sql`
      INSERT INTO conversation_insights
        (date_from, date_to, summary_md, analyzed_count, model, input_tokens, output_tokens, generated_at)
      VALUES
        (${rollup.from}::date, ${rollup.to}::date, ${rollup.summaryMd}, ${rollup.analyzedCount},
         ${rollup.model}, ${rollup.inputTokens}, ${rollup.outputTokens}, now())
      ON CONFLICT (date_from, date_to) DO UPDATE SET
        summary_md = EXCLUDED.summary_md,
        analyzed_count = EXCLUDED.analyzed_count,
        model = EXCLUDED.model,
        input_tokens = EXCLUDED.input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        generated_at = now()
    `;
    return true;
  } catch (err) {
    reportError(err, { route: "lib/admin-conversations", phase: "saveInsights" });
    return false;
  }
}
