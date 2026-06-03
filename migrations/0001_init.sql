-- 0001_init.sql — initial schema for the motion sports chatbot backend.
--
-- The schema is split into two clusters with DIFFERENT GDPR lawful bases.
-- Keep them separate; do not join email onto conversations.
--
--   Cluster A — conversation / analytics  (lawful basis: legitimate interest /
--   service provision). Pseudonymous: keyed by a client-generated session_id,
--   never an email. Used to run the chat, build summaries and KPIs.
--
--   Cluster B — consent / marketing  (lawful basis: explicit consent). This is
--   the ONLY place an email address lives. A row here exists only because the
--   user actively gave their email and ticked a consent box.
--
-- See docs/DATA_RETENTION.md and docs/DATABASE.md for the rationale.


-- ============================================================================
-- Cluster A: conversation / analytics  (legitimate interest)
-- ============================================================================

-- One row per chat session. NO email, no directly-identifying data — only the
-- pseudonymous session_id and derived analytics fields.
CREATE TABLE IF NOT EXISTS conversations (
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id               TEXT NOT NULL UNIQUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The persona archetype the backend derives from the profile, e.g.
  -- 'pragmatic_beginner', 'studio_operator'. Nullable until classified.
  persona_label            TEXT,
  message_count            INTEGER NOT NULL DEFAULT 0,
  -- Catalog product ids referenced via tool calls (show_product,
  -- compare_products, add_to_cart, suggest_showroom, show_contact_form).
  recommended_product_ids  TEXT[] NOT NULL DEFAULT '{}',
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'abandoned', 'converted')),
  last_activity_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_last_activity_idx
  ON conversations (last_activity_at);
CREATE INDEX IF NOT EXISTS conversations_status_idx
  ON conversations (status);

-- Individual chat messages. Stores user/assistant text plus a marker row per
-- tool call (tool_name set, content = the tool input). Needed for the summary
-- email and the "top questions" KPI later.
CREATE TABLE IF NOT EXISTS messages (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id    BIGINT NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  -- Stable id from the source message (UIMessage.id, or the provider response
  -- id for the assistant turn). Used to keep re-sent history idempotent.
  client_message_id  TEXT,
  role               TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content            TEXT,
  tool_name          TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON messages (conversation_id, created_at);
-- Idempotency: the same logical message (re-sent each turn) lands once.
-- COALESCE(tool_name, '') so the text row (NULL tool_name) dedupes too —
-- a plain column index would treat NULLs as distinct and let dupes through.
CREATE UNIQUE INDEX IF NOT EXISTS messages_dedup_idx
  ON messages (conversation_id, client_message_id, COALESCE(tool_name, ''))
  WHERE client_message_id IS NOT NULL;

-- Pseudonymous product/usage telemetry from the widget's fail-silent track().
-- Keyed by session_id only; `data` is free-form jsonb (keep it pseudonymous).
CREATE TABLE IF NOT EXISTS kpi_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  TEXT,
  event       TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kpi_events_created_at_idx
  ON kpi_events (created_at);
CREATE INDEX IF NOT EXISTS kpi_events_event_idx
  ON kpi_events (event);


-- ============================================================================
-- Cluster B: consent / marketing  (explicit consent)
-- ============================================================================
-- The ONLY place email addresses are stored. Separate lawful basis, separate
-- retention rules. Deliberately NOT linked to the conversations table by a
-- foreign key so the two clusters stay decoupled — the optional bridge is the
-- pseudonymous session_id, which the user can sever by clearing local storage.

-- An email capture is created only when a user actively submits their email
-- with an explicit consent choice. Records the exact consent copy shown.
CREATE TABLE IF NOT EXISTS email_captures (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id            TEXT,
  email                 TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Consent to receive the transactional summary email of this conversation.
  transactional_consent BOOLEAN NOT NULL DEFAULT false,
  -- Consent to receive marketing email (separate, opt-in, never pre-ticked).
  marketing_consent     BOOLEAN NOT NULL DEFAULT false,
  -- Double-opt-in lifecycle for the marketing consent.
  marketing_doi_status  TEXT NOT NULL DEFAULT 'none'
                          CHECK (marketing_doi_status IN ('pending', 'confirmed', 'none')),
  doi_token             TEXT,
  doi_confirmed_at      TIMESTAMPTZ,
  -- The exact consent copy the user saw, stored verbatim for audit/GDPR proof.
  consent_text_shown    TEXT,
  unsubscribed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS email_captures_email_idx
  ON email_captures (email);
CREATE UNIQUE INDEX IF NOT EXISTS email_captures_doi_token_idx
  ON email_captures (doi_token)
  WHERE doi_token IS NOT NULL;

-- Hard suppression: emails that must never be contacted again (unsubscribe,
-- bounce, complaint, GDPR erasure). Checked before any marketing send.
CREATE TABLE IF NOT EXISTS suppression_list (
  email     TEXT PRIMARY KEY,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason    TEXT
);

-- A drafted/approved/sent marketing message tied to a specific email capture.
-- Drafts are reviewed by a human before sending (status workflow).
CREATE TABLE IF NOT EXISTS marketing_sends (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_capture_id      BIGINT NOT NULL REFERENCES email_captures (id) ON DELETE CASCADE,
  drafted_text          TEXT,
  discount_code         TEXT,
  sent_at               TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'approved', 'sent')),
  shopify_order_matched BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS marketing_sends_capture_idx
  ON marketing_sends (email_capture_id);
CREATE INDEX IF NOT EXISTS marketing_sends_status_idx
  ON marketing_sends (status);
