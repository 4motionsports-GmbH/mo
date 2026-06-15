-- 0023_customer_letter_draft.sql — a SEPARATE, editable letter draft per customer
-- (physical mail, docs/EMAIL_SUBSYSTEM_SPIKE.md §4).
--
-- The "Brief senden" flow is DISTINCT from the email draft (marketing_sends): a
-- letter is written + laid out for print (no clickable cart/unsubscribe), so its
-- text is generated and edited on its own. We keep ONE open letter draft per
-- customer here (mirrors how admin_instructions is stored on the row); on send it
-- is rendered to a PDF and submitted to Pingen, logged in physical_letters.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS letter_draft_subject    TEXT,
  ADD COLUMN IF NOT EXISTS letter_draft_body       TEXT,
  ADD COLUMN IF NOT EXISTS letter_draft_updated_at TIMESTAMPTZ;
