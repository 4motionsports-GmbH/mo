import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureConversationStarted } from "./conversation-create.mjs";

// ---------------------------------------------------------------------------
// A tiny in-memory stand-in for the tagged-template sql client, modelling just
// the three tables the eager create touches:
//   * customer_session_links (session_id → customer_id)  — seeded per test
//   * conversations          (keyed by conversation_key) — upserted here
//   * messages                                            — the eager user turn
// so a create-then-"list" round-trip exercises the REAL contract the
// lost-conversation fix restores: "a new signed-in conversation is created AND
// customer-linked at creation, so it appears in the customer's history list."
// ---------------------------------------------------------------------------
function makeSql({ links = {} } = {}) {
  const sessionLinks = new Map(Object.entries(links).map(([k, v]) => [k, Number(v)]));
  const conversations = new Map(); // conversation_key → row
  const messages = []; // { conversation_id, client_message_id, role, content }
  let nextId = 1;

  const sql = (strings, ...values) => {
    const text = strings.join("?");

    if (text.includes("SELECT customer_id FROM customer_session_links")) {
      const sid = values[0];
      const customerId = sessionLinks.get(sid);
      return Promise.resolve(customerId != null ? [{ customer_id: customerId }] : []);
    }

    if (text.includes("INSERT INTO conversations")) {
      // VALUES order: session_id, conversation_key, customer_id, persona_label,
      // message_count, title_auto (the rest are SQL literals).
      const [sessionId, conversationKey, customerId, personaLabel, messageCount, titleAuto] =
        values;
      const existing = conversations.get(conversationKey);
      if (existing) {
        // ON CONFLICT DO UPDATE: COALESCE keeps the existing link + cached title.
        existing.customer_id = existing.customer_id ?? customerId ?? null;
        existing.title_auto = existing.title_auto ?? titleAuto ?? null;
        existing.last_activity_at = "now";
        return Promise.resolve([{ id: existing.id }]);
      }
      const row = {
        id: nextId++,
        session_id: sessionId,
        conversation_key: conversationKey,
        customer_id: customerId ?? null,
        persona_label: personaLabel ?? null,
        message_count: messageCount ?? 0,
        title_auto: titleAuto ?? null,
        status: "active",
      };
      conversations.set(conversationKey, row);
      return Promise.resolve([{ id: row.id }]);
    }

    if (text.includes("INSERT INTO messages")) {
      // VALUES order: conversation_id, client_message_id, content ('user' + NULL
      // tool_name are SQL literals).
      const [conversationId, clientMessageId, content] = values;
      // ON CONFLICT DO NOTHING on (conversation_id, client_message_id).
      const dup = messages.some(
        (m) => m.conversation_id === conversationId && m.client_message_id === clientMessageId
      );
      if (!dup) {
        messages.push({
          conversation_id: conversationId,
          client_message_id: clientMessageId,
          role: "user",
          content,
        });
      }
      return Promise.resolve([]);
    }

    throw new Error(`unexpected query: ${text}`);
  };

  // The exact filter the history list applies (WHERE customer_id = $self), so a
  // test can assert a freshly-created thread is actually listable.
  sql._listByCustomer = (customerId) =>
    [...conversations.values()].filter((c) => c.customer_id === customerId);
  sql._conversations = conversations;
  sql._messages = messages;
  return sql;
}

// ---------------------------------------------------------------------------

test("ensureConversationStarted no-ops without sql / session", async () => {
  const sql = makeSql();
  assert.equal(await ensureConversationStarted(null, { sessionId: "s", conversationKey: "k" }), null);
  assert.equal(await ensureConversationStarted(sql, { sessionId: "", conversationKey: "k" }), null);
  assert.equal(await ensureConversationStarted(sql, { sessionId: "   " }), null);
  assert.equal(sql._conversations.size, 0);
});

