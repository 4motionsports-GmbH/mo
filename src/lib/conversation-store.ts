// Conversation + message persistence (Cluster A — legitimate interest).
//
// Called from /api/chat AFTER the model stream finishes, so it never adds
// latency to token delivery. Every path is best-effort: a database failure is
// logged and swallowed — it must NEVER break the chat response. When no
// database is configured (getSql() === null) this is a silent no-op.
//
// Pseudonymous only: we key on the client-generated session_id and store no
// email here. Email lives exclusively in the consent/marketing cluster.

import type { UIMessage } from "ai";
import { getSql } from "./db";
import { reportError } from "./observability";
import { recordAiUsage } from "./ai-usage-store";

// Tool inputs that reference catalog product ids. Used to accumulate
// conversations.recommended_product_ids — the "DISCUSSED" set: every product
// that appeared in the conversation, including compared-and-rejected ones.
const PRODUCT_TOOLS = new Set([
  "show_product",
  "compare_products",
  "add_to_cart",
  "suggest_showroom",
  "show_contact_form",
  "offer_email_summary",
]);

// Tools whose firing signals the user actively CHOSE to buy — the "SELECTED"
// set, distinct from merely discussed. add_to_cart is the direct-checkout CTA:
// the model fires it only on a clear buy signal ("Das nehme ich"), with ALL
// wanted items in one call (productId or productIds). show_product /
// compare_products, by contrast, are pure discussion.
const SELECTION_TOOLS = new Set(["add_to_cart"]);

// Keep stored content bounded — tool inputs and messages are small, but never
// let a pathological turn write an unbounded blob.
const MAX_CONTENT_CHARS = 8000;

export interface ToolInvocation {
  toolName: string;
  input: unknown;
}

export interface PersistTurnInput {
  sessionId: string | null;
  /**
   * Per-THREAD key (migration 0018). The widget sends a stable, client-generated
   * value per conversation; "Neue Beratung" = a fresh key. Defaults to
   * `sessionId` when absent, preserving the legacy one-thread-per-session
   * behaviour. The row's session_id is never rewritten on conflict, so resuming
   * a thread from another device (same key) appends to the original row.
   */
  conversationKey?: string | null;
  /** Full incoming UIMessage history (the new user turn is the last user msg). */
  history: UIMessage[];
  /** Persona archetype the backend derived this turn (e.g. 'pragmatic_beginner'). */
  personaLabel: string;
  /** Assistant text produced this turn. */
  assistantText: string;
  /** Tool calls the assistant fired this turn. */
  assistantToolCalls: ToolInvocation[];
  /** Stable id for the assistant turn (provider response id). */
  assistantMessageId: string;
  /**
   * Token usage for this turn's model call (the AI SDK's aggregated
   * `totalUsage`), recorded against the conversation for the cost-per-
   * consultation KPI. Optional — omitted when usage is unavailable.
   */
  usage?: { model: string; inputTokens: number; outputTokens: number };
}

function truncate(s: string): string {
  return s.length > MAX_CONTENT_CHARS ? s.slice(0, MAX_CONTENT_CHARS) : s;
}

function textOfMessage(msg: UIMessage): string {
  return (msg.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join(" ")
    .trim();
}

function toolInvocationsOfMessage(msg: UIMessage): ToolInvocation[] {
  const out: ToolInvocation[] = [];
  for (const part of msg.parts ?? []) {
    const t = part.type;
    if (typeof t === "string" && t.startsWith("tool-")) {
      out.push({
        toolName: t.slice("tool-".length),
        input: (part as { input?: unknown }).input,
      });
    }
  }
  return out;
}

function productIdsFromInvocation(inv: ToolInvocation): string[] {
  if (!PRODUCT_TOOLS.has(inv.toolName)) return [];
  const input = inv.input;
  if (!input || typeof input !== "object") return [];
  const obj = input as Record<string, unknown>;
  const out: string[] = [];
  if (typeof obj.productId === "string") out.push(obj.productId);
  if (Array.isArray(obj.productIds)) {
    for (const p of obj.productIds) if (typeof p === "string") out.push(p);
  }
  return out;
}

/**
 * The user's CURRENT selection: the product ids of the LATEST selection-intent
 * (add_to_cart) tool call across the whole conversation, or null when no such
 * call exists.
 *
 * The latest call REPLACES earlier ones instead of accumulating: the model is
 * instructed to put ALL wanted items into ONE add_to_cart call per buying
 * decision, so a newer call after a switch ("nimm doch lieber das andere")
 * reflects the user's current decision — the rejected alternative must not
 * linger in the cart. Deliberately no further inference (no NLP over the
 * transcript): the tool call IS the signal.
 */
function latestSelectedProductIds(
  history: UIMessage[],
  assistantToolCalls: ToolInvocation[]
): string[] | null {
  let latest: string[] | null = null;
  const consider = (inv: ToolInvocation) => {
    if (!SELECTION_TOOLS.has(inv.toolName)) return;
    // productIdsFromInvocation reads both `productId` (single checkout) and
    // `productIds` (multi-product checkout), so every wanted item is captured.
    const ids = [...new Set(productIdsFromInvocation(inv))];
    if (ids.length > 0) latest = ids;
  };
  for (const msg of history) {
    for (const inv of toolInvocationsOfMessage(msg)) consider(inv);
  }
  for (const inv of assistantToolCalls) consider(inv);
  return latest;
}

function latestUserMessage(history: UIMessage[]): UIMessage | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return history[i];
  }
  return null;
}

