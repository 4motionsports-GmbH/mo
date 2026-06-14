-- 0022_physical_letters.sql — PHYSICAL MAIL via Pingen (Round 10D item 10 /
-- docs/EMAIL_SUBSYSTEM_SPIKE.md §4).
--
-- A letter is NOT email, so it gets its OWN table (parallel to email_messages,
-- NOT folded into it). It is the audit log of every physical letter we hand to
-- Pingen → Deutsche Post: the recipient's FULL postal address (snapshotted at
-- submit time), the Pingen letter id + lifecycle status (queued → printed →
-- posted, driven by the status webhook), the cost, and the optional link back
-- to the marketing_sends workflow row when the letter mirrors a campaign.
--
-- ⚠ NEW DATA PROCESSOR. Submitting an address to Pingen (CH) → Deutsche Post is
-- a NEW processor with a third-country (CH) transfer — it needs its own
-- AV-Vertrag (DPA). The whole physical-send path therefore stays behind the
-- PHYSICAL_MAIL_SENDS_APPROVED flag (lib/pingen-flag.mjs), exactly like
-- BESTANDSKUNDE_SENDS_APPROVED: BUILT here, but DISABLED for real sends until
-- legal sign-off + the address-acquisition decision land.

-- ---------------------------------------------------------------------------
-- The LAWFUL full-address store (the spike's product blocker, §4).
--
-- Today we deliberately do NOT hold full postal addresses: the tier-3 Shopify
-- account snapshot is MINIMISED to city/country only (migration 0015), and the
-- profile pass never sees a street. Physical mail needs the FULL address WITH a
-- lawful basis to use it for outbound post. We keep that on its OWN, separate,
-- NULL-by-default column set so:
--   * minimisation is intact — the profile/greeting still read only
--     shopify_account_summary (city/country); nothing auto-populates this;
--   * eligibility is a real, testable check — a customer is mail-eligible ONLY
--     when a COMPLETE address is present here (lib/physical-address.mjs), never
--     guessed or part-filled;
--   * the source/lawful basis is recorded for the audit.
-- It is written ONLY by a future consented-capture / purchase-derived
-- acquisition flow (the address-acquisition follow-up) — so it is NULL for
-- everyone until then, and "Brief senden" is disabled with a clear reason.
ALTER TABLE customers
  -- Full postal address held LAWFULLY, jsonb:
  -- { name, company?, address_line_1, address_line_2?, postal_code, city,
  --   country } (country = ISO-3166 alpha-2, e.g. 'DE'). NULL = none held.
  ADD COLUMN IF NOT EXISTS postal_address            JSONB,
  -- How/why we are allowed to use it for post: 'purchase' (delivery address
  -- from a completed order) | 'consented_capture' (explicit postal consent).
  ADD COLUMN IF NOT EXISTS postal_address_source     TEXT,
  ADD COLUMN IF NOT EXISTS postal_address_updated_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- The physical-letter audit log.
CREATE TABLE IF NOT EXISTS physical_letters (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The person this letter is for. SET NULL on customer erasure so deleting a
  -- customer never orphan-cascades the audit row away (retention purges
  -- letters on their own schedule, like email_messages).
  customer_id           BIGINT REFERENCES customers (id) ON DELETE SET NULL,
  -- LINK to the marketing workflow row when this letter mirrors a campaign send
  -- (the "actual marketing mail" button). marketing_sends stays a WORKFLOW
  -- table — we LINK to it, never reshape it. NULL for a one-off letter.
  marketing_send_id     BIGINT REFERENCES marketing_sends (id) ON DELETE SET NULL,
  -- Provider provenance. Only Pingen today; kept explicit so a second postal
  -- provider (DHL/DP) could be added without a schema change.
  provider              TEXT NOT NULL DEFAULT 'pingen'
                          CHECK (provider IN ('pingen')),
  -- The Pingen letter UUID — our handle for status polling + the webhook match.
  provider_letter_id    TEXT,
  -- Internal lifecycle. Pingen's many granular statuses are NORMALISED into
  -- this set (lib/pingen-core.normalizePingenStatus). queued → printed → posted
  -- is the happy path the webhook drives; failed/cancelled/undeliverable are
  -- terminal error states.
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','submitted','queued',
                                            'printing','printed','posted',
                                            'failed','cancelled','undeliverable')),
  -- Recipient FULL address, SNAPSHOTTED at submit time (the lawful address can
  -- change later; the letter we posted used THIS one). country = ISO alpha-2.
  recipient_name          TEXT,
  recipient_company       TEXT,
  recipient_address_line1 TEXT,
  recipient_address_line2 TEXT,
  recipient_postal_code   TEXT,
  recipient_city          TEXT,
  recipient_country       TEXT,
  -- Per-letter cost in cents (Pingen reports a price; from ~€0.86/letter), so
  -- the dashboard can total postage. NULL until known.
  cost_cents            INTEGER,
  -- The last provider error (failed submit / undeliverable), for triage.
  error                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- When it was handed to Pingen (submit) and last status change.
  submitted_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS physical_letters_customer_idx
  ON physical_letters (customer_id, created_at DESC);
-- Webhook lookup: map an incoming status event to our row by the Pingen id.
-- Partial so the (brief) pending rows without a provider id never collide.
CREATE UNIQUE INDEX IF NOT EXISTS physical_letters_provider_idx
  ON physical_letters (provider_letter_id) WHERE provider_letter_id IS NOT NULL;
