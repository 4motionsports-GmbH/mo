-- 0008_customers.sql — introduce a CUSTOMER entity above sessions.
--
-- Identity model (deliberately narrow): the ONLY reliable cross-session
-- identifier is the EMAIL, given with consent via /api/capture-email. The
-- localStorage session id is a per-browser THREAD id, not a person — anonymous
-- sessions are never linked across visits. A `customers` row exists only
-- because an email was captured, and a conversation gets a customer_id only
-- when an email is captured for that session.
--
-- GDPR note: customer_id on conversations is a deliberate, consent-anchored
-- bridge between Cluster A (pseudonymous analytics) and Cluster B (consented
-- email data). It is created only on an explicit email capture, and retention
-- removes it again: deleting a customer sets conversations.customer_id back to
-- NULL (ON DELETE SET NULL), returning those rows to plain pseudonymous state.
-- See docs/CUSTOMERS.md for the open consent-copy TODO (profile building).

CREATE TABLE IF NOT EXISTS customers (
  id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Normalised (trimmed + lower-cased by the app) — the person key.
  email                       TEXT NOT NULL UNIQUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- First/last time we saw this person identify themselves (email capture).
  first_seen_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Aggregated consent state, mirrored from email_captures (which stays the
  -- audit-grade source of truth — consent_text_shown, DOI tokens etc. live
  -- there). Kept here so customer-level reads don't re-derive it.
  transactional_consent       BOOLEAN NOT NULL DEFAULT false,
  marketing_status            TEXT NOT NULL DEFAULT 'none'
                                CHECK (marketing_status IN ('none', 'pending', 'confirmed', 'unsubscribed')),
  -- Regenerated "current understanding" profile (an Anthropic pass over the
  -- customer's linked conversations + purchase history). Cached with its
  -- timestamp; regenerated on demand from the admin dashboard — never merged
  -- mechanically from per-session profiles.
  profile_summary             TEXT,
  profile_summary_updated_at  TIMESTAMPTZ,
  -- Cached Shopify order-history summary (jsonb, see lib/shopify-orders.ts
  -- OrderHistory). Refreshed on demand from the dashboard.
  purchase_summary            JSONB,
  purchase_summary_updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS customers_last_seen_idx
  ON customers (last_seen_at);

-- A consent record belongs to exactly one customer (same email key). SET NULL
-- so deleting a customer (GDPR erasure / retention) never drops the consent
-- audit row by accident — capture purging has its own retention rules.
ALTER TABLE email_captures
  ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers (id) ON DELETE SET NULL;

-- A conversation is attached to a customer ONLY when an email was captured for
-- its session. NULL = anonymous (the default, and the state every conversation
-- returns to if the customer row is deleted).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conversations_customer_idx
  ON conversations (customer_id)
  WHERE customer_id IS NOT NULL;

-- ============================================================================
-- Backfill — existing rows must keep working.
-- ============================================================================

-- One customer per existing capture email. first/last_seen are approximated by
-- the capture's created_at (the best signal we stored); consent state mirrors
-- the capture, with an explicit unsubscribe overriding the DOI status.
INSERT INTO customers (email, created_at, first_seen_at, last_seen_at,
                       transactional_consent, marketing_status)
SELECT ec.email,
       ec.created_at,
       ec.created_at,
       ec.created_at,
       ec.transactional_consent,
       CASE
         WHEN ec.unsubscribed_at IS NOT NULL THEN 'unsubscribed'
         WHEN ec.marketing_doi_status IN ('pending', 'confirmed') THEN ec.marketing_doi_status
         ELSE 'none'
       END
  FROM email_captures ec
ON CONFLICT (email) DO NOTHING;

-- Link each capture to its customer.
UPDATE email_captures ec
   SET customer_id = c.id
  FROM customers c
 WHERE c.email = ec.email
   AND ec.customer_id IS NULL;

-- Link conversations whose session captured an email — via the capture's
-- stored session_id, the same pseudonymous bridge the summary email uses.
-- Sessions without a capture stay anonymous (customer_id NULL), exactly as
-- before.
UPDATE conversations co
   SET customer_id = ec.customer_id
  FROM email_captures ec
 WHERE ec.session_id = co.session_id
   AND ec.customer_id IS NOT NULL
   AND co.customer_id IS NULL;