export interface TranscriptMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName: string | null;
}

export interface ConversationSummaryData {
  conversationId: number;
  personaLabel: string | null;
  /** Every product referenced by tool calls — the DISCUSSED set. */
  recommendedProductIds: string[];
  /**
   * Products the user expressed intent to BUY (latest add_to_cart call) — the
   * SELECTED set. Empty when no buy signal occurred; cart-link builders then
   * fall back to the discussed set (see chooseCartProductIds in lib/cart).
   */
  selectedProductIds: string[];
  messages: TranscriptMessage[];
}

/**
 * Load a conversation for the transactional summary email: the ordered
 * transcript plus the accumulated recommended product ids. Returns null when
 * there's no DB or no such conversation. Read-only — Cluster A data, keyed by
 * the pseudonymous session_id (never the email).
 *
 * A session may now host multiple THREADS (migration 0018); the summary is for
 * the chat the user is currently in, so we take the MOST RECENTLY ACTIVE thread
 * of the session. With one thread this is identical to the legacy behaviour.
 */
export async function loadConversationForSummary(
  sessionId: string
): Promise<ConversationSummaryData | null> {
  const sql = getSql();
  if (!sql) return null;
  const sid = sessionId.trim();
  if (!sid) return null;

  try {
    const convRows = await sql`
      SELECT id, persona_label, recommended_product_ids, selected_product_ids
        FROM conversations
       WHERE session_id = ${sid}
       ORDER BY last_activity_at DESC, id DESC
       LIMIT 1
    `;
    const conv = convRows[0] as
      | {
          id: number;
          persona_label: string | null;
          recommended_product_ids: string[];
          selected_product_ids: string[];
        }
      | undefined;
    if (!conv) return null;

    const msgRows = await sql`
      SELECT role, content, tool_name
        FROM messages
       WHERE conversation_id = ${conv.id}
       ORDER BY created_at ASC, id ASC
    `;

    const messages: TranscriptMessage[] = msgRows.map((r) => ({
      role: r.role as TranscriptMessage["role"],
      content: typeof r.content === "string" ? r.content : "",
      toolName: (r.tool_name as string | null) ?? null,
    }));

    return {
      conversationId: conv.id,
      personaLabel: conv.persona_label ?? null,
      recommendedProductIds: Array.isArray(conv.recommended_product_ids)
        ? conv.recommended_product_ids
        : [],
      selectedProductIds: Array.isArray(conv.selected_product_ids)
        ? conv.selected_product_ids
        : [],
      messages,
    };
  } catch (err) {
    reportError(err, { route: "lib/conversation-store", phase: "loadConversationForSummary" });
    return null;
  }
}

/**
 * Resolve the conversation id for a session, or null when there's no DB, no
 * session, or no conversation yet. Read-only and best-effort (a failure logs
 * and returns null) — used to attribute out-of-band usage like /api/tts to the
 * consultation it belongs to without ever breaking the request.
 */
export async function getConversationIdBySession(
  sessionId: string | null
): Promise<number | null> {
  const sql = getSql();
  if (!sql) return null;
  const sid = sessionId?.trim();
  if (!sid) return null;
  try {
    // A session may host multiple threads (migration 0018) — attribute usage to
    // the most recently active one (the thread the out-of-band call belongs to).
    const rows = await sql`
      SELECT id FROM conversations
       WHERE session_id = ${sid}
       ORDER BY last_activity_at DESC, id DESC
       LIMIT 1
    `;
    const id = (rows[0] as { id?: number } | undefined)?.id;
    return typeof id === "number" ? id : null;
  } catch (err) {
    reportError(err, {
      route: "lib/conversation-store",
      phase: "getConversationIdBySession",
    });
    return null;
  }
}

/**
 * Upsert the conversation row (by session_id) and insert the new messages.
 * Returns true if persisted, false if skipped (no DB / no session) or failed.
 */
