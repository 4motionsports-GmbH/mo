-- 0024_physical_letters_content.sql — keep the letter's CONTENT on the row.
--
-- The letter we posted is part of the customer correspondence, so it belongs in
-- the per-customer knowledge base (docs/EMAIL_SUBSYSTEM_SPIKE.md §3, same as sent
-- email). To fold it in (loadCustomerCorrespondence) and to keep an audit of
-- exactly what we printed, snapshot the subject + body onto the physical_letters
-- row at send time.

ALTER TABLE physical_letters
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS body    TEXT;
