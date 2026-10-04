-- 0075_campaign_chat_started_once.sql — „Chat gestartet“ counts once per
-- campaign send, race-free (ROLLOUT C.3).
--
-- recordCampaignChatStarted (lib/campaign-store.ts) inserts one session-less
-- kpi_events row per send when the widget reports the send's mo_c token. Its
-- NOT EXISTS check alone lets two simultaneous first turns (two tabs) both
-- insert. This partial unique index makes the second insert a no-op (the
-- insert already says ON CONFLICT DO NOTHING) and turns the per-send lookup —
-- also used by the campaign funnel — into an index scan.
--
-- Duplicates from before are removed first (the oldest row per send stays).
-- Forward-only, idempotent.

DELETE FROM kpi_events a
 USING kpi_events b
 WHERE a.event = 'campaign_chat_started'
   AND b.event = 'campaign_chat_started'
   AND a.data->>'sendId' = b.data->>'sendId'
   AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS kpi_events_campaign_chat_started_send_uidx
  ON kpi_events ((data->>'sendId'))
  WHERE event = 'campaign_chat_started';
