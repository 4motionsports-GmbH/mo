-- 0013_bundle_offers.sql — personalized bundle offers (S10).
--
-- Replaces per-customer DISCOUNT CODES with per-customer BUNDLE OFFERS: a real
-- Shopify product (native fixed bundle, kept UNLISTED) created automatically by
-- the backend, priced at an admin-set total, linked from a marketing email and
-- archived on expiry. See docs/BUNDLES.md for the model + lifecycle and
-- docs/BUNDLES_SPIKE.md (esp. the "Probe results (S9b)" section) for the live
-- verification this is built on.
--
-- One row per generated offer. Component prices are SNAPSHOTTED at creation
-- (components JSONB carries each component's unitPrice) so the displayed
-- "statt €X" (compareAtPrice = true component sum) stays auditable even after
-- catalog prices drift — the bundle price never auto-recomputes (spike §2).
--
-- GDPR: an offer may reference a CUSTOMER (migration 0008). The FK is
-- ON DELETE SET NULL so erasing a customer keeps the offer's audit/KPI record
-- (and its Shopify order history) intact while detaching the person. Ad-hoc
-- offers carry a NULL customer_id. See docs/DATA_RETENTION.md for the window.

CREATE TABLE IF NOT EXISTS bundle_offers (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Recipient (nullable for ad-hoc offers). SET NULL on customer erasure.
  customer_id          BIGINT REFERENCES customers (id) ON DELETE SET NULL,
  -- The email send this offer rode out with, if any. SET NULL keeps the offer
  -- record if the send row is later removed.
  marketing_send_id    BIGINT REFERENCES marketing_sends (id) ON DELETE SET NULL,

  -- Snapshot of what went into the bundle at creation time. JSON array; each
  -- entry pins the catalog product + resolved Shopify variant + the component's
  -- unit price AT CREATION (the basis for the true-sum compareAtPrice). E.g.
  --   [{ "productId":"atx-foldable-...", "title":"…",
  --      "variantId":"gid://shopify/ProductVariant/123", "numericVariantId":"123",
  --      "quantity":1, "unitPrice":"149.00", "currency":"EUR" }]
  components           JSONB NOT NULL,

  -- Pricing (decimal, Money-style; currency fixed EUR by default).
  components_sum       NUMERIC(10,2) NOT NULL,  -- TRUE sum => compareAtPrice / "statt"
  bundle_price         NUMERIC(10,2) NOT NULL,  -- admin-set selling price (defaults to the sum)
  currency             TEXT NOT NULL DEFAULT 'EUR',

  -- Admin-facing / email title for the bundle product.
  title                TEXT,

  -- Shopify linkage (null until the product is created).
  shopify_product_id   TEXT,                     -- gid://shopify/Product/...
  shopify_variant_id   TEXT,                     -- parent variant gid (cart permalink source)
  numeric_variant_id   TEXT,                     -- digits only, ready for /cart/<id>:1
  shopify_handle       TEXT,                     -- product handle (direct URL)
  bundle_operation_id  TEXT,                     -- ProductBundleOperation gid (poll/audit)

  -- Which seam produced this offer (config flag BUNDLE_CREATION_MODE).
  creation_mode        TEXT NOT NULL
                         CHECK (creation_mode IN ('native_fixed_bundle', 'plain_unlisted_product')),

  -- Lifecycle: pending -> active -> expired | failed.
  --   active  == UNLISTED + published & purchasable; cart_url materialized.
  --   expired == Shopify product ARCHIVED by the daily cron.
  --   failed  == create/poll/publish error; the offer was never sent (see `error`).
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'active', 'expired', 'failed')),
  -- Recorded failure reason when status = 'failed' (for diagnosis).
  error                TEXT,

  -- The REAL materialized Shopify cart permalink (`/cart/<numericVariantId>:1`).
  -- The email CTA links to /api/r/<redirect_token>, which resolves to this (and
  -- serves a friendly "Angebot abgelaufen" page once the offer is expired).
  cart_url             TEXT,
  -- Unique, hard-to-guess token for the tracked redirect link (/api/r/<token>).
  redirect_token       TEXT UNIQUE,

  -- Lifecycle timestamps.
  expires_at           TIMESTAMPTZ NOT NULL,     -- offer deadline (e.g. created + 7d)
  archived_at          TIMESTAMPTZ,              -- set when the expiry cron archived it
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Expiry-cron sweep: active offers past their deadline.
CREATE INDEX IF NOT EXISTS bundle_offers_expiry_idx
  ON bundle_offers (status, expires_at);

-- Per-customer listing (admin UI).
CREATE INDEX IF NOT EXISTS bundle_offers_customer_idx
  ON bundle_offers (customer_id)
  WHERE customer_id IS NOT NULL;
