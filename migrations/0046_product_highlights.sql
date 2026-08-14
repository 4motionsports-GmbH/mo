-- 0046_product_highlights.sql — per-product personalised descriptions on the
-- AI-drafted marketing + campaign emails.
--
-- The redesigned product presentation (email-products.renderEmailProductRows)
-- shows each recommended product as a row: image/name/price in the first third,
-- a PERSONALISED description in the remaining two thirds. That description is
-- written by the draft model from the customer knowledge (conversations,
-- profile, purchase history) and must be reviewable/stable between preview and
-- send — so it is persisted on the draft row, not regenerated at render time.
--
-- Shape: JSONB array of { "name": string, "description": string }, keyed by
-- product name (the render path matches case-insensitively and falls back to
-- the catalog shortDescription when no entry matches). NULL = legacy draft /
-- templated fallback draft — render falls back to catalog copy.

ALTER TABLE marketing_sends
  ADD COLUMN IF NOT EXISTS product_highlights JSONB;

ALTER TABLE campaign_drafts
  ADD COLUMN IF NOT EXISTS product_highlights JSONB;
