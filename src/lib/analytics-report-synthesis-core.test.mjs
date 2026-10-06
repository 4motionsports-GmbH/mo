import test from "node:test";
import assert from "node:assert/strict";

import {
  REPORT_SECTIONS_VERSION,
  OWNERS,
  LIMITS,
  normalizeDecisions,
  normalizePlan,
  assembleDecision,
  emptyDecision,
  strategistEffortForAttempt,
  STRATEGIST_TIMEOUT_MS,
  STEP_MAX_DURATION_S,
  reportSectionsVersion,
  isDecisionReport,
  buildReportComparison,
  comparisonDelta,
  renderComparisonForPrompt,
  buildDecisionsPrompt,
  buildPlanPrompt,
  STRATEGIST_SYSTEM,
} from "./analytics-report-synthesis-core.mjs";
import { decisionsSchema, planSchema } from "./analytics-report-synthesis-schemas.mjs";
import { buildBusinessSnapshot } from "./business-snapshot-core.mjs";
import { SAMPLE_PREVIOUS_PERIOD_RAW } from "./business-snapshot.fixtures.mjs";
import {
  SAMPLE_DECISIONS_OUTPUT,
  SAMPLE_PLAN_OUTPUT,
  sampleReportSections,
} from "./analytics-report.fixtures.mjs";
import { z } from "zod";

function jsonSchemaText(schema) {
  return JSON.stringify(z.toJSONSchema(schema));
}

test("the structured-output schemas accept the sample model output", () => {
  assert.equal(decisionsSchema.safeParse(SAMPLE_DECISIONS_OUTPUT).success, true);
  assert.equal(planSchema.safeParse(SAMPLE_PLAN_OUTPUT).success, true);
});

test("the schemas carry no min/max keywords (Anthropic structured output rejects them)", () => {
  for (const schema of [decisionsSchema, planSchema]) {
    const text = jsonSchemaText(schema);
    for (const kw of ["minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum"]) {
      assert.ok(!text.includes(`"${kw}"`), `${kw} must not appear`);
    }
  }
});

test("normalizeDecisions keeps valid output and fixes the rest", () => {
  const ok = normalizeDecisions(SAMPLE_DECISIONS_OUTPUT);
  assert.equal(ok.decisions.length, 4);
  assert.equal(ok.decisions[0].owner, "frontend");
  assert.equal(ok.decisions[0].link, "kpi_anmeldung");

  const messy = normalizeDecisions({
    headline: "  Viel   Platz  ",
    decisions: [
      { title: "A", owner: "boss", impact: "riesig", link: "nowhere", rationale: "Mail an max@example.de" },
      { title: "" },
      null,
      ...Array.from({ length: 9 }, (_, i) => ({ title: `D${i}` })),
    ],
    revenue: { drivers: "nope" },
    changes: { items: [{ title: "X", direction: "seitwärts" }] },
  });
  assert.equal(messy.headline, "Viel Platz");
  assert.equal(messy.decisions.length, LIMITS.decisions, "capped");
  assert.equal(messy.decisions[0].owner, "operator", "unknown owner → operator");
  assert.equal(messy.decisions[0].impact, "mittel");
  assert.equal(messy.decisions[0].link, "none");
  assert.ok(!messy.decisions[0].rationale.includes("max@example.de"), "personal data scrubbed");
  assert.deepEqual(messy.revenue.drivers, []);
  assert.equal(messy.changes.items[0].direction, "unklar");
  assert.deepEqual(normalizeDecisions(null).decisions, []);
});

test("normalizePlan bounds lists and long texts", () => {
  const plan = normalizePlan({
    recommendations: Array.from({ length: 14 }, (_, i) => ({ title: `R${i}`, why: "x".repeat(5000), effort: "riesig", owner: "lawyer" })),
  });
  assert.equal(plan.recommendations.length, LIMITS.recommendations);
  assert.equal(plan.recommendations[0].effort, "mittel");
  assert.equal(plan.recommendations[0].owner, "lawyer");
  assert.ok(plan.recommendations[0].why.length <= LIMITS.text);
  assert.ok(plan.recommendations[0].why.endsWith("…"));
  assert.deepEqual(normalizePlan(undefined).experiments, []);
  const sample = normalizePlan(SAMPLE_PLAN_OUTPUT);
  assert.ok(sample.recommendations.every((r) => OWNERS.includes(r.owner)));
});

test("assembleDecision reports complete, partial and unavailable", () => {
  assert.equal(assembleDecision({ decisions: SAMPLE_DECISIONS_OUTPUT, plan: SAMPLE_PLAN_OUTPUT }).status, "complete");
  const partial = assembleDecision({ decisions: SAMPLE_DECISIONS_OUTPUT, notes: ["Maßnahmenteil nicht erstellt.", "Maßnahmenteil nicht erstellt."] });
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.notes, ["Maßnahmenteil nicht erstellt."]);
  assert.deepEqual(partial.recommendations, []);
  const none = assembleDecision();
  assert.equal(none.status, "unavailable");
  assert.deepEqual(Object.keys(emptyDecision()).sort(), Object.keys(none).filter((k) => !["status", "model", "efforts", "generatedAt", "notes"].includes(k)).sort());
});

