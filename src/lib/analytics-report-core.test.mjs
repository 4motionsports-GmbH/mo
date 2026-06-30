import test from "node:test";
import assert from "node:assert/strict";

import {
  PHASE_ORDER,
  phasesFor,
  nextPhase,
  phaseIndex,
  normalizeOptions,
  defaultReportTitle,
  mergeUsage,
  totalTokens,
  reportCostEur,
  estimateReportCostUsd,
  DEFAULT_MAX_ANALYZE,
  DEFAULT_MAX_PROFILES,
  MAX_ANALYZE_CAP,
  ANALYZE_MODEL,
  PROFILE_MODEL,
} from "./analytics-report-core.mjs";

const PRICES = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-8": { input: 5, output: 25 },
};

test("phasesFor drops customer_profiles unless per-customer is requested", () => {
  assert.ok(!phasesFor({ includePerCustomer: false }).includes("customer_profiles"));
  assert.ok(phasesFor({ includePerCustomer: true }).includes("customer_profiles"));
  // The full order is otherwise preserved.
  assert.deepEqual(phasesFor({ includePerCustomer: true }), PHASE_ORDER);
});

test("nextPhase walks the active set and ends at done", () => {
  const opts = { includePerCustomer: false };
  assert.equal(nextPhase("analyze", opts), "insights");
  assert.equal(nextPhase("insights", opts), "personas");
  assert.equal(nextPhase("personas", opts), "customer_synthesis");
  // customer_profiles is skipped when off.
  assert.equal(nextPhase("customer_synthesis", opts), "assemble");
  assert.equal(nextPhase("assemble", opts), "done");
  assert.equal(nextPhase("done", opts), "done");
  // Unknown phase fails safe to done.
  assert.equal(nextPhase("bogus", opts), "done");
});

test("nextPhase includes customer_profiles when on", () => {
  const opts = { includePerCustomer: true };
  assert.equal(nextPhase("customer_synthesis", opts), "customer_profiles");
  assert.equal(nextPhase("customer_profiles", opts), "assemble");
});

test("phaseIndex reflects the active set", () => {
  assert.equal(phaseIndex("analyze", { includePerCustomer: true }), 0);
  assert.equal(phaseIndex("assemble", { includePerCustomer: false }), 4);
  assert.equal(phaseIndex("customer_profiles", { includePerCustomer: false }), -1);
});

test("normalizeOptions applies defaults and clamps", () => {
  const d = normalizeOptions(undefined);
  assert.equal(d.includePerCustomer, false);
  assert.equal(d.includeAppendix, true);
  assert.equal(d.maxAnalyze, DEFAULT_MAX_ANALYZE);
  assert.equal(d.maxProfiles, DEFAULT_MAX_PROFILES);

  const o = normalizeOptions({
    includePerCustomer: true,
    includeAppendix: false,
    maxAnalyze: 999999,
    maxProfiles: -3,
  });
  assert.equal(o.includePerCustomer, true);
  assert.equal(o.includeAppendix, false);
  assert.equal(o.maxAnalyze, MAX_ANALYZE_CAP); // clamped down
  assert.equal(o.maxProfiles, 0); // clamped up from negative
});

test("defaultReportTitle renders interval + optional preset", () => {
  assert.equal(
    defaultReportTitle("2026-06-01", "2026-06-30", "month"),
    "Komplettanalyse · Monat · 01.06.2026 – 30.06.2026"
  );
  assert.equal(
    defaultReportTitle("2026-06-21", "2026-06-21", "day"),
    "Komplettanalyse · Tag · 21.06.2026"
  );
  assert.equal(
    defaultReportTitle("2026-06-01", "2026-06-07", "custom"),
    "Komplettanalyse · 01.06.2026 – 07.06.2026"
  );
});

test("mergeUsage accumulates per model and never goes negative", () => {
  let u = {};
  u = mergeUsage(u, ANALYZE_MODEL, 100, 20);
  u = mergeUsage(u, ANALYZE_MODEL, 50, 5);
  u = mergeUsage(u, PROFILE_MODEL, 1000, 300);
  u = mergeUsage(u, ANALYZE_MODEL, -10, NaN); // ignored / floored to 0
  assert.deepEqual(u[ANALYZE_MODEL], { input: 150, output: 25 });
  assert.deepEqual(u[PROFILE_MODEL], { input: 1000, output: 300 });
  assert.deepEqual(totalTokens(u), { input: 1150, output: 325 });
});

test("mergeUsage does not mutate the input object", () => {
  const a = { [ANALYZE_MODEL]: { input: 10, output: 2 } };
  const b = mergeUsage(a, ANALYZE_MODEL, 5, 1);
  assert.deepEqual(a[ANALYZE_MODEL], { input: 10, output: 2 });
  assert.deepEqual(b[ANALYZE_MODEL], { input: 15, output: 3 });
});

test("reportCostEur prices each model and converts to EUR", () => {
  // Haiku 1/5 per Mtok: 1M in = $1, 1M out = $5 → $6; Opus 5/25: 1M in = $5 → $5.
  const usage = {
    "claude-haiku-4-5": { input: 1_000_000, output: 1_000_000 },
    "claude-opus-4-8": { input: 1_000_000, output: 0 },
  };
  const eur = reportCostEur(usage, PRICES, 0.5);
  // ($6 + $5) * 0.5 = $5.5 → 5.5 EUR
  assert.equal(Math.round(eur * 1000) / 1000, 5.5);
});

test("estimateReportCostUsd scales with the known counts and respects the per-customer switch", () => {
  const withProfiles = estimateReportCostUsd(
    { conversationsToAnalyze: 100, personaCount: 5, customerCount: 10, includePerCustomer: true },
    PRICES
  );
  const withoutProfiles = estimateReportCostUsd(
    { conversationsToAnalyze: 100, personaCount: 5, customerCount: 10, includePerCustomer: false },
    PRICES
  );
  assert.ok(withProfiles > withoutProfiles, "profiles add cost");
  assert.ok(withoutProfiles > 0, "non-zero even without profiles");

  // More conversations ⇒ strictly more cost.
  const more = estimateReportCostUsd(
    { conversationsToAnalyze: 200, personaCount: 5, includePerCustomer: false },
    PRICES
  );
  assert.ok(more > withoutProfiles);
});
