-- 0019_customer_session_links.sql — a DIRECT, durable session_id ↔ customer link.
--
-- THE BUG this fixes: tier-3 sign-in re-hydration never reached the widget.
-- The session_id ↔ customer link was only ever recorded INDIRECTLY, by stamping
-- `conversations.customer_id` (bindShopifyIdentity / linkCustomerOnEmailCapture):
--
--     UPDATE conversations SET customer_id = $c WHERE session_id = $sid
--
-- and read back INDIRECTLY by resolveSignedInCustomer JOINing through
-- `conversations`. That only works when a conversation row ALREADY EXISTS for the
-- session. But the common sign-in paths run with NO conversation yet:
--   * the prompt=none silent check on first widget open (before any chat), and
--   * clicking "Anmelden" on the on-open card before sending a message.
-- In those cases the UPDATE matches ZERO rows, so the link is silently dropped —
-- the customers row + tokens ARE persisted (the admin shows the login email), but
-- /api/auth/me and every /api/account/* call resolve to NOTHING and fail closed.
-- The widget never flips to signed-in and the history drawer never appears.
--
-- The fix: persist the link DIRECTLY here, independent of any conversation row,
-- written on every identity bind and read first by resolveSignedInCustomer. The
-- conversation attach stays (it carries the chat into the customer's history); it
-- is just no longer the carrier of IDENTITY.
--
-- GDPR / fail-closed: this is a pure identity convenience link. ON DELETE CASCADE
-- means /api/account/erase (which deletes the customers row) wipes the links too;
-- and resolution still proves liveness via getValidAccessToken, so a logged-out
-- or erased session resolves to signedIn:false even if a stale link survived.

CREATE TABLE IF NOT EXISTS customer_session_links (
  -- The widget's stable localStorage session id (the opaque identity reference).
  session_id   TEXT PRIMARY KEY,
  -- The customer this session belongs to. CASCADE so erasure wipes the link.
  customer_id  BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Resolve "which sessions belong to this customer" (erase / cross-device reads).
CREATE INDEX IF NOT EXISTS customer_session_links_customer_idx
  ON customer_session_links (customer_id);

-- Backfill the link from existing conversation stamps so already-linked sessions
-- keep resolving after deploy. NEWEST stamp wins on duplicate session ids (a
-- session is non-unique in conversations since migration 0018).
INSERT INTO customer_session_links (session_id, customer_id, linked_at, last_seen_at)
SELECT DISTINCT ON (co.session_id)
       co.session_id, co.customer_id, now(), now()
  FROM conversations co
 WHERE co.customer_id IS NOT NULL
 ORDER BY co.session_id, co.id DESC
ON CONFLICT (session_id) DO NOTHING;
