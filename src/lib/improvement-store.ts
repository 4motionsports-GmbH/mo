// Data layer for improvement runs + suggestions (migration 0044,
// docs/IMPROVEMENT_LOOP.md). Pure persistence — the model calls live in
// improvement-generate.ts, the pure maths in improvement-core.mjs.
//
// Cost note: like the Komplettanalyse, a run stores per-model token sums
// ({model: {input, output}}) and the EUR figure is priced in JS on every read
// (lib/ai-pricing.mjs) — one pricing source of truth.
//
// GDPR: all payloads are pseudonymous derived text (report narratives, KPI
// rates, suggestion prose) — no identity values (Cluster A discipline).

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { loadModelPrices, usdEurRate } from "./ai-pricing.mjs";
import { reportCostEur } from "./analytics-report-core.mjs";
import {
  SUGGESTION_STATUSES,
  suggestionFingerprint,
} from "./improvement-core.mjs";
import type { ReportUsage } from "./analytics-report-store";

export const RUN_LIST_LIMIT = 50;
// How many prior suggestions each new run sees (prompt input + dedup base).
export const PRIOR_SUGGESTIONS_LIMIT = 60;

export type ImprovementRunStatus = "running" | "complete" | "failed";
export type SuggestionLane = "shop" | "mo";
export type SuggestionStatus = "open" | "accepted" | "implemented" | "dismissed";

export interface ImprovementSuggestion {
  id: number;
  runId: number;
  lane: SuggestionLane;
  category: string;
  title: string;
  fingerprint: string;
  rationaleMd: string;
  proposalMd: string;
  directiveText: string | null;
  expectedEffect: string | null;
  impact: string;
  effort: string;
  evidence: string[];
  status: SuggestionStatus;
  statusNote: string | null;
  statusChangedAt: string | null;
  createdAt: string;
}

export interface ImprovementRunListItem {
  id: number;
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
  baseline: Record<string, unknown> | null;
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
  title: string;
  fingerprint: string;
  status: SuggestionStatus;
  expectedEffect: string | null;
  statusNote: string | null;
  createdAt: string;
}

interface RunRow {
  id: number;
  report_id: number | null;
  report_title: string;
  range_from: string;
  range_to: string;
  prompt_hash: string;
  baseline_json: unknown;
  delta_json: unknown;
  effect_check_md: string | null;
  status: string;
  phase: string;
  error: string | null;
  usage: unknown;
  created_at: string;
  completed_at: string | null;
  suggestion_count?: number;
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
    reportId: r.report_id == null ? null : Number(r.report_id),
    reportTitle: r.report_title,
    rangeFrom: String(r.range_from),
    rangeTo: String(r.range_to),
    status: (["running", "complete", "failed"].includes(r.status)
      ? r.status
      : "failed") as ImprovementRunStatus,
    phase: r.phase,
    promptHash: r.prompt_hash,
    costEur: costOf(r.usage),
    suggestionCount: Number(r.suggestion_count ?? 0),
    createdAt: String(r.created_at),
    completedAt: r.completed_at == null ? null : String(r.completed_at),
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
  status_changed_at: string | null;
  created_at: string;
}

