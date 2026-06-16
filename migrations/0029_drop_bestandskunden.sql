-- 0029_drop_bestandskunden.sql — remove the §7 Abs. 3 UWG "Bestandskunden"
-- (existing-customer marketing) feature entirely (client decision: not needed).
--
-- The feature was never live (BESTANDSKUNDE_SENDS_APPROVED stayed OFF, no
-- production send ever ran), so this drops its schema with no loss of operative
-- data:
--   * the cached eligibility columns on customers (derived from purchase history,
--     re-derivable, now unused), and
--   * the separate §7(3) objection/opt-out list.
-- The DOI marketing path (email_captures / suppression_list / marketing_sends)
-- is a DIFFERENT lawful basis and is untouched.
--
-- IF EXISTS throughout so the migration is idempotent and safe to re-run.
-- Dropping bestandskunde_eligible also drops its partial index
-- (customers_bestandskunde_idx) automatically.

ALTER TABLE customers
  DROP COLUMN IF EXISTS bestandskunde_eligible,
  DROP COLUMN IF EXISTS bestandskunde_eligible_updated_at;

DROP TABLE IF EXISTS bestandskunden_suppression_list;
