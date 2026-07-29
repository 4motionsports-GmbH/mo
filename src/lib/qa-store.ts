// Data layer for the "Wissen" (Q&A / knowledge enhancement) queue — see
// migrations/0036_qa_entries.sql for the model and docs/QA_KNOWLEDGE.md for
// the flow. Pure DB reads/writes (no model calls); every function degrades
// gracefully when no DB is configured, mirroring the other stores.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { questionFingerprint } from "./qa-core.mjs";

export type QaStatus = "open" | "answered" | "published" | "dismissed";

export interface QaEntry {
  id: number;
  conversationId: number | null;
  productId: string | null;
  productTitle: string | null;
  gapSummary: string;
  question: string;
  answer: string | null;
  // Optional English pair for the bilingual metafield / EN prompt — auto-
  // translated at publish time, operator-overridable. null = not translated.
  questionEn: string | null;
  answerEn: string | null;
  status: QaStatus;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
  updatedAt: string;
  answeredAt: string | null;
  publishedAt: string | null;
}

export interface QaCounts {
  open: number;
  answered: number;
  published: number;
  dismissed: number;
}

interface QaRow {
  id: number;
  conversation_id: number | null;
  product_id: string | null;
  product_title: string | null;
  gap_summary: string;
  question: string;
  answer: string | null;
  question_en: string | null;
  answer_en: string | null;
  status: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: unknown;
  updated_at: unknown;
  answered_at: unknown;
  published_at: unknown;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return new Date(v).toISOString();
  return new Date(0).toISOString();
}
function toIsoOrNull(v: unknown): string | null {
  return v == null ? null : toIso(v);
}

function rowToEntry(r: QaRow): QaEntry {
  return {
    id: Number(r.id),
    conversationId: r.conversation_id == null ? null : Number(r.conversation_id),
    productId: r.product_id,
    productTitle: r.product_title,
    gapSummary: r.gap_summary,
    question: r.question,
    answer: r.answer,
    questionEn: r.question_en,
    answerEn: r.answer_en,
    status: (r.status as QaStatus) ?? "open",
    model: r.model,
    inputTokens: r.input_tokens == null ? null : Number(r.input_tokens),
    outputTokens: r.output_tokens == null ? null : Number(r.output_tokens),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    answeredAt: toIsoOrNull(r.answered_at),
    publishedAt: toIsoOrNull(r.published_at),
  };
}

const QA_LIST_LIMIT = 200;

