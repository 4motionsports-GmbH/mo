-- 0055_campaign_send_delivery.sql — delivery outcome per campaign send.
--
-- Resend reports what happened to a mail after we handed it over — delivered,
-- bounced (hard/soft), complained (spam button) — through webhooks
-- (api/webhooks/resend, and the inbound route accepts the same events). To
-- attach those reports to the send they belong to, the send row now keeps
-- Resend's message id (provider_email_id); an event without a known id falls
-- back to the newest send to that address within the last 7 days.
--
-- Hard bounces and complaints also land the address on suppression_list
-- (reason 'bounce' / 'complaint' — the reasons 0001 planned for), so the
-- campaign gate refuses the next send to it.

ALTER TABLE campaign_sends
  ADD COLUMN IF NOT EXISTS provider_email_id TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounced_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounce_type       TEXT
    CHECK (bounce_type IS NULL OR bounce_type IN ('hard', 'soft')),
  ADD COLUMN IF NOT EXISTS complained_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS campaign_sends_provider_email_idx
  ON campaign_sends (provider_email_id) WHERE provider_email_id IS NOT NULL;
