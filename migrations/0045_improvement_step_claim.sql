-- 0045_improvement_step_claim.sql — make improvement-run stepping safe to
-- retry (docs/IMPROVEMENT_LOOP.md).
--
-- Why: a /step request carries one long model call. Browsers abort in-flight
-- requests on a local network change (Chrome net::ERR_NETWORK_CHANGED — seen
-- in production), while the serverless function keeps processing. The client
-- must therefore RETRY dropped requests — but a blind retry could start a
-- SECOND model call for the same phase while the first is still running
-- (duplicate spend, duplicate suggestions, racing phase transitions).
--
-- Fix: an atomic per-run step claim. stepImprovementRun claims the run
-- (step_claimed_at) before doing model work; a concurrent /step sees the live
-- claim and returns "busy" instead of starting work, so the client can poll
-- and continue safely. Every step-finishing update clears the claim; a stale
-- claim (crashed function) expires after 6 minutes — comfortably above the
-- step route's maxDuration of 300s.

ALTER TABLE improvement_runs
  ADD COLUMN IF NOT EXISTS step_claimed_at TIMESTAMPTZ;
