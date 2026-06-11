-- 0010_customer_email_draft.sql — per-CUSTOMER marketing drafts with admin
-- special instructions.
--
-- The marketing draft is upgraded from per-capture/session to per-customer:
-- the Kunden tab can generate one email from EVERYTHING we know about a person
-- (all linked conversations, the "current understanding" profile, the Shopify
-- purchase history), and the admin can inject free-text special instructions
-- ("mention the new rowing machine line", "she asked about delivery to
-- Austria") that the generator weaves into the email.
--
-- Two storage points, deliberately split:
--
--   customers.admin_instructions       — the CURRENT editable value on the
--                                        customer; pre-fills the next draft.
--   marketing_sends.admin_instructions — the SNAPSHOT that actually went into
--                                        a specific draft, frozen on the send
--                                        row for the audit trail (the customer
--                                        value can change afterwards).
--
-- marketing_sends.customer_id records WHICH customer a draft was generated
-- from (NULL for legacy per-capture drafts and for customers deleted later —
-- SET NULL keeps the send history intact through GDPR erasure, matching the
-- conversations.customer_id behaviour from 0008).

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS admin_instructions            TEXT,
  ADD COLUMN IF NOT EXISTS admin_instructions_updated_at TIMESTAMPTZ;

ALTER TABLE marketing_sends
  ADD COLUMN IF NOT EXISTS customer_id        BIGINT REFERENCES customers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_instructions TEXT;

CREATE INDEX IF NOT EXISTS marketing_sends_customer_idx
  ON marketing_sends (customer_id)
  WHERE customer_id IS NOT NULL;
