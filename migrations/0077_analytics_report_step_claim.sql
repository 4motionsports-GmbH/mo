-- 0077_analytics_report_step_claim.sql — make Komplettanalyse stepping safe to
-- retry (docs/ADMIN_DASHBOARD.md §3.8), the same claim the improvement runs
-- got in 0045.
--
-- Why: the decision passes of the report run on the strategist tier (Opus 5.5,
-- effort high) and one /step can now carry a model call of several minutes.
-- When the browser drops that request (network change, sleep), useStepLoop
-- retries while the serverless function is still working — without a claim the
-- retry would start a SECOND Opus call for the same phase (double spend,
-- racing phase transitions).
--
-- Fix: stepReport claims the report (step_claimed_at) before doing work; a
-- concurrent /step sees the live claim and answers "busy" (the client polls).
-- The step releases the claim when it ends; a stale claim (crashed function)
-- expires after 6 minutes — above the step route's maxDuration of 300 s.
-- Until this migration runs the claim fails open (today's behaviour).

ALTER TABLE analytics_reports
  ADD COLUMN IF NOT EXISTS step_claimed_at TIMESTAMPTZ;
