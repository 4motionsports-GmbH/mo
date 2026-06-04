-- 0003_marketing_sends_dashboard.sql — extend marketing_sends to back the
-- authenticated admin marketing dashboard (Cluster B — explicit consent).
--
-- The 0001 table already has the core lifecycle columns (drafted_text,
-- discount_code, sent_at, status draft|approved|sent, shopify_order_matched).
-- The dashboard needs a few more fields so a draft can be fully reconstructed,
-- edited and sent without re-deriving everything:
--
--   subject              — the AI-drafted (admin-editable) email subject line.
--   cart_url             — the prefilled-cart permalink (?discount=CODE) built
--                          from the discussed products. Rendered as the CTA at
--                          send time so the admin can never edit it away.
--   discount_code_gid    — the Shopify discount node id (gid://…), kept for
--                          auditing / later deactivation. Distinct from the
--                          human-facing discount_code.
--   discount_expires_at  — when the unique discount code stops working.
--   product_ids          — snapshot of the discussed product ids the draft
--                          targeted (the cart + recommendations were built from
--                          these). Stored so the row is self-contained.
--   persona_label        — snapshot of the conversation persona at draft time.
--   created_at/updated_at — row lifecycle timestamps (the table had neither).

ALTER TABLE marketing_sends
  ADD COLUMN IF NOT EXISTS subject             TEXT,
  ADD COLUMN IF NOT EXISTS cart_url            TEXT,
  ADD COLUMN IF NOT EXISTS discount_code_gid   TEXT,
  ADD COLUMN IF NOT EXISTS discount_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS product_ids         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS persona_label       TEXT,
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ NOT NULL DEFAULT now();

-- At most one in-flight (un-sent) draft per capture, so "Generate draft" is
-- idempotent and the admin edits a single row rather than spawning duplicates
-- (each of which would mint its own Shopify discount code). Sent rows are the
-- historical record and are deliberately not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_sends_one_open_draft_idx
  ON marketing_sends (email_capture_id)
  WHERE status <> 'sent';