/** List entries, newest first; `status` = null lists everything (capped). */
export async function listQaEntries(
  status: QaStatus | null,
  sql: Sql | null = getSql()
): Promise<QaEntry[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, conversation_id, product_id, product_title, gap_summary,
             question, answer, question_en, answer_en, status, model,
             input_tokens, output_tokens,
             created_at, updated_at, answered_at, published_at
        FROM qa_entries
       WHERE (${status}::text IS NULL OR status = ${status})
       ORDER BY created_at DESC
       LIMIT ${QA_LIST_LIMIT}
    `) as QaRow[];
    return rows.map(rowToEntry);
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "list" });
    return [];
  }
}

export async function getQaEntry(
  id: number,
  sql: Sql | null = getSql()
): Promise<QaEntry | null> {
  if (!sql || !Number.isInteger(id) || id <= 0) return null;
  try {
    const rows = (await sql`
      SELECT id, conversation_id, product_id, product_title, gap_summary,
             question, answer, question_en, answer_en, status, model,
             input_tokens, output_tokens,
             created_at, updated_at, answered_at, published_at
        FROM qa_entries WHERE id = ${id}
    `) as QaRow[];
    return rows[0] ? rowToEntry(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "get" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Wissen KPIs (KPI tab)
// ---------------------------------------------------------------------------

export interface QaKpis {
  /** Lifetime queue state (same numbers as the Wissen tab header). */
  queue: QaCounts;
  /** Entries CREATED inside the window (gaps found by the scan). */
  createdInWindow: number;
  /** Entries PUBLISHED inside the window (knowledge shipped to Mo/PDP). */
  publishedInWindow: number;
  /** Median hours from draft to operator answer, over entries answered inside
   * the window. Null when none. */
  medianHoursToAnswer: number | null;
  /** Median hours from draft to publish, over entries published inside the
   * window. Null when none. */
  medianHoursToPublish: number | null;
  /** Conversations currently eligible for a knowledge-gap scan but not yet
   * scanned (the backlog the operator can burn down). */
  scanBacklog: number;
}

/**
 * Aggregate the knowledge queue for the KPI tab: lifetime queue state plus
 * windowed throughput (gaps found / published) and the operator's answering
 * latency. Returns null when no DB is configured or on a hard failure.
 */
export async function getQaKpis(
  range: { from: string; to: string },
  sql: Sql | null = getSql()
): Promise<QaKpis | null> {
  if (!sql) return null;
  try {
    const [queue, backlog, windowRows, latencyRows] = await Promise.all([
      getQaCounts(sql),
      countScanCandidates(sql),
      sql`
        SELECT
          count(*) FILTER (WHERE created_at >= ${range.from}::date
                             AND created_at < (${range.to}::date + 1))::int AS created_n,
          count(*) FILTER (WHERE published_at >= ${range.from}::date
                             AND published_at < (${range.to}::date + 1))::int AS published_n
          FROM qa_entries
      `,
      sql`
        SELECT
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (answered_at - created_at)) / 3600.0
          ) FILTER (WHERE answered_at >= ${range.from}::date
                      AND answered_at < (${range.to}::date + 1)) AS med_answer_h,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (published_at - created_at)) / 3600.0
          ) FILTER (WHERE published_at >= ${range.from}::date
                      AND published_at < (${range.to}::date + 1)) AS med_publish_h
          FROM qa_entries
      `,
    ]);

    const w = (windowRows as Array<Record<string, unknown>>)[0] ?? {};
    const l = (latencyRows as Array<Record<string, unknown>>)[0] ?? {};
    const toHours = (v: unknown): number | null => {
      const n = Number(v);
      return v == null || !Number.isFinite(n) ? null : n;
    };
    return {
      queue,
      createdInWindow: Number(w.created_n ?? 0),
      publishedInWindow: Number(w.published_n ?? 0),
      medianHoursToAnswer: toHours(l.med_answer_h),
      medianHoursToPublish: toHours(l.med_publish_h),
      scanBacklog: backlog,
    } satisfies QaKpis;
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "kpis" });
    return null;
  }
}

/** Per-status counts for the tab header (missing statuses come back 0). */
export async function getQaCounts(sql: Sql | null = getSql()): Promise<QaCounts> {
  const counts: QaCounts = { open: 0, answered: 0, published: 0, dismissed: 0 };
  if (!sql) return counts;
  try {
    const rows = (await sql`
      SELECT status, count(*)::int AS n FROM qa_entries GROUP BY status
    `) as Array<{ status: string; n: number }>;
    for (const r of rows) {
      if (r.status in counts) counts[r.status as keyof QaCounts] = Number(r.n);
    }
    return counts;
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "counts" });
    return counts;
  }
}

/**
 * Insert a drafted entry. De-dup: the partial unique index on
 * question_fingerprint (non-dismissed rows) makes a duplicate question a
 * silent no-op — returns null in that case so the scan can count "skipped".
 */
export async function createQaEntry(
  input: {
    conversationId: number | null;
    productId: string | null;
    productTitle: string | null;
    gapSummary: string;
    question: string;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
  },
  sql: Sql | null = getSql()
): Promise<QaEntry | null> {
  if (!sql) return null;
  const fp = questionFingerprint(input.question);
  if (!fp) return null;
  try {
    const rows = (await sql`
      INSERT INTO qa_entries
        (conversation_id, product_id, product_title, gap_summary, question,
         question_fingerprint, model, input_tokens, output_tokens)
      VALUES
        (${input.conversationId}, ${input.productId}, ${input.productTitle},
         ${input.gapSummary}, ${input.question}, ${fp}, ${input.model},
         ${input.inputTokens}, ${input.outputTokens})
      ON CONFLICT (question_fingerprint) WHERE status <> 'dismissed'
      DO NOTHING
      RETURNING id, conversation_id, product_id, product_title, gap_summary,
                question, answer, question_en, answer_en, status, model,
                input_tokens, output_tokens,
                created_at, updated_at, answered_at, published_at
    `) as QaRow[];
    return rows[0] ? rowToEntry(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "create" });
    return null;
  }
}

/**
 * Operator saves/edits question, answer and product attribution. A non-empty
 * answer moves an 'open' entry to 'answered'; published entries stay
 * 'published' (re-publish pushes the edit to Shopify).
 */
export async function saveQaAnswer(
  input: {
    id: number;
    question?: string;
    answer: string;
    productId?: string | null;
    productTitle?: string | null;
    // Operator override for the English pair. Empty strings CLEAR the cached
    // translation (forcing a fresh auto-translation on the next publish);
    // undefined leaves it untouched.
    questionEn?: string;
    answerEn?: string;
  },
  sql: Sql | null = getSql()
): Promise<QaEntry | null> {
  if (!sql) return null;
  const answer = input.answer.trim();
  const question = input.question?.trim();
  const fp = question ? questionFingerprint(question) : null;
  const questionEn =
    input.questionEn === undefined ? undefined : input.questionEn.trim() || null;
  const answerEn =
    input.answerEn === undefined ? undefined : input.answerEn.trim() || null;
  try {
    const rows = (await sql`
      UPDATE qa_entries
         SET answer = ${answer || null},
             question = COALESCE(${question ?? null}, question),
             question_fingerprint = COALESCE(${fp}, question_fingerprint),
             question_en = CASE WHEN ${questionEn !== undefined} THEN ${questionEn ?? null} ELSE question_en END,
             answer_en = CASE WHEN ${answerEn !== undefined} THEN ${answerEn ?? null} ELSE answer_en END,
             product_id = ${input.productId === undefined ? null : input.productId},
             product_title = ${input.productTitle === undefined ? null : input.productTitle},
             status = CASE
                        WHEN status = 'published' THEN 'published'
                        WHEN ${answer !== ""} THEN 'answered'
                        ELSE 'open'
                      END,
             answered_at = CASE WHEN ${answer !== ""} THEN COALESCE(answered_at, now()) ELSE NULL END,
             updated_at = now()
       WHERE id = ${input.id} AND status <> 'dismissed'
      RETURNING id, conversation_id, product_id, product_title, gap_summary,
                question, answer, question_en, answer_en, status, model,
                input_tokens, output_tokens,
                created_at, updated_at, answered_at, published_at
    `) as QaRow[];
    return rows[0] ? rowToEntry(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "answer" });
    return null;
  }
}

export async function markQaPublished(
  id: number,
  sql: Sql | null = getSql()
): Promise<QaEntry | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE qa_entries
         SET status = 'published', published_at = now(), updated_at = now()
       WHERE id = ${id} AND status IN ('answered', 'published')
      RETURNING id, conversation_id, product_id, product_title, gap_summary,
                question, answer, question_en, answer_en, status, model,
                input_tokens, output_tokens,
                created_at, updated_at, answered_at, published_at
    `) as QaRow[];
    return rows[0] ? rowToEntry(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "publish" });
    return null;
  }
}

