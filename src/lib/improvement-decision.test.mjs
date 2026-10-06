import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenSnapshot } from "./business-snapshot-core.mjs";
import { sampleReportSections } from "./analytics-report.fixtures.mjs";
import { DEFAULT_MODEL_PRICES } from "./ai-pricing.mjs";
import { MAX_DIRECTIVE_CHARS, MAX_SUGGESTIONS_PER_LANE, OWNER_LANES, priorityTier } from "./improvement-core.mjs";
import { buildChangeList, changeWindow, measureChange, snapshotMovers } from "./improvement-effects.mjs";
import {
  IMPROVEMENT_STEP_MAX_DURATION_S,
  IMPROVEMENT_STRATEGIST_TIMEOUT_MS,
  IMPROVEMENT_SYSTEM,
  MEASURE_STEP_BUDGET_MS,
  buildEffectReviewPrompt,
  buildSuggestionPrompt,
  countImportable,
  estimateImprovementCostUsd,
  estimateImprovementMinutes,
  importReportRecommendations,
  laneForReportRecommendation,
  normalizeEffectReview,
  normalizeSuggestion,
  normalizeSuggestionsPayload,
  parseHorizonDays,
  readSuggestionDetails,
  renderBacklogForPrompt,
  suggestionStorage,
} from "./improvement-decision.mjs";
import { effectReviewSchema, suggestionsSchema } from "./improvement-schemas.mjs";
import {
  SAMPLE_BUSINESS_SUGGESTIONS_OUTPUT,
  SAMPLE_CHANGE_SUGGESTIONS,
  SAMPLE_CHAT_SUGGESTIONS_OUTPUT,
  SAMPLE_DIRECTIVES,
  SAMPLE_EFFECT_REVIEW_OUTPUT,
  SAMPLE_TODAY,
  sampleRunSnapshot,
  sampleWindowSnapshot,
} from "./improvement.fixtures.mjs";

const SNAPSHOT = sampleRunSnapshot();
const FLAT = flattenSnapshot(SNAPSHOT);

// ── Budgets ───────────────────────────────────────────────────────────────────

test("a strategist call and a measurement step end well inside the step route's maxDuration", () => {
  assert.ok(IMPROVEMENT_STRATEGIST_TIMEOUT_MS <= (IMPROVEMENT_STEP_MAX_DURATION_S - 45) * 1000);
  assert.ok(MEASURE_STEP_BUDGET_MS <= (IMPROVEMENT_STEP_MAX_DURATION_S - 120) * 1000, "room for one more snapshot after the budget");
});

// ── Suggestions ───────────────────────────────────────────────────────────────

test("chat pass: decision-grade suggestions with frozen evidence, success metric and priority", () => {
  const out = normalizeSuggestionsPayload(SAMPLE_CHAT_SUGGESTIONS_OUTPUT, { flat: FLAT, pass: "vorschlaege_chat" });
  assert.equal(out.suggestions.length, 3, "the item without a title is dropped");
  assert.equal(out.headline, null);
  const [set, holdout, popup] = out.suggestions;

  assert.equal(set.lane, "chat");
  assert.match(set.directive, /^Wenn du ein Laufband/);
  assert.equal(set.evidence.length, 3);
  assert.equal(set.evidence[0].key, "bundles.revenue");
  assert.equal(set.evidence[0].metric.value, 5120, "the number comes from the snapshot");
  assert.equal(set.evidence[0].metric.previous, 3268.65);
  assert.equal(set.evidence[2].key, null, "an unknown key is dropped, the text kept");
  assert.equal(set.successMetric.key, "bundles.revenue");
  assert.equal(set.successMetric.baseline.value, 5120);
  assert.equal(set.successMetric.target, 6500);
  assert.equal(set.successMetric.horizonDays, 28);
  assert.equal(set.refersTo, "D4");
  assert.equal(set.tier, 1);
  assert.equal(set.link, "verbesserung");

  assert.equal(holdout.lane, "developer");
  assert.equal(holdout.directive, null, "only chat & prompt suggestions carry a directive");

  assert.equal(popup.lane, "frontend");
  assert.equal(popup.successMetric.target, 0.18, "a rate target of 18 is read as 18 %");
  assert.equal(popup.successMetric.horizonDays, 90, "horizon clamped");
  assert.equal(popup.risk, "mittel");
  assert.equal(priorityTier(popup.priority), popup.tier);
});

