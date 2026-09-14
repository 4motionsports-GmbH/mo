-- 0057_campaign_test_contacts.sql — Testkontakte for the Kampagne desk.
--
-- Before going live (and whenever a design, a discount rule or the hero
-- pipeline changes) the operator wants to send real campaign mails to two or
-- three inboxes of their own, in every variation, without the contact
-- disappearing after the first send and without the test traffic bending the
-- KPIs. A test contact is a campaign_contacts row that
--   * is created from the desk (no Shopify customer behind it — the sync key
--     is 'test:<email>', so the audience sync never overwrites or suppresses
--     it),
--   * counts as CONFIRMED_OPT_IN so the opt-in gate passes, and is exempt
--     from the cross-channel frequency cap (the other gates — master flag,
--     suppression list, discount check — apply exactly as for a real send),
--   * returns to 'drafted' after every send instead of 'sent', keeping its
--     draft, so it can be sent again with the next variation,
--   * may borrow the purchase history of a real customer (test_source_email)
--     so the generated mail is realistic instead of a fallback draft.
-- Every send to a test contact is stamped is_test on campaign_sends and left
-- out of the Kampagnen-Funnel, the delivery strip, the overview and the
-- revenue KPI (the MK- code minted for it is real, but its redemption is not
-- campaign revenue). The „Gesendet“ view still lists test sends, badged.

ALTER TABLE campaign_contacts
  ADD COLUMN IF NOT EXISTS is_test           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS test_source_email TEXT;

ALTER TABLE campaign_sends
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS campaign_contacts_is_test_idx
  ON campaign_contacts (id) WHERE is_test;
