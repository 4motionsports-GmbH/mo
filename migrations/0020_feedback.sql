-- 0020_feedback.sql — customer feedback capture.
--
-- A new, standalone table for free-text customer feedback submitted from the
-- storefront widget via POST /api/feedback (behind the same widget guard as the
-- other public endpoints: origin allowlist + x-ms-chat-key + rate limit).
--
-- The feedback text is the only required field. Everything else is OPTIONAL
-- CONTEXT the widget attaches when it has it, so the admin can read a comment in
-- situ without joining across the GDPR clusters:
--
--   * session_id / conversation_id — pseudonymous (Cluster A) keys, so a comment
--     can be tied back to the session/thread it came from. Free-form text; no FK
--     (feedback must survive even if the conversation is retention-purged, and a
--     write here must never fail because a conversation row is missing).
--   * tier   — the customer tier the widget knows (e.g. "anonymous", a signed-in
--     tier label). Telemetry-grade, not authoritative.
--   * email  — present ONLY when the widget already has an identified address
--     (e.g. a signed-in / already-captured customer). User-supplied contact
--     context for THIS comment, mirroring /api/contact (which likewise carries a
--     user-supplied email) — NOT a consent record. The audit-grade consent trail
--     stays exclusively in email_captures; nothing here grants any marketing or
--     other permission.
--   * page   — the storefront URL/path the widget was on when the comment was
--     left, for triage.
--
-- Light abuse protection lives in the route (dedicated rate-limit bucket) and in
-- the length caps the validation layer enforces before insert; the column types
-- below are generous TEXT so a valid-but-long comment is never silently cut.

CREATE TABLE IF NOT EXISTS feedback (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message          TEXT NOT NULL,
  session_id       TEXT,
  conversation_id  TEXT,
  tier             TEXT,
  email            TEXT,
  page             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The admin tab lists feedback newest-first; index the sort key.
CREATE INDEX IF NOT EXISTS feedback_created_at_idx
  ON feedback (created_at DESC);
