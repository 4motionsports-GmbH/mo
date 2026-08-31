-- 0049_email_design_selections.sql — CODE-BASED email designs replace the
-- DB-token templates from 0048.
--
-- Rationale: email designs are now full code modules (src/lib/email-designs/)
-- authored with Claude Code — a design defines the GENERAL template (theme
-- tokens and/or renderer overrides, up to a completely different shell
-- document) plus per-email-type tailored variants. A row of color values can't
-- express that, so the 0048 tables (email_templates + email_template_
-- assignments) are superseded before ever carrying production data and are
-- dropped here.
--
-- The database now stores ONLY the selection ("version control" pointer):
-- which registered design each email type currently uses. A type without a
-- row — or with a design_key that no code release knows anymore — renders the
-- built-in classic design. design_key is free TEXT because the design registry
-- lives in code; the store validates keys against the registry at read time.

DROP TABLE IF EXISTS email_template_assignments;
DROP TABLE IF EXISTS email_templates;

CREATE TABLE IF NOT EXISTS email_design_selections (
  email_kind TEXT PRIMARY KEY
    CHECK (email_kind IN ('summary', 'doi', 'marketing', 'campaign')),
  design_key TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