/**
 * Cache an auto-generated English translation on the entry (publish-time
 * fill; never overwrites an operator-provided value — the publish route only
 * calls this when both EN fields were empty).
 */
export async function saveQaTranslation(
  input: { id: number; questionEn: string; answerEn: string },
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE qa_entries
         SET question_en = ${input.questionEn},
             answer_en = ${input.answerEn},
             updated_at = now()
       WHERE id = ${input.id}
    `;
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "save-translation" });
  }
}

/**
 * Pull a published entry back to 'answered' ("Zurückziehen"). The caller is
 * responsible for removing the pair from Shopify / invalidating the general-QA
 * cache FIRST — this only records the state transition.
 */
export async function markQaUnpublished(
  id: number,
  sql: Sql | null = getSql()
): Promise<QaEntry | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE qa_entries
         SET status = 'answered', published_at = NULL, updated_at = now()
       WHERE id = ${id} AND status = 'published'
      RETURNING id, conversation_id, product_id, product_title, gap_summary,
                question, answer, question_en, answer_en, status, model,
                input_tokens, output_tokens,
                created_at, updated_at, answered_at, published_at
    `) as QaRow[];
    return rows[0] ? rowToEntry(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "unpublish" });
    return null;
  }
}

export type RestoreQaResult =
  | { status: "restored"; entry: QaEntry }
  | { status: "duplicate" } // an active entry with the same question exists
  | { status: "not_found" };

