-- 0071_session_link_kind.sql — HOW a widget session was linked to a customer.
--
-- customer_session_links (0019) recorded only session → customer. Both a typed
-- e-mail (/api/capture-email, /api/chat-marketing-opt-in: no proof of mailbox
-- ownership) and a verified Shopify sign-in wrote the same row, and the
-- signed-in check (resolveSignedInCustomerRow) only asked whether the linked
-- customer has a shopify_customer_id. Since the customer mirror gives every
-- shop customer that id, a session that merely TYPED the e-mail of a customer
-- with a live sign-in token anywhere resolved as that customer's signed-in
-- session (/api/account/*, /api/auth/me, chat memory).
--
-- link_kind records the proof behind the link:
--   email             typed e-mail (tier 2) — never counts as signed in
--   customer_account  Customer Account OAuth in THIS session (tier 3)
--   app_proxy         the shop's App Proxy (HMAC-signed logged_in_customer_id)
--   legacy            rows from before this migration — not signed in; the
--                     customer signs in once more (fail closed)
-- authenticated_at   when the signed-in proof was recorded.
--
-- Forward-only, idempotent. Safe while the old code runs (it ignores the column;
-- its rows get the default).

ALTER TABLE customer_session_links
  ADD COLUMN IF NOT EXISTS link_kind TEXT NOT NULL DEFAULT 'legacy'
    CHECK (link_kind IN ('email', 'customer_account', 'app_proxy', 'legacy'));

ALTER TABLE customer_session_links
  ADD COLUMN IF NOT EXISTS authenticated_at TIMESTAMPTZ;
