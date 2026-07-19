-- Verlinkte Gespräche im aggregierten Insights-Report: the rollup now carries
-- per-section conversation references (which chats back which finding), stored
-- as validated JSON alongside the cached narrative. Nullable — old cached
-- rollups simply have no references and render unchanged.
ALTER TABLE conversation_insights
  ADD COLUMN IF NOT EXISTS references_json jsonb;
