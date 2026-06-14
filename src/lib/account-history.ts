// Signed-in (tier-3) conversation history — the data layer behind
// /api/account/conversations and /api/account/erase.
//
// Identity model (do NOT weaken): every read/write here is scoped by the
// resolved customer id (a SIGNED-IN customer, see resolveSignedInCustomer +
// requireSignedInCustomer). Because all of a signed-in customer's sessions —
// on every device — link to the SAME customers row (keyed by
// shopify_customer_id), scoping by customer_id lists/operates ACROSS devices.
// Every mutation additionally constrains `customer_id = $self` so a customer
// can only ever touch their OWN conversations (an id they don't own simply
// "not found"); anonymous / email-only callers never reach this module because
// the resolver fails closed before it.
//
// Deletion semantics (see docs/CUSTOMER_ACCOUNT.md §9 + docs/DATA_RETENTION.md):
//   * deleteCustomerConversation HARD-deletes ONE transcript (messages + chat
//     ai_usage cascade). The durable "current understanding" profile is a
//     SEPARATE aggregate under a different lawful basis: deleting the source
//     conversation means a FUTURE profile regeneration no longer sees it, but
//     profile text already derived persists until regenerated or the customer
//     is erased.
//   * eraseSignedInCustomer is the DISTINCT full "delete my data" path: it
//     purges ALL the customer's conversations, clears the profile + cached
//     summaries, revokes the OAuth tokens, and suppresses the email — a true
//     GDPR erasure, stronger than the single-chat delete.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import type { TranscriptMessage, ConversationSummaryData } from "./conversation-store";
import { deriveConversationTitle } from "./conversation-title.mjs";

// Bound the history list. A signed-in customer's own past consultations — more
// than this is paginated away (the widget shows the most recent).
const HISTORY_LIST_LIMIT = 100;

/** One row of the signed-in customer's conversation list. */
export interface ConversationListItem {
  conversationId: number;
  /**
   * The per-THREAD key (migration 0018) the widget sends on /api/chat to RESUME
   * this conversation. Distinct from `conversationId` (the numeric DB id used by
   * the per-id account routes). Falls back to the session id for legacy rows.
   */
  conversationKey: string;
  /** Custom title if renamed, else the cheap derived label (never null). */
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  /** Count of READABLE turns (user/assistant text; tool rows excluded). */
  messageCount: number;
}

/**
 * List a signed-in customer's past conversations across all their devices,
 * most recent first. The title is the customer's custom title when set, else
 * the cheap first-user-message label (no model call). Returns [] on any
 * failure or when no DB is configured. Fail-closed by construction: scoped to
 * the resolved customer id.
 */
