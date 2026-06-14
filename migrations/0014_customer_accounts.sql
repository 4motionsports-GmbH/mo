-- 0014_customer_accounts.sql — TIER 3: signed-in Shopify customer identity.
--
-- Adds the third identity tier to the chat (see docs/CUSTOMER_ACCOUNT.md and the
-- authoritative spike docs/CUSTOMER_ACCOUNT_SPIKE.md). This NEVER weakens the
-- existing tiers:
--   Tier 1 — anonymous: pseudonymous session_id, no customers row (unchanged).
--   Tier 2 — identified: a customers row keyed by consented email (unchanged;
--            the email-capture/DOI/consent-audit flow stays the only path to it).
--   Tier 3 — signed-in: a customers row additionally stamped with the Shopify
--            customer identity (this migration). EMAIL stays the merge key
--            between tier 2 and tier 3.
--
-- GDPR: signing in establishes IDENTITY, never marketing consent — our DOI
-- (email_captures / customers.marketing_status) stays the only path to
-- 'confirmed'. Re-keying never imports Shopify's marketing state.

-- ============================================================================
-- 1) Re-key customers with the Shopify identity (nullable: tiers 1/2 have none).
-- ============================================================================
ALTER TABLE customers
  -- The numeric extracted from the GraphQL customer.id GID — the tier-3 key.
  ADD COLUMN IF NOT EXISTS shopify_customer_id  TEXT,
  -- The canonical GID, gid://shopify/Customer/<numeric>.
  ADD COLUMN IF NOT EXISTS shopify_customer_gid TEXT,
  -- When sign-in first bound this row.
  ADD COLUMN IF NOT EXISTS shopify_linked_at    TIMESTAMPTZ,
  -- 1 anon, 2 email-identified, 3 signed-in. DEFAULT 1 per the data-model
  -- sketch; every existing customers row is backfilled to 2 below (a customers
  -- row only ever exists because an email was captured).
  ADD COLUMN IF NOT EXISTS identity_tier        SMALLINT NOT NULL DEFAULT 1;

-- One Shopify customer maps to at most one of our customer rows.
CREATE UNIQUE INDEX IF NOT EXISTS customers_shopify_customer_id_key
  ON customers (shopify_customer_id)
  WHERE shopify_customer_id IS NOT NULL;

-- Every existing customers row is a tier-2 (email-identified) customer.
UPDATE customers SET identity_tier = 2 WHERE identity_tier < 2;

-- ============================================================================
-- 2) Server-side encrypted token store (one current row per customer).
--    Tokens are encrypted at rest with TOKEN_ENC_KEY (lib/token-crypto.ts) and
--    are NEVER exposed to the browser. Refresh rotation persists the new pair
--    atomically (see lib/customer-oauth-store.ts).
-- ============================================================================
CREATE TABLE IF NOT EXISTS customer_oauth_tokens (
  customer_id        BIGINT PRIMARY KEY REFERENCES customers (id) ON DELETE CASCADE,
  access_token_enc   BYTEA NOT NULL,
  refresh_token_enc  BYTEA NOT NULL,
  -- OIDC subject (id_token.sub) — kept for cross-checking against the GID.
  id_token_sub       TEXT,
  scope              TEXT NOT NULL,
  -- Both lifetimes are read from the token response (expires_in), never hardcoded.
  access_expires_at  TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3) Short-lived pending-auth records (CSRF state + PKCE verifier + return).
--    Created on /api/auth/shopify/login, consumed (deleted) on the callback.
--    Purged past expiry by the retention cron.
-- ============================================================================
CREATE TABLE IF NOT EXISTS customer_auth_pending (
  -- The random component of the signed OAuth `state` param.
  state         TEXT PRIMARY KEY,
  -- The widget thread (localStorage session id) to re-link on return.
  session_id    TEXT NOT NULL,
  -- PKCE code_verifier (S256). Short-lived; server-side only.
  code_verifier TEXT NOT NULL,
  -- Random nonce, checked against id_token.nonce on callback.
  nonce         TEXT NOT NULL,
  -- Storefront page to send the browser back to (validated against the
  -- origin allowlist at mint AND consume time).
  return_url    TEXT NOT NULL,
  -- Whether this was a silent (prompt=none) attempt — affects the degraded
  -- redirect on error=login_required.
  prompt_none   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS customer_auth_pending_expires_idx
  ON customer_auth_pending (expires_at);

-- ============================================================================
-- 4) Merge-conflict audit log — sign-in conflicts are recorded for admin
--    review rather than silently fusing consent records (consent provenance
--    must stay auditable). See the merge rule in lib/customer-store.ts.
-- ============================================================================
CREATE TABLE IF NOT EXISTS customer_merge_conflicts (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The Shopify identity that triggered the conflict.
  shopify_customer_id  TEXT NOT NULL,
  shopify_customer_gid TEXT,
  -- Shopify's verified email (authoritative for identity).
  shopify_email        TEXT,
  -- The conflicting local row(s), if any.
  email_row_customer_id   BIGINT,
  email_row_email         TEXT,
  shopify_row_customer_id BIGINT,
  -- 'email_mismatch' (email-row email != Shopify email) or
  -- 'row_collision' (an email row AND a shopify-id row both exist).
  conflict_kind        TEXT NOT NULL,
  -- Which row sign-in ultimately bound to (Shopify email is authoritative).
  resolved_customer_id BIGINT,
  session_id           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cleared by an admin once reviewed.
  resolved_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS customer_merge_conflicts_unresolved_idx
  ON customer_merge_conflicts (created_at)
  WHERE resolved_at IS NULL;
