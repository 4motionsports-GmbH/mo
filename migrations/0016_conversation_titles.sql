-- 0016_conversation_titles.sql — TIER 3: signed-in conversation history.
--
-- The signed-in (tier-3) customer can browse, rename and delete their own past
-- conversations across devices (CA goal: "my chat history"). Each conversation
-- needs a human-readable TITLE for the list. We deliberately do NOT call a model
-- per list render: the title is either
--   * a custom title the customer set (RENAME), stored in this column, or
--   * a CHEAP derived label — the first user message trimmed, computed in
--     lib/conversation-title.mjs at render time (never persisted unless renamed).
--
-- This column is therefore NULL for every conversation until the customer
-- renames it; the list endpoint COALESCEs NULL → the derived label.
--
-- GDPR: this adds no PII. The title, when derived, is a slice of a message the
-- customer themselves typed (Cluster A free-text, already bounded by the
-- conversation retention window). When set explicitly it is the customer's own
-- label. Deleting the conversation removes the title with it (it lives on the
-- conversations row); erasing the customer purges the conversation entirely.

ALTER TABLE conversations
  -- Customer-set conversation title (tier-3 history rename). NULL = use the
  -- cheap derived label (first user message trimmed) at render time.
  ADD COLUMN IF NOT EXISTS title TEXT;