export async function listCustomerConversations(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<ConversationListItem[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT co.id,
             co.conversation_key,
             co.title,
             co.created_at,
             co.updated_at,
             fu.content AS first_user_message,
             COALESCE(mc.cnt, 0) AS message_count
        FROM conversations co
        LEFT JOIN LATERAL (
          SELECT m.content
            FROM messages m
           WHERE m.conversation_id = co.id
             AND m.role = 'user'
             AND m.tool_name IS NULL
             AND length(btrim(m.content)) > 0
           ORDER BY m.created_at ASC, m.id ASC
           LIMIT 1
        ) fu ON true
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS cnt
            FROM messages m
           WHERE m.conversation_id = co.id
             AND m.role IN ('user', 'assistant')
             AND m.tool_name IS NULL
             AND length(btrim(m.content)) > 0
        ) mc ON true
       WHERE co.customer_id = ${customerId}
       ORDER BY co.last_activity_at DESC, co.id DESC
       LIMIT ${HISTORY_LIST_LIMIT}
    `) as Array<Record<string, unknown>>;

    return rows.map((r) => {
      const custom = (r.title as string | null) ?? null;
      const title =
        custom && custom.trim()
          ? custom.trim()
          : deriveConversationTitle((r.first_user_message as string | null) ?? "");
      return {
        conversationId: Number(r.id),
        conversationKey: String(r.conversation_key ?? ""),
        title,
        createdAt: (r.created_at as string | null) ?? null,
        updatedAt: (r.updated_at as string | null) ?? null,
        messageCount: r.message_count != null ? Number(r.message_count) : 0,
      };
    });
  } catch (err) {
    reportError(err, { route: "lib/account-history", phase: "listCustomerConversations" });
    return [];
  }
}

/** A single past conversation's transcript, scoped to its owning customer. */
export interface ConversationTranscript {
  conversationId: number;
  /** The per-thread key to RESUME this conversation on /api/chat (migration 0018). */
  conversationKey: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  personaLabel: string | null;
  messageCount: number;
  /** Readable user/assistant turns (tool bookkeeping rows dropped). */
  messages: TranscriptMessage[];
}

/**
 * Fetch ONE past conversation's transcript — but only if it belongs to this
 * customer. Returns null when there is no DB, no such conversation, or it
 * belongs to someone else (ownership is enforced in the WHERE clause, so a
 * foreign id is indistinguishable from a missing one — no enumeration leak).
 */
export async function getCustomerConversationTranscript(
  customerId: number,
  conversationId: number,
  sql: Sql | null = getSql()
): Promise<ConversationTranscript | null> {
  if (!sql) return null;
  if (!Number.isInteger(conversationId)) return null;
  try {
    const convRows = (await sql`
      SELECT id, conversation_key, title, persona_label, created_at, updated_at
        FROM conversations
       WHERE id = ${conversationId}
         AND customer_id = ${customerId}
    `) as Array<Record<string, unknown>>;
    const conv = convRows[0];
    if (!conv) return null;

    const msgRows = (await sql`
      SELECT role, content, tool_name
        FROM messages
       WHERE conversation_id = ${conversationId}
       ORDER BY created_at ASC, id ASC
    `) as Array<Record<string, unknown>>;

    const messages: TranscriptMessage[] = [];
    for (const m of msgRows) {
      const role = m.role as TranscriptMessage["role"];
      const content = typeof m.content === "string" ? m.content : "";
      const toolName = (m.tool_name as string | null) ?? null;
      // Keep only the readable conversation turns (same filter as the admin
      // session view): drop tool-bookkeeping rows and empty content.
      if (toolName !== null || (role !== "user" && role !== "assistant") || !content.trim()) {
        continue;
      }
      messages.push({ role, content, toolName: null });
    }

    const custom = (conv.title as string | null) ?? null;
    const firstUser = messages.find((m) => m.role === "user")?.content ?? "";
    const title = custom && custom.trim() ? custom.trim() : deriveConversationTitle(firstUser);

    return {
      conversationId: Number(conv.id),
      conversationKey: String(conv.conversation_key ?? ""),
      title,
      createdAt: (conv.created_at as string | null) ?? null,
      updatedAt: (conv.updated_at as string | null) ?? null,
      personaLabel: (conv.persona_label as string | null) ?? null,
      messageCount: messages.length,
      messages,
    };
  } catch (err) {
    reportError(err, { route: "lib/account-history", phase: "getCustomerConversationTranscript" });
    return null;
  }
}

/**
 * Load ONE of the signed-in customer's conversations — by its per-THREAD
 * `conversationKey` (migration 0018) — in the shape the S5 summary renderer
 * consumes (transcript + the accumulated DISCUSSED / SELECTED product id sets).
 * This backs the "Zusammenfassung herunterladen" download.
 *
 * Ownership is enforced in the WHERE clause (`customer_id = $self`), so a thread
 * the caller doesn't own — or one belonging to an anonymous/tier-2 session — is
 * indistinguishable from a missing one (no enumeration leak). `conversation_key`
 * is unique (migration 0018), so this returns at most one row. Returns null when
 * there's no DB, an empty key, or no such owned conversation.
 */
export async function loadCustomerConversationForSummary(
  customerId: number,
  conversationKey: string,
  sql: Sql | null = getSql()
): Promise<ConversationSummaryData | null> {
  if (!sql) return null;
  const key = conversationKey.trim();
  if (!key) return null;
  try {
    const convRows = (await sql`
      SELECT id, persona_label, recommended_product_ids, selected_product_ids
        FROM conversations
       WHERE conversation_key = ${key}
         AND customer_id = ${customerId}
    `) as Array<Record<string, unknown>>;
    const conv = convRows[0];
    if (!conv) return null;

    const msgRows = (await sql`
      SELECT role, content, tool_name
        FROM messages
       WHERE conversation_id = ${Number(conv.id)}
       ORDER BY created_at ASC, id ASC
    `) as Array<Record<string, unknown>>;

    const messages: TranscriptMessage[] = msgRows.map((r) => ({
      role: r.role as TranscriptMessage["role"],
      content: typeof r.content === "string" ? r.content : "",
      toolName: (r.tool_name as string | null) ?? null,
    }));

    return {
      conversationId: Number(conv.id),
      personaLabel: (conv.persona_label as string | null) ?? null,
      recommendedProductIds: Array.isArray(conv.recommended_product_ids)
        ? (conv.recommended_product_ids as string[])
        : [],
      selectedProductIds: Array.isArray(conv.selected_product_ids)
        ? (conv.selected_product_ids as string[])
        : [],
      messages,
    };
  } catch (err) {
    reportError(err, {
      route: "lib/account-history",
      phase: "loadCustomerConversationForSummary",
    });
    return null;
  }
}

/**
 * Rename a conversation's title — only if it belongs to this customer. The
 * caller passes an already-sanitised title (see sanitizeTitleInput). Bumps
 * updated_at (a metadata edit) but NOT last_activity_at, so a rename never
 * reorders the list or extends the retention window. Returns true when a row
 * was updated, false otherwise (not found / not owned / no DB).
 */
export async function renameCustomerConversation(
  customerId: number,
  conversationId: number,
  title: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  if (!Number.isInteger(conversationId)) return false;
  try {
    const rows = (await sql`
      UPDATE conversations
         SET title = ${title},
             updated_at = now()
       WHERE id = ${conversationId}
         AND customer_id = ${customerId}
      RETURNING id
    `) as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/account-history", phase: "renameCustomerConversation" });
    return false;
  }
}

/**
 * HARD-delete ONE conversation — only if it belongs to this customer. Messages
 * and chat ai_usage rows cascade (FK ON DELETE CASCADE). The customer's durable
 * profile is NOT touched here: it is a separate aggregate (see module header) —
 * a future profile regeneration simply no longer sees this transcript. Returns
 * true when a row was deleted, false otherwise (not found / not owned / no DB).
 */
export async function deleteCustomerConversation(
  customerId: number,
  conversationId: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  if (!Number.isInteger(conversationId)) return false;
  try {
    const rows = (await sql`
      DELETE FROM conversations
       WHERE id = ${conversationId}
         AND customer_id = ${customerId}
      RETURNING id
    `) as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/account-history", phase: "deleteCustomerConversation" });
    return false;
  }
}

export interface EraseCustomerResult {
  /** Number of conversations purged (transcripts hard-deleted). */
  deletedConversations: number;
}

/**
 * The DISTINCT full "delete my data" path for a signed-in customer — a true
 * GDPR erasure, separate from the single-chat delete. In one transaction:
 *   1. PURGE every linked conversation (transcripts + messages + chat ai_usage
 *      cascade) — not merely unlink them. The customer's own transcripts are
 *      gone, the strongest reading of "erase my data".
 *   2. Suppress + purge the consent record: add the (real) email to
 *      suppression_list (reason 'erasure', so a future re-identification can't
 *      silently re-attach) and delete its email_captures (marketing_sends
 *      cascade) — exactly the documented manual erasure-of-an-email procedure.
 *   3. DELETE the customers row. This CLEARS the profile + all cached summaries
 *      (they live on the row), REVOKES the OAuth tokens (customer_oauth_tokens
 *      ON DELETE CASCADE), and de-identifies any remaining FK references
 *      (bundle_offers ON DELETE SET NULL — kept for accounting, no PII).
 *
 * The synthetic `shopify:<id>` placeholder email (a tier-3 row created with no
 * verified Shopify email) is NOT a real address, so step 2 is skipped for it.
 *
 * Returns null only when no DB is configured or the transaction hard-failed
 * (the caller surfaces that as a 503/500). On success the customer no longer
 * resolves — every subsequent history call fails closed.
 */
export async function eraseSignedInCustomer(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<EraseCustomerResult | null> {
  if (!sql) return null;
  try {
    // The email decides whether there's a consent record to suppress + purge.
    const custRows = (await sql`
      SELECT email FROM customers WHERE id = ${customerId}
    `) as Array<Record<string, unknown>>;
    if (custRows.length === 0) {
      // Already gone — idempotent success with nothing to purge.
      return { deletedConversations: 0 };
    }
    const email = (custRows[0].email as string | null) ?? "";
    const realEmail = email.includes("@") && !email.startsWith("shopify:") ? email : null;

    // All three steps run in ONE transaction so an erasure is all-or-nothing:
    //   1) PURGE the transcripts (messages + chat ai_usage cascade);
    //   2) suppress + purge the consent record (marketing_sends cascade) for a
    //      real email — skipped for the synthetic shopify:<id> placeholder;
    //   3) DELETE the customer row — clears profile + cached summaries, cascades
    //      (revokes) the OAuth tokens, SET NULLs the de-identifiable FK refs.
    const queries = [
      sql`
        WITH del AS (
          DELETE FROM conversations WHERE customer_id = ${customerId} RETURNING 1
        )
        SELECT count(*)::int AS n FROM del
      `,
    ];
    if (realEmail) {
      queries.push(sql`
        INSERT INTO suppression_list (email, reason)
        VALUES (${realEmail}, 'erasure')
        ON CONFLICT (email) DO NOTHING
      `);
      // Suppress the SEPARATE §7(3) Bestandskunden basis too: deleting the
      // customers row drops the cached eligibility, but a future re-sign-in
      // would re-derive it from the (unchanged) Shopify purchase history. The
      // objection list keeps the erasure durable across both lawful bases.
      queries.push(sql`
        INSERT INTO bestandskunden_suppression_list (email, reason)
        VALUES (${realEmail}, 'erasure')
        ON CONFLICT (email) DO NOTHING
      `);
      queries.push(sql`DELETE FROM email_captures WHERE email = ${realEmail}`);
    }
    queries.push(sql`DELETE FROM customers WHERE id = ${customerId}`);

    const results = (await sql.transaction(queries)) as Array<Array<Record<string, unknown>>>;
    const deletedConversations =
      results[0]?.[0]?.n != null ? Number(results[0][0].n) : 0;

    return { deletedConversations };
  } catch (err) {
    reportError(err, { route: "lib/account-history", phase: "eraseSignedInCustomer" });
    return null;
  }
}