test("business pass: headline + summary, lanes of the pass only, never a directive", () => {
  const out = normalizeSuggestionsPayload(SAMPLE_BUSINESS_SUGGESTIONS_OUTPUT, { flat: FLAT, pass: "vorschlaege_betrieb" });
  assert.match(out.headline, /\+50 %/);
  assert.ok(out.summary.length > 50);
  assert.deepEqual(
    out.suggestions.map((s) => s.lane),
    ["campaign", "legal"]
  );
  assert.ok(out.suggestions.every((s) => s.directive === null));
  const legal = out.suggestions[1];
  assert.equal(legal.successMetric.key, "consent.newSubscribers");
  assert.equal(legal.successMetric.target, null);
  // A lane outside the pass falls back to the pass's first lane.
  const coerced = normalizeSuggestionsPayload(
    { suggestions: [{ ...SAMPLE_BUSINESS_SUGGESTIONS_OUTPUT.suggestions[0], lane: "chat" }] },
    { flat: FLAT, pass: "vorschlaege_betrieb" }
  );
  assert.equal(coerced.suggestions[0].lane, "operator");
  const many = { suggestions: Array.from({ length: 9 }, (_, i) => ({ ...SAMPLE_BUSINESS_SUGGESTIONS_OUTPUT.suggestions[0], title: `Vorschlag ${i}` })) };
  assert.equal(normalizeSuggestionsPayload(many, { flat: FLAT, pass: "vorschlaege_betrieb" }).suggestions.length, MAX_SUGGESTIONS_PER_LANE);
});

test("normalizeSuggestion scrubs personal data, clamps the directive and finds a key in the text", () => {
  const s = normalizeSuggestion(
    {
      title: "Kundin anna@example.com zurückholen",
      lane: "chat",
      why: "Bestellung #12345 blieb liegen; [capture.submitRate] sank.",
      action: "Anrufen unter +49 170 1234567.",
      directive: "W".repeat(900),
      evidence: ["Nur Text"],
      successMetric: { key: "does.notExist", target: null, direction: "sideways", horizonDays: "abc" },
    },
    { flat: FLAT }
  );
  assert.ok(!s.title.includes("@"));
  assert.ok(!s.why.includes("#12345"));
  assert.ok(!s.action.includes("1234567"));
  assert.equal(s.directive.length, MAX_DIRECTIVE_CHARS);
  assert.equal(s.successMetric.key, "capture.submitRate", "taken from the reason when the given key is unknown");
  assert.equal(s.successMetric.direction, "up");
  assert.equal(s.successMetric.horizonDays, 14);
  assert.deepEqual(s.evidence, [{ key: null, text: "Nur Text", metric: null }]);
  assert.equal(normalizeSuggestion({ title: "x", why: "", action: "y" }, { flat: FLAT }), null);
  assert.equal(normalizeSuggestion(null), null);
});

test("storage round trip: v2 details in evidence_json, owner lane in category; v1 rows still read", () => {
  const s = normalizeSuggestionsPayload(SAMPLE_CHAT_SUGGESTIONS_OUTPUT, { flat: FLAT, pass: "vorschlaege_chat" }).suggestions[0];
  const row = suggestionStorage(s);
  assert.equal(row.lane, "mo");
  assert.equal(row.category, "chat");
  assert.equal(row.rationale, s.why);
  assert.equal(row.impact, "hoch");
  const back = readSuggestionDetails(JSON.parse(JSON.stringify(row.evidence)));
  assert.equal(back.version, 2);
  assert.equal(back.items[0].metric.key, "bundles.revenue");
  assert.equal(back.details.successMetric.key, "bundles.revenue");
  assert.equal(back.details.confidence, "mittel");
  const v1 = readSuggestionDetails(["Gespräch #3: Frage offen", 42]);
  assert.equal(v1.version, 1);
  assert.deepEqual(v1.items, [{ key: null, text: "Gespräch #3: Frage offen", metric: null }]);
  assert.equal(v1.details, null);
  assert.equal(readSuggestionDetails(null).version, 1);
});

// ── Wirkungs-Check ────────────────────────────────────────────────────────────

test("normalizeEffectReview keeps one item per measured ref", () => {
  const r = normalizeEffectReview(SAMPLE_EFFECT_REVIEW_OUTPUT, ["D1", "S12", "D4"]);
  assert.deepEqual(
    r.items.map((i) => i.ref),
    ["D1", "S12", "D4"]
  );
  assert.equal(r.items[2].recommendation, "beobachten");
  assert.match(r.summary, /D1/);
  assert.deepEqual(normalizeEffectReview({ items: [{ ref: "D1", recommendation: "löschen" }] }, ["D1"]).items[0].recommendation, "beobachten");
  assert.deepEqual(normalizeEffectReview(null, []), { summary: null, items: [] });
});

// ── Komplettanalyse import ────────────────────────────────────────────────────

