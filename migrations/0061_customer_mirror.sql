-- 0061_customer_mirror.sql — every Shopify customer is a Mo customer.
--
-- Until now a `customers` row existed only for chat captures, widget sign-ins
-- and Shopify newsletter subscribers (0059). From here on the table MIRRORS the
-- shop's whole customer base (bulk import + customers/* webhooks + a nightly
-- reconciliation, lib/shopify-sync.ts), so the Kunden screen, audiences and the
-- Eingang see everyone — most of whom never chatted. See
-- docs/CUSTOMER_PLATFORM_PLAN.md §6 and docs/CUSTOMERS.md.
--
-- Identity: shopify_customer_id (numeric, unique since 0014) is the primary
-- external key, the e-mail the fallback. A Shopify customer without an e-mail
-- keeps the existing `shopify:<id>` placeholder convention.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS first_name          TEXT,
  ADD COLUMN IF NOT EXISTS last_name           TEXT,
  ADD COLUMN IF NOT EXISTS locale              TEXT,
  ADD COLUMN IF NOT EXISTS country_code        TEXT,
  -- The person's e-mail language pin (was per Kampagne contact, 0040): it is
  -- a property of the person, not of a campaign. NULL = derived.
  ADD COLUMN IF NOT EXISTS language_override   TEXT CHECK (language_override IN ('de', 'en')),
  -- Shopify account state (ENABLED / DISABLED / INVITED / DECLINED).
  ADD COLUMN IF NOT EXISTS shopify_state       TEXT,
  ADD COLUMN IF NOT EXISTS shopify_tags        TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS shopify_created_at  TIMESTAMPTZ,
  -- Stale guard for webhooks / reconciliation: a payload older than this is ignored.
  ADD COLUMN IF NOT EXISTS shopify_updated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shopify_synced_at   TIMESTAMPTZ,
  -- Set by every write that changes a customer's facts (order, chat, send);
  -- the facts job recomputes dirty customers first (lib/customer-facts.ts).
  ADD COLUMN IF NOT EXISTS facts_dirty_at      TIMESTAMPTZ,
  -- Art. 21 GDPR objection to postal advertising (letters are blocked).
  ADD COLUMN IF NOT EXISTS postal_objection_at TIMESTAMPTZ,
  -- Art. 21 GDPR objection to profiling (the AI profile is cleared and never rebuilt).
  ADD COLUMN IF NOT EXISTS profile_objection_at TIMESTAMPTZ,
  -- Which generator wrote the current AI profile ("Profiltiefe"): 'kauf'
  -- (purchases + marketing reactions) or 'voll' (also conversations and
  -- correspondence). NULL = no AI profile yet, the person is shown with facts.
  ADD COLUMN IF NOT EXISTS profile_depth       TEXT CHECK (profile_depth IN ('kauf', 'voll'));

UPDATE customers SET profile_depth = 'voll' WHERE profile_summary IS NOT NULL AND profile_depth IS NULL;

-- `source` keeps its meaning ("where the person first came from") with two
-- values going forward: 'shopify' (already a shop customer when Mo first saw
-- them) and 'chat' (first seen in Mo). The legacy values stay allowed until the
-- legacy-drop migration so old code paths never fail an insert.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_source_check;
ALTER TABLE customers ADD CONSTRAINT customers_source_check
  CHECK (source IN ('chat', 'shopify', 'shopify_account', 'kampagne'));

UPDATE customers SET source = 'shopify' WHERE source IN ('kampagne', 'shopify_account');

-- Backfill identity from the linked Kampagne contacts: the Shopify id (the
-- contact stores the GID), the name and the language pin. Never steals an id
-- another customer already holds.
UPDATE customers c
   SET shopify_customer_id  = regexp_replace(cc.shopify_customer_id, '^gid://shopify/Customer/', ''),
       shopify_customer_gid = cc.shopify_customer_id,
       shopify_linked_at    = COALESCE(c.shopify_linked_at, now())
  FROM campaign_contacts cc
 WHERE cc.customer_id = c.id
   AND cc.is_test = false
   AND c.shopify_customer_id IS NULL
   AND cc.shopify_customer_id LIKE 'gid://shopify/Customer/%'
   AND NOT EXISTS (
         SELECT 1 FROM customers o
          WHERE o.shopify_customer_id = regexp_replace(cc.shopify_customer_id, '^gid://shopify/Customer/', '')
       );

UPDATE customers c
   SET first_name        = COALESCE(c.first_name, NULLIF(btrim(cc.first_name), '')),
       last_name         = COALESCE(c.last_name, NULLIF(btrim(cc.last_name), '')),
       language_override = COALESCE(c.language_override, cc.language_override)
  FROM campaign_contacts cc
 WHERE cc.customer_id = c.id
   AND cc.is_test = false;

UPDATE customers
   SET first_name = NULLIF(btrim(shopify_account_summary->>'firstName'), '')
 WHERE first_name IS NULL
   AND shopify_account_summary IS NOT NULL;

CREATE INDEX IF NOT EXISTS customers_facts_dirty_idx
  ON customers (facts_dirty_at) WHERE facts_dirty_at IS NOT NULL;
