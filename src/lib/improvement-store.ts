// Data layer for improvement runs + suggestions (migrations 0044/0045,
// docs/IMPROVEMENT_LOOP.md). Pure persistence — the model calls live in
// improvement-generate.ts, the measurement I/O in improvement-measure.ts, the
// pure logic in improvement-core / -effects / -decision (.mjs).
//
// Two run versions share the tables (no migration):
//   v1 — `baseline_json` = conversation rates of one report, `delta_json` =
//        their movement; suggestions with lane shop|mo and a v1 category,
//        `evidence_json` = string[];
//   v2 — `baseline_json` = { version: 2, period, options, snapshot },
//        `delta_json` = { version: 2, measurement, review, synthesis,
//        imported, state }; suggestions keep the owner lane in `category`
//        and their decision fields in `evidence_json` = { version: 2, items,
//        details } (improvement-types.ts).
//
// Cost note: like the Komplettanalyse, a run stores per-model token sums
// ({model: {input, output}}) and the EUR figure is priced in JS on every read
// (lib/ai-pricing.mjs) — one pricing source of truth.
//
// GDPR: all payloads are pseudonymous derived text and aggregates (snapshot
// metrics, report narratives, suggestion prose) — no identity values
// (Cluster A discipline).

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { loadModelPrices, usdEurRate } from "./ai-pricing.mjs";
import { reportCostEur } from "./analytics-report-core.mjs";
import {
  SUGGESTION_STATUSES,
  ownerLaneOf,
  priorityScore,
  priorityTier,
  runVersion,
  suggestionFingerprint,
} from "./improvement-core.mjs";
import { readSuggestionDetails } from "./improvement-decision.mjs";
import type { ReportUsage } from "./analytics-report-store";
import type {
  EvidenceItem,
  Measurement,
  OwnerLane,
  RunAnalysisV2,
  RunBaselineV2,
  SuggestionDetails,
  SuggestionOrigin,
  SwitchChange,
} from "./improvement-types";
import type { SnapshotSwitch } from "./business-snapshot";

const RUN_LIST_LIMIT = 50;
// How many prior suggestions each new run sees (prompt input + dedup base).
const PRIOR_SUGGESTIONS_LIMIT = 60;
// Open + planned suggestions across runs (backlog view and matrix).
const BACKLOG_LIMIT = 200;

export type ImprovementRunStatus = "running" | "complete" | "failed";
/** The stored coarse lane column (CHECK shop|mo). */
export type SuggestionLane = "shop" | "mo";
export type SuggestionStatus = "open" | "accepted" | "implemented" | "dismissed";

export interface ImprovementSuggestion {
  id: number;
  runId: number;
  lane: SuggestionLane;
  /** v1: a SHOP_/MO_CATEGORIES key; v2: the owner lane. */
  category: string;
  /** Who acts (v2 directly, v1 mapped). */
  ownerLane: OwnerLane;
  title: string;
  fingerprint: string;
  rationaleMd: string;
  proposalMd: string;
  directiveText: string | null;
  expectedEffect: string | null;
  impact: string;
  effort: string;
  /** 1 = before 2026-10-06 (free-text evidence), 2 = decision-grade. */
  detailsVersion: 1 | 2;
  evidence: EvidenceItem[];
  details: SuggestionDetails | null;
  priority: number;
  tier: 1 | 2 | 3;
  status: SuggestionStatus;
  statusNote: string | null;
  statusChangedAt: string | null;
  createdAt: string;
}

