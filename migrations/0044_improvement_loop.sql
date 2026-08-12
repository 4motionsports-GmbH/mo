-- 0044_improvement_loop.sql — the closed improvement loop ("Verbesserung" tab):
-- Mo reads a finished Komplettanalyse (analytics_reports.sections) plus a
-- snapshot of his own current configuration (the rendered system prompt, tool
-- copy, personas, published knowledge) and produces concrete, evidence-based
-- improvement suggestions in two lanes — for the ONLINE STORE and for MO
-- HIMSELF. Suggestions carry a lifecycle the operator drives (open → accepted →
-- implemented / dismissed); every NEW run receives the previous suggestions and
-- the KPI movement since the last run, so it can honestly assess whether
-- implemented changes worked ("Wirkungs-Check"). That feedback edge is what
-- closes the loop.
--
-- Human-in-the-loop boundary (docs/IMPROVEMENT_LOOP.md): the system NEVER
-- changes Mo's prompt or behaviour automatically. The one live-editable surface
-- is the mo_directives layer below — short operator instructions injected into
-- the system prompt like the published Q&A knowledge — and a directive only
-- ever becomes active through an explicit, authenticated admin action. The core
-- prompt stays in git. Every directive change is versioned append-only in
-- mo_directive_versions, so the full history of what Mo was told (the
-- "past system prompts" record) is queryable and shown in the admin.
--
-- GDPR: everything here is Cluster-A-derived, pseudonymous TEXT (report
-- narratives, KPI aggregates, suggestion prose). No email, no identity values.
-- report_id detaches (SET NULL) when the source report is deleted, so a run —
-- like a published Q&A — outlives its source artifact.

-- One improvement run = one engine pass over one completed Komplettanalyse.
CREATE TABLE IF NOT EXISTS improvement_runs (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Source report (provenance; NULL after the report is deleted).
  report_id        BIGINT REFERENCES analytics_reports (id) ON DELETE SET NULL,
  -- Denormalized so the run stays meaningful without the report row.
  report_title     TEXT NOT NULL,
  range_from       DATE NOT NULL,
  range_to         DATE NOT NULL,
  -- Which "self" the suggestions targeted: SHA-256 (hex) of Mo's rendered
  -- self-snapshot (system prompt + tool copy + personas + knowledge +
  -- directives) at run time. Changes whenever code-prompt or directives change.
  prompt_hash      TEXT NOT NULL,
  -- Comparable KPI rates computed from the report sections at run time
  -- (lib/improvement-core.mjs computeKpiBaseline) — the yardstick the NEXT run
  -- measures against.
  baseline_json    JSONB NOT NULL,
  -- Movement vs. the previous run's baseline (null on the first run).
  delta_json       JSONB,
  -- The model's honest assessment of previously implemented/accepted
  -- suggestions in light of delta_json (null when there was nothing to check).
  effect_check_md  TEXT,
  -- Mini state machine, stepped like analytics_reports: one bounded model call
  -- per /step request so no request approaches maxDuration.
  status           TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete', 'failed')),
  phase            TEXT NOT NULL DEFAULT 'wirkung',
  error            TEXT,
  -- Per-model token sums ({model: {input, output}}), priced in JS on read
  -- (lib/ai-pricing.mjs) — same shape as analytics_reports.usage.
  usage            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

-- Sidebar list: newest first.
CREATE INDEX IF NOT EXISTS improvement_runs_created_idx
  ON improvement_runs (created_at DESC);

-- The engine's structured output: one row per suggestion, owned by its run
-- (CASCADE — deleting a run removes its suggestions; the operator deletes runs,
-- not suggestions).
CREATE TABLE IF NOT EXISTS improvement_suggestions (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id           BIGINT NOT NULL REFERENCES improvement_runs (id) ON DELETE CASCADE,
  -- 'shop' (online store) or 'mo' (Mo himself).
  lane             TEXT NOT NULL CHECK (lane IN ('shop', 'mo')),
  -- Validated vocabulary per lane — see lib/improvement-core.mjs
  -- (SHOP_CATEGORIES / MO_CATEGORIES). Stored as the raw key.
  category         TEXT NOT NULL,
  title            TEXT NOT NULL,
  -- Normalized title fingerprint (lib/improvement-core.mjs) — the engine
  -- deduplicates new output against ALL previous non-dismissed suggestions in
  -- code before insert (no unique index: a dismissed idea may return later
  -- with better evidence).
  fingerprint      TEXT NOT NULL,
  -- WHY (evidence-based, references the report) and WHAT exactly to change.
  rationale_md     TEXT NOT NULL,
  proposal_md      TEXT NOT NULL,
  -- For lane='mo' suggestions that are directly adoptable as a live directive:
  -- the ready-to-inject instruction text. One click in the admin turns it into
  -- a mo_directives row (never automatic).
  directive_text   TEXT,
  -- Which KPI/metric the model expects to move — the hook the next run's
  -- Wirkungs-Check grabs.
  expected_effect  TEXT,
  impact           TEXT NOT NULL DEFAULT 'mittel' CHECK (impact IN ('hoch', 'mittel', 'niedrig')),
  effort           TEXT NOT NULL DEFAULT 'mittel' CHECK (effort IN ('hoch', 'mittel', 'niedrig')),
  -- Curated evidence strings (KPI figures, categories, persona names) — small
  -- and displayable, never transcripts.
  evidence_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Operator-driven lifecycle. 'accepted' = will do; 'implemented' = done (the
  -- next run measures it); 'dismissed' = considered and rejected.
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'implemented', 'dismissed')),
  status_note      TEXT,
  status_changed_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS improvement_suggestions_run_idx
  ON improvement_suggestions (run_id);

-- Backlog views: filter by status, newest first.
CREATE INDEX IF NOT EXISTS improvement_suggestions_status_idx
  ON improvement_suggestions (status, created_at DESC);

-- The live, versioned instruction layer injected into Mo's system prompt
-- (system-prompt-core.mjs `directives` — rendered exactly like the published
-- general Q&A; an empty set leaves the prompt byte-identical). Bounded: the
-- store enforces MAX_ACTIVE_DIRECTIVES / per-directive length caps
-- (lib/improvement-core.mjs) so the prompt cannot grow unbounded.
CREATE TABLE IF NOT EXISTS mo_directives (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The instruction text (German — Mo's prompt core language; the EN prompt
  -- injects it unchanged under an English framing header).
  content        TEXT NOT NULL,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  -- 'operator' = typed by hand; 'suggestion' = adopted from an engine
  -- suggestion (provenance below).
  source         TEXT NOT NULL DEFAULT 'operator' CHECK (source IN ('operator', 'suggestion')),
  suggestion_id  BIGINT REFERENCES improvement_suggestions (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chat-path read: active directives, oldest first (stable prompt ordering).
CREATE INDEX IF NOT EXISTS mo_directives_active_idx
  ON mo_directives (created_at)
  WHERE active;

-- Append-only history: one row per state a directive has ever been in
-- (created / updated / activated / deactivated). Never updated or deleted while
-- the directive exists (CASCADE with it) — this is the audit trail the admin's
-- "Verlauf" view renders.
CREATE TABLE IF NOT EXISTS mo_directive_versions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  directive_id  BIGINT NOT NULL REFERENCES mo_directives (id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  active        BOOLEAN NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('created', 'updated', 'activated', 'deactivated')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mo_directive_versions_directive_idx
  ON mo_directive_versions (directive_id, created_at DESC);
