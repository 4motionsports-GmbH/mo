-- 0041_kpi_coverage.sql — KPI coverage round: campaign click tracking +
-- conversation language dimension.
--
-- 1. campaign_sends click tracking — parity with marketing_sends (0006).
--    Campaign emails' main CTA (the Mo-promo deep link) now routes through the
--    tracked redirect /api/r/<token>, exactly like the marketing channel's cart
--    link, so the Kampagnen-Funnel (gesendet → geklickt → eingelöst) becomes
--    measurable. Same GDPR posture as 0006: a click on a link the user CHOSE
--    to click; deliberately still NO open-tracking pixel.
--    Nullable — 'copy' sends and rows recorded before this migration have no
--    token and simply never count as clicked.
ALTER TABLE campaign_sends
  ADD COLUMN IF NOT EXISTS redirect_token TEXT,
  ADD COLUMN IF NOT EXISTS clicked_at     TIMESTAMPTZ;

-- Token lookup on the redirect hot path (unique: one token = one send).
CREATE UNIQUE INDEX IF NOT EXISTS campaign_sends_redirect_token_idx
  ON campaign_sends (redirect_token)
  WHERE redirect_token IS NOT NULL;

-- 2. conversations.locale — the storefront-selected chat language ('de'/'en',
--    lib/locale). Stamped by persistTurn on every turn (latest wins), so the
--    KPI tab can split consultations by language. Pseudonymous Cluster-A data
--    (a UI preference, not an identifier); NULL for conversations persisted
--    before this migration ("unbekannt" in the dashboard). No CHECK constraint:
--    the value comes through resolveLocale (already clamped to the supported
--    set) and a future locale must not break inserts.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS locale TEXT;