export interface ImprovementRunListItem {
  id: number;
  version: 1 | 2;
  reportId: number | null;
  reportTitle: string;
  rangeFrom: string;
  rangeTo: string;
  status: ImprovementRunStatus;
  phase: string;
  promptHash: string;
  costEur: number;
  suggestionCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface ImprovementRunDetail extends ImprovementRunListItem {
  /** v1 baseline (rates) or v2 RunBaselineV2. */
  baseline: Record<string, unknown> | null;
  /** v1 delta (rows) or v2 RunAnalysisV2. */
  delta: Record<string, unknown> | null;
  effectCheckMd: string | null;
  error: string | null;
  usage: ReportUsage;
  suggestions: ImprovementSuggestion[];
}

/** The compact prior-suggestion shape fed to the engine (prompt + dedup). */
export interface PriorSuggestion {
  id: number;
  lane: SuggestionLane;
  category: string;
  title: string;
  fingerprint: string;
  status: SuggestionStatus;
  impact: string;
  effort: string;
  confidence: string | null;
  risk: string | null;
  successMetricKey: string | null;
  origin: SuggestionOrigin | null;
  expectedEffect: string | null;
  statusNote: string | null;
  createdAt: string;
}

interface RunRow {
  id: number;
  report_id: number | null;
  report_title: string;
  range_from: unknown;
  range_to: unknown;
  prompt_hash: string;
  baseline_json?: unknown;
  delta_json?: unknown;
  run_version?: unknown;
  effect_check_md?: string | null;
  status: string;
  phase: string;
  error?: string | null;
  usage: unknown;
  created_at: unknown;
  completed_at: unknown;
  suggestion_count?: number;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return v == null ? "" : String(v);
}

/** YYYY-MM-DD of a DATE column (string or Date). */
function ymd(v: unknown): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return toIso(v).slice(0, 10);
}

function costOf(usage: unknown): number {
  try {
    return reportCostEur(usage ?? {}, loadModelPrices(), usdEurRate());
  } catch {
    return 0;
  }
}

function mapListRow(r: RunRow): ImprovementRunListItem {
  return {
    id: Number(r.id),
    version: Number(r.run_version) >= 2 ? 2 : 1,
    reportId: r.report_id == null ? null : Number(r.report_id),
    reportTitle: r.report_title,
    rangeFrom: ymd(r.range_from),
    rangeTo: ymd(r.range_to),
    status: (["running", "complete", "failed"].includes(r.status) ? r.status : "failed") as ImprovementRunStatus,
    phase: r.phase,
    promptHash: r.prompt_hash,
    costEur: costOf(r.usage),
    suggestionCount: Number(r.suggestion_count ?? 0),
    createdAt: toIso(r.created_at),
    completedAt: r.completed_at == null ? null : toIso(r.completed_at),
  };
}

interface SuggestionRow {
  id: number;
  run_id: number;
  lane: string;
  category: string;
  title: string;
  fingerprint: string;
  rationale_md: string;
  proposal_md: string;
  directive_text: string | null;
  expected_effect: string | null;
  impact: string;
  effort: string;
  evidence_json: unknown;
  status: string;
  status_note: string | null;
  status_changed_at: unknown;
  created_at: unknown;
}

function statusOf(s: string): SuggestionStatus {
  return (SUGGESTION_STATUSES.includes(s) ? s : "open") as SuggestionStatus;
}

function mapSuggestion(r: SuggestionRow): ImprovementSuggestion {
  const read = readSuggestionDetails(r.evidence_json);
  const details = read.details as SuggestionDetails | null;
  const lane: SuggestionLane = r.lane === "mo" ? "mo" : "shop";
  const ownerLane = (details?.lane ?? ownerLaneOf({ lane, category: r.category })) as OwnerLane;
  const score = priorityScore({
    impact: r.impact,
    effort: r.effort,
    confidence: details?.confidence ?? null,
    risk: details?.risk ?? null,
  });
  return {
    id: Number(r.id),
    runId: Number(r.run_id),
    lane,
    category: r.category,
    ownerLane,
    title: r.title,
    fingerprint: r.fingerprint,
    rationaleMd: r.rationale_md,
    proposalMd: r.proposal_md,
    directiveText: r.directive_text,
    expectedEffect: r.expected_effect,
    impact: r.impact,
    effort: r.effort,
    detailsVersion: read.version,
    evidence: read.items as EvidenceItem[],
    details,
    priority: score,
    tier: priorityTier(score) as 1 | 2 | 3,
    status: statusOf(r.status),
    statusNote: r.status_note,
    statusChangedAt: r.status_changed_at == null ? null : toIso(r.status_changed_at),
    createdAt: toIso(r.created_at),
  };
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export async function createImprovementRun(
  input: {
    reportId: number | null;
    reportTitle: string;
    rangeFrom: string;
    rangeTo: string;
    promptHash: string;
    baseline: RunBaselineV2 | Record<string, unknown>;
    delta: RunAnalysisV2 | Record<string, unknown> | null;
    /** First phase of the run. */
    phase: string;
  },
  sql: Sql | null = getSql()
): Promise<number | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      INSERT INTO improvement_runs
        (report_id, report_title, range_from, range_to, prompt_hash,
         baseline_json, delta_json, phase)
      VALUES
        (${input.reportId}, ${input.reportTitle}, ${input.rangeFrom}, ${input.rangeTo},
         ${input.promptHash}, ${JSON.stringify(input.baseline)}::jsonb,
         ${input.delta ? JSON.stringify(input.delta) : null}::jsonb, ${input.phase})
      RETURNING id
    `) as Array<{ id: number }>;
    return Number(rows[0]?.id);
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "create" });
    return null;
  }
}

export async function listImprovementRuns(sql: Sql | null = getSql()): Promise<ImprovementRunListItem[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT r.id, r.report_id, r.report_title, r.range_from, r.range_to,
             r.prompt_hash, r.status, r.phase, r.usage, r.created_at, r.completed_at,
             (r.baseline_json->>'version') AS run_version,
             (SELECT count(*)::int FROM improvement_suggestions s WHERE s.run_id = r.id)
               AS suggestion_count
        FROM improvement_runs r
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ${RUN_LIST_LIMIT}
    `) as RunRow[];
    return rows.map(mapListRow);
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "list" });
    return [];
  }
}

