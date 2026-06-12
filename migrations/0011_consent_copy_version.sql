-- 0011_consent_copy_version.sql — version identifier for the consent copy a
-- capture was made under (consent copy v2 rollout).
--
-- The canonical capture-form copy changed from v1 (long labels + marketing
-- benefit hint; transactional box could render pre-checked) to v2 (shorter
-- labels, shared Art. 7 footer line, BOTH boxes start unchecked). The
-- verbatim consent_text_shown stays the byte-authoritative Art. 7 record;
-- this column adds a queryable version stamp so v1 and v2 audit records are
-- distinguishable without string-matching old copy.
--
-- Semantics (see src/lib/consent-copy-version.mjs):
--   * 'v1' / 'v2' / … — the capture's echoed consent_text_shown matched the
--     canonical copy of that version byte-for-byte at capture time. The
--     backfill below stamps every pre-existing row 'v1': v1 was the only copy
--     ever served before this migration.
--   * NULL (on rows written after this migration) — the echoed text did not
--     match the then-current canonical string (e.g. a ≤60s-stale cached copy
--     across a deploy boundary). Honest "unattested"; the stored verbatim
--     text remains authoritative.

ALTER TABLE email_captures
  ADD COLUMN IF NOT EXISTS consent_copy_version TEXT;

UPDATE email_captures
   SET consent_copy_version = 'v1'
 WHERE consent_copy_version IS NULL;
