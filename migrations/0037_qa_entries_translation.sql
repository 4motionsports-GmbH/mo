-- 0037_qa_entries_translation.sql — Q&A i18n (docs/QA_KNOWLEDGE.md):
-- the storefront runs German AND English, but the team writes answers in
-- German only. At publish time the backend auto-translates the pair once
-- (cheap Haiku pass, call site 'qa_translate') and stores the English
-- alongside, so the metafield carries {q, a, q_en, a_en} and the theme picks
-- the storefront language. These columns cache the translation on the entry:
--   - filled automatically at publish when empty,
--   - editable by the operator in the Wissen tab (override), where clearing
--     them forces a fresh auto-translation on the next publish.

ALTER TABLE qa_entries
  ADD COLUMN IF NOT EXISTS question_en TEXT,
  ADD COLUMN IF NOT EXISTS answer_en   TEXT;
