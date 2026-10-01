-- 0067_inbox.sql — the Eingang: what needs the team's attention today.
--
-- One row per thing to decide: a customer who needs attention (a purchase
-- intent without a purchase, an offer about to expire, an unanswered e-mail …)
-- or a system matter (unmatched inbound mail, a Shopify data request, a sync
-- problem). Items come from the deterministic rules in
-- lib/customer-signals.mjs (nightly + on events) and carry an optional AI
-- suggestion (action, channel, draft). Nothing here ever sends — the operator
-- decides. docs/CUSTOMER_PLATFORM_PLAN.md §11.
--
--   kind         the rule that produced the item (customer-signals.mjs)
--   dedupe_key   kind + subject + window — a nightly run never duplicates
--   evidence     ids and numbers behind the reason (never an e-mail address)
--   suggestion   { warum, aktion, kanal, betreff?, text?, rabatt?, produkte[] }
--   outcome      filled 14 days after the decision: sent?, ordered?, revenue

CREATE TABLE IF NOT EXISTS inbox_items (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind                TEXT NOT NULL,
  customer_id         BIGINT REFERENCES customers (id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'offen'
                        CHECK (status IN ('offen', 'zurueckgestellt', 'erledigt', 'verworfen')),
  priority            INTEGER NOT NULL DEFAULT 50,
  title               TEXT NOT NULL,
  reason              TEXT NOT NULL,
  evidence            JSONB NOT NULL DEFAULT '{}'::jsonb,
  suggestion          JSONB,
  suggested_at        TIMESTAMPTZ,
  dedupe_key          TEXT NOT NULL UNIQUE,
  snoozed_until       TIMESTAMPTZ,
  decided_at          TIMESTAMPTZ,
  decision            TEXT,
  decision_note       TEXT,
  outcome             JSONB,
  outcome_checked_at  TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbox_items_open_idx
  ON inbox_items (priority DESC, created_at DESC) WHERE status IN ('offen', 'zurueckgestellt');
CREATE INDEX IF NOT EXISTS inbox_items_customer_idx
  ON inbox_items (customer_id, status) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inbox_items_kind_idx
  ON inbox_items (kind, status);
CREATE INDEX IF NOT EXISTS inbox_items_decided_idx
  ON inbox_items (decided_at) WHERE decided_at IS NOT NULL;
