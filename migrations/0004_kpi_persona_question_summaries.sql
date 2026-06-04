-- 0004_kpi_persona_question_summaries.sql — cache for the on-demand "top
-- questions per persona" KPI (Cluster A — analytics, legitimate interest).
--
-- The "top questions" insight runs an Anthropic API pass over a sample of recent
-- user messages in a persona group and returns the common themes in German. That
-- costs tokens, so the result is cached here and only re-generated when the
-- operator explicitly asks (a "regenerate" button) — never on a normal page load.
--
-- Pseudonymous: the cached SUMMARY is derived analytics text, keyed by the
-- persona label (no session_id, no email). The underlying user messages live in
-- the messages table and are subject to the usual retention windows.

CREATE TABLE IF NOT EXISTS kpi_persona_question_summaries (
  -- COALESCE(persona_label, 'unknown') — one cached summary per persona group.
  persona_label  TEXT PRIMARY KEY,
  -- Markdown bullet list of the common themes/questions, in German.
  summary_md     TEXT NOT NULL,
  -- How many user messages the summary was built from (for honesty in the UI).
  sample_size    INTEGER NOT NULL DEFAULT 0,
  -- The model id used, for auditing / cost attribution. Null = templated/no-model.
  model          TEXT,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
