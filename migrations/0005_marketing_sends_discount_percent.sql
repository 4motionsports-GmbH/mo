-- 0005_marketing_sends_discount_percent.sql — record the admin-selected discount
-- depth on each marketing send, so analytics can later see which discount depths
-- were offered and the row is a complete record of the offer.
--
-- The discount workflow changed: the admin now picks a discount depth BEFORE the
-- draft is written (None = 0, or 5/10/15%), the body is written AROUND that depth
-- with a clearly-marked PLACEHOLDER code, and the REAL unique single-use Shopify
-- code is minted only at APPROVE & SEND time (so discarded drafts never waste a
-- code). discount_percent captures the chosen depth; discount_code (existing) is
-- filled with the real minted code at send time.
--
--   discount_percent — selected discount depth as a whole-number percent.
--                      0 = "None" (no offer; body must not mention a discount and
--                      the cart link carries no ?discount= param). 5 / 10 / 15 are
--                      the offered depths. Defaults to 0 so an offer is always a
--                      deliberate, explicit admin choice.

ALTER TABLE marketing_sends
  ADD COLUMN IF NOT EXISTS discount_percent SMALLINT NOT NULL DEFAULT 0;
