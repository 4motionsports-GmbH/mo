// Pure helpers for the "Komplettanalyse" analytics report. No I/O, no DB, no
// model — imported by the data layer (analytics-report-store.ts), the generation
// stepper (analytics-report-generate.ts), the PDF builder (analytics-report-pdf.mjs)
// AND the node:test suite, so it stays a plain .mjs (like ai-pricing.mjs /
// conversation-analysis-core.mjs / kpi-range.mjs).
//
// It owns: the generation phase state-machine, the option normaliser, the
// default-title builder, the per-model usage accumulator + EUR pricing, and the
// up-front cost estimate shown before the operator confirms a (deliberately
// expensive) full run.

import { usdCostForUsage, usdToEur } from "./ai-pricing.mjs";
import { germanDate } from "./kpi-range.mjs";

// ── Models ────────────────────────────────────────────────────────────────────
// The models each generation phase calls. These MUST match the model ids the
// underlying libs use (conversation-analysis / conversation-insights = Haiku;
// kpi-top-questions = Sonnet; customer-profile = Opus) so the up-front estimate
// and the recorded spend price against the same table (lib/ai-pricing.mjs).

export const ANALYZE_MODEL = "claude-haiku-4-5";
export const INSIGHTS_MODEL = "claude-haiku-4-5";
export const PERSONA_MODEL = "claude-sonnet-4-6";
export const SYNTHESIS_MODEL = "claude-sonnet-4-6";
export const PROFILE_MODEL = "claude-opus-4-8";

// ── Phase state-machine ───────────────────────────────────────────────────────
// The generation runs as an ordered set of phases, advanced one bounded chunk per
// /step call. `customer_profiles` (the expensive per-customer Opus pass) is only
// in the active set when the operator opted into per-customer knowledge.

export const PHASE_ORDER = [
  "analyze", // per-conversation AI analysis for every conversation in the window
  "insights", // aggregate insights rollup over the cached summaries
  "personas", // per-persona top-questions (range-scoped)
  "customer_synthesis", // aggregate, pseudonymous customer-knowledge synthesis
  "customer_profiles", // OPTIONAL per-customer "current understanding" (identity)
  "assemble", // pure aggregations + finalise the sections payload
  "done",
];

/** German labels for the progress UI. */
export const PHASE_LABELS = {
  analyze: "Gespräche analysieren",
  insights: "Insights verdichten",
  personas: "Personas & Top-Fragen",
  customer_synthesis: "Kundenwissen (aggregiert)",
  customer_profiles: "Kundenprofile (pro Kunde)",
  assemble: "Bericht zusammenstellen",
  done: "Fertig",
};

/**
 * The ordered phases that actually run for the given options — drops
 * `customer_profiles` when per-customer knowledge wasn't requested.
 */
export function phasesFor(options) {
  const includePerCustomer = options?.includePerCustomer === true;
  return PHASE_ORDER.filter(
    (p) => p !== "customer_profiles" || includePerCustomer
  );
}

/** The phase that follows `current` for these options, or 'done' at the end. */
export function nextPhase(current, options) {
  const phases = phasesFor(options);
  const i = phases.indexOf(current);
  if (i === -1) return "done";
  return phases[i + 1] ?? "done";
}

/** Zero-based index of `phase` within the active set (for a progress bar). -1 if absent. */
export function phaseIndex(phase, options) {
  return phasesFor(options).indexOf(phase);
}

// ── Options ───────────────────────────────────────────────────────────────────

/** Hard ceilings so a single report can never run unbounded. Surfaced in the UI. */
export const MAX_ANALYZE_CAP = 5000;
export const DEFAULT_MAX_ANALYZE = 2000;
export const MAX_PROFILES_CAP = 100;
export const DEFAULT_MAX_PROFILES = 40;