export async function getImprovementRun(id: number, sql: Sql | null = getSql()): Promise<ImprovementRunDetail | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT id, report_id, report_title, range_from, range_to, prompt_hash,
             baseline_json, delta_json, (baseline_json->>'version') AS run_version,
             effect_check_md, status, phase, error, usage, created_at, completed_at
        FROM improvement_runs
       WHERE id = ${id}
    `) as RunRow[];
    if (rows.length === 0) return null;
    const r = rows[0];
    const suggestionRows = (await sql`
      SELECT id, run_id, lane, category, title, fingerprint, rationale_md,
             proposal_md, directive_text, expected_effect, impact, effort,
             evidence_json, status, status_note, status_changed_at, created_at
        FROM improvement_suggestions
       WHERE run_id = ${id}
       ORDER BY (lane = 'mo') DESC,
                (impact = 'hoch') DESC, (impact = 'mittel') DESC,
                id ASC
    `) as SuggestionRow[];
    const suggestions = suggestionRows.map(mapSuggestion);
    return {
      ...mapListRow(r),
      version: runVersion(r.baseline_json) as 1 | 2,
      suggestionCount: suggestions.length,
      baseline: (r.baseline_json as Record<string, unknown>) ?? null,
      delta: (r.delta_json as Record<string, unknown>) ?? null,
      effectCheckMd: r.effect_check_md ?? null,
      error: r.error ?? null,
      usage: (r.usage as ReportUsage) ?? {},
      suggestions,
    };
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "get" });
    return null;
  }
}

export async function updateImprovementRun(
  id: number,
  patch: {
    status?: ImprovementRunStatus;
    phase?: string;
    error?: string | null;
    effectCheckMd?: string | null;
    usage?: ReportUsage;
    /** Replaces baseline_json (v2: the run's period, options and snapshot). */
    baseline?: RunBaselineV2;
    /** Replaces delta_json (v2: measurement, review, synthesis, state). */
    delta?: RunAnalysisV2;
    completed?: boolean;
  },
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    // Every update here ends a step (phase transition, completion or failure),
    // so it also RELEASES the step claim (migration 0045) — the next /step may
    // proceed immediately.
    await sql`
      UPDATE improvement_runs
         SET status = COALESCE(${patch.status ?? null}, status),
             phase = COALESCE(${patch.phase ?? null}, phase),
             error = COALESCE(${patch.error ?? null}, error),
             effect_check_md = COALESCE(${patch.effectCheckMd ?? null}, effect_check_md),
             usage = COALESCE(${patch.usage ? JSON.stringify(patch.usage) : null}::jsonb, usage),
             baseline_json = COALESCE(${patch.baseline ? JSON.stringify(patch.baseline) : null}::jsonb, baseline_json),
             delta_json = COALESCE(${patch.delta ? JSON.stringify(patch.delta) : null}::jsonb, delta_json),
             completed_at = CASE WHEN ${patch.completed === true} THEN now() ELSE completed_at END,
             step_claimed_at = NULL,
             updated_at = now()
       WHERE id = ${id}
    `;
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "update" });
  }
}

// How long a step claim shields against concurrent stepping before it is
// considered stale (a crashed function never cleared it). Comfortably above
// the step route's maxDuration.
const STEP_CLAIM_TTL_MINUTES = 6;

/**
 * Atomically claim the run for ONE step (migration 0045). Returns
 *  - 'claimed' — proceed with the step's work;
 *  - 'busy'    — another /step is live on this run (client should poll);
 *  - 'error'   — DB unavailable/failed (the caller proceeds fail-open).
 * A stale claim (older than STEP_CLAIM_TTL_MINUTES) is taken over.
 */
export async function claimRunStep(id: number, sql: Sql | null = getSql()): Promise<"claimed" | "busy" | "error"> {
  if (!sql) return "error";
  try {
    const rows = (await sql`
      UPDATE improvement_runs
         SET step_claimed_at = now()
       WHERE id = ${id}
         AND status = 'running'
         AND (step_claimed_at IS NULL
              OR step_claimed_at < now() - make_interval(mins => ${STEP_CLAIM_TTL_MINUTES}))
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.length > 0 ? "claimed" : "busy";
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "claim" });
    return "error";
  }
}

