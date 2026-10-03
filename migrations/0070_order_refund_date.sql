-- 0070_order_refund_date.sql — when an order was last refunded.
--
-- The Eingang rule „Unzufriedenheit“ dated a refund by the order's last change
-- in Shopify (shopify_updated_at), so an old refund on an order touched for
-- any other reason (a tag, a note, a fulfilment) looked new. The order mirror
-- now records the newest refund that moved money (REST webhook: refunds[] with
-- successful refund transactions; GraphQL import/reconcile: refunds { createdAt
-- totalRefundedSet }). Refunds cannot be undone, so the column only moves
-- forward (GREATEST on upsert).
--
-- Forward-only, idempotent. Existing rows stay NULL until Shopify sends the
-- order again; a NULL never raises the rule, so old refunds stay quiet.

ALTER TABLE customer_orders
  ADD COLUMN IF NOT EXISTS last_refund_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS customer_orders_last_refund_idx
  ON customer_orders (last_refund_at)
  WHERE last_refund_at IS NOT NULL;