/**
 * Bring a dismissed entry back into the queue ("Wiederherstellen"): with an
 * answer it returns as 'answered', otherwise as 'open'. Guarded against the
 * fingerprint de-dup rule: if the same question was re-drafted (or manually
 * re-created) while this one was dismissed, restoring would create two active
 * copies — that case reports 'duplicate' instead.
 */
export async function restoreQaEntry(
  id: number,
  sql: Sql | null = getSql()
): Promise<RestoreQaResult> {
  if (!sql) return { status: "not_found" };
  try {
    // Duplicate probe FIRST (the partial unique index on question_fingerprint
    // covers non-dismissed rows — an UPDATE into a collision would throw).
    const dup = (await sql`
      SELECT EXISTS (
        SELECT 1 FROM qa_entries other
         WHERE other.question_fingerprint =
               (SELECT question_fingerprint FROM qa_entries WHERE id = ${id})
           AND other.id <> ${id}
           AND other.status <> 'dismissed'
      ) AS dup
    `) as Array<{ dup: boolean }>;
    if (dup[0]?.dup === true) return { status: "duplicate" };

    const rows = (await sql`
      UPDATE qa_entries
         SET status = CASE
                        WHEN answer IS NOT NULL AND length(btrim(answer)) > 0 THEN 'answered'
                        ELSE 'open'
                      END,
             updated_at = now()
       WHERE id = ${id} AND status = 'dismissed'
      RETURNING id, conversation_id, product_id, product_title, gap_summary,
                question, answer, question_en, answer_en, status, model,
                input_tokens, output_tokens,
                created_at, updated_at, answered_at, published_at
    `) as QaRow[];
    return rows[0]
      ? { status: "restored", entry: rowToEntry(rows[0]) }
      : { status: "not_found" };
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "restore" });
    return { status: "not_found" };
  }
}

export async function dismissQaEntry(
  id: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    await sql`
      UPDATE qa_entries
         SET status = 'dismissed', updated_at = now()
       WHERE id = ${id} AND status <> 'published'
    `;
    return true;
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "dismiss" });
    return false;
  }
}

// ── Scan support ─────────────────────────────────────────────────────────────

export interface ScanCandidate {
  conversationId: number;
  quality: string | null;
  contactFormShown: boolean;
}

/**
 * Conversations the knowledge-gap scan should look at next: not yet scanned,
 * AND (analysis flagged unmet_need/dropped_off OR the contact form was shown).
 * Newest first, capped. The quality filter mirrors
 * qa-core.QA_ELIGIBLE_QUALITIES — keep the two in sync.
 */
export async function listScanCandidates(
  limit: number,
  sql: Sql | null = getSql()
): Promise<ScanCandidate[]> {
  if (!sql) return [];
  const n = Math.max(1, Math.min(50, Math.floor(limit)));
  try {
    const rows = (await sql`
      SELECT c.id,
             c.analysis_quality,
             EXISTS (
               SELECT 1 FROM messages m
                WHERE m.conversation_id = c.id
                  AND m.tool_name = 'show_contact_form'
             ) AS contact_form_shown
        FROM conversations c
       WHERE c.qa_scanned_at IS NULL
         AND (
           c.analysis_quality IN ('unmet_need', 'dropped_off')
           OR EXISTS (
             SELECT 1 FROM messages m
              WHERE m.conversation_id = c.id
                AND m.tool_name = 'show_contact_form'
           )
         )
       ORDER BY c.created_at DESC
       LIMIT ${n}
    `) as Array<{ id: number; analysis_quality: string | null; contact_form_shown: boolean }>;
    return rows.map((r) => ({
      conversationId: Number(r.id),
      quality: r.analysis_quality,
      contactFormShown: r.contact_form_shown === true,
    }));
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "scan-candidates" });
    return [];
  }
}

/** How many conversations are still waiting for a knowledge-gap scan. */
export async function countScanCandidates(sql: Sql | null = getSql()): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = (await sql`
      SELECT count(*)::int AS n
        FROM conversations c
       WHERE c.qa_scanned_at IS NULL
         AND (
           c.analysis_quality IN ('unmet_need', 'dropped_off')
           OR EXISTS (
             SELECT 1 FROM messages m
              WHERE m.conversation_id = c.id
                AND m.tool_name = 'show_contact_form'
           )
         )
    `) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "scan-count" });
    return 0;
  }
}

