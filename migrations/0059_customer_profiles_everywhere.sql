-- 0059_customer_profiles_everywhere.sql — one customer record for everyone,
-- a structured, automatically maintained profile, and the Kampagne link.
--
-- Until now a `customers` row existed only after an email capture in the chat
-- (or a Shopify sign-in), the AI profile was regenerated only on an admin
-- click, and the Kampagne audience (campaign_contacts) lived beside the
-- customers table with no link. From here on:
--   * every Shopify marketing contact also gets (or is linked to) a customer
--     row — `source` records where the row came from;
--   * the profile is kept current by the nightly customer-refresh cron and
--     carries structured fields next to the readable text;
--   * campaign_contacts.customer_id ties the Kampagne contact to its customer,
--     so drafts, picks and the review desk read the same profile as the chat.
-- Erasure (lib/customer-erasure.ts) removes the customer AND the linked
-- Kampagne data in one transaction; see docs/CUSTOMERS.md.

-- ---------------------------------------------------------------------------
-- 1) Where a customer row came from. Existing rows: signed-in-only rows are
--    'shopify_account', everything else was created by the chat capture.
-- ---------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'chat'
    CHECK (source IN ('chat', 'shopify_account', 'kampagne'));

UPDATE customers c
   SET source = 'shopify_account'
 WHERE c.shopify_customer_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM email_captures ec WHERE ec.email = c.email)
   AND c.source = 'chat';

CREATE INDEX IF NOT EXISTS customers_source_idx ON customers (source);

-- ---------------------------------------------------------------------------
-- 2) Structured profile next to the readable profile_summary.
--    profile_data  — { persona, goals[], owned[], interests[], level, budget,
--                      nextSteps[] } (lib/customer-profile-core.mjs normalises)
--    persona_label — the persona archetype key, a column so the Kunden list
--                    and the KPIs can filter/group without parsing JSON
--    profile_checked_at — when the nightly upkeep last looked at this
--                    customer (generated, or found nothing to summarise); a
--                    customer is picked again only after new activity.
-- ---------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS profile_data       JSONB,
  ADD COLUMN IF NOT EXISTS persona_label      TEXT,
  ADD COLUMN IF NOT EXISTS profile_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS customers_persona_idx
  ON customers (persona_label) WHERE persona_label IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Kampagne contact → customer. SET NULL on a plain customer delete (the
--    contact is still a Shopify subscriber); the erasure path deletes the
--    contact explicitly.
-- ---------------------------------------------------------------------------
ALTER TABLE campaign_contacts
  ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS campaign_contacts_customer_idx
  ON campaign_contacts (customer_id) WHERE customer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) Backfill: link existing contacts to existing customers (by Shopify id,
--    then by email). New customer rows for the rest are created by the next
--    audience sync (lib/campaign-store.ts linkCampaignContactsToCustomers).
-- ---------------------------------------------------------------------------
UPDATE campaign_contacts cc
   SET customer_id = c.id
  FROM customers c
 WHERE cc.customer_id IS NULL
   AND c.shopify_customer_id IS NOT NULL
   AND c.shopify_customer_id = regexp_replace(cc.shopify_customer_id, '^gid://shopify/Customer/', '');

UPDATE campaign_contacts cc
   SET customer_id = c.id
  FROM customers c
 WHERE cc.customer_id IS NULL
   AND c.email = cc.email;