export async function persistTurn(input: PersistTurnInput): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;

  const sessionId = input.sessionId?.trim();
  if (!sessionId) return false;
  // The thread key identifies WHICH conversation under this session. Default to
  // the session id (legacy one-thread-per-session) when the client sends none.
  const conversationKey = input.conversationKey?.trim() || sessionId;

  try {
    // Accumulate product ids referenced anywhere in this conversation's tool
    // calls (history + the new assistant turn). The upsert below de-dupes
    // against whatever is already stored, so re-sending history is harmless.
    const productIds = new Set<string>();
    for (const msg of input.history) {
      for (const inv of toolInvocationsOfMessage(msg)) {
        for (const id of productIdsFromInvocation(inv)) productIds.add(id);
      }
    }
    for (const inv of input.assistantToolCalls) {
      for (const id of productIdsFromInvocation(inv)) productIds.add(id);
    }
    const newProductIds = [...productIds];

    // The user's current SELECTION (latest add_to_cart across the full
    // conversation), or null when no buy signal has fired. Recomputed from
    // scratch each turn — the widget re-sends the whole history — so the
    // stored value always mirrors the latest selection state, including a
    // switch to an alternative (replacement, not accumulation).
    const selection = latestSelectedProductIds(input.history, input.assistantToolCalls);

    // Count includes the assistant turn we're about to write.
    const messageCount = input.history.length + 1;

    const rows = await sql`
      INSERT INTO conversations
        (session_id, conversation_key, persona_label, message_count,
         recommended_product_ids, selected_product_ids, status,
         created_at, updated_at, last_activity_at)
      VALUES
        (${sessionId}, ${conversationKey}, ${input.personaLabel}, ${messageCount},
         ${newProductIds}::text[], ${selection ?? []}::text[],
         'active', now(), now(), now())
      ON CONFLICT (conversation_key) DO UPDATE SET
        persona_label = EXCLUDED.persona_label,
        message_count = EXCLUDED.message_count,
        recommended_product_ids = (
          SELECT ARRAY(
            SELECT DISTINCT e
            FROM unnest(
              conversations.recommended_product_ids || EXCLUDED.recommended_product_ids
            ) AS e
          )
        ),
        -- Selection is REPLACED with the latest state (so a switch drops the
        -- rejected product) — but only when this turn's history actually shows
        -- a selection. With no add_to_cart in sight we keep the stored value,
        -- defensive against a client that ever sends a trimmed history.
        selected_product_ids = CASE
          WHEN ${selection !== null} THEN EXCLUDED.selected_product_ids
          ELSE conversations.selected_product_ids
        END,
        -- 'converted' is sticky; otherwise an active turn keeps it active.
        status = CASE WHEN conversations.status = 'converted'
                      THEN 'converted' ELSE 'active' END,
        updated_at = now(),
        last_activity_at = now()
      RETURNING id
    `;

    const conversationId = rows[0]?.id;
    if (conversationId == null) return false;

    // Insert only the NEW messages: the latest user turn (idempotent across
    // re-sends via client_message_id) and the assistant turn produced now.
    // Assistant messages are persisted ONLY here (never re-derived from
    // history), so there is no cross-turn duplication.
    const queries = [];

    const user = latestUserMessage(input.history);
    if (user) {
      const text = textOfMessage(user);
      if (text) {
        queries.push(sql`
          INSERT INTO messages (conversation_id, client_message_id, role, content, tool_name)
          VALUES (${conversationId}, ${user.id ?? null}, 'user', ${truncate(text)}, NULL)
          ON CONFLICT DO NOTHING
        `);
      }
    }

    if (input.assistantText.trim()) {
      queries.push(sql`
        INSERT INTO messages (conversation_id, client_message_id, role, content, tool_name)
        VALUES (${conversationId}, ${input.assistantMessageId}, 'assistant',
                ${truncate(input.assistantText.trim())}, NULL)
        ON CONFLICT DO NOTHING
      `);
    }

    input.assistantToolCalls.forEach((inv, i) => {
      let body = "";
      try {
        body = JSON.stringify(inv.input ?? {});
      } catch {
        body = "";
      }
      queries.push(sql`
        INSERT INTO messages (conversation_id, client_message_id, role, content, tool_name)
        VALUES (${conversationId}, ${`${input.assistantMessageId}:${i}`}, 'assistant',
                ${truncate(body)}, ${inv.toolName})
        ON CONFLICT DO NOTHING
      `);
    });

    if (queries.length > 0) {
      await sql.transaction(queries);
    }

    // Record this turn's token usage against the conversation (cost-per-
    // consultation KPI). Best-effort and self-contained — never throws.
    if (input.usage) {
      await recordAiUsage(
        {
          callSite: "chat",
          model: input.usage.model,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          conversationId,
        },
        sql
      );
    }

    return true;
  } catch (err) {
    // A persistence failure must never surface to the user.
    reportError(err, { route: "lib/conversation-store", phase: "persistTurn" });
    return false;
  }
}
