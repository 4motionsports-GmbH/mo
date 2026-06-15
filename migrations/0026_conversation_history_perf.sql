-- 0026_conversation_history_perf.sql — make the signed-in history list FAST and
-- cache the cheap title on the row (so it is never re-derived per render).
--
-- TWO problems this fixes in /api/account/conversations (listCustomerConversations):
--
--   1) ORDERING COST. Migration 0008 already indexes conversations(customer_id)
--      (partial, WHERE customer_id IS NOT NULL) — that covers the WHERE filter,
--      but NOT the `ORDER BY last_activity_at DESC, id DESC`. A customer with a
--      long history therefore still pays a sort over all their rows on every
--      list. A COMPOSITE index on (customer_id, last_activity_at DESC, id DESC)
--      lets Postgres walk the rows already in list order — filter AND sort served
--      by one index, no sort node.
--
--   2) PER-ROW TITLE SUBQUERY. The list derived each row's title from a LATERAL
--      sub-select that fetched the conversation's FIRST user message out of
--      `messages` — an extra indexed lookup per conversation (the N+1 the perf
--      ticket flags). The title is cheap to DERIVE (no model call — it never was
--      one) but it should not cost a `messages` round-trip per row. We cache the
--      derived label on the conversation row (`title_auto`), written once when the
--      conversation is created (lib/conversation-create + persistTurn), so the
--      list reads it straight off the row: COALESCE(custom title, title_auto).
--
-- title_auto is NULL only until the first user turn is persisted; the list
-- COALESCEs custom-title → title_auto → a neutral fallback. A rename still sets
-- the separate `title` column (custom title wins). Deleting the conversation or
-- erasing the customer removes it with the row, same as `title` (migration 0016).

ALTER TABLE conversations
  -- Cached cheap label (first user message, whitespace-collapsed + length-bounded
  -- the same way lib/conversation-title.deriveConversationTitle does it). NULL =
  -- not yet written; the list falls back to the neutral "Beratung" label.
  ADD COLUMN IF NOT EXISTS title_auto TEXT;

-- The composite index that serves the history list's WHERE + ORDER BY in one
-- walk. Partial (customer_id IS NOT NULL) so it only covers signed-in/identified
-- conversations — anonymous rows (the vast majority) stay out of it.
CREATE INDEX IF NOT EXISTS conversations_customer_activity_idx
  ON conversations (customer_id, last_activity_at DESC, id DESC)
  WHERE customer_id IS NOT NULL;

-- Backfill title_auto for ALL existing conversations from their first user
-- message, so already-stored history shows real labels immediately after deploy
-- (not the fallback). We backfill EVERY row — not just currently customer-linked
-- ones — because an anonymous row can be linked LATER at sign-in / email-capture
-- (those linkers stamp customer_id but not title_auto); pre-seeding here means the
-- history list never has to fall back to the generic label for such a row. DISTINCT
-- ON picks the earliest readable user turn per conversation; the SQL collapse+
-- truncate approximates deriveConversationTitle (new rows get the exact JS-derived
-- value at write time — the only difference is a hard 80-char cut vs. a word-
-- boundary ellipsis, cosmetic and confined to long pre-deploy titles).
UPDATE conversations co
   SET title_auto = sub.t
  FROM (
    SELECT DISTINCT ON (m.conversation_id)
           m.conversation_id,
           left(regexp_replace(btrim(m.content), '\s+', ' ', 'g'), 80) AS t
      FROM messages m
     WHERE m.role = 'user'
       AND m.tool_name IS NULL
       AND length(btrim(m.content)) > 0
     ORDER BY m.conversation_id, m.created_at ASC, m.id ASC
  ) sub
 WHERE co.id = sub.conversation_id
   AND (co.title_auto IS NULL OR btrim(co.title_auto) = '');
