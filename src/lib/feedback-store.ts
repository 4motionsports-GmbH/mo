// Feedback data access — the only module that reads/writes the `feedback` table
// (migration 0020).
//
//   - insertFeedback()   POST /api/feedback  (widget submission)
//   - listFeedback()     admin FEEDBACK tab  (read-only, newest-first)
//   - getFeedbackKpis()  KPI tab             (windowed volume aggregate)
//
// Like every store here it degrades gracefully when no database is configured
// (`getSql()` → null): the insert no-ops and the list returns []. A persistence
// failure must never break the public endpoint nor the admin page render.

import { getSql, type Sql } from "./db";

export interface FeedbackInput {
  message: string;
  sessionId: string | null;
  conversationId: string | null;
  tier: string | null;
  email: string | null;
  page: string | null;
}

export interface FeedbackRow {
  id: number;
  message: string;
  sessionId: string | null;
  conversationId: string | null;
  tier: string | null;
  email: string | null;
  page: string | null;
  createdAt: string;
}

/**
 * Store one feedback submission. Returns the new row id, or null when no DB is
 * configured / the write failed. The caller (the route) treats a null as a
 * storage outage and reports it honestly rather than pretending success — the
 * whole point of this endpoint is to persist the comment.
 */
export async function insertFeedback(
  input: FeedbackInput,
  sql: Sql | null = getSql()
): Promise<number | null> {
  if (!sql) return null;
  const rows = await sql`
    INSERT INTO feedback
      (message, session_id, conversation_id, tier, email, page, created_at)
    VALUES
      (${input.message}, ${input.sessionId}, ${input.conversationId},
       ${input.tier}, ${input.email}, ${input.page}, now())
    RETURNING id
  `;
  const id = rows[0]?.id as number | undefined;
  return id ?? null;
}

/** Hard cap on rows the admin tab pulls — a thin read, newest-first. */
const LIST_DEFAULT_LIMIT = 500;

/**
 * List feedback newest-first for the admin FEEDBACK tab. Read-only presentation
 * query — no joins, no aggregation. Returns [] when no DB is configured or on
 * any read error (the tab then shows its empty state rather than throwing).
 */
export async function listFeedback(
  limit: number = LIST_DEFAULT_LIMIT,
  sql: Sql | null = getSql()
): Promise<FeedbackRow[]> {
  if (!sql) return [];
  const capped = Math.max(1, Math.min(limit, LIST_DEFAULT_LIMIT));
  try {
    const rows = await sql`
      SELECT id, message, session_id, conversation_id, tier, email, page, created_at
        FROM feedback
       ORDER BY created_at DESC, id DESC
       LIMIT ${capped}
    `;
    return rows.map((r) => ({
      id: r.id as number,
      message: r.message as string,
      sessionId: (r.session_id as string | null) ?? null,
      conversationId: (r.conversation_id as string | null) ?? null,
      tier: (r.tier as string | null) ?? null,
      email: (r.email as string | null) ?? null,
      page: (r.page as string | null) ?? null,
      createdAt:
        r.created_at instanceof Date
          ? (r.created_at as Date).toISOString()
          : String(r.created_at),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Feedback KPIs (KPI tab)
// ---------------------------------------------------------------------------

export interface FeedbackKpis {
  /** Submissions inside the window. */
  total: number;
  /** Of those, submissions that could be tied to a conversation. */
  withConversation: number;
  /** Of those, submissions that arrived with a known contact email. */
  withEmail: number;
  /** Split by the widget-reported customer tier (telemetry-grade), largest
   * first; null tiers land under "unknown". */
  byTier: Array<{ tier: string; count: number }>;
}

/**
 * Windowed feedback volume for the KPI tab — pure counts, never the message
 * text or the email value (the KPI surface stays Cluster-A shaped even though
 * the table may carry user-supplied contact context). Returns null when no DB
 * is configured or on a read failure.
 */
export async function getFeedbackKpis(
  range: { from: string; to: string },
  sql: Sql | null = getSql()
): Promise<FeedbackKpis | null> {
  if (!sql) return null;
  try {
    const [totalRows, tierRows] = await Promise.all([
      sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE conversation_id IS NOT NULL)::int AS with_conversation,
               count(*) FILTER (WHERE email IS NOT NULL)::int AS with_email
          FROM feedback
         WHERE created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
      `,
      sql`
        SELECT COALESCE(NULLIF(btrim(tier), ''), 'unknown') AS tier, count(*)::int AS n
          FROM feedback
         WHERE created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY 1
         ORDER BY n DESC, 1 ASC
      `,
    ]);
    const t = (totalRows as Array<Record<string, unknown>>)[0] ?? {};
    return {
      total: Number(t.total ?? 0),
      withConversation: Number(t.with_conversation ?? 0),
      withEmail: Number(t.with_email ?? 0),
      byTier: (tierRows as Array<{ tier: string; n: number }>).map((r) => ({
        tier: String(r.tier),
        count: Number(r.n),
      })),
    } satisfies FeedbackKpis;
  } catch {
    return null;
  }
}
