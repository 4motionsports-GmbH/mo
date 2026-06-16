-- 0028_admin_access_log.sql — audit trail of admin access to customer PII.
--
-- The admin dashboard exposes the full customer PII trove (emails, AI profiles,
-- purchase history, correspondence bodies, postal addresses) behind a single
-- shared password (lib/admin-auth.ts). There was no record of WHICH customer's
-- data an operator pulled. This table is that record: one row per sensitive
-- admin action (profile generation, correspondence read, §7(3) send, …),
-- written best-effort by lib/admin-access-log.ts.
--
-- "Who": the login is a single shared password (no user table), so we cannot
-- record a named human. We store a SESSION FINGERPRINT (a hash of the signed
-- session cookie — never the cookie itself) so distinct concurrent operators are
-- at least distinguishable, plus the client IP. Named-operator identity is a
-- follow-up that needs the admin-auth model to grow per-user credentials.
--
-- GDPR: this is a SECURITY/accountability record (Art. 6(1)(f), and supports
-- Art. 5(2) accountability). target_customer_id has NO foreign key on purpose —
-- the audit must survive a customer erasure (it records that an access happened,
-- not the customer's data). Purged on its own window by the retention cron
-- (ADMIN_ACCESS_LOG_RETENTION_DAYS).

CREATE TABLE IF NOT EXISTS admin_access_log (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Dotted action key, e.g. 'customer.profile.generate', 'correspondence.read',
  -- 'bestandskunde.send', 'bestandskunde.test_send'.
  action             TEXT NOT NULL,
  -- Which customer's data was accessed (internal id; no FK so the audit row
  -- survives the customer's erasure). NULL for non-customer-scoped actions.
  target_customer_id BIGINT,
  -- Small, non-sensitive context (ids, counts) — never PII bodies.
  detail             JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip                 TEXT,
  -- SHA-256 fingerprint of the admin session cookie (hex, truncated) — NOT the
  -- cookie, so the log can't be replayed into a session.
  session_fp         TEXT,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_access_log_occurred_idx
  ON admin_access_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS admin_access_log_customer_idx
  ON admin_access_log (target_customer_id)
  WHERE target_customer_id IS NOT NULL;