function mapSuggestion(r: SuggestionRow): ImprovementSuggestion {
  return {
    id: Number(r.id),
    runId: Number(r.run_id),
    lane: r.lane === "mo" ? "mo" : "shop",
    category: r.category,
    title: r.title,
    fingerprint: r.fingerprint,
    rationaleMd: r.rationale_md,
    proposalMd: r.proposal_md,
    directiveText: r.directive_text,
    expectedEffect: r.expected_effect,
    impact: r.impact,
    effort: r.effort,
    evidence: Array.isArray(r.evidence_json)
      ? (r.evidence_json as unknown[]).filter((e): e is string => typeof e === "string")
      : [],
    status: (SUGGESTION_STATUSES.includes(r.status) ? r.status : "open") as SuggestionStatus,
    statusNote: r.status_note,
    statusChangedAt: r.status_changed_at == null ? null : String(r.status_changed_at),
    createdAt: String(r.created_at),
  };
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export async function createImprovementRun(
  input: {
    reportId: number;
    reportTitle: string;
    rangeFrom: string;
    rangeTo: string;
    promptHash: string;
    baseline: Record<string, unknown>;
    delta: Record<string, unknown> | null;
    /** First phase — 'wirkung' when there is history to check, else 'vorschlaege'. */
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

export async function listImprovementRuns(
  sql: Sql | null = getSql()
): Promise<ImprovementRunListItem[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT r.id, r.report_id, r.report_title, r.range_from, r.range_to,
             r.prompt_hash, r.status, r.phase, r.usage, r.created_at, r.completed_at,
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

export async function getImprovementRun(
  id: number,
  sql: Sql | null = getSql()
): Promise<ImprovementRunDetail | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT id, report_id, report_title, range_from, range_to, prompt_hash,
             baseline_json, delta_json, effect_check_md, status, phase, error,
             usage, created_at, completed_at
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
      suggestionCount: suggestions.length,
      baseline: (r.baseline_json as Record<string, unknown>) ?? null,
      delta: (r.delta_json as Record<string, unknown>) ?? null,
      effectCheckMd: r.effect_check_md,
      error: r.error,
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
export const STEP_CLAIM_TTL_MINUTES = 6;

/**
 * Atomically claim the run for ONE step (migration 0045). Returns
 *  - 'claimed' — proceed with the model call;
 *  - 'busy'    — another /step is live on this run (client should poll);
 *  - 'error'   — DB unavailable/failed (caller treats like busy: no work).
 * A stale claim (older than STEP_CLAIM_TTL_MINUTES) is taken over.
 */
export async function claimRunStep(
  id: number,
  sql: Sql | null = getSql()
): Promise<"claimed" | "busy" | "error"> {
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

export async function deleteImprovementRun(
  id: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    await sql`DELETE FROM improvement_runs WHERE id = ${id}`;
    return true;
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "delete" });
    return false;
  }
}

/** The most recent COMPLETED run — the yardstick a new run measures against. */
export async function getPreviousCompletedRun(
  sql: Sql | null = getSql()
): Promise<{ id: number; baseline: Record<string, unknown>; createdAt: string } | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT id, baseline_json, created_at
        FROM improvement_runs
       WHERE status = 'complete'
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `) as Array<{ id: number; baseline_json: unknown; created_at: string }>;
    if (rows.length === 0) return null;
    return {
      id: Number(rows[0].id),
      baseline: (rows[0].baseline_json as Record<string, unknown>) ?? {},
      createdAt: String(rows[0].created_at),
    };
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "previous" });
    return null;
  }
}

// ── Suggestions ───────────────────────────────────────────────────────────────

export async function insertSuggestions(
  runId: number,
  suggestions: Array<{
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
    evidence: string[];
  }>,
  sql: Sql | null = getSql()
): Promise<number> {
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

/**
 * The newest prior suggestions across ALL runs — what the engine must not
 * repeat (prompt input) and the fingerprint base for the hard dedup.
 */
export async function listPriorSuggestions(
  sql: Sql | null = getSql()
): Promise<PriorSuggestion[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, lane, title, fingerprint, status, expected_effect, status_note, created_at
        FROM improvement_suggestions
       ORDER BY created_at DESC, id DESC
       LIMIT ${PRIOR_SUGGESTIONS_LIMIT}
    `) as Array<{
      id: number;
      lane: string;
      title: string;
      fingerprint: string;
      status: string;
      expected_effect: string | null;
      status_note: string | null;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: Number(r.id),
      lane: r.lane === "mo" ? "mo" : "shop",
      title: r.title,
      fingerprint: r.fingerprint,
      status: (SUGGESTION_STATUSES.includes(r.status) ? r.status : "open") as SuggestionStatus,
      expectedEffect: r.expected_effect,
      statusNote: r.status_note,
      createdAt: String(r.created_at),
    }));
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "prior" });
    return [];
  }
}

export async function getSuggestion(
  id: number,
  sql: Sql | null = getSql()
): Promise<ImprovementSuggestion | null> {
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

/**
 * Prior accepted/implemented suggestions for the Wirkungs-Check pass — the
 * measures whose effect the new run assesses. Excludes the run being generated
 * (its suggestions don't exist yet, but be explicit anyway).
 */
export async function listMeasuresForEffectCheck(
  excludeRunId: number,
  sql: Sql | null = getSql()
): Promise<PriorSuggestion[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, lane, title, fingerprint, status, expected_effect, status_note, created_at
        FROM improvement_suggestions
       WHERE status IN ('accepted', 'implemented') AND run_id <> ${excludeRunId}
       ORDER BY created_at DESC, id DESC
       LIMIT ${PRIOR_SUGGESTIONS_LIMIT}
    `) as Array<{
      id: number;
      lane: string;
      title: string;
      fingerprint: string;
      status: string;
      expected_effect: string | null;
      status_note: string | null;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: Number(r.id),
      lane: r.lane === "mo" ? "mo" : "shop",
      title: r.title,
      fingerprint: r.fingerprint,
      status: (SUGGESTION_STATUSES.includes(r.status) ? r.status : "open") as SuggestionStatus,
      expectedEffect: r.expected_effect,
      statusNote: r.status_note,
      createdAt: String(r.created_at),
    }));
  } catch (err) {
    reportError(err, { route: "lib/improvement-store", phase: "measures" });
    return [];
  }
}
