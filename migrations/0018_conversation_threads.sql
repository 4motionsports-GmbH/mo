-- 0018_conversation_threads.sql — multiple conversation THREADS per session.
--
-- Until now `conversations.session_id` was UNIQUE: one row per browser thread,
-- so a signed-in customer who keeps a STABLE session_id (the identity link — it
-- must not rotate while signed in) could only ever have ONE conversation row,
-- which "Neue Beratung" would grow forever instead of starting a fresh thread.
--
-- We decouple the THREAD identity from the SESSION identity:
--   * session_id stays the device/identity link (the consent-anchored bridge
--     the email-capture + sign-in match-up attach by). NO LONGER unique.
--   * conversation_key is the per-THREAD key (a stable, client-generated value
--     the widget sends on /api/chat). It is the new uniqueness key.
--
-- BACKWARD-COMPATIBLE: existing rows (and any client that sends no
-- conversation_key) default conversation_key = session_id, which preserves the
-- exact one-row-per-session behaviour. A widget that sends a fresh key per
-- "Neue Beratung" gets a new thread; resuming a past thread sends its key again.
-- conversation_key carries the SAME trust/entropy expectation as session_id
-- (an unguessable client value); the upsert never rewrites a row's session_id.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS conversation_key TEXT;

-- Backfill: each existing single-thread session becomes a thread keyed by its
-- session_id (identical addressing to before).
UPDATE conversations SET conversation_key = session_id WHERE conversation_key IS NULL;

ALTER TABLE conversations ALTER COLUMN conversation_key SET NOT NULL;

-- Uniqueness moves from session_id → conversation_key.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_session_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_conversation_key_key
  ON conversations (conversation_key);

-- session_id is still looked up (match-up attach, summary email, tts usage) —
-- keep it fast now that it is no longer the unique key.
CREATE INDEX IF NOT EXISTS conversations_session_idx
  ON conversations (session_id);
