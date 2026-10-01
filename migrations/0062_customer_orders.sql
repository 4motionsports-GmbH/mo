-- 0062_customer_orders.sql — the local order ledger.
--
-- Every Shopify order of every mirrored customer, minimised: ids, dates,
-- statuses, money, discount codes and the line items (handle / variant /
-- title / quantity / unit price). NO addresses, payment data, notes or contact
-- fields. Filled by the bulk import, the orders/* webhooks and the nightly
-- reconciliation (lib/shopify-sync.ts). Replaces the per-e-mail Shopify read
-- cached on customers.purchase_summary (kept as a fallback until the import ran).
--
-- Retention: the rows live as long as the customer row (ON DELETE CASCADE),
-- so an erasure removes them with the person. Pseudonymous attribution facts
-- for revenue KPIs stay separately in mo_orders (0042).
--
--   line_items  [{ title, variantTitle, quantity, unitPrice, handle, ref,
--                  productId, variantId }]  (unitPrice: decimal, shop currency)

CREATE TABLE IF NOT EXISTS customer_orders (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shopify_order_id     TEXT NOT NULL UNIQUE,
  customer_id          BIGINT REFERENCES customers (id) ON DELETE CASCADE,
  shopify_customer_id  TEXT,
  order_name           TEXT,
  processed_at         TIMESTAMPTZ NOT NULL,
  financial_status     TEXT,
  fulfillment_status   TEXT,
  cancelled_at         TIMESTAMPTZ,
  currency             TEXT,
  subtotal_cents       BIGINT,
  total_cents          BIGINT NOT NULL DEFAULT 0,
  refunded_cents       BIGINT NOT NULL DEFAULT 0,
  discount_codes       TEXT[] NOT NULL DEFAULT '{}',
  source_name          TEXT,
  line_items           JSONB NOT NULL DEFAULT '[]'::jsonb,
  shopify_updated_at   TIMESTAMPTZ,
  synced_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_orders_customer_idx
  ON customer_orders (customer_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS customer_orders_shopify_customer_idx
  ON customer_orders (shopify_customer_id) WHERE shopify_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_orders_processed_idx
  ON customer_orders (processed_at);
CREATE INDEX IF NOT EXISTS customer_orders_codes_idx
  ON customer_orders USING GIN (discount_codes);
