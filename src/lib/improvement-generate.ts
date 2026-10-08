// The improvement engine ("Verbesserung" tab) — the server-only stepper that
// drives one run from 'running' to 'complete', ONE bounded unit of work per
// /step request (the shape of the Komplettanalyse stepper, so no request
// approaches maxDuration).
//
// A run (v2, docs/IMPROVEMENT_LOOP.md) is built on the BUSINESS SNAPSHOT of a
// period (lib/business-snapshot — the KPI screen's numbers, vs the previous
// period):
//   daten               — collect the snapshot; import the open
//                         recommendations of the chosen Komplettanalyse
//   messung             — measure every adopted directive / implemented change
//                         on its success metric (before/after windows, tests,
//                         confounders — improvement-effects.mjs), time-boxed
//   wirkungscheck       — strategist: keep / adjust / roll back / watch
//   vorschlaege_chat    — strategist: chat & prompt, widget, Mo's tools
//   vorschlaege_betrieb — strategist: operations, campaigns, development,
//                         legal + the run's headline
// The strategist passes run on Opus 5.5 (tier `strategist`, runStrategistObject:
// structured output, streamed, timeout below maxDuration, refusal fallback);
// a pass that times out or fails stays in its phase and is retried one rung
// lower on the effort ladder (high → medium → low); after that, or without an
// Anthropic key, the run moves on with a note — the deterministic parts
// (snapshot, measurement, imports) always complete.
//
// Human-in-the-loop boundary: the engine only ever PROPOSES. Nothing here
// mutates Mo's prompt, the directives, the catalog or any store content —
// adoption is an explicit admin action on the suggestion.

import { getAnalyticsReport, type AnalyticsReportDetail } from "./analytics-report-store";
import { getBusinessSnapshot, type BusinessSnapshot } from "./business-snapshot";
import { flattenSnapshot } from "./business-snapshot-core.mjs";
import { isDecisionReport, settleInFlightAttempt, strategistEffortForAttempt } from "./analytics-report-synthesis-core.mjs";
import { callTimeoutWithinStep } from "./object-stream.mjs";
import { mergeUsage } from "./analytics-report-core.mjs";
import { buildMoSelfSnapshot } from "./mo-self-snapshot";
import { listDirectives } from "./directives-store";
import { reportError } from "./observability";
import { runStrategistObject, STRATEGIST_MODEL } from "./strategist-call";
import { toYmd } from "./kpi-range.mjs";
import {
  RUN_VERSION,
  dedupeSuggestions,
  nextRunPhase,
  renderReportExtract,
  resolveRunPeriod,
} from "./improvement-core.mjs";
import { dayOf, snapshotMovers, summariseMeasurements, switchChanges } from "./improvement-effects.mjs";
import {
  EFFECT_REVIEW_ANSWER_TOKENS,
  IMPROVEMENT_STEP_MAX_DURATION_S,
  IMPROVEMENT_STRATEGIST_TIMEOUT_MS,
  MEASURE_STEP_BUDGET_MS,
  SUGGESTIONS_ANSWER_TOKENS,
  buildEffectReviewPrompt,
  buildSuggestionPrompt,
  importReportRecommendations,
  normalizeEffectReview,
  normalizeSuggestionsPayload,
  suggestionStorage,
} from "./improvement-decision.mjs";
import { effectReviewSchema, suggestionsSchema } from "./improvement-schemas.mjs";
import {
  createImprovementRun,
  getImprovementRun,
  getPreviousCompletedRun,
  claimRunStep,
  insertSuggestions,
  listPriorSuggestions,
  listSuggestionOrigins,
  releaseRunStep,
  saveImprovementRunState,
  updateImprovementRun,
  type ImprovementRunDetail,
  type SuggestionInsert,
} from "./improvement-store";
import { collectChanges, measurePending } from "./improvement-measure";
import type { EffectReview, Measurement, RunAnalysisV2, RunBaselineV2, RunPeriod, StrategistEffortName } from "./improvement-types";

type StrategistPhase = "wirkungscheck" | "vorschlaege_chat" | "vorschlaege_betrieb";

