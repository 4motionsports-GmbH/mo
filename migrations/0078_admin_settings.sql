-- 0078_admin_settings.sql — operator settings the admin edits in Einstellungen.
--
-- A generic key/value store for configuration that the operator changes in the
-- dashboard (not in the deployment's environment). One row per setting, the
-- value as JSONB so a setting can carry several fields; the store parses and
-- clamps every value at read time (an unknown or broken value falls back to
-- the code default), so the table never needs a CHECK per key.
--
-- First key — 'contact_frequency' {maxMails, windowDays}: the soft
-- contact-frequency warning on the Kampagne desk and in Kunden → Marketing
-- (lib/contact-frequency.mjs, docs/CAMPAIGNS.md §3). Without a row the code
-- default applies (3 marketing mails in 30 days); 0 in either field switches
-- the warning off. It is a warning only — never a send gate, and different
-- from the hard cap MARKETING_MIN_SEND_INTERVAL_DAYS.
--
-- Until this migration runs, reads fall back to the defaults and saving in
-- Einstellungen answers „Migration 0078 fehlt — bitte zuerst ausführen.“
-- Configuration, not data: `npm run db:reset` keeps it (db-reset-plan.mjs).
-- Forward-only, idempotent.

CREATE TABLE IF NOT EXISTS admin_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
