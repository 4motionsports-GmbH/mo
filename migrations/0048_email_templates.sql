-- 0048_email_templates.sql — operator-managed email design templates ("Themes")
-- plus the per-email-type assignment, backing the admin "Einstellungen" tab.
--
-- A template parameterises the SHARED branded shell (email-template.ts): accent
-- color, the signature separator-band colors, the outer background, the font
-- stack, the CTA button shape, an optional logo override and the social-icon
-- row. It deliberately does NOT touch content: the AI-drafted prose, the legal
-- DOI/unsubscribe copy and the product data render exactly as before — only
-- the chrome around them changes.
--
-- email_template_assignments maps ONE template to each outgoing email type
-- ('summary' | 'doi' | 'marketing' | 'campaign'; correspondence is plain text
-- and the contact-form notification is internal — neither uses the shell). A
-- type without a row renders the built-in default design (today's look), and
-- deleting a template cascades its assignments away, falling back to that
-- default — a template can never be "half deleted".
--
-- Colors are stored as normalized '#rrggbb'; font_family / button_shape are
-- closed vocabularies shared with email-theme.mjs so the DB check, the API
-- validation and the UI labels can never drift apart.

CREATE TABLE IF NOT EXISTS email_templates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  accent_color TEXT NOT NULL DEFAULT '#008ccb',
  band_background TEXT NOT NULL DEFAULT '#000000',
  band_text_color TEXT NOT NULL DEFAULT '#ffffff',
  outer_background TEXT NOT NULL DEFAULT '#fafafa',
  font_family TEXT NOT NULL DEFAULT 'montserrat'
    CHECK (font_family IN ('montserrat', 'verdana', 'arial', 'helvetica', 'georgia', 'trebuchet')),
  button_shape TEXT NOT NULL DEFAULT 'pill'
    CHECK (button_shape IN ('pill', 'rounded', 'square')),
  logo_url TEXT,
  show_social BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_template_assignments (
  email_kind TEXT PRIMARY KEY
    CHECK (email_kind IN ('summary', 'doi', 'marketing', 'campaign')),
  template_id BIGINT NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_template_assignments_template_id_idx
  ON email_template_assignments (template_id);