const PASS_LABELS: Record<StrategistPhase, string> = {
  wirkungscheck: "Wirkungs-Check",
  vorschlaege_chat: "Vorschläge für Chat, Prompt & Widget",
  vorschlaege_betrieb: "Vorschläge für Betrieb, Kampagnen, Entwicklung & Recht",
};

function todayUtc(): string {
  return toYmd(new Date());
}

export function emptyAnalysis(): RunAnalysisV2 {
  return {
    version: 2,
    measurement: { today: null, changes: null, measurements: [], switchHistory: [], previousRunId: null, done: false },
    review: null,
    synthesis: null,
    imported: 0,
    state: { attempts: {}, efforts: {}, model: null, notes: [] },
  };
}

/** The v2 payloads of a run (defaults filled), or null for a v1 run. */
function v2Of(run: ImprovementRunDetail): { baseline: RunBaselineV2; analysis: RunAnalysisV2 } | null {
  if (run.version !== 2 || !run.baseline) return null;
  const baseline = run.baseline as unknown as RunBaselineV2;
  const stored = (run.delta ?? {}) as Partial<RunAnalysisV2>;
  const empty = emptyAnalysis();
  const analysis: RunAnalysisV2 = {
    ...empty,
    ...stored,
    version: 2,
    measurement: { ...empty.measurement, ...(stored.measurement ?? {}) },
    state: { ...empty.state, ...(stored.state ?? {}), attempts: { ...(stored.state?.attempts ?? {}) }, efforts: { ...(stored.state?.efforts ?? {}) } },
  };
  return { baseline, analysis };
}

function pushNote(notes: string[], note: string): string[] {
  return notes.includes(note) ? notes : [...notes, note];
}

// ── Start ─────────────────────────────────────────────────────────────────────

export interface StartRunInput {
  /** A completed Komplettanalyse: its conversation insights feed the chat pass. */
  reportId?: number | null;
  /** "report" = the report's period; "7d" | "14d" | "30d" | "90d" = full days up to yesterday; "custom" = from/to. */
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  /** Import the report's open recommendations (decision reports only). Default true. */
  importRecommendations?: boolean;
}

export interface StartRunResult {
  ok: boolean;
  runId?: number;
  error?: "not_found" | "not_complete" | "bad_period" | "db_error";
}

/**
 * Create a run and decide its period. No model call and no snapshot here —
 * the client drives /step until done.
 */
export async function startImprovementRun(input: StartRunInput): Promise<StartRunResult> {
  let report: AnalyticsReportDetail | null = null;
  if (input.reportId != null) {
    report = await getAnalyticsReport(input.reportId);
    if (!report) return { ok: false, error: "not_found" };
    if (report.status !== "complete" || !report.sections) return { ok: false, error: "not_complete" };
  }
  const preset = input.preset ?? (report ? "report" : "30d");
  const period = resolveRunPeriod(
    { preset, from: input.from ?? null, to: input.to ?? null, reportRange: report ? { from: report.from, to: report.to } : null },
    todayUtc()
  ) as RunPeriod | null;
  if (!period) return { ok: false, error: "bad_period" };

  const self = await buildMoSelfSnapshot();
  const baseline: RunBaselineV2 = {
    version: RUN_VERSION,
    period,
    options: {
      reportId: report?.id ?? null,
      importRecommendations: Boolean(report && isDecisionReport(report.sections) && input.importRecommendations !== false),
    },
    snapshot: null,
  };
  const runId = await createImprovementRun({
    reportId: report?.id ?? null,
    reportTitle: report ? report.title : `Geschäftsdaten ${period.label}`,
    rangeFrom: period.from,
    rangeTo: period.to,
    promptHash: self.hash,
    baseline,
    delta: emptyAnalysis(),
    phase: "daten",
  });
  if (runId == null) return { ok: false, error: "db_error" };
  return { ok: true, runId };
}

// ── Step ──────────────────────────────────────────────────────────────────────

export interface RunStepResult {
  ok: boolean;
  status?: string;
  phase?: string;
  costEur?: number;
  done: boolean;
  /** True when another /step is already live on this run — poll, don't work. */
  busy?: boolean;
  error?: string;
  /** Progress details for the driver. */
  progress?: {
    measured: number;
    toMeasure: number | null;
    attempt: number;
    effort: StrategistEffortName | null;
    suggestions: number;
  };
}