test("a new signed-in conversation is created + customer-linked + listed at creation", async () => {
  // The widget session is already linked to signed-in customer 42 (migration 0019).
  const sql = makeSql({ links: { "sess-1": 42 } });

  const res = await ensureConversationStarted(sql, {
    sessionId: "sess-1",
    conversationKey: "thread-A",
    personaLabel: "pragmatic_beginner",
    messageCount: 1,
    userText: "Ich brauche ein leises Laufband für die Wohnung",
    userMessageId: "u1",
  });

  assert.ok(res, "returns the created conversation");
  assert.equal(res.customerId, 42);

  // The row exists and — crucially — carries customer_id (the bug was NULL here).
  const row = sql._conversations.get("thread-A");
  assert.ok(row, "conversation row was created eagerly");
  assert.equal(row.customer_id, 42, "linked to the signed-in customer AT CREATION");
  // The cheap title is cached on the row (deriveConversationTitle of the 1st msg).
  assert.equal(row.title_auto, "Ich brauche ein leises Laufband für die Wohnung");

  // It is therefore returned by the customer-scoped history list immediately.
  const listed = sql._listByCustomer(42);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].conversation_key, "thread-A");

  // The started user message is persisted up-front (survives an unanswered reload).
  assert.equal(sql._messages.length, 1);
  assert.equal(sql._messages[0].content, "Ich brauche ein leises Laufband für die Wohnung");
});

test("an anonymous session still persists the thread (pseudonymous, customer_id NULL)", async () => {
  const sql = makeSql(); // no link
  const res = await ensureConversationStarted(sql, {
    sessionId: "anon-1",
    conversationKey: "thread-anon",
    userText: "Hallo",
    userMessageId: "u1",
  });
  assert.ok(res);
  assert.equal(res.customerId, null);
  assert.equal(sql._conversations.get("thread-anon").customer_id, null);
  // Not listed under any customer.
  assert.equal(sql._listByCustomer(42).length, 0);
});

test("idempotent: re-running keeps the link + first cached title, no duplicate message", async () => {
  const sql = makeSql({ links: { "sess-1": 42 } });
  await ensureConversationStarted(sql, {
    sessionId: "sess-1",
    conversationKey: "thread-A",
    userText: "Erste Frage",
    userMessageId: "u1",
  });
  // A later turn on the SAME thread (different text + message). The title must not
  // change, the link must stick, and the first message must not duplicate.
  await ensureConversationStarted(sql, {
    sessionId: "sess-1",
    conversationKey: "thread-A",
    userText: "Zweite Frage",
    userMessageId: "u2",
  });

  assert.equal(sql._conversations.size, 1, "no duplicate conversation row");
  const row = sql._conversations.get("thread-A");
  assert.equal(row.customer_id, 42);
  assert.equal(row.title_auto, "Erste Frage", "first cached title is kept");
  assert.equal(sql._messages.length, 2, "both distinct user messages persisted once each");
});

test("COALESCE never NULLs an existing customer link on a later turn", async () => {
  // The thread was created while signed in (linked to 42).
  const sql = makeSql({ links: { "sess-1": 42 } });
  await ensureConversationStarted(sql, {
    sessionId: "sess-1",
    conversationKey: "thread-A",
    userText: "Angemeldete Frage",
    userMessageId: "u1",
  });
  assert.equal(sql._conversations.get("thread-A").customer_id, 42);

  // Even if a later resolve came back empty (e.g. a transient link read), the
  // existing link must survive — ON CONFLICT COALESCEs the stored value first.
  sql._linkOverride = null; // not used by the fake, documents intent
  const sqlNoLink = makeSql(); // no link → EXCLUDED.customer_id is null
  sqlNoLink._conversations.set("thread-A", { ...sql._conversations.get("thread-A") });
  await ensureConversationStarted(sqlNoLink, {
    sessionId: "sess-1",
    conversationKey: "thread-A",
    userText: "Folgefrage",
    userMessageId: "u2",
  });
  assert.equal(
    sqlNoLink._conversations.get("thread-A").customer_id,
    42,
    "existing link preserved (COALESCE keeps stored value)"
  );
});
