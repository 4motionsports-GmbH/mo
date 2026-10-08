// Time budgets of one Komplettanalyse step outside the strategist passes —
// the pure core behind analytics-report-generate.ts (analyze, insights,
// personas, customer_synthesis, customer_profiles).
//
// /api/admin/analytics/step runs at most STEP_MAX_DURATION_S (300 s). Every
// model call in a step gets an abort timeout from callTimeoutWithinStep
// (object-stream.mjs: the call's cap, shortened by the time the step already
// used, 40 s kept back for the writes after it) and at most one SDK retry; the
// loops stop STARTING items once the step has used its share. What a step
// leaves undone waits for the next step; a call that times out is one failed
// item with a note, never a failed report and never a replayed step.

import { callTimeoutWithinStep } from "./object-stream.mjs";
import { STEP_MAX_DURATION_S } from "./analytics-report-synthesis-core.mjs";

// ── Per-call caps (abort timeouts) ────────────────────────────────────────────
// Sized from the output ceilings (maxOutputTokensFor: answer + thinking
// headroom) — a normal call needs a fraction of its cap.

/** One Haiku conversation analysis (600 output tokens, seconds normally). */
export const ANALYSIS_CALL_CAP_MS = 45_000;
/** The insights narrative pass (Sonnet, ≤ 12.5k output tokens). */
export const INSIGHTS_REPORT_CAP_MS = 170_000;
/** The insights refs pass gets what is left of the step; below this it is skipped. */
export const INSIGHTS_REFS_MIN_MS = 30_000;
/** One persona's top questions (Sonnet writer tier, ≤ 4.5k output tokens). */
export const PERSONA_CALL_CAP_MS = 110_000;
/** The aggregate customer synthesis (Sonnet analyst tier, ≤ 9.2k output tokens). */
export const SYNTHESIS_CALL_CAP_MS = 200_000;
/** One customer profile (Opus deep tier, ≤ 10k output tokens), its loads included. */
export const PROFILE_CALL_CAP_MS = 200_000;
/** The best-effort Shopify purchase refresh before a profile in a report run. */
export const PROFILE_REFRESH_TIMEOUT_MS = 20_000;

// ── When a loop may start one more item ───────────────────────────────────────

/** stepAnalyze starts no further analysis once the step has run this long. */
export const ANALYZE_START_UNTIL_MS = 150_000;
/** stepPersonas starts no further persona with less than 120 s of the step left. */
export const PERSONA_START_UNTIL_MS = STEP_MAX_DURATION_S * 1000 - 120_000;

/**
 * May a step loop start another item? The first item of a step always may —
 * otherwise a slow start would stall the phase for good.
 *
 * @param {{ stepStartedAt: number, startedThisStep: number, startUntilMs: number, now?: number }} p
 * @returns {boolean}
 */
export function mayStartAnother({ stepStartedAt, startedThisStep, startUntilMs, now = Date.now() }) {
  if (!(Number(startedThisStep) > 0)) return true;
  const elapsed = Number.isFinite(stepStartedAt) ? Math.max(0, now - stepStartedAt) : 0;
  return elapsed < startUntilMs;
}

/**
 * Abort timeout of the insights refs pass, asked once the narrative is done:
 * whatever the step has left after its reserve, or 0 (skip the pass — the
 * narrative is kept without curated refs) when that is under
 * INSIGHTS_REFS_MIN_MS.
 *
 * @param {{ stepStartedAt: number, maxDurationS?: number, now?: number }} p
 * @returns {number}
 */
export function refsPassTimeoutMs({ stepStartedAt, maxDurationS = STEP_MAX_DURATION_S, now = Date.now() }) {
  const left = callTimeoutWithinStep({ stepStartedAt, maxDurationS, capMs: maxDurationS * 1000, floorMs: 0, now });
  return left >= INSIGHTS_REFS_MIN_MS ? left : 0;
}

/**
 * Items a step took from its queue but did not start go back to the FRONT,
 * in their order, so the next step picks them first.
 *
 * @template T
 * @param {T[] | null | undefined} queue
 * @param {T[] | null | undefined} items
 * @returns {T[]}
 */
export function requeueFront(queue, items) {
  return [...(Array.isArray(items) ? items : []), ...(Array.isArray(queue) ? queue : [])];
}

// ── Failed analyses ───────────────────────────────────────────────────────────
// A failed analysis writes nothing to the conversation, so the next step's
// "not yet analysed" query returned the same ids again: with ANALYZE_BATCH of
// them failing for good (unusable model output, a row that cannot be read) the
// analyze phase never ended. The report therefore remembers its failed ids in
// the scratch and leaves them out — they stay unanalysed, so a later report or
// the Gespräche button tries them again. A run of failures with no success in
// between (key revoked, provider down) ends the phase instead of walking
// through every conversation.

/** Failed analyses in a row that end the analyze phase. */
export const ANALYZE_FAIL_STREAK_LIMIT = 24;

/**
 * @typedef {{ skip: number[], failStreak: number }} AnalyzeLedger
 */

/**
 * The ledger from the stored scratch (tolerates missing or broken values).
 *
 * @param {{ analyzeSkip?: unknown, analyzeFailStreak?: unknown } | null | undefined} scratch
 * @returns {AnalyzeLedger}
 */
export function readAnalyzeLedger(scratch) {
  const raw = Array.isArray(scratch?.analyzeSkip) ? scratch.analyzeSkip : [];
  const skip = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const streak = Math.floor(Number(scratch?.analyzeFailStreak));
  return { skip, failStreak: Number.isFinite(streak) && streak > 0 ? streak : 0 };
}

/**
 * Record one analysis outcome: a success resets the streak, a failure skips
 * the id for the rest of the report and extends the streak.
 *
 * @param {AnalyzeLedger} ledger
 * @param {number} id
 * @param {boolean} ok
 * @returns {AnalyzeLedger}
 */
export function noteAnalyzeResult(ledger, id, ok) {
  if (ok) return { skip: ledger.skip, failStreak: 0 };
  const skip = ledger.skip.includes(id) ? ledger.skip : [...ledger.skip, id];
  return { skip, failStreak: ledger.failStreak + 1 };
}

/**
 * True once so many analyses failed in a row that the phase should end.
 *
 * @param {AnalyzeLedger} ledger
 * @param {number} [limit]
 */
export function analyzeGaveUp(ledger, limit = ANALYZE_FAIL_STREAK_LIMIT) {
  return ledger.failStreak >= limit;
}
