-- 0053_email_hero_mobile.sql — a MOBILE variant of the per-send hero image.
--
-- On desktop the hero is a full-bleed background (the headline sits on its
-- calm left part, the products on the right). On phones the design drops the
-- background and shows the picture as its own row UNDER the text — where the
-- empty left part is wasted space. generateHeroImage (lib/email-hero.ts)
-- therefore stores TWO files per render: the desktop image (with the
-- legibility gradient) and a right-side crop of the same scene for phones
-- (products only, no gradient). This column holds the mobile crop's URL.
--
-- Nullable and additive: NULL = use the desktop image on phones too (the
-- behaviour for every hero generated before this migration).

ALTER TABLE marketing_sends
  ADD COLUMN IF NOT EXISTS hero_image_mobile_url TEXT;

ALTER TABLE campaign_drafts
  ADD COLUMN IF NOT EXISTS hero_image_mobile_url TEXT;