test("the effort ladder walks high → medium → low, and the timeout fits the step", () => {
  assert.equal(strategistEffortForAttempt(0), "high");
  assert.equal(strategistEffortForAttempt(1), "medium");
  assert.equal(strategistEffortForAttempt(2), "low");
  assert.equal(strategistEffortForAttempt(3), null);
  assert.equal(strategistEffortForAttempt(-1), null);
  assert.equal(strategistEffortForAttempt("x"), null);
  // Room for loading the inputs and saving the result after an abort.
  assert.ok(STRATEGIST_TIMEOUT_MS <= (STEP_MAX_DURATION_S - 45) * 1000);
});

test("versions: old payloads stay v1, the decision layer is v2", () => {
  assert.equal(reportSectionsVersion({ kpis: {} }), 1);
  assert.equal(reportSectionsVersion(null), 1);
  assert.equal(isDecisionReport({ kpis: {} }), false);
  const s = sampleReportSections();
  assert.equal(s.version, REPORT_SECTIONS_VERSION);
  assert.equal(isDecisionReport(s), true);
  assert.equal(isDecisionReport({ version: 2 }), false, "a version without content is not a decision report");
});

test("buildReportComparison against a v1 report compares the legacy KPIs and keeps the dates", () => {
  const s = sampleReportSections();
  const c = s.comparison;
  assert.equal(c.basis, "legacy");
  assert.equal(c.previousReportId, 11);
  assert.equal(c.sameLength, true);
  const conv = c.metrics.find((m) => m.key === "legacy.conversations");
  assert.deepEqual([conv.now, conv.then], [96, 71]);
  const unmet = c.metrics.find((m) => m.key === "legacy.unmetNeed");
  assert.equal(Math.round(unmet.now * 1000), Math.round((17 / 74) * 1000));
  assert.equal(comparisonDelta(unmet).favourable, true, "less unmet need is better");
  assert.deepEqual(c.previousDecisions, []);
  assert.equal(buildReportComparison({ from: "2026-08-10", to: "2026-09-08" }, null), null);
});

test("buildReportComparison between two v2 reports uses the snapshot keys, per day when lengths differ", () => {
  const cur = sampleReportSections();
  const prevSections = { ...sampleReportSections(), snapshot: buildBusinessSnapshot(SAMPLE_PREVIOUS_PERIOD_RAW) };
  const c = buildReportComparison(
    { ...cur, from: "2026-08-10", to: "2026-09-08" },
    { id: 12, title: "Vorbericht", from: "2026-07-27", to: "2026-08-09", completedAt: null, sections: prevSections }
  );
  assert.equal(c.basis, "snapshot");
  assert.equal(c.sameLength, false);
  assert.equal(c.perDay, true);
  const revenue = c.metrics.find((m) => m.key === "revenue.total");
  // 30 days now vs 14 days then → compared per day.
  assert.equal(Math.round(revenue.now * 100) / 100, Math.round((15220.9 / 30) * 100) / 100);
  assert.equal(Math.round(revenue.then * 100) / 100, Math.round((10120 / 14) * 100) / 100);
  const rate = c.metrics.find((m) => m.key === "chat.engagement");
  assert.ok(rate.now < 1 && rate.then < 1, "rates are not divided by days");
  // Averages and ratios in euros stay as they are, too.
  const aov = c.metrics.find((m) => m.key === "revenue.aov");
  assert.deepEqual([aov.now, aov.then], [691.86, 632.5]);
  assert.equal(c.metrics.find((m) => m.key === "costs.roi").now, 711.26);
  assert.ok(c.metrics.some((m) => m.key === "journey.chatToOrder"));
  assert.equal(c.previousDecisions.length, 4);
  assert.equal(c.previousRecommendations[0].title, "Rückkehr nach der Shopify-Anmeldung reparieren");
  const text = renderComparisonForPrompt(c);
  assert.match(text, /Vorbericht #12/);
  assert.match(text, /Damals empfohlene Entscheidungen:/);
  assert.match(text, /Mengen je Tag/);
  assert.match(renderComparisonForPrompt(null), /Kein früherer Bericht/);
});

test("the prompts carry the data, the task and the rules — and no personal data", () => {
  const s = sampleReportSections();
  const input = {
    snapshot: s.snapshot,
    comparison: s.comparison,
    insightsMd: "Kundin erika@example.com fragt nach Rack-Maßen. Tel. 0170 1234567.",
    customerKnowledgeMd: s.customerKnowledgeMd,
    personas: s.personas,
    notes: s.notes,
  };
  const d = buildDecisionsPrompt(input);
  assert.equal(d.system, STRATEGIST_SYSTEM);
  assert.match(d.prompt, /# Geschäftsdaten/);
  assert.match(d.prompt, /\[revenue\.total\]/);
  assert.match(d.prompt, /# Vergleich mit dem letzten gespeicherten Bericht/);
  assert.match(d.prompt, /Home-Gym-Aufbauer/);
  assert.match(d.prompt, /decisions: die 3–5 Entscheidungen/);
  assert.ok(!d.prompt.includes("erika@example.com"));
  assert.ok(!d.prompt.includes("1234567"));

  const p = buildPlanPrompt(input, SAMPLE_DECISIONS_OUTPUT);
  assert.equal(p.system, d.system, "both passes share one system prompt");
  assert.match(p.prompt, /# Bereits erstellter Entscheidungsteil/);
  assert.match(p.prompt, /Anmelde-Popup auf den Wertmoment/);
  assert.match(p.prompt, /recommendations: 5–10 priorisierte Maßnahmen/);
  assert.match(buildPlanPrompt(input, null).prompt, /nicht verfügbar/);
  for (const owner of OWNERS) assert.ok(STRATEGIST_SYSTEM.includes(`${owner} =`), `owner ${owner} defined`);
});
