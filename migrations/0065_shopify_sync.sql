-- 0065_shopify_sync.sql — the sync layer between Mo and Shopify.
--
-- Four small tables behind lib/shopify-sync.ts, lib/shopify-webhook-customers.ts
-- and lib/shopify-outbox.ts (docs/CUSTOMER_PLATFORM_PLAN.md §6.2, §8):
--
--   shopify_webhook_events  dedupe of webhook deliveries by X-Shopify-Webhook-Id
--                           (Shopify retries; a duplicate is acked, not re-applied).
--                           No payload is stored — topic + outcome only.
--   shopify_sync_runs       the resumable bulk import and the nightly
--                           reconciliation: bulk-operation id, result URL, the
--                           byte offset reached, counts, errors.
--   shopify_outbox          every write Mo makes to Shopify customers (consent,
--                           customer create, data-erasure request, write-back),
--                           retried with backoff until done or dead. The only
--                           retry layer for Shopify mutations.
--   erasure_tombstones      Shopify ids of persons erased in Mo, so no import,
--                           reconciliation or webhook re-creates them before
--                           Shopify has redacted the record. Kept until Shopify
--                           confirms (customers/redact) + 30 days.

CREATE TABLE IF NOT EXISTS shopify_webhook_events (
  webhook_id    TEXT PRIMARY KEY,
  topic         TEXT NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  outcome       TEXT,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS shopify_webhook_events_received_idx
  ON shopify_webhook_events (received_at);
CREATE INDEX IF NOT EXISTS shopify_webhook_events_topic_idx
  ON shopify_webhook_events (topic, received_at DESC);

CREATE TABLE IF NOT EXISTS shopify_sync_runs (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- import_customers | import_orders | reconcile
  kind                TEXT NOT NULL,
  -- running | processing | done | failed | cancelled
  status              TEXT NOT NULL DEFAULT 'running',
  bulk_operation_id   TEXT,
  result_url          TEXT,
  byte_offset         BIGINT NOT NULL DEFAULT 0,
  lines_processed     INTEGER NOT NULL DEFAULT 0,
  customers_upserted  INTEGER NOT NULL DEFAULT 0,
  orders_upserted     INTEGER NOT NULL DEFAULT 0,
  skipped             INTEGER NOT NULL DEFAULT 0,
  -- reconcile: the updated_at floor this run covered
  since               TIMESTAMPTZ,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  error               TEXT
);

CREATE INDEX IF NOT EXISTS shopify_sync_runs_kind_idx
  ON shopify_sync_runs (kind, started_at DESC);

CREATE TABLE IF NOT EXISTS shopify_outbox (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- consent_update | customer_create | data_erasure | writeback
  kind                 TEXT NOT NULL,
  customer_id          BIGINT REFERENCES customers (id) ON DELETE SET NULL,
  shopify_customer_id  TEXT,
  -- The target state (idempotent). customer_create carries the e-mail; it is
  -- blanked when the row completes. Never anything else personal.
  payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- pending | done | failed | dead | skipped
  status               TEXT NOT NULL DEFAULT 'pending',
  attempts             INTEGER NOT NULL DEFAULT 0,
  next_attempt_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS shopify_outbox_due_idx
  ON shopify_outbox (next_attempt_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS shopify_outbox_status_idx
  ON shopify_outbox (status, created_at DESC);

CREATE TABLE IF NOT EXISTS erasure_tombstones (
  shopify_customer_id   TEXT PRIMARY KEY,
  erased_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set when Shopify's customers/redact (or customers/delete) arrived.
  shopify_confirmed_at  TIMESTAMPTZ
);
