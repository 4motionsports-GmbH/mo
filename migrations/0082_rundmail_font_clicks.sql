-- 0082: Rundmails released before 2026-11-11 froze the Google-Fonts stylesheet
-- of the mail's head as a tracked link (usually link 0), so every mail client
-- that loads web fonts (Apple Mail, iOS) was recorded as a click. Since then
-- only click targets are tracked (freezeLinks / rewriteLinkHrefs), a hit on
-- such an old link records nothing (recordCampaignClick) and the Rundmail
-- statistics leave it out (getMailingStats). This corrects the stored data,
-- so every other figure built on clicks (customer facts „zuletzt geklickt“,
-- audience filters, engaged-first order, campaign click rates, KPI funnel)
-- is right too:
--   1. a send with a recorded click on a web-font link gets the time of its
--      first REAL click as clicked_at — or none, when it has no real click;
--   2. the click events on web-font links are deleted.
-- Idempotent: a second run finds nothing. Data only, no schema change.

UPDATE campaign_sends s
   SET clicked_at = (
         SELECT min(e.created_at)
           FROM kpi_events e
           LEFT JOIN campaign_mailings m ON e.data->>'campaignId' = m.campaign_id::text
          WHERE e.event = 'campaign_email_clicked'
            AND e.data->>'sendId' = s.id::text
            AND COALESCE((m.links -> ((e.data->>'link')::int) ->> 'url') ~* '^https?://fonts\.(googleapis|gstatic)\.com/', false) = false
       )
 WHERE s.clicked_at IS NOT NULL
   AND EXISTS (
         SELECT 1
           FROM kpi_events e
           JOIN campaign_mailings m ON e.data->>'campaignId' = m.campaign_id::text
          WHERE e.event = 'campaign_email_clicked'
            AND e.data->>'sendId' = s.id::text
            AND (m.links -> ((e.data->>'link')::int) ->> 'url') ~* '^https?://fonts\.(googleapis|gstatic)\.com/'
       );

DELETE FROM kpi_events e
 USING campaign_mailings m
 WHERE e.event = 'campaign_email_clicked'
   AND e.data ? 'link'
   AND e.data->>'campaignId' = m.campaign_id::text
   AND (m.links -> ((e.data->>'link')::int) ->> 'url') ~* '^https?://fonts\.(googleapis|gstatic)\.com/';
