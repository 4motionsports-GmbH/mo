-- 0072_campaign_release.sql — „Freigeben": approve a reviewed campaign mail now,
-- send it later (docs/CAMPAIGNS.md §5, KAMPAGNE_REDESIGN.md §9).
--
-- An approved mail stays status 'drafted' (so every existing list of open
-- statuses — opt-out, consent loss, counts — keeps treating it as open and can
-- still cancel it) and carries:
--   approved_at           when a person approved it on the review desk
--   release_at            from when the release job may send it
--   approved_fingerprint  what was approved (draft + campaign version); a change
--                         after the approval holds the mail for a new review
--   release_error         why a release was held back (shown on the card)
--   claimed_at            when a send claimed the row ('sending'); lets the
--                         release job recover rows stuck by a timeout
-- The release job (/api/cron/release-campaign-mails) sends through the one
-- delivery path, approveAndSendCampaign, so every legal gate runs at send time.
--
-- Forward-only, idempotent.

ALTER TABLE campaign_contacts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE campaign_contacts ADD COLUMN IF NOT EXISTS release_at TIMESTAMPTZ;
ALTER TABLE campaign_contacts ADD COLUMN IF NOT EXISTS approved_fingerprint TEXT;
ALTER TABLE campaign_contacts ADD COLUMN IF NOT EXISTS release_error TEXT;
ALTER TABLE campaign_contacts ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS campaign_contacts_release_idx
  ON campaign_contacts (release_at, id)
  WHERE approved_at IS NOT NULL AND status = 'drafted';