function clampInt(v, min, max, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Normalise the raw options posted at creation into a validated, bounded shape.
 * Defaults: appendix on (the report is "everything in one place"), per-customer
 * profiles OFF unless explicitly requested (it's the expensive, identity-laden
 * pass).
 */
export function normalizeOptions(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  return {
    includePerCustomer: o.includePerCustomer === true,
    includeAppendix: o.includeAppendix !== false,
    maxAnalyze: clampInt(o.maxAnalyze, 1, MAX_ANALYZE_CAP, DEFAULT_MAX_ANALYZE),
    maxProfiles: clampInt(o.maxProfiles, 0, MAX_PROFILES_CAP, DEFAULT_MAX_PROFILES),
  };
}

// ── Title ─────────────────────────────────────────────────────────────────────

/** A stable, human-readable German title for the sidebar from the interval. */
export function defaultReportTitle(from, to, preset) {
  const presetLabel = {
    day: "Tag",
    week: "Woche",
    month: "Monat",
  }[preset];
  const window = from === to ? germanDate(from) : `${germanDate(from)} – ${germanDate(to)}`;
  return presetLabel
    ? `Komplettanalyse · ${presetLabel} · ${window}`
    : `Komplettanalyse · ${window}`;
}

// ── Usage accumulator + pricing ───────────────────────────────────────────────
// The report calls several models; we keep a per-model {input,output} sum so the
// EUR cost is priced in JS (one source of truth) and shown for free on every read.

/** Return a NEW usage object with `model`'s token counts incremented. */
export function mergeUsage(usage, model, inputTokens, outputTokens) {
  const next = usage && typeof usage === "object" ? { ...usage } : {};
  if (!model) return next;
  const cur = next[model] && typeof next[model] === "object" ? next[model] : { input: 0, output: 0 };
  const addIn = Number.isFinite(Number(inputTokens)) ? Math.max(0, Math.floor(Number(inputTokens))) : 0;
  const addOut = Number.isFinite(Number(outputTokens)) ? Math.max(0, Math.floor(Number(outputTokens))) : 0;
  next[model] = {
    input: Math.max(0, Math.floor(Number(cur.input) || 0)) + addIn,
    output: Math.max(0, Math.floor(Number(cur.output) || 0)) + addOut,
  };
  return next;
}

/** Total {input, output} tokens across all models in a usage object. */
export function totalTokens(usage) {
  let input = 0;
  let output = 0;
  for (const v of Object.values(usage ?? {})) {
    input += Math.max(0, Math.floor(Number(v?.input) || 0));
    output += Math.max(0, Math.floor(Number(v?.output) || 0));
  }
  return { input, output };
}

/** EUR cost of a per-model usage object, priced via the env-overridable table. */
export function reportCostEur(usage, prices, rate) {
  let usd = 0;
  for (const [model, v] of Object.entries(usage ?? {})) {
    usd += usdCostForUsage(
      { model, inputTokens: Number(v?.input) || 0, outputTokens: Number(v?.output) || 0 },
      prices
    );
  }
  return usdToEur(usd, rate);
}

// ── Up-front cost estimate ────────────────────────────────────────────────────
// Rough per-unit token figures for the parts of a run, used to show "ca. €X"
// BEFORE the operator confirms. The analyze figures mirror conversation-analysis-
// core's bulk estimate; the rest are conservative single-pass estimates.

const EST = {
  analyze: { in: 3000, out: 250, model: ANALYZE_MODEL },
  insights: { in: 6000, out: 1300, model: INSIGHTS_MODEL },
  persona: { in: 5000, out: 450, model: PERSONA_MODEL },
  synthesis: { in: 6000, out: 1100, model: SYNTHESIS_MODEL },
  profile: { in: 9000, out: 1300, model: PROFILE_MODEL },
};

function n(v) {
  const x = Math.floor(Number(v));
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/**
 * Estimated USD cost of a full run. Inputs are the counts known up front:
 * conversations still to analyse, distinct personas, and (when per-customer is
 * on) the number of active customers to profile.
 */
export function estimateReportCostUsd(input, prices) {
  const conversations = n(input?.conversationsToAnalyze);
  const personas = n(input?.personaCount);
  const customers = input?.includePerCustomer ? n(input?.customerCount) : 0;

  const unit = (key, count) =>
    usdCostForUsage(
      { model: EST[key].model, inputTokens: EST[key].in * count, outputTokens: EST[key].out * count },
      prices
    );

  return (
    unit("analyze", conversations) +
    unit("insights", 1) +
    unit("persona", personas) +
    unit("synthesis", 1) +
    unit("profile", customers)
  );
}
