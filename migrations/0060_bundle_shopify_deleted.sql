-- 0060_bundle_shopify_deleted.sql — ended sets are removed from Shopify.
--
-- Until now an expired (or manually ended) set's Shopify product was only
-- ARCHIVED, so every set ever sent stayed in the Shopify admin. From here on
-- the product is DELETED when the set ends (the expiry sweep, which now runs
-- every 15 minutes, and the manual "Set entfernen"). The bundle_offers row
-- stays — the tracked link still needs it for the "Angebot abgelaufen" page,
-- and the KPIs count it.
--
-- shopify_deleted_at records that the product is gone. The sweep's clean-up
-- pass deletes the product of every ended offer that still has one
-- (status <> 'active', shopify_product_id set, shopify_deleted_at NULL): a
-- manual end whose delete failed, and — once, after this migration — all sets
-- that were archived before.

ALTER TABLE bundle_offers
  ADD COLUMN IF NOT EXISTS shopify_deleted_at TIMESTAMPTZ;

-- Clean-up pass: ended offers whose Shopify product still exists.
CREATE INDEX IF NOT EXISTS bundle_offers_shopify_leftover_idx
  ON bundle_offers (id)
  WHERE status <> 'active' AND shopify_product_id IS NOT NULL AND shopify_deleted_at IS NULL;
