-- 0064_email_consent.sql — ONE e-mail-marketing consent per person.
--
-- Until now consent lived in three places: our DOI in email_captures, the
-- Shopify newsletter state in campaign_contacts.status/opt_in_level (synced
-- daily) and blocks in suppression_list; customers.marketing_status mirrored
-- only our DOI. From here on there is one consent, shared with Shopify in both
-- directions (docs/CUSTOMER_PLATFORM_PLAN.md §7):
--
--   * Shopify's emailMarketingConsent is the shared STATE. Mo's surfaces write
--     into it through the outbox (lib/shopify-outbox.ts), Shopify's surfaces
--     reach Mo through webhooks + the nightly reconciliation.
--   * customers.email_consent_* MIRROR that state; every change is appended to
--     consent_events (the "Einwilligungsverlauf").
--   * email_captures stays the Art. 7 EVIDENCE for consents given on Mo's own
--     surfaces (verbatim text, version stamp, DOI timestamps) — unchanged.
--   * Blocks are not consent: bounce / complaint / erasure stay in
--     suppression_list.
--
-- The merge rules live in ONE pure core (lib/consent-core.mjs). customers.
-- marketing_status keeps being written as a derived compatibility mirror
-- (subscribed → confirmed, …) until the legacy-drop migration.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email_consent_state TEXT NOT NULL DEFAULT 'not_subscribed'
    CHECK (email_consent_state IN ('subscribed', 'pending', 'unsubscribed', 'not_subscribed')),
  ADD COLUMN IF NOT EXISTS email_consent_level TEXT
    CHECK (email_consent_level IN ('confirmed_opt_in', 'single_opt_in', 'unknown')),
  -- When the deciding act happened (Shopify consentUpdatedAt, our DOI confirm,
  -- the unsubscribe click …) — the resolver's "newer act wins" clock.
  ADD COLUMN IF NOT EXISTS email_consent_at TIMESTAMPTZ,
  -- Where the act happened: mo_capture_form | mo_chat_gate | mo_signin | mo |
  -- shopify | admin | import. No CHECK (future surfaces), typed in consent-core.
  ADD COLUMN IF NOT EXISTS email_consent_source TEXT,
  -- Last time Shopify was confirmed to hold the same state (echo / reconcile).
  ADD COLUMN IF NOT EXISTS email_consent_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS customers_email_consent_idx
  ON customers (email_consent_state, email_consent_level);

CREATE TABLE IF NOT EXISTS consent_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id   BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  occurred_at   TIMESTAMPTZ NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  source        TEXT NOT NULL,
  state         TEXT NOT NULL,
  level         TEXT,
  -- What carried the act: email_capture:<id>, webhook:<id>, outbox:<id>,
  -- admin, import … (never an e-mail address).
  origin_ref    TEXT,
  -- For Shopify-side acts: the consent text version live on the shop's
  -- surfaces at that time (SHOPIFY_CONSENT_TEXT_VERSION) — best evidence.
  text_version  TEXT,
  note          TEXT
);

CREATE INDEX IF NOT EXISTS consent_events_customer_idx
  ON consent_events (customer_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Backfill — conservative (fail-closed) translation of today's three stores.
-- The first Shopify import then runs every customer through the resolver.
-- ---------------------------------------------------------------------------

-- (1) Our own DOI records.
UPDATE customers c
   SET email_consent_state  = CASE
                                WHEN ec.unsubscribed_at IS NOT NULL THEN 'unsubscribed'
                                WHEN ec.marketing_doi_status = 'confirmed' THEN 'subscribed'
                                WHEN ec.marketing_doi_status = 'pending' THEN 'pending'
                                ELSE 'not_subscribed'
                              END,
       email_consent_level  = CASE
                                WHEN ec.unsubscribed_at IS NULL AND ec.marketing_doi_status = 'confirmed'
                                THEN 'confirmed_opt_in'
                                ELSE NULL
                              END,
       email_consent_at     = COALESCE(ec.unsubscribed_at, ec.doi_confirmed_at, ec.doi_sent_at, ec.created_at),
       email_consent_source = 'mo'
  FROM email_captures ec
 WHERE ec.email = c.email
   AND (ec.unsubscribed_at IS NOT NULL OR ec.marketing_doi_status IN ('confirmed', 'pending'));

-- (2) Live Shopify subscriptions (the Kampagne audience). A subscription wins
--     over "nothing" and over a pending DOI; against our unsubscribe the newer
--     act wins.
UPDATE customers c
   SET email_consent_state  = 'subscribed',
       email_consent_level  = CASE cc.opt_in_level
                                WHEN 'CONFIRMED_OPT_IN' THEN 'confirmed_opt_in'
                                WHEN 'SINGLE_OPT_IN' THEN 'single_opt_in'
                                ELSE 'unknown'
                              END,
       email_consent_at     = cc.consent_updated_at,
       email_consent_source = 'shopify'
  FROM campaign_contacts cc
 WHERE cc.customer_id = c.id
   AND cc.is_test = false
   AND cc.status <> 'suppressed'
   AND (
         c.email_consent_state IN ('not_subscribed', 'pending')
         OR (c.email_consent_state = 'unsubscribed'
             AND cc.consent_updated_at IS NOT NULL
             AND c.email_consent_at IS NOT NULL
             AND cc.consent_updated_at > c.email_consent_at)
       );

-- (3) Opt-outs on the block list are withdrawals (bounce/erasure are blocks
--     and leave the consent state alone).
UPDATE customers c
   SET email_consent_state = 'unsubscribed',
       email_consent_level = NULL,
       email_consent_at    = COALESCE(c.email_consent_at, s.added_at),
       email_consent_source = COALESCE(c.email_consent_source, 'mo')
  FROM suppression_list s
 WHERE s.email = c.email
   AND COALESCE(s.reason, 'unsubscribe') IN ('unsubscribe', 'manual', 'complaint')
   AND c.email_consent_state <> 'unsubscribed';

-- (4) One history entry per backfilled state.
INSERT INTO consent_events (customer_id, occurred_at, source, state, level, origin_ref, note)
SELECT c.id, COALESCE(c.email_consent_at, now()), COALESCE(c.email_consent_source, 'import'),
       c.email_consent_state, c.email_consent_level, 'import', 'Übernahme aus dem bisherigen Stand (Migration 0064)'
  FROM customers c
 WHERE c.email_consent_state <> 'not_subscribed'
   AND NOT EXISTS (SELECT 1 FROM consent_events e WHERE e.customer_id = c.id);

-- (5) Keep the compatibility mirror aligned with the new state.
UPDATE customers
   SET marketing_status = CASE email_consent_state
                            WHEN 'subscribed' THEN 'confirmed'
                            WHEN 'pending' THEN 'pending'
                            WHEN 'unsubscribed' THEN 'unsubscribed'
                            ELSE 'none'
                          END;
