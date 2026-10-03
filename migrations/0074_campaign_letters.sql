-- 0074_campaign_letters.sql — letters as a campaign channel (D-7).
--
-- Until now an advertising letter was sent per customer (Kunden → Brief).
-- A campaign can now also reach its audience by post, mostly the people an
-- e-mail may not reach (no consent):
--
--   campaigns.letter_mode     'aus' (default) | 'ohne_einwilligung' (letters
--                             only to matches WITHOUT the e-mail consent) |
--                             'alle' (every match, in addition to e-mail)
--   campaigns.letter_budget_cents  postage cap of the campaign (NULL = none);
--                             the send path refuses a letter beyond it
--
--   campaign_letters          one row per recipient per campaign per cycle —
--                             separate from campaign_contacts, whose every
--                             query assumes the e-mail consent. Each letter is
--                             drafted (AI), reviewed and released ONE BY ONE by
--                             a person; the send path re-checks every gate.
--                             The posted letter is a physical_letters row
--                             (physical_letter_id); its status comes from
--                             there (Pingen webhook), never a second copy.
--
--   physical_letters.campaign_id  postage per campaign
--
--   customers.postal_address_order_id   the order the stored address was
--                             taken from (the address source rule: only the
--                             shipping address of a completed order) — a
--                             newer completed order refreshes it
--   customers.postal_address_invalid_at a letter came back undeliverable;
--                             no further letter to that address
--
-- Erasure: campaign_letters cascade with the customer. Retention: with the
-- campaign recipients (CAMPAIGN_CONTACT_RETENTION_DAYS). Forward-only,
-- idempotent.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS letter_mode TEXT NOT NULL DEFAULT 'aus'
    CHECK (letter_mode IN ('aus', 'ohne_einwilligung', 'alle'));

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS letter_budget_cents INTEGER
    CHECK (letter_budget_cents IS NULL OR letter_budget_cents >= 0);

CREATE TABLE IF NOT EXISTS campaign_letters (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id        BIGINT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  customer_id        BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  cycle              INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'drafted', 'approved', 'sending',
                                         'sent', 'skipped', 'excluded', 'failed')),
  -- Why a row left the audience (excluded): widerspruch | einwilligung |
  -- zielgruppe | kein_kauf.
  excluded_reason    TEXT,
  subject            TEXT,
  body               TEXT,
  edited             BOOLEAN NOT NULL DEFAULT false,
  admin_note         TEXT,
  drafted_at         TIMESTAMPTZ,
  approved_at        TIMESTAMPTZ,
  sent_at            TIMESTAMPTZ,
  page_count         INTEGER,
  physical_letter_id BIGINT REFERENCES physical_letters (id) ON DELETE SET NULL,
  error              TEXT,
  added_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, customer_id, cycle)
);

CREATE INDEX IF NOT EXISTS campaign_letters_campaign_status_idx
  ON campaign_letters (campaign_id, status, id);

CREATE INDEX IF NOT EXISTS campaign_letters_customer_idx
  ON campaign_letters (customer_id);

ALTER TABLE physical_letters
  ADD COLUMN IF NOT EXISTS campaign_id BIGINT REFERENCES campaigns (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS physical_letters_campaign_idx
  ON physical_letters (campaign_id) WHERE campaign_id IS NOT NULL;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS postal_address_order_id TEXT;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS postal_address_invalid_at TIMESTAMPTZ;
