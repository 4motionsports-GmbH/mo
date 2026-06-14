-- 0017_bestandskunden.sql — §7 Abs. 3 UWG "Bestandskunden" (existing-customer)
-- marketing: a SEPARATE lawful basis from the DOI-consented marketing path.
--
-- ⚠️ NEVER MERGE THE TWO BASES.
--   * DOI-consented marketing lives in email_captures.marketing_doi_status +
--     customers.marketing_status, suppressed by suppression_list. Path to
--     'confirmed' is the double-opt-in ONLY.
--   * §7(3) Bestandskunden eligibility lives in the new columns below, derived
--     ONLY from a COMPLETED PURCHASE in the Shopify order history (NOT an
--     account, NOT a cancelled/abandoned order), suppressed by the SEPARATE
--     bestandskunden_suppression_list (its own opt-out).
-- A customer may be in one audience, both, or neither. Real §7(3) sends stay
-- gated behind BESTANDSKUNDE_SENDS_APPROVED (default OFF) until the lawyer
-- blesses the "own similar products" boundary + opt-out copy. See
-- docs/CONSENT_FLOW.md.

-- ============================================================================
-- 1) Cached §7(3) eligibility on the customer row.
--    Computed from customers.purchase_summary whenever it is refreshed
--    (lib/customer-store.ts::saveCustomerPurchaseSummary →
--     lib/bestandskunden.mjs::isBestandskundeEligible). Cached so the audience
--    query is a cheap boolean filter, never a per-row Shopify fan-out.
-- ============================================================================
ALTER TABLE customers
  -- True ⇔ the cached purchase_summary contains a completed purchase. DEFAULT
  -- false (fail-closed): a customer is NOT a Bestandskunde until a completed
  -- order is actually observed.
  ADD COLUMN IF NOT EXISTS bestandskunde_eligible            BOOLEAN NOT NULL DEFAULT false,
  -- When the eligibility flag was last (re)computed from a purchase refresh.
  ADD COLUMN IF NOT EXISTS bestandskunde_eligible_updated_at TIMESTAMPTZ;

-- The §7(3) audience = eligible AND not opted-out. A partial index keeps that
-- list fast.
CREATE INDEX IF NOT EXISTS customers_bestandskunde_idx
  ON customers (bestandskunde_eligible)
  WHERE bestandskunde_eligible;

-- ============================================================================
-- 2) SEPARATE Bestandskunden opt-out (objection under §7 Abs. 3 Nr. 3 UWG).
--    Distinct from suppression_list: objecting to existing-customer mail is a
--    different act from unsubscribing the DOI marketing — different lawful
--    basis, different sender promise — so the two opt-outs are honoured
--    INDEPENDENTLY and never auto-fused.
-- ============================================================================
CREATE TABLE IF NOT EXISTS bestandskunden_suppression_list (
  -- Normalised (trimmed + lower-cased by the app) email.
  email     TEXT PRIMARY KEY,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Free-text provenance, e.g. 'bestandskunde_opt_out', 'erasure'.
  reason    TEXT
);
