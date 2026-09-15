-- 0058_campaign_discount_scope.sql — what a campaign discount code applies to.
--
-- Until now every minted MK- code applied to the whole order
-- (customerGets.items: { all: true }). The desk can now scope it:
--   all              — the whole order (the previous behaviour, the default)
--   recommendations  — only the products recommended in this mail
--   set              — only the attached set (bundle_offers product)
-- The scope lives on the draft (the operator's choice, regenerates keep it),
-- is stamped on the send record so „Gesendet“ and the KPIs know what a code
-- was good for, and steers the coupon wording plus the prose (the AI draft is
-- told the scope). At send time the code is minted against the Shopify
-- product gids of that scope; a scope that cannot be resolved (no
-- recommendations, no active set) refuses the send instead of silently
-- minting a wider code.

ALTER TABLE campaign_drafts
  ADD COLUMN IF NOT EXISTS discount_scope TEXT NOT NULL DEFAULT 'all'
    CHECK (discount_scope IN ('all', 'recommendations', 'set'));

ALTER TABLE campaign_sends
  ADD COLUMN IF NOT EXISTS discount_scope TEXT
    CHECK (discount_scope IS NULL OR discount_scope IN ('all', 'recommendations', 'set'));
