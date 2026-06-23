-- 0031_conversation_analysis.sql — admin "Gespräche" (conversation inspector):
-- cache the on-demand AI analysis of a single conversation, and the aggregate
-- insights rollup over a date range. (Cluster A — analytics, legitimate
-- interest.)
--
-- Two caches, mirroring two existing patterns:
--
--   1) PER-CONVERSATION analysis — columns ON the conversations row, exactly like
--      the customer "current understanding" profile lives on `customers`
--      (migration 0008: profile_summary + profile_summary_updated_at). One Haiku
--      pass over the readable transcript produces a short summary + a category +
--      tags + a quality signal; the result is cached here and shown for FREE on
--      re-open. Regenerated only on an explicit "Analysieren" click — NEVER on
--      list load. Because the cache lives on the conversation row, it is dropped
--      automatically when the conversation is deleted (retention) or erased
--      (single-chat / account erasure) — the same lifecycle as title/title_auto
--      (migrations 0016/0026). No extra FK or trigger needed.
--
--      The token counts are cached alongside the model id so re-opening can show
--      the approximate EUR cost for FREE (priced in JS via lib/ai-pricing.mjs),
--      without another model call — the same "show what it cost" affordance the
--      customer-profile regeneration has.
--
--   2) AGGREGATE insights rollup — a sibling cache table keyed by date range,
--      mirroring kpi_persona_question_summaries (migration 0004): one cached
--      markdown report per [from, to] window, regenerated on demand. The rollup
--      is produced by summarising the already-cached per-conversation summaries
--      + categories (NOT the raw transcripts), so it is cheap and scales. It is
--      derived, pseudonymous analytics text (no session_id, no email) — like the
--      top-questions cache it carries no conversation FK and is regenerated on
--      demand.
--
-- Model: Haiku-class (claude-haiku-4-5) — back-office categorisation + a short
-- summary do not need the top consultation model. AI usage is recorded in
-- ai_usage (migration 0012) under new call sites 'conversation_analysis' /
-- 'conversation_insights' so this spend shows up in the cost KPI like every
-- other backend LLM call.

-- 1) Per-conversation analysis cache (columns on the conversation row).
ALTER TABLE conversations
  -- Short smart summary (2–3 sentences, German). NULL = not yet analysed.
  ADD COLUMN IF NOT EXISTS analysis_summary       TEXT,
  -- Single primary category, e.g. 'product-advice', 'refund/return', 'sizing',
  -- 'price/discount', 'technical-question', 'complaint', 'off-topic'.
  ADD COLUMN IF NOT EXISTS analysis_category      TEXT,
  -- Free-form topical tags (a handful).
  ADD COLUMN IF NOT EXISTS analysis_tags          TEXT[] NOT NULL DEFAULT '{}',
  -- Quality signal label, e.g. 'handled_well', 'satisfied', 'unmet_need',
  -- 'dropped_off', 'unclear'. The reasoning is folded into analysis_summary.
  ADD COLUMN IF NOT EXISTS analysis_quality       TEXT,
  -- The model id used (for audit + cost attribution). NULL until analysed.
  ADD COLUMN IF NOT EXISTS analysis_model         TEXT,
  -- Cached token counts so the per-conversation cost can be shown for FREE on
  -- re-open (priced in JS), without another model call.
  ADD COLUMN IF NOT EXISTS analysis_input_tokens  INTEGER,
  ADD COLUMN IF NOT EXISTS analysis_output_tokens INTEGER,
  -- When the cached analysis was produced. NULL = never analysed; the list shows
  -- "nicht analysiert" and the cost is zero.
  ADD COLUMN IF NOT EXISTS analysis_updated_at    TIMESTAMPTZ;

-- Lets the list / insights rollup cheaply find analysed-vs-not and group by
-- category over a date range without scanning every row's text. Partial: only
-- analysed rows are indexed (the vast majority are never analysed).
CREATE INDEX IF NOT EXISTS conversations_analysis_idx
  ON conversations (analysis_updated_at)
  WHERE analysis_updated_at IS NOT NULL;

-- 2) Aggregate insights rollup cache (keyed by date range), mirroring
--    kpi_persona_question_summaries (migration 0004).
CREATE TABLE IF NOT EXISTS conversation_insights (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The inclusive date window the rollup covers (matches the list date filter).
  date_from       DATE NOT NULL,
  date_to         DATE NOT NULL,
  -- Markdown narrative: top themes/questions, where consultations stall/fail,
  -- common unmet needs, and concrete "consider refining X" suggestions FOR A
  -- HUMAN. The category distribution is recomputed for free from the cached
  -- per-conversation categories at render time, so it is not stored here.
  summary_md      TEXT NOT NULL,
  -- How many analysed conversations fed the rollup (honesty in the UI).
  analyzed_count  INTEGER NOT NULL DEFAULT 0,
  -- Model id used, for audit / cost attribution. NULL = templated/no-model.
  model           TEXT,
  -- Token counts so the rollup cost can be shown (priced in JS).
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One cached rollup per [from, to] window; regenerate = upsert on this key.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_insights_range_idx
  ON conversation_insights (date_from, date_to);

-- 3) Supporting indexes for the inspector's session-keyed outcome probes.
--    The list/detail derive two session-grained signals — "email captured" and
--    "cart link used" — by probing email_captures / kpi_events by session_id.
--    Neither table had a session_id index (they were keyed by email / event /
--    created_at). These keep the inspector's per-page batched probes
--    (session_id = ANY(...)) index-served and cheap, honouring the "cheap
--    indexed DB queries, zero tokens" requirement for the list.
CREATE INDEX IF NOT EXISTS email_captures_session_idx
  ON email_captures (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS kpi_events_session_idx
  ON kpi_events (session_id)
  WHERE session_id IS NOT NULL;
