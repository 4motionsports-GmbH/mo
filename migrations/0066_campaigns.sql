-- 0066_campaigns.sql — many campaigns instead of one implicit one.
--
-- Until now the Kampagne module was ONE open-ended campaign: a person's place
-- in it was the status column of campaign_contacts (one row per Shopify
-- subscriber), and `sent` was terminal — every subscriber could receive one
-- campaign e-mail, ever. From here on (docs/CUSTOMER_PLATFORM_PLAN.md §10):
--
--   * `campaigns` defines each campaign: kind (laufend / aktion / einzel),
--     status, brief for the drafter, audience spec, offer defaults, design,
--     hero mode, call to action, schedule, priority.
--   * campaign_contacts BECOMES the recipient table: one row per person per
--     campaign (and per cycle, for re-entry in a laufend campaign). Every
--     existing key (drafts, sends, sets, hero images, AI usage) keeps pointing
--     at it, so the review desk works per campaign unchanged. Its identity
--     columns (email, name, language, opt-in level, order figures) are a
--     snapshot refreshed from customers/customer_facts.
--   * Today's queue becomes campaign #1 "Bestandskunden – Lebenszyklus"; the
--     1:1 mails from Kunden get the built-in campaign "Einzelansprache".

CREATE TABLE IF NOT EXISTS campaigns (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  kind                  TEXT NOT NULL CHECK (kind IN ('laufend', 'aktion', 'einzel')),
  status                TEXT NOT NULL DEFAULT 'entwurf'
                          CHECK (status IN ('entwurf', 'aktiv', 'pausiert', 'beendet', 'archiviert')),
  -- The campaign's instructions to the drafter: goal, occasion, tone,
  -- must-haves, no-gos (lib/campaign-draft.ts "Kampagnenziel").
  brief                 TEXT,
  -- Validated audience spec (lib/audience-spec.mjs). Consent + blocks are
  -- always implied for the e-mail channel.
  audience              JSONB NOT NULL DEFAULT '{"v":1}'::jsonb,
  -- dynamisch: re-evaluated nightly (new matches join, pending ones that no
  -- longer match leave); fest: materialised once at the start.
  audience_mode         TEXT NOT NULL DEFAULT 'fest' CHECK (audience_mode IN ('dynamisch', 'fest')),
  priority              INTEGER NOT NULL DEFAULT 0,
  starts_at             TIMESTAMPTZ,
  ends_at               TIMESTAMPTZ,
  daily_target          INTEGER,
  -- Nightly drafts for this campaign (bounded globally by CAMPAIGN_AUTO_PREPARE_COUNT).
  auto_prepare_per_day  INTEGER NOT NULL DEFAULT 0,
  -- laufend: a person who got a mail may re-enter after this many days.
  reentry_days          INTEGER,
  discount_percent      INTEGER NOT NULL DEFAULT 0,
  discount_scope        TEXT NOT NULL DEFAULT 'all' CHECK (discount_scope IN ('all', 'recommendations', 'set')),
  -- aktion: every code of the campaign ends here (else MARKETING_DISCOUNT_EXPIRY_DAYS).
  discount_valid_until  TIMESTAMPTZ,
  -- E-mail design (email-designs registry key); NULL = the "campaign" default.
  design_key            TEXT,
  hero_mode             TEXT NOT NULL DEFAULT 'none' CHECK (hero_mode IN ('none', 'default', 'ai_ab', 'ai_all')),
  text_mode             TEXT CHECK (text_mode IN ('detailed', 'compact', 'minimal')),
  -- Append the Mo chat hint block (deterministic, campaign-draft-core).
  mo_promo              BOOLEAN NOT NULL DEFAULT true,
  -- mo_chat: the CTA opens Mo (today's deep link); shop: a shop URL.
  cta_kind              TEXT NOT NULL DEFAULT 'mo_chat' CHECK (cta_kind IN ('mo_chat', 'shop')),
  cta_url               TEXT,
  audience_refreshed_at TIMESTAMPTZ,
  started_at            TIMESTAMPTZ,
  ended_at              TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one Einzelansprache.
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_one_einzel ON campaigns (kind) WHERE kind = 'einzel';
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (status, priority DESC);

INSERT INTO campaigns (name, slug, kind, status, audience, audience_mode, priority, hero_mode, reentry_days, started_at)
SELECT 'Bestandskunden – Lebenszyklus', 'lebenszyklus', 'laufend', 'aktiv',
       '{"v":1,"lifecycle":["ausbauen_frueh","ausbauen","weiterentwickeln","zurueckholen","unbekannt"]}'::jsonb,
       'dynamisch', 10, 'ai_ab', 180, now()
 WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE slug = 'lebenszyklus');

INSERT INTO campaigns (name, slug, kind, status, audience, audience_mode, priority, started_at)
SELECT 'Einzelansprache', 'einzelansprache', 'einzel', 'aktiv', '{"v":1}'::jsonb, 'fest', 100, now()
 WHERE NOT EXISTS (SELECT 1 FROM campaigns WHERE kind = 'einzel');

-- ---------------------------------------------------------------------------
-- campaign_contacts → recipients
-- ---------------------------------------------------------------------------

ALTER TABLE campaign_contacts
  ADD COLUMN IF NOT EXISTS campaign_id     BIGINT REFERENCES campaigns (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS cycle           INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS excluded_reason TEXT,
  -- Einzelansprache started from a chat: the conversion sweep follows it.
  ADD COLUMN IF NOT EXISTS conversation_id BIGINT REFERENCES conversations (id) ON DELETE SET NULL,
  -- Per-recipient hint for the drafter (Einzelansprache, Eingang suggestion).
  ADD COLUMN IF NOT EXISTS admin_note      TEXT,
  ADD COLUMN IF NOT EXISTS added_at        TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE campaign_contacts
   SET campaign_id = (SELECT id FROM campaigns WHERE slug = 'lebenszyklus')
 WHERE campaign_id IS NULL;

ALTER TABLE campaign_contacts ALTER COLUMN campaign_id SET NOT NULL;

-- A person can now be in many campaigns: the Shopify id is no longer the key.
ALTER TABLE campaign_contacts DROP CONSTRAINT IF EXISTS campaign_contacts_shopify_customer_id_key;
ALTER TABLE campaign_contacts ALTER COLUMN shopify_customer_id DROP NOT NULL;

ALTER TABLE campaign_contacts DROP CONSTRAINT IF EXISTS campaign_contacts_status_check;
ALTER TABLE campaign_contacts ADD CONSTRAINT campaign_contacts_status_check
  CHECK (status IN ('pending', 'drafted', 'sending', 'sent', 'skipped', 'suppressed', 'draft_failed', 'excluded'));

CREATE UNIQUE INDEX IF NOT EXISTS campaign_contacts_recipient_idx
  ON campaign_contacts (campaign_id, customer_id, cycle)
  WHERE customer_id IS NOT NULL AND is_test = false;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_contacts_test_email_idx
  ON campaign_contacts (campaign_id, email) WHERE is_test;
CREATE INDEX IF NOT EXISTS campaign_contacts_campaign_status_idx
  ON campaign_contacts (campaign_id, status, id);

-- ---------------------------------------------------------------------------
-- Sends know their campaign and their person
-- ---------------------------------------------------------------------------

ALTER TABLE campaign_sends
  ADD COLUMN IF NOT EXISTS campaign_id BIGINT REFERENCES campaigns (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers (id) ON DELETE SET NULL;

UPDATE campaign_sends s
   SET campaign_id = cc.campaign_id,
       customer_id = cc.customer_id
  FROM campaign_contacts cc
 WHERE s.contact_id = cc.id
   AND s.campaign_id IS NULL;

UPDATE campaign_sends
   SET campaign_id = (SELECT id FROM campaigns WHERE slug = 'lebenszyklus')
 WHERE campaign_id IS NULL;

UPDATE campaign_sends s
   SET customer_id = c.id
  FROM customers c
 WHERE s.customer_id IS NULL
   AND c.email = s.email;

CREATE INDEX IF NOT EXISTS campaign_sends_campaign_idx ON campaign_sends (campaign_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS campaign_sends_customer_idx ON campaign_sends (customer_id) WHERE customer_id IS NOT NULL;

-- The duplicate of campaign_sends_email_idx (0034) added by 0054.
DROP INDEX IF EXISTS campaign_sends_email_sent_idx;
