-- 0012_ai_usage.sql — per-call AI token usage, for the "cost per consultation"
-- KPI (Cluster A — analytics, legitimate interest).
--
-- Every AI call site (chat turns + the dashboard/admin LLM passes + embeddings)
-- records one row here on completion: the model id and the input/output token
-- counts the provider reported. The dashboard turns these into a EUR cost via a
-- model→price table (see lib/ai-pricing.mjs).
--
-- RETENTION (mirrors docs/DATA_RETENTION.md):
--   - CHAT rows carry conversation_id → ON DELETE CASCADE means they are deleted
--     together with their conversation when it expires (RETENTION_DAYS). Usage
--     therefore follows exactly the same retention rule as the consultation it
--     measures.
--   - DASHBOARD/ADMIN/EMBEDDING rows have no conversation (conversation_id NULL);
--     they are derived analytics and are purged by created_at on the same
--     KPI/analytics schedule by runRetention (lib/retention.ts).
--
-- Pseudonymous: no email, no session_id is stored here — only a model id, token
-- counts, and (for chat) the pseudonymous conversation FK.

CREATE TABLE IF NOT EXISTS ai_usage (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Set for chat usage so the row cascade-deletes with its conversation. NULL
  -- for dashboard/admin/embedding calls, which are purged by created_at instead.
  conversation_id BIGINT REFERENCES conversations (id) ON DELETE CASCADE,
  -- Which AI call produced this usage: 'chat', 'summary_email',
  -- 'marketing_draft', 'customer_profile', 'top_questions', 'embeddings',
  -- 'bundle_suggestions'.
  call_site       TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  -- True when the token counts are ESTIMATED (e.g. an embeddings response with
  -- no usage field) rather than reported by the provider.
  estimated       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_conversation_idx ON ai_usage (conversation_id);
CREATE INDEX IF NOT EXISTS ai_usage_created_at_idx ON ai_usage (created_at);
CREATE INDEX IF NOT EXISTS ai_usage_call_site_idx ON ai_usage (call_site);