/**
 * Save the run's analysis state WITHOUT ending the step — the claim stays (the
 * in-flight mark written before a strategist call).
 */
export async function saveImprovementRunState(id: number, delta: RunAnalysisV2, sql: Sql | null = getSql()): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE improvement_runs
         SET delta_json = ${JSON.stringify(delta)}::jsonb,
             updated_at = now()
       WHERE id = ${id}
    `;
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "save-state" });
  }
}

/** Release a step claim without other changes (a step that only found another one running). */
export async function releaseRunStep(id: number, sql: Sql | null = getSql()): Promise<void> {
  if (!sql) return;
  try {
    await sql`UPDATE improvement_runs SET step_claimed_at = NULL WHERE id = ${id}`;
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "release" });
  }
}

export async function deleteImprovementRun(id: number, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return false;
  try {
    await sql`DELETE FROM improvement_runs WHERE id = ${id}`;
    return true;
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "delete" });
    return false;
  }
}

/**
 * The most recent COMPLETED run before `beforeRunId` — its switches (v2) are
 * the yardstick for which switches flipped since. Only the small parts are
 * read, never the whole snapshot.
 */
export async function getPreviousCompletedRun(
  beforeRunId: number,
  sql: Sql | null = getSql()
): Promise<{ id: number; version: 1 | 2; createdAt: string; switches: SnapshotSwitch[] | null } | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT p.id, p.created_at,
             (p.baseline_json->>'version') AS run_version,
             p.baseline_json->'snapshot'->'switches' AS switches
        FROM improvement_runs p
       WHERE p.status = 'complete'
         AND p.id <> ${beforeRunId}
         AND p.created_at <= COALESCE((SELECT created_at FROM improvement_runs WHERE id = ${beforeRunId}), now())
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 1
    `) as Array<{ id: number; created_at: unknown; run_version: unknown; switches: unknown }>;
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      version: Number(r.run_version) >= 2 ? 2 : 1,
      createdAt: toIso(r.created_at),
      switches: Array.isArray(r.switches) ? (r.switches as SnapshotSwitch[]) : null,
    };
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "previous" });
    return null;
  }
}

/**
 * The measurements of the newest completed v2 run (for the directive list:
 * "measured effect") with the run's id and date.
 */
