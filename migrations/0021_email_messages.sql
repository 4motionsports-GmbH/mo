-- 0021_email_messages.sql — the UNIFIED mail log (Round 10D items 7+8).
--
-- One append-only union log of all email, BOTH directions, mapped to a customer
-- where we can. It backs the inbound webhook (/api/inbound/resend), the
-- mirror-write on every send site, and (later) the per-customer "Korrespondenz"
-- thread view + the KB correspondence block. See docs/EMAIL_SUBSYSTEM_SPIKE.md.
--
-- LAWFUL BASIS — its OWN category: Korrespondenz (contract / legitimate
-- interest, Art. 6(1)(b)/(f)), DISTINCT from marketing consent. It lives in
-- Cluster B (it is identified by email / linked to a customer) but is NEVER
-- fused into the DOI / §7(3) eligibility gates. The consent gates
-- (canSendMarketing, loadEligibleCapture) do not read this table.
--
-- The spike sketched this as migration 0020; 0020 was taken by 0020_feedback.sql
-- before this shipped, so it lands as the next free number (0021). The shape is
-- exactly the spike sketch.

CREATE TABLE IF NOT EXISTS email_messages (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The person this mail belongs to. SET NULL on customer erasure so deleting a
  -- customer never orphan-cascades the audit row away unexpectedly — retention
  -- purges correspondence on its own schedule (see DATA_RETENTION). NULL also =
  -- the "unmatched inbound" queue (reply from an unknown address).
  customer_id         BIGINT REFERENCES customers (id) ON DELETE SET NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('sent','received')),
  channel             TEXT NOT NULL DEFAULT 'email'
                        CHECK (channel IN ('email')),       -- physical = own table, §4
  -- RFC-5322 identity + threading.
  message_id          TEXT,            -- our/their Message-ID header (unique per msg)
  in_reply_to         TEXT,            -- In-Reply-To header
  references_ids      TEXT[] NOT NULL DEFAULT '{}',  -- References header chain
  thread_id           TEXT,            -- derived root id; groups the conversation
  -- Envelope + content.
  from_address        TEXT NOT NULL,
  to_address          TEXT NOT NULL,
  subject             TEXT,
  body_text           TEXT,
  body_html           TEXT,
  snippet             TEXT,            -- first ~200 chars, for list rendering
  -- Attachments: METADATA ONLY (filename, content_type, size, provider ref).
  -- Blobs are NOT stored here; fetch on demand from the provider, or, if we ever
  -- need durability, push to Vercel Blob (already a dependency) and store the URL.
  attachments         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Provenance / refetch handles.
  provider            TEXT NOT NULL DEFAULT 'resend',
  provider_email_id   TEXT,            -- Resend data.email_id, to refetch body/attachments
  -- Link to the marketing workflow row when this 'sent' mail was a campaign send.
  -- marketing_sends stays a WORKFLOW table — we LINK to it, never reshape it.
  -- NULL for transactional/manual/inbound mail.
  marketing_send_id   BIGINT REFERENCES marketing_sends (id) ON DELETE SET NULL,
  occurred_at         TIMESTAMPTZ NOT NULL,  -- sent_at or received_at
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_messages_customer_idx ON email_messages (customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_thread_idx   ON email_messages (thread_id);
-- Inbound dedup: a webhook re-delivery (or a retry) carrying the same RFC-5322
-- Message-ID can never create a second row. Partial so the many 'sent' rows we
-- might write without a header don't collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_msgid_idx
  ON email_messages (message_id) WHERE message_id IS NOT NULL;
