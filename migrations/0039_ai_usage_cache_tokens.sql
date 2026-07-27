-- 0039_ai_usage_cache_tokens.sql — prompt-cache token splits on ai_usage.
--
-- The chat route now sets Anthropic prompt-cache breakpoints (cache_control)
-- on its tools/system/history prefix, so a growing share of input tokens is
-- served from the provider's prompt cache (billed at 0.1× the input price) or
-- written to it (1.25×). The AI SDK reports input_tokens as the TOTAL
-- including cached tokens; without the splits the cost KPI would price cached
-- reads at the full input rate and overstate spend.
--
-- These two columns record the split per usage row. Pre-existing rows (and
-- call sites that don't cache) keep 0/0, which prices exactly as before —
-- see lib/ai-pricing.mjs (CACHE_READ_INPUT_MULTIPLIER / _WRITE_).
--
-- Both are SUBSETS of input_tokens: uncached = input_tokens
--   - cache_read_tokens - cache_write_tokens.

ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER NOT NULL DEFAULT 0;