function progressOf(run: ImprovementRunDetail): RunStepResult["progress"] {
  const v2 = v2Of(run);
  if (!v2) return undefined;
  const { analysis } = v2;
  const phase = run.phase as StrategistPhase;
  const attempt = analysis.state.attempts[phase] ?? 0;
  return {
    measured: analysis.measurement.measurements.length,
    toMeasure: analysis.measurement.changes ? analysis.measurement.changes.length : null,
    attempt,
    effort: (["wirkungscheck", "vorschlaege_chat", "vorschlaege_betrieb"].includes(run.phase)
      ? strategistEffortForAttempt(attempt)
      : null) as StrategistEffortName | null,
    suggestions: run.suggestions.length,
  };
}

/** Advance the run by one bounded unit of work. Never throws. */
export async function stepImprovementRun(id: number): Promise<RunStepResult> {
  const stepStartedAt = Date.now();
  const run = await getImprovementRun(id);
  if (!run) return { ok: false, done: true, error: "not_found" };
  if (run.status !== "running") {
    return { ok: true, status: run.status, phase: run.phase, costEur: run.costEur, done: true, progress: progressOf(run) };
  }

  // Retry-safety (migration 0045): a retried request while the original is
  // still working becomes a cheap "busy" poll. 'error' (claim not possible)
  // falls through fail-open — the pre-claim behaviour.
  const claim = await claimRunStep(id);
  if (claim === "busy") {
    return { ok: true, status: run.status, phase: run.phase, costEur: run.costEur, done: false, busy: true, progress: progressOf(run) };
  }

  let busy = false;
  try {
    const v2 = v2Of(run);
    if (!v2) {
      await upgradeLegacyRun(run);
    } else {
      switch (run.phase) {
        case "daten":
          await stepData(run, v2.baseline, v2.analysis);
          break;
        case "messung":
          await stepMeasure(run, v2.baseline, v2.analysis);
          break;
        case "wirkungscheck":
          busy = (await stepEffectReview(run, v2.baseline, v2.analysis, stepStartedAt)) === "busy";
          break;
        case "vorschlaege_chat":
        case "vorschlaege_betrieb":
          busy = (await stepSuggestions(run, v2.baseline, v2.analysis, run.phase, stepStartedAt)) === "busy";
          break;
        default:
          await updateImprovementRun(id, { status: "complete", phase: "done", completed: true });
      }
    }
  } catch (err) {
    reportError(err, { route: "lib/improvement-generate", phase: run.phase });
    const message = err instanceof Error ? err.message : String(err);
    await updateImprovementRun(id, { status: "failed", error: message.slice(0, 500) });
    return { ok: true, status: "failed", phase: run.phase, done: true, error: message };
  }

  if (busy) {
    // Another step is still inside its strategist call (in-flight mark) —
    // nothing was done here; hand the claim back and let the client poll.
    if (claim === "claimed") await releaseRunStep(id);
    return { ok: true, status: run.status, phase: run.phase, costEur: run.costEur, done: false, busy: true, progress: progressOf(run) };
  }

  const after = await getImprovementRun(id);
  if (!after) return { ok: false, done: true, error: "not_found" };
  return {
    ok: true,
    status: after.status,
    phase: after.phase,
    costEur: after.costEur,
    done: after.status !== "running",
    progress: progressOf(after),
  };
}

/**
 * A run started before the snapshot rework that is still running: it
 * continues as a v2 run over its report's period (its existing suggestions
 * stay).
 */
async function upgradeLegacyRun(run: ImprovementRunDetail): Promise<void> {
  const period = resolveRunPeriod({ preset: "report", reportRange: { from: run.rangeFrom, to: run.rangeTo } }, todayUtc()) as RunPeriod | null;
  if (!period) throw new Error("Zeitraum des Laufs ist nicht lesbar — bitte löschen und neu starten.");
  const baseline: RunBaselineV2 = {
    version: RUN_VERSION,
    period,
    options: { reportId: run.reportId, importRecommendations: false },
    snapshot: null,
    upgradedFrom: 1,
  };
  const analysis = emptyAnalysis();
  analysis.state.notes = ["Vor der Umstellung auf die Geschäftsdaten gestartet und mit dem neuen Ablauf fortgesetzt."];
  await updateImprovementRun(run.id, { phase: "daten", baseline, delta: analysis });
}

