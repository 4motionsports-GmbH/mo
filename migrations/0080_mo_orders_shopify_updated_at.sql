-- 0080 — mo_orders: Shopify's updated_at of the last delivery applied.
--
-- orders/updated + orders/cancelled now refresh the money of an order already
-- in the attribution ledger (refunds, cancellations after payment —
-- docs/ORDER_ATTRIBUTION.md). Shopify does not guarantee the delivery order,
-- so a delivery older than the stored one is skipped (mergeOrderFinancials,
-- and the UPDATE's own WHERE for concurrent deliveries).
--
-- Nullable, no backfill: existing rows get it with their next delivery. Until
-- this migration runs, the code writes without the column and falls back to the
-- status ladder (isUndefinedColumnError), so the deploy order does not matter.

ALTER TABLE mo_orders ADD COLUMN IF NOT EXISTS shopify_updated_at TIMESTAMPTZ;
