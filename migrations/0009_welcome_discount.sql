-- 0009_welcome_discount.sql — one-time welcome discount, recorded on the CUSTOMER.
--
-- A customer who completes the marketing double-opt-in confirmation for the
-- FIRST time receives a unique single-use welcome code ("WELCOME-…", distinct
-- from the marketing "MS5-…" codes). The customer row is the SOURCE OF TRUTH
-- for the once-ever guarantee: welcome_issued_at is claimed atomically
-- (UPDATE … WHERE welcome_issued_at IS NULL) before any code is minted, so the
-- same email can never be issued a second welcome code — not on a repeated
-- token click, not on a re-signup from another session, not under concurrent
-- confirmations.
--
-- LEGAL FRAMING (lawyer-confirm, see docs/WELCOME_DISCOUNT.md): the code is a
-- welcome GIFT for completing the freely-chosen DOI confirmation, NOT
-- consideration for ticking the marketing checkbox — this keeps the marketing
-- consent "freely given" (Art. 7(4) GDPR). Issuing only on DOI confirmation
-- also means unconfirmed or fake addresses are never rewarded.

ALTER TABLE customers
  -- The issued code (e.g. "WELCOME-A1B2C3D4"). NULL until issued.
  ADD COLUMN IF NOT EXISTS welcome_code            TEXT,
  -- Shopify DiscountCodeNode gid for auditing / later deactivation.
  ADD COLUMN IF NOT EXISTS welcome_code_gid        TEXT,
  -- When the code stops working (Shopify endsAt) — stated in the email.
  ADD COLUMN IF NOT EXISTS welcome_code_expires_at TIMESTAMPTZ,
  -- The once-ever claim stamp. Set atomically BEFORE minting; non-NULL means
  -- this customer's single welcome code has been (or is being) issued.
  ADD COLUMN IF NOT EXISTS welcome_issued_at       TIMESTAMPTZ;