// ── Phase: daten ──────────────────────────────────────────────────────────────

async function stepData(run: ImprovementRunDetail, baseline: RunBaselineV2, analysis: RunAnalysisV2): Promise<void> {
  const { period, options } = baseline;
  const [snapshot, previousRun, report] = await Promise.all([
    // The Shopify cross-check of the Mo codes goes through the KPI screen's
    // 10-minute cache and is bounded inside the snapshot (45 s).
    getBusinessSnapshot({ from: period.from, to: period.to }, { includeShopify: true }),
    getPreviousCompletedRun(run.id),
    options.reportId != null && options.importRecommendations ? getAnalyticsReport(options.reportId) : Promise.resolve(null),
  ]);
  const today = todayUtc();

  let notes = analysis.state.notes;
  const switchHistory =
    previousRun?.switches && previousRun.version === 2
      ? switchChanges(previousRun.switches, snapshot.switches, { from: dayOf(previousRun.createdAt) ?? today, to: today })
      : [];
  if (!previousRun || previousRun.version !== 2) {
    notes = pushNote(notes, "Schalter-Historie beginnt mit diesem Lauf — Schalter-Änderungen vor ihm sind nicht bekannt.");
  }

  let imported = analysis.imported;
  if (report?.sections && isDecisionReport(report.sections)) {
    const existing = await listSuggestionOrigins();
    const recs = importReportRecommendations(report.sections, {
      reportId: report.id,
      reportTitle: report.title,
      flat: flattenSnapshot(snapshot),
      existing,
    });
    imported += await insertSuggestions(run.id, recs.map((s) => suggestionStorage(s) as SuggestionInsert));
  }

  await updateImprovementRun(run.id, {
    phase: nextRunPhase("daten"),
    baseline: { ...baseline, snapshot },
    delta: {
      ...analysis,
      imported,
      measurement: { ...analysis.measurement, switchHistory, previousRunId: previousRun?.id ?? null },
      state: { ...analysis.state, notes },
    },
  });
}

// ── Phase: messung ────────────────────────────────────────────────────────────

async function stepMeasure(run: ImprovementRunDetail, baseline: RunBaselineV2, analysis: RunAnalysisV2): Promise<void> {
  const snapshot = baseline.snapshot;
  const reference = snapshot ? flattenSnapshot(snapshot) : {};
  const m = { ...analysis.measurement };
  if (!m.today) m.today = todayUtc();
  if (!m.changes) m.changes = await collectChanges(reference, m.today);

  const added = await measurePending({
    changes: m.changes,
    measured: m.measurements,
    today: m.today,
    switchHistory: m.switchHistory,
    reference,
    budgetMs: MEASURE_STEP_BUDGET_MS,
  });
  const order = new Map(m.changes.map((c, i) => [c.ref, i]));
  m.measurements = [...m.measurements, ...added].sort((a, b) => (order.get(a.ref) ?? 0) - (order.get(b.ref) ?? 0));
  m.done = m.measurements.length >= m.changes.length;

  await updateImprovementRun(run.id, {
    phase: m.done ? nextRunPhase("messung", { hasAssessable: summariseMeasurements(m.measurements).assessable }) : "messung",
    delta: { ...analysis, measurement: m },
  });
}

// ── Strategist phases ─────────────────────────────────────────────────────────

/**
 * Bookkeeping shared by the three strategist passes: the effort of this
 * attempt, and how to move on (success, give up with a note, or stay for a
 * retry one rung lower). An attempt whose step the platform killed (its
 * in-flight mark is still stored) counts as failed; a mark that may still
 * belong to a running step makes this step answer "busy" (`live`).
 */
