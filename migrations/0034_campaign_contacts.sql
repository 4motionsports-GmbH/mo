-- 0034_campaign_contacts.sql — Kampagnen-Modul (R12): personalized marketing
-- emails to the shop's EXISTING Shopify marketing subscribers.
--
-- This audience is DISTINCT from the Mo email-capture funnel (email_captures):
-- their consent comes from Shopify's marketing checkbox (login/checkout), NOT
-- from our own double-opt-in flow. German case law effectively requires a
-- provable double opt-in, so the consent QUALITY is recorded per contact
-- (opt_in_level, from Shopify's emailMarketingConsent.marketingOptInLevel) and
-- the send path gates on it (see src/lib/campaign-gates.mjs):
--   * CONFIRMED_OPT_IN  — sendable once CAMPAIGN_SENDS_APPROVED is flipped.
--   * SINGLE_OPT_IN / UNKNOWN — send-blocked by default; only
--     CAMPAIGN_ALLOW_SINGLE_OPT_IN=true (the lawyer's call) unblocks them.
--
-- Sync rules (src/lib/campaign-sync.ts):
--   * Only marketingState = SUBSCRIBED customers are ever stored here.
--   * Idempotent upsert on shopify_customer_id.
--   * A customer who unsubscribed on the Shopify side, or whose email is on OUR
--     suppression list, is marked status='suppressed' on re-sync — never
--     deleted mid-campaign (audit trail). Retention purges rows on their own
--     window (CAMPAIGN_CONTACT_RETENTION_DAYS, /api/cron/retention).

CREATE TABLE IF NOT EXISTS campaign_contacts (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Shopify Customer GID (gid://shopify/Customer/…) — the stable sync key.
  shopify_customer_id TEXT NOT NULL UNIQUE,
  -- Normalised (trim + lowercase) — the key for suppression / frequency checks.
  email               TEXT NOT NULL,
  first_name          TEXT,
  last_name           TEXT,
  -- Derived email language (see campaign-language.mjs): customer locale if
  -- present (de* → de, otherwise en); fallback defaultAddress country DE/AT/CH
  -- → de, else en; final fallback de.
  language            TEXT NOT NULL DEFAULT 'de' CHECK (language IN ('de','en')),
  -- Shopify emailMarketingConsent.marketingOptInLevel at last sync:
  -- CONFIRMED_OPT_IN | SINGLE_OPT_IN | UNKNOWN. Drives the per-contact send
  -- gate + the UI badge.
  opt_in_level        TEXT,
  consent_updated_at  TIMESTAMPTZ,
  orders_count        INTEGER NOT NULL DEFAULT 0,
  -- Lifetime spend in CENTS (Shopify amountSpent, shop currency).
  total_spent_cents   BIGINT NOT NULL DEFAULT 0,
  last_synced_at      TIMESTAMPTZ,
  -- Review-queue lifecycle. 'suppressed' is a terminal audit marker (Shopify
  -- unsubscribe or our suppression list); 'draft_failed' lets a failed batch
  -- generation surface per contact without blocking the rest.
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','drafted','sending','sent',
                                          'skipped','suppressed','draft_failed')),
  sent_at             TIMESTAMPTZ,
  skipped_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_contacts_email_idx
  ON campaign_contacts (email);
CREATE INDEX IF NOT EXISTS campaign_contacts_status_idx
  ON campaign_contacts (status, id);

-- ---------------------------------------------------------------------------
-- The pre-generated, admin-editable draft for a contact. At most ONE draft per
-- contact (same idempotency rule as marketing_sends' one-open-draft index):
-- changed discount depth or an explicit regenerate OVERWRITES the row so the
-- text and the eventual real code can never disagree. NO real Shopify code is
-- ever stored here — the MK- code is minted only at send time.
CREATE TABLE IF NOT EXISTS campaign_drafts (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id              BIGINT NOT NULL UNIQUE
                            REFERENCES campaign_contacts (id) ON DELETE CASCADE,
  subject                 TEXT NOT NULL,
  body                    TEXT NOT NULL,
  -- Admin-selected depth (whole percent, 0 = no offer; bounds in
  -- discount-validation.mjs). The draft body carries the MO-XXXX placeholder.
  discount_percent        INTEGER NOT NULL DEFAULT 0,
  -- PROJECTED expiry shown in the preview; the real code gets its own at send.
  discount_expires_at     TIMESTAMPTZ,
  -- Compact snapshot of the purchase history the draft was written from
  -- (titles, dates, totals — just enough to render the review card; the full
  -- order history is read from Shopify at draft time and NOT bulk-stored).
  purchase_summary        JSONB,
  -- Catalog product ids (= Shopify handles) recommended in the prose.
  recommended_product_ids TEXT[] NOT NULL DEFAULT '{}',
  -- True when the contact's orders couldn't be matched to any catalog product
  -- and the recommendations are bestseller/representative fallbacks — flagged
  -- so the reviewer knows to look closer.
  low_confidence          BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- The immutable send record — mirrors marketing_sends' role for the campaign
-- channel, keyed by EMAIL so the cross-channel frequency cap and the KPI
-- revenue rollup (MK- codes) can read it without joins to mutable state.
-- body_hash (SHA-256 of the shipped text part) proves WHAT was sent without
-- retaining a second full copy of the prose.
CREATE TABLE IF NOT EXISTS campaign_sends (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id          BIGINT REFERENCES campaign_contacts (id) ON DELETE SET NULL,
  email               TEXT NOT NULL,
  subject             TEXT,
  body_hash           TEXT,
  -- 'email' = sent through the system (Resend); 'copy' = the operator copied
  -- the text out and explicitly marked the contact done.
  sent_via            TEXT NOT NULL DEFAULT 'email'
                        CHECK (sent_via IN ('email','copy')),
  -- The REAL minted MK- code (campaign prefix — separable from MS5- marketing
  -- codes in the revenue KPI), its Shopify gid and expiry. NULL when no
  -- discount was selected or sent_via='copy'.
  discount_code       TEXT,
  discount_code_gid   TEXT,
  discount_expires_at TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_sends_email_idx
  ON campaign_sends (email, sent_at DESC);
CREATE INDEX IF NOT EXISTS campaign_sends_sent_at_idx
  ON campaign_sends (sent_at DESC);
