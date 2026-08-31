-- 0050_email_hero_images.sql — per-send AI-generated HERO images for the
-- image-first email designs (e.g. 'performance', src/lib/email-designs/).
--
-- Hero-driven designs open with a large lifestyle image. By default that is a
-- static brand asset (public/email-hero-default.jpg / EMAIL_HERO_DEFAULT_URL);
-- for the two REVIEWED email types (marketing + campaign) the operator can
-- generate a CUSTOM hero before sending: the system suggests an image prompt
-- from the draft's personal context, the operator edits it, an image model
-- renders it, the file is uploaded to Vercel Blob, and its public URL is
-- stored HERE on the draft row — so preview and send show the same image and
-- the audit trail keeps prompt + image together with the draft.
--
-- Both columns are nullable and additive: NULL = default hero. Designs without
-- a hero section (e.g. 'classic') ignore these columns entirely.

ALTER TABLE marketing_sends
  ADD COLUMN IF NOT EXISTS hero_image_url TEXT,
  ADD COLUMN IF NOT EXISTS hero_image_prompt TEXT;

ALTER TABLE campaign_drafts
  ADD COLUMN IF NOT EXISTS hero_image_url TEXT,
  ADD COLUMN IF NOT EXISTS hero_image_prompt TEXT;