function ladder(run: ImprovementRunDetail, analysis: RunAnalysisV2, phase: StrategistPhase, stepStartedAt: number) {
  const label = PASS_LABELS[phase];
  const settled = settleInFlightAttempt(analysis.state.attempts[phase] ?? 0, analysis.state.inFlight, phase);
  const attempts = settled.attempts;
  const effort = strategistEffortForAttempt(attempts) as StrategistEffortName | null;
  const killedEffort = settled.interrupted ? (strategistEffortForAttempt(attempts - 1) ?? "?") : null;
  // Every write of this step starts from this state: the recovered attempt
  // count, a note for a killed attempt, no in-flight mark.
  const state: RunAnalysisV2["state"] = {
    ...analysis.state,
    attempts: { ...analysis.state.attempts, [phase]: attempts },
    notes: killedEffort
      ? pushNote(
          analysis.state.notes,
          `${label}: Versuch mit Denktiefe „${killedEffort}“ vom Server nach ${IMPROVEMENT_STEP_MAX_DURATION_S} s abgebrochen.`
        )
      : analysis.state.notes,
    inFlight: null,
  };
  const base: RunAnalysisV2 = { ...analysis, state };
  const next = nextRunPhase(phase);
  const finish = async (patch: Partial<RunAnalysisV2>, extra: { usage?: ImprovementRunDetail["usage"]; effectCheckMd?: string | null } = {}) => {
    const done = next === "done";
    await updateImprovementRun(run.id, {
      phase: next,
      ...(done ? { status: "complete" as const, completed: true } : {}),
      ...(extra.usage ? { usage: extra.usage } : {}),
      ...(extra.effectCheckMd ? { effectCheckMd: extra.effectCheckMd } : {}),
      delta: { ...base, ...patch },
    });
  };
  const skip = async (note: string, usage?: ImprovementRunDetail["usage"]) => {
    await finish({ state: { ...state, notes: pushNote(state.notes, note) } }, { usage });
  };
  const retryOrSkip = async (message: string, usage: ImprovementRunDetail["usage"]) => {
    const nextAttempts = attempts + 1;
    const retryState = { ...state, attempts: { ...state.attempts, [phase]: nextAttempts } };
    if (strategistEffortForAttempt(nextAttempts) === null) {
      await finish({ state: { ...retryState, notes: pushNote(retryState.notes, `${label} nicht erstellt (${message}).`) } }, { usage });
      return;
    }
    await updateImprovementRun(run.id, { phase, usage, delta: { ...base, state: retryState } });
  };
  const succeeded = (eff: StrategistEffortName) => {
    let notes = state.notes;
    if (attempts > 0) notes = pushNote(notes, `${label} im ${attempts + 1}. Versuch mit Denktiefe „${eff}“ erstellt (vorher Zeitlimit oder Fehler).`);
    return { ...state, notes, model: STRATEGIST_MODEL, efforts: { ...state.efforts, [phase]: eff } };
  };
  /** Mark the attempt right before the minutes-long call (the step claim stays held). */
  const markInFlight = () =>
    saveImprovementRunState(run.id, {
      ...base,
      state: { ...state, inFlight: { pass: phase, attempt: attempts, startedAt: new Date().toISOString() } },
    });
  /** The call's abort timeout: the cap, or less when the step's earlier work took long. */
  const timeoutMs = () =>
    callTimeoutWithinStep({ stepStartedAt, maxDurationS: IMPROVEMENT_STEP_MAX_DURATION_S, capMs: IMPROVEMENT_STRATEGIST_TIMEOUT_MS });
  return { attempts, effort, label, live: settled.live, finish, skip, retryOrSkip, succeeded, markInFlight, timeoutMs };
}

