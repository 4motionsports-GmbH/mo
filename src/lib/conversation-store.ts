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

// Tool inputs that reference catalog product ids. Used to accumulate
// conversations.recommended_product_ids.
const PRODUCT_TOOLS = new Set([
  "show_product",
  "compare_products",
  "add_to_cart",
  "suggest_showroom",
  "show_contact_form",
]);

// Keep stored content bounded — tool inputs and messages are small, but never
// let a pathological turn write an unbounded blob.
const MAX_CONTENT_CHARS = 8000;

export interface ToolInvocation {
  toolName: string;
  input: unknown;
}

export interface PersistTurnInput {
  sessionId: string | null;
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

function latestUserMessage(history: UIMessage[]): UIMessage | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") return history[i];
  }
  return null;
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

    // Count includes the assistant turn we're about to write.
    const messageCount = input.history.length + 1;

    const rows = await sql`
      INSERT INTO conversations
        (session_id, persona_label, message_count, recommended_product_ids,
         status, created_at, updated_at, last_activity_at)
      VALUES
        (${sessionId}, ${input.personaLabel}, ${messageCount},
         ${newProductIds}::text[], 'active', now(), now(), now())
      ON CONFLICT (session_id) DO UPDATE SET
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

    return true;
  } catch (err) {
    // A persistence failure must never surface to the user.
    reportError(err, { route: "lib/conversation-store", phase: "persistTurn" });
    return false;
  }
}
