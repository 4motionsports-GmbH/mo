-- 0083_gift_vouchers.sql — Geschenkgutscheine (gift vouchers): vouchers
-- designed and bought in the shop, vouchers issued by hand in the admin
-- („Gutscheine“), and the printed Premium-Karte. docs/GIFT_VOUCHERS.md.
-- (Not the newsletter „Willkommensgutschein“ — that is a discount code.)
--
-- 1. gift_voucher_drafts — what a customer designed on /pages/gutschein
--    before paying: Motiv, amount (preview only — the paid price comes from
--    the Shopify variant, never from here), texts, an optional photo
--    (private Blob gift-voucher-photos/…), the delivery and — for the
--    Premium-Karte — the recipient's postal address (the snake_case shape of
--    customers.postal_address). ANONYMOUS: no customer, e-mail or session;
--    the cart lines carry only the opaque token (line property _mo_gv).
--    orders/paid copies a draft into its vouchers and stamps ordered_at.
--
-- 2. gift_vouchers — one row per voucher UNIT (an order line with quantity 2
--    is two rows, unit_index 0 and 1; UNIQUE per order line and unit, so a
--    redelivered webhook never creates a second voucher). source 'shop'
--    (orders/paid) or 'admin' (Kulanz, Marketing, Gewinnspiel,
--    Firmengeschenk, Sonstiges). Each row becomes a REAL Shopify gift card
--    (giftCardCreate) with a Mo-generated code: code_enc is the code
--    encrypted with TOKEN_ENC_KEY (AES-256-GCM, lib/token-crypto.ts),
--    code_hash its sha256 (balance check by code), code_last4 the display
--    tail. The code is stored BEFORE the Shopify call (status 'issuing'), so
--    a lost response can be resolved by looking the card up by its code.
--    download_token_hash = sha256 of the e-mailed PDF download link token.
--    attempts / next_attempt_at / locked_until drive the retry sweep (lease
--    against two workers), mail_* the buyer mail, balance_* the last balance
--    read from Shopify. Number shown to people: G-<Berlin year>-<id 5 digits>
--    (derived, no column).
--
-- 3. gift_voucher_print_jobs — the Premium-Karte of a voucher (at most one):
--    provider 'printone' (print.one prints and posts it) or 'manual' (the
--    in-house print queue in the admin), the recipient address, the
--    provider order id and status, the two print spreads (private Blob
--    gift-voucher-print/…, served to the provider by asset_token while the
--    job is open), cost and errors.
--
-- Erasure (customer-erasure-core.mjs ERASURE_PLAN): a voucher is money for
-- its recipient, so the row stays ANONYMISED — the buyer link (customer,
-- Shopify customer id), the buyer's e-mail and name go, and so do the e-mail
-- and name of a person who was the e-mail recipient of an admin voucher; a
-- finished print job loses the recipient address. Drafts are anonymous.
-- Merge: gift_vouchers.customer_id is repointed (customer-fk-plan.mjs).
-- Retention (lib/retention.ts, retention-options.mjs; 0 disables a step):
-- GIFT_VOUCHER_DRAFT_RETENTION_DAYS (30) deletes drafts no live voucher uses,
-- GIFT_VOUCHER_ADDRESS_RETENTION_DAYS (180) clears the address of finished
-- print jobs, GIFT_VOUCHER_PERSONAL_RETENTION_DAYS (365) anonymises a voucher
-- that long after it ended (expired, used up, deactivated, cancelled,
-- rejected) — amounts, status, code hash/last 4 and ids stay.
--
-- Run BEFORE deploying the code that reads it (the voucher webhook path, the
-- retention step, erasure and merge touch these tables; erasure and merge
-- skip them only while the tables do not exist yet). Additive: older code
-- ignores the new tables.
-- Configuration vs data: all three tables are data (wiped by
-- `npm run db:reset`, db-reset-plan.mjs); the settings live in admin_settings
-- key 'gift_vouchers' (no migration).
-- Forward-only, idempotent.

