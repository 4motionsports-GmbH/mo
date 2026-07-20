-- 0035_campaign_bundles.sql — bundle offers for the CAMPAIGN channel
-- (docs/CAMPAIGNS.md §4; closes the "bundles as a documented TODO" left by
-- migration 0034 / round R12).
--
-- A campaign email may carry a personalised bundle offer as an alternative (or
-- addition) to a plain percentage code — the SAME bundle_offers mechanism the
-- Kunden marketing flow uses (migration 0013, docs/BUNDLES.md): a real
-- UNLISTED Shopify product with snapshotted component prices, a tracked
-- /api/r/<token> link, and archive-on-expiry via the existing cron. bundle_offers
-- stays the ONE offers table; the campaign link is an additional nullable FK,
-- exactly parallel to customer_id / marketing_send_id.
--
-- ON DELETE SET NULL: when a campaign contact is purged by retention, the offer
-- row is detached (never cascade-deleted) — its lifecycle stays governed by the
-- expiry cron, mirroring how customer erasure keeps the de-identified offer row.

ALTER TABLE bundle_offers
  ADD COLUMN IF NOT EXISTS campaign_contact_id BIGINT
    REFERENCES campaign_contacts (id) ON DELETE SET NULL;

-- Card lookup: the active offer attached to a campaign contact.
CREATE INDEX IF NOT EXISTS bundle_offers_campaign_contact_idx
  ON bundle_offers (campaign_contact_id)
  WHERE campaign_contact_id IS NOT NULL;
