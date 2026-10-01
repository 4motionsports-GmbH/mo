-- 0069_campaign_manual_recipients.sql — a person put into a campaign by hand
-- stays in it.
--
-- addRecipient (Kunden „Zur Kampagne…“, the Einzelansprache, an accepted
-- Eingang item) marks the row; the nightly refresh of a dynamic audience then
-- leaves it alone instead of excluding it as „passt nicht mehr zur
-- Zielgruppe“. Consent and blocks are still re-checked for every row.
--
-- Forward-only, idempotent. Existing rows keep `false`.

ALTER TABLE campaign_contacts
  ADD COLUMN IF NOT EXISTS added_manually BOOLEAN NOT NULL DEFAULT false;
