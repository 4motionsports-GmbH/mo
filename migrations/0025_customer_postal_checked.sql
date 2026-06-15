-- 0025_customer_postal_checked.sql — throttle for background address auto-capture.
--
-- The Kunden tab auto-captures missing postal addresses from Shopify in the
-- background (lib/address-capture). To avoid re-querying Shopify every load for
-- customers who simply have no saved address, we stamp WHEN we last attempted a
-- capture (regardless of result) and only retry past a cooldown window.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS postal_address_checked_at TIMESTAMPTZ;