test("the open recommendations of a decision report become suggestions with lane, metric and origin", () => {
  const sections = sampleReportSections();
  const imported = importReportRecommendations(sections, { reportId: 9, reportTitle: "Komplettanalyse · 10.08.–08.09.2026", flat: FLAT });
  assert.equal(imported.length, sections.decision.recommendations.length);
  const [signin, sets, campaign] = imported;
  assert.equal(signin.lane, "frontend");
  assert.equal(signin.successMetric.key, "signin.popupLinked");
  assert.equal(signin.successMetric.horizonDays, 14, "„in 2 Wochen“");
  assert.match(signin.successMetric.text, /> 90 %/);
  assert.equal(signin.effort, "niedrig", "klein → niedrig");
  assert.equal(signin.risk, null, "the report has no risk per recommendation");
  assert.deepEqual(signin.origin, { kind: "report", reportId: 9, index: 0, reportTitle: "Komplettanalyse · 10.08.–08.09.2026" });
  assert.equal(sets.lane, "chat", "a recommendation acted on in the Verbesserung is a chat & prompt change");
  assert.equal(campaign.lane, "campaign");
  assert.equal(campaign.successMetric.key, "campaigns.revenue");

  // Already imported (same report and position) or already in the backlog → skipped.
  const existing = [
    { fingerprint: "x", status: "open", origin: { kind: "report", reportId: 9, index: 0 } },
    { fingerprint: sets.fingerprint, status: "accepted", origin: { kind: "engine" } },
    { fingerprint: campaign.fingerprint, status: "dismissed", origin: { kind: "engine" } },
  ];
  const again = importReportRecommendations(sections, { reportId: 9, reportTitle: "x", flat: FLAT, existing });
  assert.equal(again.length, imported.length - 2);
  assert.ok(again.some((s) => s.fingerprint === campaign.fingerprint), "a dismissed idea may come back from a new report");
  assert.deepEqual(countImportable(sections, 9, existing), { total: imported.length, open: imported.length - 1 });
  assert.deepEqual(importReportRecommendations({ kpis: {} }, { reportId: 1, reportTitle: "v1", flat: FLAT }), []);
});

test("laneForReportRecommendation and parseHorizonDays", () => {
  assert.equal(laneForReportRecommendation({ owner: "lawyer", link: "none" }), "legal");
  assert.equal(laneForReportRecommendation({ owner: "operator", link: "kampagnen" }), "campaign");
  assert.equal(laneForReportRecommendation({ owner: "developer", link: "kpi_seitenkontext" }), "developer");
  assert.equal(laneForReportRecommendation({ owner: "operator", link: "wissen" }), "operator");
  assert.equal(parseHorizonDays("> 90 % in 2 Wochen"), 14);
  assert.equal(parseHorizonDays("binnen 30 Tagen"), 30);
  assert.equal(parseHorizonDays("in 3 Monaten"), 90);
  assert.equal(parseHorizonDays("bald"), null);
});

// ── Prompts ───────────────────────────────────────────────────────────────────

function measurements() {
  const all = buildChangeList({ directives: SAMPLE_DIRECTIVES, suggestions: SAMPLE_CHANGE_SUGGESTIONS, flat: FLAT, today: SAMPLE_TODAY });
  return all.map((c) => {
    const w = changeWindow(c, SAMPLE_TODAY);
    return measureChange(c, { snapshot: w.days >= 7 ? sampleWindowSnapshot(w.from, w.to) : null, today: SAMPLE_TODAY, allChanges: all, releases: [], reference: FLAT });
  });
}

test("the system prompt names every lane and the honesty rules", () => {
  for (const lane of OWNER_LANES) assert.match(IMPROVEMENT_SYSTEM, new RegExp(`- ${lane} \\(`));
  assert.match(IMPROVEMENT_SYSTEM, /Kausalität/);
  assert.match(IMPROVEMENT_SYSTEM, /Du schlägst nur vor/);
  assert.match(IMPROVEMENT_SYSTEM, new RegExp(`höchstens ${MAX_DIRECTIVE_CHARS} Zeichen`));
});

