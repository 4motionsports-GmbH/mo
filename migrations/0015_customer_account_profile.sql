-- 0015_customer_account_profile.sql — TIER 3: cache the signed-in customer's
-- Shopify Customer Account snapshot (name + address context) for the internal
-- profile and the live-chat greeting.
--
-- Context (see docs/CUSTOMER_ACCOUNT.md §8): for a SIGNED-IN customer we pull
-- the interesting Customer Account API data (name, addresses, full order
-- history) and cache it into the EXISTING customer-memory mechanism, keyed by
-- shopify_customer_id:
--   * the order history reuses customers.purchase_summary (migration 0008) —
--     for tier 3 the Customer Account API REPLACES the email-keyed Admin-API
--     fetch (fetchOrderHistoryByEmail) as the purchase-history source;
--   * the name + a DATA-MINIMISED address context (city + country only — never
--     the full street) live in the compact JSONB column added here.
--
-- DATA MINIMISATION: we deliberately cache only what the profile/greeting need
-- (display name, first name, city, country code, address count) — never raw
-- street addresses, phone numbers, or order totals. Consistent with the live
-- chat's data-minimisation rules (lib/customer-memory.ts).
--
-- GDPR: this NEVER imports Shopify's marketing state. Using this cached history
-- to PERSONALISE the live chat / marketing profile stays gated on the same
-- personalisation consent as tier 2 (CONSENT_COPY_LAWYER_APPROVED + marketing
-- consent — see lib/customer-account-data.mjs::canPersonaliseSignedIn). The
-- greeting-by-name uses only the authenticated session's own identity.

ALTER TABLE customers
  -- Compact Customer Account snapshot (jsonb): { displayName, firstName,
  -- addressContext: { city, countryCode }, addressCount, fetchedAt }. See
  -- lib/customer-account-data.mjs (buildAccountSummary) for the shape.
  ADD COLUMN IF NOT EXISTS shopify_account_summary            JSONB,
  ADD COLUMN IF NOT EXISTS shopify_account_summary_updated_at TIMESTAMPTZ;
