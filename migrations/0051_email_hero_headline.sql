-- 0051_email_hero_headline.sql — per-send AI-drafted HERO HEADLINE for the
-- image-first email designs (docs/EMAIL_DESIGNS.md).
--
-- The hero of the 'performance' design opens with a short two-line claim
-- ("Mehr Leistung. / Mehr Fokus."). By default that claim is a fixed
-- per-email-type line in the design; for the two REVIEWED types (marketing +
-- campaign) the operator can let the AI draft a claim tailored to THIS email
-- (same panel as the hero image), edit it, and store it here next to the
-- image prompt — so preview and send show the same headline.
--
-- NULL = the design's own per-type default. Designs without a hero ignore it.

ALTER TABLE marketing_sends
  ADD COLUMN IF NOT EXISTS hero_headline TEXT;

ALTER TABLE campaign_drafts
  ADD COLUMN IF NOT EXISTS hero_headline TEXT;
