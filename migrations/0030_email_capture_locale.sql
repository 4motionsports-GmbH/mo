-- 0030_email_capture_locale.sql — storefront language carried WITH the consent
-- record, so the language the user selected (/en vs /de) flows from capture
-- through to every later send + page for that address:
--
--   * the transactional summary email + the marketing DOI confirmation email
--     (sent at capture time — locale known from the request),
--   * the confirm-marketing + unsubscribe result pages (the links also carry
--     &locale=, but the stored value is the durable source of truth), and
--   * later marketing sends' unsubscribe footer (recipient's stored locale).
--
-- Default 'de': every pre-existing row, and any capture that doesn't send a
-- locale, stays German — byte-identical to today.

ALTER TABLE email_captures
  ADD COLUMN IF NOT EXISTS locale TEXT;

UPDATE email_captures
   SET locale = 'de'
 WHERE locale IS NULL;
