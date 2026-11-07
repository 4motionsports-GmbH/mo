-- 0081_templates_rundmail_senders.sql — e-mail templates („Vorlagen“), the
-- bulk mail („Rundmail“) and selectable sender identities („Absender“).
--
-- 1. campaigns.sender — the From identity a campaign sends with
--    ({id, address, name, replies}, lib/sender-identities.mjs). NULL = the
--    default sender (CONTACT_FROM_EMAIL, „Mo von motion sports“) — exactly
--    what every campaign sent with before. The address must lie on a domain
--    verified in Resend; the code checks it on save AND at send time.
--
-- 2. campaigns.kind gains 'rundmail': ONE human-reviewed content sent to a
--    whole audience (docs/CAMPAIGNS.md §9). No per-recipient AI draft and no
--    review desk; recipients are campaign_contacts rows as for every campaign
--    (pending → sending → sent | skipped | suppressed), every send is a
--    campaign_sends row (KPIs, delivery webhooks, unsubscribe attribution,
--    erasure, retention and the frequency cap keep working unchanged).
--
-- 3. mail_templates — operator-built templates: a block document
--    (lib/mail-template-doc.mjs) the admin screen „Vorlagen“ edits. A
--    template with the block „Mos persönlicher Text“ is selectable as the
--    design of Kampagne / Marketing mails (design key 'vorlage-<id>' in
--    email_design_selections.design_key / campaigns.design_key — both free
--    TEXT, validated in code); any template can start a Rundmail (copied).
--    `version` counts saves (part of the release fingerprint: a template
--    changed after „Einplanen“ holds the planned mails for a new review).
--    Templates are never deleted while in use — archived_at hides them.
--    (Not `email_templates`: that name belonged to the 0048 token themes,
--    dropped by 0049.)
--
-- 4. campaign_mailings — the content of a Rundmail (1:1 with its campaign)
--    and its send state. The content is FROZEN at release (frozen_*: subject,
--    HTML and text with per-recipient placeholders, the tracked link table,
--    the From / Reply-To): every recipient gets byte-for-byte that content,
--    only the placeholders differ (unsubscribe / erasure link, tracked links,
--    first name). test_version = the content version the last test mail
--    showed — the release requires test_version = content_version.
--
-- 5. campaign_mailing_batches — one row per Resend batch request: the
--    recipient ids and their redirect tokens (no addresses — nothing to
--    erase here), the status and attempts. The idempotency key
--    'mo-rundmail-<campaign>-<batch id>' makes a retry after a timeout safe:
--    Resend never delivers the same batch twice.
--
-- Run BEFORE deploying the code that reads it (the campaign SELECTs and
-- updates name `sender`). Additive: older code ignores the new column and
-- tables, and the widened CHECK still accepts every old kind.
-- Configuration vs data: mail_templates is configuration (kept by
-- `npm run db:reset`, db-reset-plan.mjs); mailings and batches are data.
-- Forward-only, idempotent.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS sender JSONB
    CHECK (sender IS NULL OR jsonb_typeof(sender) = 'object');

-- 0066 declared the kind CHECK inline, so Postgres named it campaigns_kind_check.
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_kind_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_kind_check
  CHECK (kind IN ('laufend', 'aktion', 'einzel', 'rundmail'));

CREATE TABLE IF NOT EXISTS mail_templates (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  doc         JSONB NOT NULL CHECK (jsonb_typeof(doc) = 'object'),
  version     INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_templates_active_idx
  ON mail_templates (updated_at DESC) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS campaign_mailings (
  campaign_id        BIGINT PRIMARY KEY REFERENCES campaigns (id) ON DELETE CASCADE,
  subject            TEXT NOT NULL DEFAULT '',
  preheader          TEXT,
  doc                JSONB NOT NULL CHECK (jsonb_typeof(doc) = 'object'),
  language           TEXT NOT NULL DEFAULT 'de' CHECK (language IN ('de', 'en')),
  source_template_id BIGINT REFERENCES mail_templates (id) ON DELETE SET NULL,
  rate               TEXT NOT NULL DEFAULT 'normal' CHECK (rate IN ('behutsam', 'normal', 'schnell')),
  engaged_first      BOOLEAN NOT NULL DEFAULT true,
  content_version    INTEGER NOT NULL DEFAULT 1,
  test_version       INTEGER,
  test_sent_at       TIMESTAMPTZ,
  test_sent_to       INTEGER,
  frozen_version     INTEGER,
  frozen_at          TIMESTAMPTZ,
  frozen_subject     TEXT,
  frozen_html        TEXT,
  frozen_text        TEXT,
  frozen_hash        TEXT,
  frozen_from        TEXT,
  frozen_reply_to    TEXT,
  links              JSONB NOT NULL DEFAULT '[]'::jsonb,
  merges             JSONB NOT NULL DEFAULT '{}'::jsonb,
  materialized_at    TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  lease_until        TIMESTAMPTZ,
  next_batch_at      TIMESTAMPTZ,
  last_error         TEXT,
  last_error_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_mailing_batches (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id  BIGINT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  contact_ids  BIGINT[] NOT NULL,
  tokens       TEXT[] NOT NULL,
  status       TEXT NOT NULL DEFAULT 'offen'
                 CHECK (status IN ('offen', 'gesendet', 'fehler', 'unklar')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempted_at TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS campaign_mailing_batches_open_idx
  ON campaign_mailing_batches (campaign_id, id) WHERE status = 'offen';
CREATE INDEX IF NOT EXISTS campaign_mailing_batches_created_idx
  ON campaign_mailing_batches (created_at);
