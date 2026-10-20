-- 0079 — Kampagnenbild: per-campaign default hero (Kampagnen-Editor → Gestaltung).
-- campaigns.hero_image NULL = no campaign picture (design default hero is used).
-- Otherwise {"v":1,"file","mobileFile","ai","name","width","height","uploadedAt"}:
-- blob FILE NAMES under email-heroes/ (served by /api/email-hero-image/<file>);
-- the public URL is built at render time (follows PUBLIC_BASE_URL). Shape is
-- validated in code (campaign-hero.mjs normalizeCampaignHeroImage).
--
-- Precedence in a mail: the per-draft AI hero, then this picture, then the
-- design's default asset — under every hero_mode („Kein KI-Titelbild“ drops
-- only the AI hero). The blob files are never deleted: replacing or removing
-- the picture only changes this column, because sent mails reference them.
--
-- Run BEFORE deploying the code that reads it: the campaign create / update
-- statements name the column. Additive and backward compatible — older code
-- ignores the column and the widened CHECK still accepts every old value.
-- Configuration, not data: `npm run db:reset` keeps campaigns. No backfill.
-- Forward-only, idempotent.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS hero_image JSONB
    CHECK (hero_image IS NULL OR jsonb_typeof(hero_image) = 'object');

-- campaign_sends.hero_variant gains 'campaign' (the mail showed the Kampagnenbild).
-- 0054 declared the CHECK inline on ADD COLUMN, so Postgres named it
-- campaign_sends_hero_variant_check (<table>_<column>_check); no later
-- migration touched it. DROP … IF EXISTS keeps a re-run harmless.
ALTER TABLE campaign_sends DROP CONSTRAINT IF EXISTS campaign_sends_hero_variant_check;
ALTER TABLE campaign_sends ADD CONSTRAINT campaign_sends_hero_variant_check
  CHECK (hero_variant IS NULL OR hero_variant IN ('ai', 'default', 'campaign', 'none'));