/** Stamp a conversation as scanned (also when NO gap was found). */
export async function markConversationQaScanned(
  conversationId: number,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE conversations SET qa_scanned_at = now() WHERE id = ${conversationId}
    `;
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "mark-scanned" });
  }
}

/**
 * Product handles that appeared in a conversation — candidates for the draft
 * pass's product attribution. Sources: the conversation's intent list
 * (selected_product_ids) plus productId(s) parsed from show_product /
 * compare_products / add_to_cart tool rows (their content is the tool input).
 */
export async function getConversationProductHandles(
  conversationId: number,
  sql: Sql | null = getSql()
): Promise<string[]> {
  if (!sql) return [];
  const out = new Set<string>();
  try {
    const convRows = (await sql`
      SELECT selected_product_ids FROM conversations WHERE id = ${conversationId}
    `) as Array<{ selected_product_ids: string[] | null }>;
    for (const id of convRows[0]?.selected_product_ids ?? []) {
      if (typeof id === "string" && id.trim()) out.add(id.trim());
    }
    const toolRows = (await sql`
      SELECT content FROM messages
       WHERE conversation_id = ${conversationId}
         AND tool_name IN ('show_product', 'compare_products', 'add_to_cart')
       LIMIT 100
    `) as Array<{ content: string }>;
    for (const r of toolRows) {
      try {
        const args = JSON.parse(r.content) as {
          productId?: unknown;
          productIds?: unknown;
        };
        if (typeof args.productId === "string" && args.productId.trim()) {
          out.add(args.productId.trim());
        }
        if (Array.isArray(args.productIds)) {
          for (const id of args.productIds) {
            if (typeof id === "string" && id.trim()) out.add(id.trim());
          }
        }
      } catch {
        // tool content not JSON — skip
      }
      if (out.size >= 12) break;
    }
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "conversation-products" });
  }
  return Array.from(out).slice(0, 12);
}

// ── Mo's general knowledge block ─────────────────────────────────────────────

/**
 * Published GENERAL (product-less) Q&A pairs for Mo's system prompt, oldest
 * first (stable ordering), capped. Product-linked pairs are NOT returned here
 * — they reach Mo through the product's `custom.qa` metafield via the catalog
 * sync.
 */
// In-memory TTL cache for the chat hot path: the general knowledge block is
// read on EVERY chat turn, but changes only when an operator publishes — a
// 5-minute staleness is invisible, a per-turn query is not free. Never throws;
// on any failure the chat simply gets the last known (or empty) list.
let generalQaCache: { at: number; entries: GeneralQaEntry[] } | null =
  null;
const GENERAL_QA_TTL_MS = 5 * 60 * 1000;

export async function getCachedGeneralQa(): Promise<GeneralQaEntry[]> {
  if (generalQaCache && Date.now() - generalQaCache.at < GENERAL_QA_TTL_MS) {
    return generalQaCache.entries;
  }
  const entries = await listPublishedGeneralQa();
  generalQaCache = { at: Date.now(), entries };
  return entries;
}

/** Drop the chat-path cache (called after publish/dismiss so edits go live). */
export function invalidateGeneralQaCache(): void {
  generalQaCache = null;
}

export interface GeneralQaEntry {
  question: string;
  answer: string;
  questionEn?: string;
  answerEn?: string;
}

export async function listPublishedGeneralQa(
  limit = 30,
  sql: Sql | null = getSql()
): Promise<GeneralQaEntry[]> {
  if (!sql) return [];
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  try {
    const rows = (await sql`
      SELECT question, answer, question_en, answer_en
        FROM qa_entries
       WHERE status = 'published' AND product_id IS NULL AND answer IS NOT NULL
       ORDER BY published_at ASC
       LIMIT ${n}
    `) as Array<{
      question: string;
      answer: string;
      question_en: string | null;
      answer_en: string | null;
    }>;
    return rows
      .filter((r) => r.question && r.answer)
      .map((r) => ({
        question: r.question,
        answer: r.answer,
        ...(r.question_en && r.answer_en
          ? { questionEn: r.question_en, answerEn: r.answer_en }
          : {}),
      }));
  } catch (err) {
    reportError(err, { route: "lib/qa-store", phase: "general-qa" });
    return [];
  }
}