async function stepEffectReview(
  run: ImprovementRunDetail,
  baseline: RunBaselineV2,
  analysis: RunAnalysisV2,
  stepStartedAt: number
): Promise<"busy" | void> {
  const l = ladder(run, analysis, "wirkungscheck", stepStartedAt);
  if (l.live) return "busy";
  if (!process.env.ANTHROPIC_API_KEY) return l.skip(`Anthropic-Key fehlt — ${l.label} übersprungen; die Messung steht.`);
  if (!baseline.snapshot) return l.skip(`Keine Geschäftsdaten — ${l.label} übersprungen.`);
  if (l.effort === null) return l.skip(`${l.label} nach ${l.attempts} Versuchen nicht erstellt.`);

  const measurements = analysis.measurement.measurements as Measurement[];
  const directives = await listDirectives();
  await l.markInFlight();
  const res = await runStrategistObject({
    schema: effectReviewSchema,
    ...buildEffectReviewPrompt({ snapshot: baseline.snapshot, movers: snapshotMovers(baseline.snapshot), measurements, directives }),
    answerTokens: EFFECT_REVIEW_ANSWER_TOKENS,
    callSite: "improvement",
    effort: l.effort,
    timeoutMs: l.timeoutMs(),
    label: "improvement-effects",
  });
  const usage = mergeUsage(run.usage, res.model, res.inputTokens, res.outputTokens);
  if (res.ok) {
    const review = normalizeEffectReview(res.object, measurements.map((m) => m.ref)) as EffectReview;
    return l.finish({ review, state: l.succeeded(l.effort) }, { usage, effectCheckMd: review.summary });
  }
  if (res.reason === "unconfigured") return l.skip(`Anthropic-Key fehlt — ${l.label} übersprungen; die Messung steht.`, usage);
  return l.retryOrSkip(res.message, usage);
}

async function stepSuggestions(
  run: ImprovementRunDetail,
  baseline: RunBaselineV2,
  analysis: RunAnalysisV2,
  pass: "vorschlaege_chat" | "vorschlaege_betrieb",
  stepStartedAt: number
): Promise<"busy" | void> {
  const l = ladder(run, analysis, pass, stepStartedAt);
  if (l.live) return "busy";
  if (!process.env.ANTHROPIC_API_KEY) return l.skip(`Anthropic-Key fehlt — ${l.label} übersprungen.`);
  if (!baseline.snapshot) return l.skip(`Keine Geschäftsdaten — ${l.label} übersprungen.`);
  if (l.effort === null) return l.skip(`${l.label} nach ${l.attempts} Versuchen nicht erstellt.`);

  const isChat = pass === "vorschlaege_chat";
  const reportId = baseline.options.reportId;
  const [prior, directives, self, report] = await Promise.all([
    listPriorSuggestions(),
    listDirectives(),
    isChat ? buildMoSelfSnapshot() : Promise.resolve(null),
    reportId != null && isChat ? getAnalyticsReport(reportId) : Promise.resolve(null),
  ]);
  const snapshot: BusinessSnapshot = baseline.snapshot;
  const flat = flattenSnapshot(snapshot);
  await l.markInFlight();
  const res = await runStrategistObject({
    schema: suggestionsSchema(pass),
    ...buildSuggestionPrompt(pass, {
      snapshot,
      movers: snapshotMovers(snapshot),
      measurements: analysis.measurement.measurements,
      review: analysis.review,
      backlog: prior,
      directives,
      selfSnapshot: self?.text ?? null,
      reportExtract: report?.sections ? renderReportExtract(report.sections) : null,
      reportTitle: report?.title ?? null,
      earlier: run.suggestions.filter((s) => s.details?.origin?.kind !== "report").map((s) => ({ lane: s.ownerLane, title: s.title })),
    }),
    answerTokens: SUGGESTIONS_ANSWER_TOKENS,
    callSite: "improvement",
    effort: l.effort,
    timeoutMs: l.timeoutMs(),
    label: `improvement-${pass}`,
  });
  const usage = mergeUsage(run.usage, res.model, res.inputTokens, res.outputTokens);
  if (!res.ok) {
    if (res.reason === "unconfigured") return l.skip(`Anthropic-Key fehlt — ${l.label} übersprungen.`, usage);
    return l.retryOrSkip(res.message, usage);
  }

  const out = normalizeSuggestionsPayload(res.object, { flat, pass });
  // Hard dedup against every non-dismissed prior suggestion AND this run's own
  // (imports and the earlier pass) — the prompt also forbids repeats.
  const existing = [
    ...prior.filter((p) => p.status !== "dismissed").map((p) => p.fingerprint),
    ...run.suggestions.map((s) => s.fingerprint),
  ];
  const fresh = dedupeSuggestions(out.suggestions, existing) as typeof out.suggestions;
  await insertSuggestions(run.id, fresh.map((s) => suggestionStorage(s) as SuggestionInsert));
  return l.finish(
    {
      state: l.succeeded(l.effort),
      ...(isChat ? {} : { synthesis: { headline: out.headline, summary: out.summary } }),
    },
    { usage }
  );
}
