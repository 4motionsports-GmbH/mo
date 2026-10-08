import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_CALL_CAP_MS,
  ANALYZE_FAIL_STREAK_LIMIT,
  ANALYZE_START_UNTIL_MS,
  INSIGHTS_REFS_MIN_MS,
  INSIGHTS_REPORT_CAP_MS,
  PERSONA_CALL_CAP_MS,
  PERSONA_START_UNTIL_MS,
  PROFILE_CALL_CAP_MS,
  PROFILE_REFRESH_TIMEOUT_MS,
  SYNTHESIS_CALL_CAP_MS,
  analyzeGaveUp,
  mayStartAnother,
  noteAnalyzeResult,
  readAnalyzeLedger,
  refsPassTimeoutMs,
  requeueFront,
} from "./analytics-report-budget.mjs";
import { STEP_RESERVE_MS, callTimeoutWithinStep } from "./object-stream.mjs";
import { STEP_MAX_DURATION_S } from "./analytics-report-synthesis-core.mjs";

const T0 = 1_000_000;
const STEP_MS = STEP_MAX_DURATION_S * 1000;
const at = (s) => T0 + s * 1000;
const timeout = (capMs, s) => callTimeoutWithinStep({ stepStartedAt: T0, maxDurationS: STEP_MAX_DURATION_S, capMs, now: at(s) });

test("the first item of a step always starts, later ones only inside the budget", () => {
  const p = { stepStartedAt: T0, startUntilMs: ANALYZE_START_UNTIL_MS };
  assert.equal(mayStartAnother({ ...p, startedThisStep: 0, now: at(280) }), true);
  assert.equal(mayStartAnother({ ...p, startedThisStep: 5, now: at(149) }), true);
  assert.equal(mayStartAnother({ ...p, startedThisStep: 5, now: at(150) }), false);
  // A missing start counts as a fresh step.
  assert.equal(mayStartAnother({ ...p, stepStartedAt: Number.NaN, startedThisStep: 3, now: at(200) }), true);
});

test("personas: no second call with less than 120 s left", () => {
  const p = { stepStartedAt: T0, startedThisStep: 1, startUntilMs: PERSONA_START_UNTIL_MS };
  assert.equal(mayStartAnother({ ...p, now: at(179) }), true);
  assert.equal(mayStartAnother({ ...p, now: at(181) }), false);
});

test("the refs pass gets what is left, or is skipped under 30 s", () => {
  // Narrative done after 172 s: 300 − 172 − 40 = 88 s.
  assert.equal(refsPassTimeoutMs({ stepStartedAt: T0, now: at(172) }), STEP_MS - 172_000 - STEP_RESERVE_MS);
  assert.equal(refsPassTimeoutMs({ stepStartedAt: T0, now: at(229) }), 31_000);
  assert.equal(refsPassTimeoutMs({ stepStartedAt: T0, now: at(231) }), 0);
  assert.equal(refsPassTimeoutMs({ stepStartedAt: T0, now: at(400) }), 0);
  assert.ok(INSIGHTS_REFS_MIN_MS === 30_000);
});

test("worst cases stay inside the step (calls end before the reserve)", () => {
  const end = STEP_MS - STEP_RESERVE_MS;
  // analyze: the last analysis may start just before 150 s.
  assert.ok(ANALYZE_START_UNTIL_MS + timeout(ANALYSIS_CALL_CAP_MS, 149.9) <= end);
  // insights: narrative from ~2 s, refs pass with what is left.
  const narrativeEnd = 2 + timeout(INSIGHTS_REPORT_CAP_MS, 2) / 1000;
  assert.ok(narrativeEnd * 1000 + refsPassTimeoutMs({ stepStartedAt: T0, now: at(narrativeEnd) }) <= end);
  // personas: the second call starts at the latest at the start limit.
  assert.ok(PERSONA_START_UNTIL_MS + timeout(PERSONA_CALL_CAP_MS, PERSONA_START_UNTIL_MS / 1000) <= end);
  // synthesis and profile: one call from the step start.
  assert.ok(2_000 + timeout(SYNTHESIS_CALL_CAP_MS, 2) <= end);
  assert.ok(2_000 + timeout(PROFILE_CALL_CAP_MS, 2) <= end);
  assert.ok(PROFILE_REFRESH_TIMEOUT_MS < PROFILE_CALL_CAP_MS);
});

test("requeueFront puts unstarted items back first, in order", () => {
  assert.deepEqual(requeueFront(["c", "d"], ["a", "b"]), ["a", "b", "c", "d"]);
  assert.deepEqual(requeueFront([], ["a"]), ["a"]);
  assert.deepEqual(requeueFront(null, null), []);
});

test("a failed analysis is skipped for the rest of the report", () => {
  let l = readAnalyzeLedger({});
  assert.deepEqual(l, { skip: [], failStreak: 0 });
  l = noteAnalyzeResult(l, 7, false);
  l = noteAnalyzeResult(l, 9, false);
  assert.deepEqual(l, { skip: [7, 9], failStreak: 2 });
  l = noteAnalyzeResult(l, 11, true);
  assert.deepEqual(l, { skip: [7, 9], failStreak: 0 });
  // The same id twice stays one entry.
  assert.deepEqual(noteAnalyzeResult(l, 7, false).skip, [7, 9]);
});

test("the ledger survives the stored scratch", () => {
  assert.deepEqual(readAnalyzeLedger({ analyzeSkip: [3, "4", 3, -1, "x", 2.5], analyzeFailStreak: "5" }), {
    skip: [3, 4],
    failStreak: 5,
  });
  assert.deepEqual(readAnalyzeLedger({ analyzeSkip: "nope", analyzeFailStreak: -2 }), { skip: [], failStreak: 0 });
  assert.deepEqual(readAnalyzeLedger(null), { skip: [], failStreak: 0 });
});

test("a run of failures ends the phase, ids failing for good do not", () => {
  // 12 ids that always fail, then working ones: skipped once, the streak resets.
  let l = readAnalyzeLedger({});
  for (let id = 1; id <= 12; id++) l = noteAnalyzeResult(l, id, false);
  assert.equal(analyzeGaveUp(l), false);
  l = noteAnalyzeResult(l, 13, true);
  assert.equal(l.failStreak, 0);
  // Everything failing (provider down): the phase ends after the limit.
  for (let id = 100; id < 100 + ANALYZE_FAIL_STREAK_LIMIT; id++) l = noteAnalyzeResult(l, id, false);
  assert.equal(analyzeGaveUp(l), true);
});
