-- 0040_campaign_contact_language_override.sql — operator override for the
-- campaign email language.
--
-- `campaign_contacts.language` is DERIVED from the Shopify profile on every
-- sync (locale → country → 'de' fallback, campaign-language.mjs) and is
-- overwritten by each sync pass. When the derivation is wrong for a person
-- (e.g. a German customer whose browser locale was English at checkout), the
-- operator can pin the language in the Kampagne tab; the override lives in its
-- OWN column so a re-sync can never clobber it. NULL = no override (derived
-- value applies). The effective language (override ?? derived) is computed in
-- campaign-store.ts and drives draft generation AND the send-time rendering.

ALTER TABLE campaign_contacts
  ADD COLUMN IF NOT EXISTS language_override TEXT
    CHECK (language_override IN ('de','en'));