test("the Wirkungs-Check prompt carries every measured change with windows, n, verdict and confounders", () => {
  const ms = measurements();
  const { prompt } = buildEffectReviewPrompt({ snapshot: SNAPSHOT, movers: snapshotMovers(SNAPSHOT), measurements: ms, directives: SAMPLE_DIRECTIVES });
  for (const m of ms) assert.ok(prompt.includes(`[${m.ref}]`), m.ref);
  assert.match(prompt, /Erfolgskennzahl \(Erfolgskennzahl des Vorschlags\) Abgesprungen \[quality\.droppedOff\]/);
  assert.match(prompt, /z = -0,32/);
  assert.match(prompt, /n = 74, vorher n = 66/);
  assert.match(prompt, /Eher besser/);
  assert.match(prompt, /Störfaktor: Anweisung/);
  assert.match(prompt, /Ziel: ≤ 15 % — nicht erreicht/);
  assert.match(prompt, /\[D3\] inaktiv/);
  assert.match(
    prompt,
    /Erfolgskennzahl \(Standardkennzahl des Bereichs \(kein Erfolgsmaß hinterlegt\)\) Gut gelöst \[quality\.handledWell\]: vorher —, nachher — → Zu früh/,
    "labels from the run snapshot when no window exists yet"
  );
  assert.match(prompt, /Besser geworden:/);
});

test("the suggestion prompts: chat reads Mo's self-snapshot, business reads this run's chat suggestions", () => {
  const ms = measurements();
  const review = normalizeEffectReview(SAMPLE_EFFECT_REVIEW_OUTPUT, ms.map((m) => m.ref));
  const backlog = [
    { id: 12, title: "Wissensqueue täglich abarbeiten", status: "implemented", category: "operator", impact: "mittel", effort: "niedrig", successMetricKey: "knowledge.hoursToAnswer", origin: { kind: "report", reportId: 9 } },
  ];
  const input = {
    snapshot: SNAPSHOT,
    movers: snapshotMovers(SNAPSHOT),
    measurements: ms,
    review,
    backlog,
    directives: SAMPLE_DIRECTIVES,
    selfSnapshot: "# Mos aktuelle Konfiguration\nSYSTEMPROMPT",
    reportExtract: "### Kennzahlen\n- Gespräche im Zeitraum: 96",
    reportTitle: "Komplettanalyse",
    earlier: [{ lane: "chat", title: "Nach jeder Großgeräte-Beratung ein Set vorschlagen" }],
  };
  const chat = buildSuggestionPrompt("vorschlaege_chat", input).prompt;
  assert.match(chat, /SYSTEMPROMPT/);
  assert.match(chat, /Seitenkontext/);
  assert.match(chat, /directive: nur im Bereich chat/);
  assert.match(chat, /\[S12\] · Betrieb · „Wissensqueue täglich abarbeiten“ · Status: Erledigt · P1 · Erfolg: \[knowledge\.hoursToAnswer\] · aus Komplettanalyse #9/);
  assert.match(chat, /Einschätzung: .* → Beibehalten/);
  assert.match(chat, /Gesprächs-Insights der Komplettanalyse/);
  assert.ok(!chat.includes("In diesem Lauf bereits erarbeitet"));
  const biz = buildSuggestionPrompt("vorschlaege_betrieb", input).prompt;
  assert.ok(!biz.includes("SYSTEMPROMPT"), "the business pass does not read the self-snapshot");
  assert.match(biz, /In diesem Lauf bereits erarbeitet/);
  assert.match(biz, /directive: immer null/);
  assert.match(biz, /headline: ein Satz/);
  assert.match(biz, /DOI-Quote/);
  for (const p of [chat, biz]) assert.ok(!/@/.test(p), "no e-mail address in a prompt");
  assert.equal(renderBacklogForPrompt([]), "(leer)");
});

// ── Schemas and estimates ─────────────────────────────────────────────────────

test("the schemas accept the sample outputs (lanes restricted per pass)", () => {
  assert.ok(effectReviewSchema.safeParse(SAMPLE_EFFECT_REVIEW_OUTPUT).success);
  const chatOk = { ...SAMPLE_CHAT_SUGGESTIONS_OUTPUT, suggestions: SAMPLE_CHAT_SUGGESTIONS_OUTPUT.suggestions.slice(0, 3) };
  assert.ok(suggestionsSchema("vorschlaege_chat").safeParse(chatOk).success);
  assert.ok(suggestionsSchema("vorschlaege_betrieb").safeParse(SAMPLE_BUSINESS_SUGGESTIONS_OUTPUT).success);
  assert.ok(!suggestionsSchema("vorschlaege_betrieb").safeParse(chatOk).success, "chat lane not allowed in the business pass");
});

test("cost and duration estimates", () => {
  const full = estimateImprovementCostUsd(DEFAULT_MODEL_PRICES);
  const lean = estimateImprovementCostUsd(DEFAULT_MODEL_PRICES, { withEffectCheck: false });
  assert.ok(full > lean && lean > 0.3 && full < 2.5, `full ${full}, lean ${lean}`);
  const [low, high] = estimateImprovementMinutes({ withEffectCheck: true, changes: 6 });
  assert.ok(low >= 2 && high > low);
});
