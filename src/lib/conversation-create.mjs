// Eager conversation creation — the durability half of the lost-conversation fix.
//
// THE BUG (docs/CUSTOMER_ACCOUNT.md §7.6 / data-integrity): a signed-in customer
// clicked "Neue Beratung", which mints a fresh conversationKey. The conversation
// row was only ever written LAZILY in persistTurn, which runs in /api/chat's
// onFinish — AFTER the model stream completes — and the INSERT never set
// customer_id. So a thread that was started but whose answer hadn't landed (reload
// / switch first) was never persisted at all, and even a completed one was
// created with customer_id = NULL and so never appeared in the customer's history
// list (listCustomerConversations filters WHERE customer_id = $self). The thread
// was "lost".
//
// THE FIX: create the row EAGERLY, at the START of the chat turn (before the
// stream), and CUSTOMER-LINK it at creation by resolving the session's direct
// customer link (migration 0019). Then a started conversation persists + lists
// immediately and survives reload — exactly like ChatGPT/Claude — regardless of
// whether the assistant has answered yet. persistTurn (onFinish) then fills in the
// assistant turn + product sets + usage on the SAME row (upsert by
// conversation_key).
//
// Kept in plain .mjs with an INJECTED sql (no module-level I/O) so the "a new
// signed-in conversation is created + customer-linked at creation" contract is
// unit-testable with a fake sql, matching the customer-session-link.mjs /
// conversation-title.mjs convention. Best-effort by construction: a failure here
// must NEVER break the chat response (the caller swallows it), and with no DB it
// is a silent no-op.

import { resolveLinkedCustomerId } from "./customer-session-link.mjs";
import { deriveConversationTitle } from "./conversation-title.mjs";

const MAX_CONTENT_CHARS = 8000;

function truncate(s) {
  const str = String(s ?? "");
  return str.length > MAX_CONTENT_CHARS ? str.slice(0, MAX_CONTENT_CHARS) : str;
}

/**
 * Ensure a conversation row exists for (sessionId, conversationKey), created
 * up-front and stamped with the session's linked customer_id so it lists straight
 * away. Idempotent (upsert by conversation_key); never rewrites session_id and
 * never NULLs an existing customer link. Also persists the first user message
 * when one is supplied with a stable client id, so a started-but-unanswered thread
 * keeps the customer's text (deduped against persistTurn's later write via the
 * messages idempotency index).
 *
 * @param {*} sql tagged-template sql client (or null)
 * @param {{
 *   sessionId: string|null,
 *   conversationKey?: string|null,
 *   personaLabel?: string|null,
 *   messageCount?: number,
 *   userText?: string|null,
 *   userMessageId?: string|null,
 * }} input  userText/userMessageId are THIS turn's latest user message — they
 *   seed the cached title on first creation (COALESCE, so only the first sticks)
 *   and persist the message eagerly so it survives an unanswered reload.
 * @returns {Promise<{ conversationId: number, customerId: number|null }|null>}
 */
export async function ensureConversationStarted(sql, input) {
  if (!sql) return null;
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  if (!sessionId) return null;
  // The thread key identifies WHICH conversation under this session. Default to
  // the session id (legacy one-thread-per-session) when the client sends none.
  const conversationKey =
    (typeof input.conversationKey === "string" && input.conversationKey.trim()) || sessionId;

  try {
    // Resolve the session → customer link (migration 0019). A signed-in (or
    // email-identified) session resolves to its customer; an anonymous one to
    // null, leaving the row pseudonymous exactly as before.
    const customerId = await resolveLinkedCustomerId(sql, sessionId);

    // The cached cheap title (migration 0026): derived once, from the first user
    // message, so the list never re-fetches it per render.
    const titleAuto = input.userText ? deriveConversationTitle(input.userText) : null;
    const personaLabel = input.personaLabel ?? null;
    const messageCount = Number.isFinite(input.messageCount) ? input.messageCount : 0;

    const rows = await sql`
      INSERT INTO conversations
        (session_id, conversation_key, customer_id, persona_label, message_count,
         title_auto, status, created_at, updated_at, last_activity_at)
      VALUES
        (${sessionId}, ${conversationKey}, ${customerId}, ${personaLabel}, ${messageCount},
         ${titleAuto}, 'active', now(), now(), now())
      ON CONFLICT (conversation_key) DO UPDATE SET
        -- Link to the customer at the first opportunity; never NULL an existing
        -- link (a thread that signs in mid-way gets stamped on the next turn).
        customer_id = COALESCE(conversations.customer_id, EXCLUDED.customer_id),
        -- Fill the cached title once; a later turn never clobbers it (and a
        -- customer RENAME lives on the separate title column).
        title_auto = COALESCE(conversations.title_auto, EXCLUDED.title_auto),
        last_activity_at = now()
      RETURNING id
    `;
    const conversationId = rows && rows[0] && rows[0].id != null ? Number(rows[0].id) : null;
    if (conversationId == null) return null;

    // Persist the first user message up-front so a started-but-unanswered thread
    // keeps the customer's words. Only when it carries a stable client id, so
    // persistTurn's later write of the same message dedups (the idempotency index
    // is partial WHERE client_message_id IS NOT NULL) — no duplicate row.
    const userId = typeof input.userMessageId === "string" ? input.userMessageId : null;
    const userText = typeof input.userText === "string" ? input.userText.trim() : "";
    if (userId && userText) {
      await sql`
        INSERT INTO messages (conversation_id, client_message_id, role, content, tool_name)
        VALUES (${conversationId}, ${userId}, 'user', ${truncate(userText)}, NULL)
        ON CONFLICT DO NOTHING
      `;
    }

    return { conversationId, customerId };
  } catch {
    // Best-effort: a failed eager-create must never break the chat turn. The
    // lazy persistTurn (onFinish) is the backstop — it stamps customer_id too.
    return null;
  }
}