CREATE TABLE IF NOT EXISTS gift_voucher_drafts (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token                     TEXT NOT NULL UNIQUE,
  design_key                TEXT NOT NULL,
  amount_cents              INTEGER,
  recipient_name            TEXT,
  sender_name               TEXT,
  message                   TEXT,
  photo_pathname            TEXT,
  delivery                  TEXT NOT NULL DEFAULT 'pdf' CHECK (delivery IN ('pdf', 'print')),
  recipient_postal_address  JSONB,
  locale                    TEXT NOT NULL DEFAULT 'de',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  ordered_at                TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS gift_voucher_drafts_created_idx ON gift_voucher_drafts (created_at);

CREATE TABLE IF NOT EXISTS gift_vouchers (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source                 TEXT NOT NULL CHECK (source IN ('shop', 'admin')),
  reason                 TEXT NOT NULL DEFAULT 'verkauf'
                           CHECK (reason IN ('verkauf', 'kulanz', 'marketing', 'gewinnspiel', 'firmengeschenk', 'sonstiges')),
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'held', 'issuing', 'issued', 'failed', 'rejected', 'cancelled', 'deactivated')),
  hold_reason            TEXT,
  attention              TEXT,
  amount_cents           INTEGER NOT NULL CHECK (amount_cents > 0),
  currency               TEXT NOT NULL DEFAULT 'EUR',
  expires_on             DATE,
  code_enc               BYTEA,
  code_hash              TEXT UNIQUE,
  code_last4             TEXT,
  shopify_gift_card_id   TEXT UNIQUE,
  shopify_order_id       TEXT,
  shopify_order_name     TEXT,
  shopify_line_item_id   TEXT,
  unit_index             INTEGER NOT NULL DEFAULT 0,
  shopify_customer_id    TEXT,
  customer_id            BIGINT REFERENCES customers (id) ON DELETE SET NULL,
  buyer_email            TEXT,
  buyer_name             TEXT,
  draft_id               BIGINT REFERENCES gift_voucher_drafts (id) ON DELETE SET NULL,
  design_key             TEXT NOT NULL,
  recipient_name         TEXT,
  sender_name            TEXT,
  message                TEXT,
  photo_pathname         TEXT,
  delivery               TEXT NOT NULL DEFAULT 'pdf' CHECK (delivery IN ('pdf', 'print', 'email')),
  recipient_email        TEXT,
  locale                 TEXT NOT NULL DEFAULT 'de',
  download_token_hash    TEXT UNIQUE,
  mail_status            TEXT NOT NULL DEFAULT 'none' CHECK (mail_status IN ('none', 'pending', 'sent', 'failed', 'skipped')),
  mail_attempts          INTEGER NOT NULL DEFAULT 0,
  mail_next_attempt_at   TIMESTAMPTZ,
  mailed_at              TIMESTAMPTZ,
  balance_cents          INTEGER,
  balance_checked_at     TIMESTAMPTZ,
  issued_at              TIMESTAMPTZ,
  deactivated_at         TIMESTAMPTZ,
  deactivation_reason    TEXT,
  fulfilled_at           TIMESTAMPTZ,
  created_by             TEXT,
  admin_note             TEXT,
  attempts               INTEGER NOT NULL DEFAULT 0,
  next_attempt_at        TIMESTAMPTZ,
  locked_until           TIMESTAMPTZ,
  last_error             TEXT,
  personal_data_purged_at TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shopify_order_id, shopify_line_item_id, unit_index)
);
CREATE INDEX IF NOT EXISTS gift_vouchers_status_due_idx ON gift_vouchers (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS gift_vouchers_mail_due_idx ON gift_vouchers (mail_status, mail_next_attempt_at);
CREATE INDEX IF NOT EXISTS gift_vouchers_customer_idx ON gift_vouchers (customer_id);
CREATE INDEX IF NOT EXISTS gift_vouchers_order_idx ON gift_vouchers (shopify_order_id);
CREATE INDEX IF NOT EXISTS gift_vouchers_created_idx ON gift_vouchers (created_at);
CREATE INDEX IF NOT EXISTS gift_vouchers_issued_idx ON gift_vouchers (issued_at);
-- The draft FK (ON DELETE SET NULL) and the draft retention look vouchers up
-- by draft; without this every deleted draft scans gift_vouchers.
CREATE INDEX IF NOT EXISTS gift_vouchers_draft_idx
  ON gift_vouchers (draft_id) WHERE draft_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gift_voucher_print_jobs (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voucher_id                BIGINT NOT NULL UNIQUE REFERENCES gift_vouchers (id) ON DELETE CASCADE,
  provider                  TEXT NOT NULL CHECK (provider IN ('printone', 'manual')),
  status                    TEXT NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('review', 'queued', 'submitting', 'submitted', 'printing', 'sent', 'failed', 'cancelled', 'done')),
  recipient_postal_address  JSONB,
  provider_order_id         TEXT,
  provider_status           TEXT,
  asset_token               TEXT UNIQUE,
  asset_outside_pathname    TEXT,
  asset_inside_pathname     TEXT,
  cost_cents                INTEGER,
  paid_line_item_id         TEXT,
  error                     TEXT,
  attempts                  INTEGER NOT NULL DEFAULT 0,
  next_attempt_at           TIMESTAMPTZ,
  locked_until              TIMESTAMPTZ,
  submitted_at              TIMESTAMPTZ,
  sent_at                   TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_voucher_print_jobs_provider_order_idx
  ON gift_voucher_print_jobs (provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS gift_voucher_print_jobs_status_due_idx
  ON gift_voucher_print_jobs (status, next_attempt_at);
