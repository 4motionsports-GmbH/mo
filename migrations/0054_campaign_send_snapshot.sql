-- 0054_campaign_send_snapshot.sql — what a campaign mail LOOKED LIKE when it
-- left, stamped on the immutable send row, plus the outcome signals the KPI
-- tab could not attribute before.
--
-- Everything that shapes a campaign mail (design, hero image, headline, text
-- mode, discount, attached set) lived only on campaign_drafts — a row that is
-- overwritten on every regenerate and cascade-deleted with the contact. So
-- the one question that decides whether the AI hero pipeline is worth its
-- cost — "did mails with a custom hero perform better?" — could not be
-- answered from the send history. Like 0052 did for `segment`, this stamps the
-- snapshot at SEND time.
--
--   hero_variant   'ai'      = a per-contact AI-generated hero was in the mail
--                  'default' = a hero design with the default asset
--                  'none'    = a design without a hero (classic) / copy path
--   design_key     the e-mail design that rendered the mail ('performance', …)
--   bundle_offer_id the set offer that rode along (bundle_offers.id)
--
-- Outcome columns filled later, all first-event-only like clicked_at:
--   bundle_clicked_at  the set's "Zur Kasse" link was clicked (api/r)
--   unsubscribed_at    the recipient unsubscribed within 30 days of the send
--
-- ai_usage.campaign_contact_id links hero-generation cost to the contact (no
-- FK on purpose — cost history must survive a contact purge), so cost per
-- hero variant becomes computable. feedback.rating / email_kind make the
-- one-click e-mail ratings a queryable number instead of a German sentence.

ALTER TABLE campaign_sends
  ADD COLUMN IF NOT EXISTS design_key        TEXT,
  ADD COLUMN IF NOT EXISTS hero_variant      TEXT
    CHECK (hero_variant IS NULL OR hero_variant IN ('ai', 'default', 'none')),
  ADD COLUMN IF NOT EXISTS hero_image_url    TEXT,
  ADD COLUMN IF NOT EXISTS hero_headline     TEXT,
  ADD COLUMN IF NOT EXISTS text_mode         TEXT,
  ADD COLUMN IF NOT EXISTS language          TEXT,
  ADD COLUMN IF NOT EXISTS discount_percent  INTEGER,
  ADD COLUMN IF NOT EXISTS bundle_offer_id   BIGINT REFERENCES bundle_offers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bundle_clicked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unsubscribed_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS campaign_sends_hero_variant_idx
  ON campaign_sends (hero_variant, sent_at DESC);
CREATE INDEX IF NOT EXISTS campaign_sends_bundle_offer_idx
  ON campaign_sends (bundle_offer_id) WHERE bundle_offer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaign_sends_email_sent_idx
  ON campaign_sends (email, sent_at DESC);

ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS campaign_contact_id BIGINT;
CREATE INDEX IF NOT EXISTS ai_usage_campaign_contact_idx
  ON ai_usage (campaign_contact_id) WHERE campaign_contact_id IS NOT NULL;

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS rating     SMALLINT CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  ADD COLUMN IF NOT EXISTS email_kind TEXT;
CREATE INDEX IF NOT EXISTS feedback_email_kind_idx
  ON feedback (email_kind, created_at DESC) WHERE email_kind IS NOT NULL;
