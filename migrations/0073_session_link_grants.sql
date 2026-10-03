-- 0073_session_link_grants.sql — a sign-in links the widget session only when
-- THAT widget redeems a one-time code.
--
-- Until now the Customer Account callback and the App Proxy (whoami) linked
-- the session id they were GIVEN IN THE URL (login?session=…, whoami?session=…)
-- as signed in. A stranger could send a shop customer who is logged in to the
-- shop a link carrying the stranger's own session id: the silent sign-in
-- (prompt=none) or the whoami call then bound the customer's account to the
-- stranger's session — and with it /api/account/* (history, export, erase)
-- and the signed-in chat context.
--
-- Now both only mint a grant: a random code (stored as its SHA-256 hash only)
-- for the session that started the sign-in, valid for a few minutes, usable
-- once. The code reaches only the browser that completed the sign-in (the
-- redirect back to the shop, or the same-origin whoami response); the widget
-- redeems it with its own x-ms-session at POST /api/auth/link, and the link is
-- written only when that session is the one the grant names.
--
-- Rows expire after minutes and are purged by the retention cron; a person's
-- erasure deletes them with the customers row (ON DELETE CASCADE).
-- Forward-only; the runner applies it once (the UPDATE below is a one-time cut-over).

CREATE TABLE IF NOT EXISTS customer_link_grants (
  code_hash   TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  link_kind   TEXT NOT NULL CHECK (link_kind IN ('customer_account', 'app_proxy')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS customer_link_grants_expires_idx
  ON customer_link_grants (expires_at);

-- Links written by the old flow cannot be told apart from links a stranger
-- planted that way: they stop counting as signed in (like 0071's 'legacy'
-- rows). Affected customers sign in once more, through the code.
UPDATE customer_session_links
   SET link_kind = 'legacy'
 WHERE link_kind IN ('customer_account', 'app_proxy');
