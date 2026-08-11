-- 0042_order_attribution.sql — Mo order attribution (Cluster A, pseudonymous).
--
-- Closes the "plain cart links carry no marker" gap documented in
-- lib/kpi-revenue-store: Mo-built cart permalinks now carry an OPAQUE
-- attribution token as a Shopify cart attribute (attributes[_mo]=<token>), the
-- widget can stamp the live storefront cart with the same attribute, and the
-- orders/paid + orders/create webhooks push every Mo-marked order into
-- mo_orders. See docs/ORDER_ATTRIBUTION.md for the full design.
--
-- GDPR posture (deliberate):
--   * Both tables are Cluster A — session-keyed, pseudonymous. NO email, no
--     name, no address, no customer id is ever stored here; the webhook
--     payload's protected customer fields are read and discarded.
--   * The token is minted server-side and is opaque: nothing in the Shopify
--     admin can be joined back to a conversation without going through this
--     database.
--   * Orders WITHOUT a Mo marker (no token attribute, no Mo discount code) are
--     never stored at all (data minimisation).

-- One row per minted attribution token. session_id is the pseudonymous bridge
-- to the conversation (NULL for sessionless carriers, e.g. bundle links).
-- No CHECK on source (same future-proofing rationale as conversations.locale,
-- 0041): values come from lib/mo-orders-store's typed union.
CREATE TABLE IF NOT EXISTS mo_attribution_tokens (
  token       TEXT PRIMARY KEY,
  session_id  TEXT,
  source      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent minting: one token per (session, source) is reused on re-request.
CREATE UNIQUE INDEX IF NOT EXISTS mo_attribution_tokens_session_source_idx
  ON mo_attribution_tokens (session_id, source)
  WHERE session_id IS NOT NULL;

-- Retention purge path (tokens age out after the attribution window + grace).
CREATE INDEX IF NOT EXISTS mo_attribution_tokens_created_idx
  ON mo_attribution_tokens (created_at);

-- One row per Shopify order that carried a Mo marker (token attribute and/or a
-- Mo-minted MS5-/MK- discount code). Pseudonymous order facts only.
--   line_items      [{title, quantity, price, variantId, productId, handle}]
--                   (handle NULL when the line couldn't be matched to the
--                   catalog — see lib/order-attribution.mjs matching rules).
--   attribution_tier 'direct' | 'assisted' | 'influenced' (no CHECK — see
--                   above; snapshot at ingest time, lib/order-attribution.mjs).
--   session_id      severed (SET NULL) on GDPR erasure; the aggregate order
--                   facts stay so historic KPI totals remain truthful.
CREATE TABLE IF NOT EXISTS mo_orders (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shopify_order_id     TEXT NOT NULL UNIQUE,
  order_name           TEXT,
  processed_at         TIMESTAMPTZ,
  financial_status     TEXT,
  currency             TEXT,
  total_price          NUMERIC(12,2),
  discount_codes       TEXT[] NOT NULL DEFAULT '{}',
  line_items           JSONB NOT NULL DEFAULT '[]'::jsonb,
  attribution_token    TEXT,
  session_id           TEXT,
  attribution_source   TEXT,
  attribution_tier     TEXT,
  recommended_overlap  BOOLEAN,
  matched_handles      TEXT[] NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- KPI window scans (the dashboard aggregates by order date).
CREATE INDEX IF NOT EXISTS mo_orders_processed_idx
  ON mo_orders (processed_at);

-- Erasure severing + per-session lookups.
CREATE INDEX IF NOT EXISTS mo_orders_session_idx
  ON mo_orders (session_id)
  WHERE session_id IS NOT NULL;

-- Conversion-sweep short-circuit: "was code X redeemed?" answered from our own
-- ingested orders before any Shopify round-trip.
CREATE INDEX IF NOT EXISTS mo_orders_codes_idx
  ON mo_orders USING gin (discount_codes);
