-- 0052_campaign_lifecycle_segments.sql — lifecycle segmentation for campaign
-- e-mails (docs/REPURCHASE_ANALYSIS.md).
--
-- The segment a contact is in decides WHAT the mail recommends: accessories to
-- what they already own ("Ausbauen"), a similar product once accessory
-- relevance has decayed ("Weiterentwickeln"), or broad picks for a win-back.
-- The boundaries are measured, not assumed — see src/lib/campaign-segments.mjs.
--
-- Three additions:
--
--   1. campaign_contacts.last_order_at — the contact's most recent order date,
--      synced from Shopify. Until now the purchase date was only known at DRAFT
--      time (read per contact from Shopify), so the review queue could neither
--      be filtered nor prioritised by lifecycle. NULL = unknown (never ordered,
--      or not yet synced) — the contact then behaves exactly as before.
--
--   2. campaign_drafts.segment / segment_days — the segment the draft was
--      written for, so the review card can show it and a regenerate keeps the
--      same framing. segment_days is the age in days at draft time, kept for
--      the review card and for spotting a draft that has gone stale.
--
--   3. campaign_sends.segment — the segment stamped at SEND time. This is the
--      measurability hook: without it there is no way to ever answer "did the
--      accessory strategy actually beat similarity", and the history cannot be
--      reconstructed afterwards. NULL = sent before this migration.
--
-- segment is free TEXT, deliberately: the segment catalogue lives in code
-- (campaign-segments.mjs) and a rename there must not require a migration. The
-- readers all fail soft on an unknown value.

ALTER TABLE campaign_contacts
  ADD COLUMN IF NOT EXISTS last_order_at TIMESTAMPTZ;

ALTER TABLE campaign_drafts
  ADD COLUMN IF NOT EXISTS segment      TEXT,
  ADD COLUMN IF NOT EXISTS segment_days INTEGER;

ALTER TABLE campaign_sends
  ADD COLUMN IF NOT EXISTS segment TEXT;

-- The review queue is worked newest-purchase-first within a status, so the
-- lifecycle sort has an index behind it.
CREATE INDEX IF NOT EXISTS campaign_contacts_last_order_idx
  ON campaign_contacts (status, last_order_at DESC NULLS LAST);

-- Reading the funnel per segment is the whole point of stamping it.
CREATE INDEX IF NOT EXISTS campaign_sends_segment_idx
  ON campaign_sends (segment, sent_at DESC);
