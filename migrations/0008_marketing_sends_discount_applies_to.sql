-- 0008_marketing_sends_discount_applies_to.sql — record WHAT each minted
-- marketing discount code applied to.
--
-- Marketing codes can now be scoped to full-price items only: when
-- SHOPIFY_FULL_PRICE_COLLECTION_GID is configured, the code's eligible items
-- are restricted to that (automated, "Compare-at price is empty") collection,
-- so sale items in a mixed cart get no discount. Shopify cannot express
-- "exclude sale items" directly on a code discount — see docs/DISCOUNTS.md for
-- the exact real-world behavior and its product-level caveats.
--
--   discount_applies_to — the eligibility scope as ECHOED BY SHOPIFY in the
--                         create-mutation response, e.g. {"scope":"all"} or
--                         {"scope":"collection","collectionGid":"gid://shopify/Collection/…"}.
--                         Stored per send so the record shows whether a shipped
--                         code was full-price-only or store-wide, even if the
--                         configuration changes later. NULL for rows without a
--                         code or sent before this feature.

ALTER TABLE marketing_sends
  ADD COLUMN IF NOT EXISTS discount_applies_to JSONB;
