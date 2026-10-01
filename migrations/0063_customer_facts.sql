-- 0063_customer_facts.sql — deterministic facts for every customer.
--
-- One row per customer, computed by the pure lib/customer-facts-core.mjs from
-- the order ledger, the linked conversations, the marketing sends and the
-- correspondence. ZERO tokens. Recomputed for dirty customers on every run of
-- the refresh cron and for everyone nightly (the time-dependent fields —
-- lifecycle segment, churn risk — move with the calendar). The Kunden list, the
-- audiences and the Eingang read these columns through the customer_overview
-- view (0066), never by re-deriving them.
--
-- Segment / value-tier keys are the ones of campaign-segments.mjs and
-- repurchase-analysis.mjs, so analysis, campaigns and the list never disagree.

CREATE TABLE IF NOT EXISTS customer_facts (
  customer_id               BIGINT PRIMARY KEY REFERENCES customers (id) ON DELETE CASCADE,
  computed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Purchases (realised orders only, net of refunds, cancelled orders excluded)
  orders_count              INTEGER NOT NULL DEFAULT 0,
  total_spent_cents         BIGINT NOT NULL DEFAULT 0,
  first_order_at            TIMESTAMPTZ,
  last_order_at             TIMESTAMPTZ,
  aov_cents                 BIGINT,
  median_interval_days      INTEGER,
  expected_next_order_at    TIMESTAMPTZ,
  refunds_count             INTEGER NOT NULL DEFAULT 0,
  discount_order_share      REAL,
  -- Classification
  lifecycle_segment         TEXT,
  value_tier                TEXT,
  rfm_r                     SMALLINT,
  rfm_f                     SMALLINT,
  rfm_m                     SMALLINT,
  churn_risk                TEXT,
  -- Ownership
  bought_handles            TEXT[] NOT NULL DEFAULT '{}',
  bought_categories         TEXT[] NOT NULL DEFAULT '{}',
  complement_handles        TEXT[] NOT NULL DEFAULT '{}',
  -- Mo (chat)
  conversations_count       INTEGER NOT NULL DEFAULT 0,
  last_chat_at              TIMESTAMPTZ,
  discussed_handles         TEXT[] NOT NULL DEFAULT '{}',
  selected_handles          TEXT[] NOT NULL DEFAULT '{}',
  -- Marketing
  emails_sent_count         INTEGER NOT NULL DEFAULT 0,
  last_marketing_at         TIMESTAMPTZ,
  last_click_at             TIMESTAMPTZ,
  clicks_90d                INTEGER NOT NULL DEFAULT 0,
  redemptions_count         INTEGER NOT NULL DEFAULT 0,
  -- Service
  last_inbound_at           TIMESTAMPTZ,
  unanswered_inbound_count  INTEGER NOT NULL DEFAULT 0,
  -- The newest of every activity above (orders, chats, sends, mail)
  last_activity_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS customer_facts_segment_idx ON customer_facts (lifecycle_segment);
CREATE INDEX IF NOT EXISTS customer_facts_value_idx ON customer_facts (value_tier);
CREATE INDEX IF NOT EXISTS customer_facts_last_order_idx ON customer_facts (last_order_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS customer_facts_spent_idx ON customer_facts (total_spent_cents DESC);
CREATE INDEX IF NOT EXISTS customer_facts_activity_idx ON customer_facts (last_activity_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS customer_facts_bought_idx ON customer_facts USING GIN (bought_handles);
