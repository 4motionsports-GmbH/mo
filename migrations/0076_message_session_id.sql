-- 0076 — ATTR-TOKEN-LIFETIME: which session wrote a product-tool marker row.
--
-- A thread resumed on another device keeps conversations.session_id
-- (persistTurn never rewrites it), so the attribution window anchor
-- (MO_ATTRIBUTION_SESSION_ANCHOR, docs/ORDER_ATTRIBUTION.md) needs the writer
-- of each product turn. Nullable, no backfill: legacy rows stay NULL and use
-- the thread-level fallback until they leave the 37-day horizon. Written only
-- on tool marker rows (messages.tool_name IS NOT NULL); text rows stay NULL.
-- Deleted with the conversation (cascade), like every message.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Empty at creation (every existing row is NULL), so it builds instantly.
CREATE INDEX IF NOT EXISTS messages_session_marker_idx
  ON messages (session_id, created_at)
  WHERE session_id IS NOT NULL AND tool_name IS NOT NULL;
