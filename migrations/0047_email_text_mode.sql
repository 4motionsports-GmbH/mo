-- 0047_email_text_mode.sql — operator-selected text mode for the AI-drafted
-- marketing + campaign emails.
--
-- The rendered email carries the message visually (product rows with image,
-- name, price and a personalised description) — the text mode controls how much
-- PROSE the model writes above them:
--   'detailed' — the classic long-form email (3–5 short paragraphs),
--   'compact'  — short greeting + 2–3 sentences (default for new drafts),
--   'minimal'  — greeting + one lead-in sentence (visual lookbook).
--
-- Persisted on the draft row (like discount_percent / admin_instructions) so
-- preview, regenerate and the audit trail always agree on how the visible text
-- was generated. NULL = legacy draft from before this column existed — those
-- were all generated long-form, so NULL reads as 'detailed'
-- (email-text-mode.mjs storedTextMode).

ALTER TABLE marketing_sends
  ADD COLUMN IF NOT EXISTS text_mode TEXT
    CHECK (text_mode IN ('detailed', 'compact', 'minimal'));

ALTER TABLE campaign_drafts
  ADD COLUMN IF NOT EXISTS text_mode TEXT
    CHECK (text_mode IN ('detailed', 'compact', 'minimal'));