export async function getLatestMeasurements(
  sql: Sql | null = getSql()
): Promise<{ runId: number; createdAt: string; measurements: Measurement[]; switchHistory: SwitchChange[] } | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT id, created_at,
             delta_json->'measurement'->'measurements' AS measurements,
             delta_json->'measurement'->'switchHistory' AS switch_history
        FROM improvement_runs
       WHERE status = 'complete'
         AND baseline_json->>'version' = '2'
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `) as Array<{ id: number; created_at: unknown; measurements: unknown; switch_history: unknown }>;
    const r = rows[0];
    if (!r) return null;
    return {
      runId: Number(r.id),
      createdAt: toIso(r.created_at),
      measurements: Array.isArray(r.measurements) ? (r.measurements as Measurement[]) : [],
      switchHistory: Array.isArray(r.switch_history) ? (r.switch_history as SwitchChange[]) : [],
    };
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "latest-measurements" });
    return null;
  }
}

/**
 * The completed Komplettanalysen with whether they carry the decision layer
 * and how many recommendations — the new-run panel's choice (no sections
 * payload is loaded).
 */
export async function listReportsForRuns(
  sql: Sql | null = getSql()
): Promise<Array<{ id: number; title: string; from: string; to: string; decision: boolean; recommendations: number }>> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, title, date_from, date_to,
             (sections->>'version') AS sections_version,
             CASE WHEN jsonb_typeof(sections->'decision'->'recommendations') = 'array'
                  THEN jsonb_array_length(sections->'decision'->'recommendations') ELSE 0 END AS recommendations
        FROM analytics_reports
       WHERE status = 'complete' AND sections IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 50
    `) as Array<{ id: number; title: string; date_from: unknown; date_to: unknown; sections_version: unknown; recommendations: unknown }>;
    return rows.map((r) => ({
      id: Number(r.id),
      title: String(r.title ?? ""),
      from: ymd(r.date_from),
      to: ymd(r.date_to),
      decision: Number(r.sections_version) >= 2,
      recommendations: Number(r.recommendations) || 0,
    }));
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "reports" });
    return [];
  }
}

// ── Suggestions ───────────────────────────────────────────────────────────────

/** One row to insert (improvement-decision suggestionStorage; v2 `evidence` is an object). */
export interface SuggestionInsert {
  lane: SuggestionLane;
  category: string;
  title: string;
  fingerprint: string;
  rationale: string;
  proposal: string;
  directive: string | null;
  expectedEffect: string | null;
  impact: string;
  effort: string;
  evidence: unknown;
}

export async function insertSuggestions(runId: number, suggestions: SuggestionInsert[], sql: Sql | null = getSql()): Promise<number> {
  if (!sql) return 0;
  let inserted = 0;
  for (const s of suggestions) {
    try {
      await sql`
        INSERT INTO improvement_suggestions
          (run_id, lane, category, title, fingerprint, rationale_md, proposal_md,
           directive_text, expected_effect, impact, effort, evidence_json)
        VALUES
          (${runId}, ${s.lane}, ${s.category}, ${s.title},
           ${s.fingerprint || suggestionFingerprint(s.title)},
           ${s.rationale}, ${s.proposal}, ${s.directive}, ${s.expectedEffect},
           ${s.impact}, ${s.effort}, ${JSON.stringify(s.evidence ?? [])}::jsonb)
      `;
      inserted += 1;
    } catch (err) {
      reportError(err, { route: "lib/improvement-store", phase: "insert-suggestion" });
    }
  }
  return inserted;
}

function mapPrior(r: SuggestionRow): PriorSuggestion {
  const s = mapSuggestion(r);
  return {
    id: s.id,
    lane: s.lane,
    category: s.category,
    title: s.title,
    fingerprint: s.fingerprint,
    status: s.status,
    impact: s.impact,
    effort: s.effort,
    confidence: s.details?.confidence ?? null,
    risk: s.details?.risk ?? null,
    successMetricKey: s.details?.successMetric?.key ?? null,
    origin: s.details?.origin ?? null,
    expectedEffect: s.expectedEffect,
    statusNote: s.statusNote,
    createdAt: s.createdAt,
  };
}

/**
 * The newest prior suggestions across ALL runs — what the engine must not
 * repeat (prompt input) and the fingerprint base for the hard dedup.
 */
