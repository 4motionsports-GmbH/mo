-- 0036_qa_entries.sql — "Wissen" (knowledge enhancement / Q&A) feature:
-- turn conversations where Mo lacked knowledge (unmet need, drop-off, or a
-- hand-over to the contact form) into a reviewable Q&A queue.
--
-- Flow: an AI pass drafts { gap summary, precise question, product? } from an
-- eligible conversation → a human operator answers it in the admin "Wissen"
-- tab → publishing writes the Q&A pair to the product's `custom.qa` metafield
-- in Shopify (shown in the storefront PDP Q&A tab AND picked up by the catalog
-- sync into Mo's context). Entries without a product are "general" knowledge
-- and are injected into Mo's system prompt directly from this table.
--
-- Cluster A (pseudonymous analytics): the entry stores derived text only —
-- no email, no identity. conversation_id is kept for provenance and detaches
-- (SET NULL) when the conversation is deleted by retention/erasure, so a
-- published Q&A outlives its source conversation.

CREATE TABLE IF NOT EXISTS qa_entries (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Source conversation (provenance; NULL after retention/erasure or for
  -- manually created entries).
  conversation_id       BIGINT REFERENCES conversations (id) ON DELETE SET NULL,
  -- Catalog product the question belongs to (the product HANDLE, i.e. the
  -- catalog Product.id). NULL = general (shop-wide) knowledge.
  product_id            TEXT,
  product_title         TEXT,
  -- AI-drafted: what could not be solved (for the operator's context) …
  gap_summary           TEXT NOT NULL,
  -- … and the precise, customer-facing question derived from it. The operator
  -- may edit it before publishing.
  question              TEXT NOT NULL,
  -- Normalized fingerprint of `question` for de-duplication (see
  -- lib/qa-core.mjs questionFingerprint): the same question drafted from two
  -- conversations must not create two queue entries.
  question_fingerprint  TEXT NOT NULL,
  -- Operator-written answer. NULL while status='open'.
  answer                TEXT,
  -- open → answered → published; dismissed is the operator's "not a real
  -- gap / duplicate / won't answer" terminal state.
  status                TEXT NOT NULL DEFAULT 'open',
  -- Draft-pass audit + cost attribution (priced in JS via lib/ai-pricing.mjs).
  model                 TEXT,
  input_tokens          INTEGER,
  output_tokens         INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at           TIMESTAMPTZ,
  published_at          TIMESTAMPTZ
);

-- Queue views: filter by status, newest first.
CREATE INDEX IF NOT EXISTS qa_entries_status_idx
  ON qa_entries (status, created_at DESC);

-- De-dup guard: at most ONE non-dismissed entry per normalized question.
-- Partial so a dismissed duplicate doesn't block re-asking later.
CREATE UNIQUE INDEX IF NOT EXISTS qa_entries_fingerprint_active_idx
  ON qa_entries (question_fingerprint)
  WHERE status <> 'dismissed';

-- Scan bookkeeping on the conversation: when the knowledge-gap scan last
-- looked at this conversation (NULL = never). Set even when NO gap was found,
-- so the bulk scan never re-spends tokens on the same conversation.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS qa_scanned_at TIMESTAMPTZ;

-- Lets the scan cheaply find "eligible and not yet scanned" conversations.
CREATE INDEX IF NOT EXISTS conversations_qa_scan_idx
  ON conversations (qa_scanned_at)
  WHERE qa_scanned_at IS NULL;
