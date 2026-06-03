-- 0002_email_capture_consent.sql — support the GDPR email-capture + double
-- opt-in (DOI) flow built on top of the Cluster B tables from 0001.
--
-- Two changes to email_captures:
--
--   1. doi_sent_at — when the current doi_token was issued. The confirmation
--      route expires tokens after a window (MARKETING_DOI_EXPIRY_DAYS) measured
--      from this timestamp, not from row creation, so a user who re-opts-in
--      later gets a fresh window rather than an instantly-expired token.
--
--   2. A UNIQUE index on email so /api/capture-email can upsert one consent
--      record per address (ON CONFLICT (email)). One person may chat in many
--      sessions; their consent state is keyed by the email, not the session.
--      Emails are normalised (trimmed + lower-cased) by the app before write.
--      The old non-unique email index is redundant once this exists.

ALTER TABLE email_captures
  ADD COLUMN IF NOT EXISTS doi_sent_at TIMESTAMPTZ;

DROP INDEX IF EXISTS email_captures_email_idx;

CREATE UNIQUE INDEX IF NOT EXISTS email_captures_email_key
  ON email_captures (email);