export async function listPriorSuggestions(sql: Sql | null = getSql()): Promise<PriorSuggestion[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, run_id, lane, category, title, fingerprint, rationale_md,
             proposal_md, directive_text, expected_effect, impact, effort,
             evidence_json, status, status_note, status_changed_at, created_at
        FROM improvement_suggestions
       ORDER BY created_at DESC, id DESC
       LIMIT ${PRIOR_SUGGESTIONS_LIMIT}
    `) as SuggestionRow[];
    return rows.map(mapPrior);
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "prior" });
    return [];
  }
}

/**
 * Fingerprint, status and origin of every suggestion — the Komplettanalyse
 * import skips what was imported or decided before.
 */
export async function listSuggestionOrigins(
  sql: Sql | null = getSql()
): Promise<Array<{ fingerprint: string; status: string; origin: SuggestionOrigin | null }>> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT fingerprint, status,
             CASE WHEN jsonb_typeof(evidence_json) = 'object'
                  THEN evidence_json->'details'->'origin' END AS origin
        FROM improvement_suggestions
       ORDER BY id DESC
       LIMIT 2000
    `) as Array<{ fingerprint: string; status: string; origin: unknown }>;
    return rows.map((r) => ({
      fingerprint: r.fingerprint,
      status: r.status,
      origin: r.origin && typeof r.origin === "object" ? (r.origin as SuggestionOrigin) : null,
    }));
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "origins" });
    return [];
  }
}

/** Open and planned suggestions of every run — the backlog, newest first. */
export async function listBacklog(sql: Sql | null = getSql()): Promise<ImprovementSuggestion[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, run_id, lane, category, title, fingerprint, rationale_md,
             proposal_md, directive_text, expected_effect, impact, effort,
             evidence_json, status, status_note, status_changed_at, created_at
        FROM improvement_suggestions
       WHERE status IN ('open', 'accepted')
       ORDER BY created_at DESC, id DESC
       LIMIT ${BACKLOG_LIMIT}
    `) as SuggestionRow[];
    return rows.map(mapSuggestion);
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "backlog" });
    return [];
  }
}

/**
 * The suggestions the effect measurement needs: everything implemented, and
 * every suggestion a directive was adopted from (its success metric).
 */
export async function listSuggestionsForChanges(sql: Sql | null = getSql()): Promise<
  Array<{
    id: number;
    title: string;
    lane: string;
    category: string;
    status: string;
    statusChangedAt: string | null;
    expectedEffect: string | null;
    details: SuggestionDetails | null;
  }>
> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, run_id, lane, category, title, fingerprint, rationale_md,
             proposal_md, directive_text, expected_effect, impact, effort,
             evidence_json, status, status_note, status_changed_at, created_at
        FROM improvement_suggestions
       WHERE status = 'implemented'
          OR id IN (SELECT suggestion_id FROM mo_directives WHERE suggestion_id IS NOT NULL)
       ORDER BY status_changed_at DESC NULLS LAST, id DESC
       LIMIT 200
    `) as SuggestionRow[];
    return rows.map((r) => {
      const s = mapSuggestion(r);
      return {
        id: s.id,
        title: s.title,
        lane: s.lane,
        category: s.category,
        status: s.status,
        statusChangedAt: s.statusChangedAt,
        expectedEffect: s.expectedEffect,
        details: s.details,
      };
    });
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "changes" });
    return [];
  }
}

export async function getSuggestion(id: number, sql: Sql | null = getSql()): Promise<ImprovementSuggestion | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT id, run_id, lane, category, title, fingerprint, rationale_md,
             proposal_md, directive_text, expected_effect, impact, effort,
             evidence_json, status, status_note, status_changed_at, created_at
        FROM improvement_suggestions
       WHERE id = ${id}
    `) as SuggestionRow[];
    return rows.length ? mapSuggestion(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "get-suggestion" });
    return null;
  }
}

export async function updateSuggestionStatus(
  id: number,
  status: SuggestionStatus,
  note: string | null,
  sql: Sql | null = getSql()
): Promise<ImprovementSuggestion | null> {
  if (!sql) return null;
  if (!SUGGESTION_STATUSES.includes(status)) return null;
  try {
    const rows = (await sql`
      UPDATE improvement_suggestions
         SET status = ${status},
             status_note = ${note},
             status_changed_at = now(),
             updated_at = now()
       WHERE id = ${id}
      RETURNING id, run_id, lane, category, title, fingerprint, rationale_md,
                proposal_md, directive_text, expected_effect, impact, effort,
                evidence_json, status, status_note, status_changed_at, created_at
    `) as SuggestionRow[];
    return rows.length ? mapSuggestion(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "status" });
    return null;
  }
}
