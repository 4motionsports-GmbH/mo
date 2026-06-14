// Feedback data access — the only module that reads/writes the `feedback` table
// (migration 0020).
//
//   - insertFeedback()  POST /api/feedback  (widget submission)
//   - listFeedback()    admin FEEDBACK tab  (read-only, newest-first)
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
