-- 0006_marketing_sends_click_tracking.sql — click-tracking for sent marketing
-- emails.
--
-- The marketing email's cart link currently points DIRECTLY at the Shopify
-- prefilled cart (…/cart/…?discount=CODE), so that click goes straight to
-- Shopify and is invisible to our backend / the KPI dashboard. We now route the
-- click through a lightweight redirect endpoint (GET /api/r/<token>) that logs
-- it and forwards to the real cart. Two new columns back that:
--
--   redirect_token — a unique, hard-to-guess token minted at APPROVE & SEND time
--                    and embedded in the email link as /api/r/<token>. The REAL
--                    Shopify cart URL (cart_url, carrying ?discount=CODE) stays
--                    server-side and is only revealed via the redirect. Unique so
--                    a token resolves to exactly one send.
--   clicked_at     — timestamp of the FIRST click on that link. Set once; repeat
--                    clicks leave it unchanged (and must never error). NULL = not
--                    yet clicked.
--
-- GDPR: this records a click on a link the user CHOSE to click — not covert
-- surveillance, and deliberately NO open-tracking pixel. Cluster B
-- (consent / marketing) data.

ALTER TABLE marketing_sends
  ADD COLUMN IF NOT EXISTS redirect_token TEXT,
  ADD COLUMN IF NOT EXISTS clicked_at     TIMESTAMPTZ;

-- A token resolves to exactly one send. Partial (token IS NOT NULL) so the many
-- rows without a token (drafts, sends that had no cart) don't collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_sends_redirect_token_idx
  ON marketing_sends (redirect_token)
  WHERE redirect_token IS NOT NULL;
