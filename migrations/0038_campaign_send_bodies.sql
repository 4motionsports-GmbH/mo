-- 0038_campaign_send_bodies.sql — store the SHIPPED campaign email content on
-- the immutable send record, so the admin can open exactly what a recipient
-- received from the Kampagne tab's "Gesendet" view.
--
-- body_hash (0034) proves WHAT was sent; these columns additionally RETAIN it:
--   * body_text — the text part as shipped (real MK- code already swapped in);
--     for sent_via='copy' rows this is the prose the operator copied out.
--   * body_html — the full branded HTML part as shipped (system sends only;
--     NULL for copy rows — nothing HTML was delivered on that path).
-- Rows remain append-only (no UPDATE path exists); sends recorded before this
-- migration keep NULLs and the UI says no content was stored.

ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS body_text TEXT;
ALTER TABLE campaign_sends ADD COLUMN IF NOT EXISTS body_html TEXT;
