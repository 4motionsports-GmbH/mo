import { test } from "node:test";
import assert from "node:assert/strict";
import { KPI_RELEASES } from "./kpi-releases.mjs";
import { flattenSnapshot } from "./business-snapshot-core.mjs";
import { SAMPLE_SNAPSHOT_RAW } from "./business-snapshot.fixtures.mjs";
import { OWNER_LANES } from "./improvement-core.mjs";
import {
  ASSESSABLE_VERDICTS,
  DEFAULT_LANE_METRICS,
  LANE_GUARDRAILS,
  MAX_MEASURED_CHANGES,
  MOVER_KEYS,
  RELEASE_EFFECTS,
  SWITCH_EFFECTS,
  VERDICTS,
  VERDICT_LABELS,
  buildChangeList,
  changeWindow,
  classifyMetricEffect,
  dayOf,
  effectStats,
  extractMetricKeys,
  keyInArea,
  measureChange,
  metricByLabel,
  metricsForChange,
  poissonRateZ,
  poissonZ,
  snapshotMovers,
  summariseMeasurements,
  switchChanges,
  twoProportionZ,
  windowKey,
} from "./improvement-effects.mjs";
import {
  SAMPLE_CHANGE_SUGGESTIONS,
  SAMPLE_DIRECTIVES,
  SAMPLE_TODAY,
  sampleRunSnapshot,
  sampleWindowSnapshot,
} from "./improvement.fixtures.mjs";

const FLAT = flattenSnapshot(sampleRunSnapshot());

// ── Classification tables ─────────────────────────────────────────────────────

test("every KPI release is classified (measurement change or product change)", () => {
  for (const r of KPI_RELEASES) {
    assert.ok(RELEASE_EFFECTS[r.key], `release ${r.key} (${r.date}) needs an entry in RELEASE_EFFECTS`);
    const fx = RELEASE_EFFECTS[r.key];
    assert.ok(Array.isArray(fx.measurement) && Array.isArray(fx.product));
  }
});

test("every snapshot switch has an effect class", () => {
  for (const key of Object.keys(SAMPLE_SNAPSHOT_RAW.switches)) {
    assert.ok(SWITCH_EFFECTS[key], `switch ${key} needs an entry in SWITCH_EFFECTS`);
  }
});

test("default metrics and guardrails of every lane are snapshot keys", () => {
  for (const lane of OWNER_LANES) {
    assert.ok(FLAT[DEFAULT_LANE_METRICS[lane]], `${lane} default ${DEFAULT_LANE_METRICS[lane]}`);
    for (const g of LANE_GUARDRAILS[lane]) assert.ok(FLAT[g], `${lane} guardrail ${g}`);
  }
  for (const k of MOVER_KEYS) assert.ok(FLAT[k], `mover key ${k}`);
  for (const v of VERDICTS) assert.ok(VERDICT_LABELS[v]);
  for (const v of ASSESSABLE_VERDICTS) assert.ok(VERDICTS.includes(v));
});

test("keyInArea matches a prefix area or a full key, nothing else", () => {
  assert.ok(keyInArea("revenue.total", "revenue"));
  assert.ok(keyInArea("capture.doiRate", "capture.doiRate"));
  assert.ok(!keyInArea("capture.doiRateX", "capture.doiRate"));
  assert.ok(!keyInArea("revenuex.total", "revenue"));
});

// ── Statistics ────────────────────────────────────────────────────────────────

test("two-proportion, Poisson and Poisson-rate z values", () => {
  assert.equal(Math.round(twoProportionZ(0.5, 100, 0.4, 100) * 1000) / 1000, 1.421);
  assert.equal(twoProportionZ(0, 50, 0, 40), 0, "no variance, no difference");
  assert.equal(twoProportionZ(0.5, 0, 0.4, 10), null);
  assert.equal(Math.round(poissonZ(30, 10) * 1000) / 1000, 3.162);
  assert.equal(poissonZ(0, 0), null);
  // 60 clicks / 100 chats vs 30 / 100 → rate 0.6 vs 0.3
  assert.equal(Math.round(poissonRateZ(60, 100, 30, 100) * 100) / 100, 3.16);
  assert.equal(poissonRateZ(1, 0, 1, 10), null);
});

test("effectStats picks the right test for each unit", () => {
  const rate = effectStats(FLAT["chat.engagement"], FLAT);
  assert.equal(rate.test, "proportion");
  assert.deepEqual(rate.n, { after: 212, before: 180 });
  assert.equal(rate.small, false);

  const smallRate = effectStats(FLAT["capture.doiRate"], FLAT);
  assert.equal(smallRate.test, "proportion");
  assert.equal(smallRate.small, true, "n = 12 is a small sample");

  const noPrevBase = effectStats({ key: "x.r", unit: "rate", value: 0.5, previous: 0.4, base: 50 }, FLAT);
  assert.equal(noPrevBase.test, "none");
  assert.equal(noPrevBase.small, true);

  const count = effectStats(FLAT["chat.chats"], FLAT);
  assert.equal(count.test, "poisson");
  assert.equal(count.n.after, 96);

  const ratio = effectStats(FLAT["chat.clicksPerChat"], FLAT);
  assert.equal(ratio.test, "poisson_rate");
  assert.equal(ratio.via, "chat.chats");

  const revenue = effectStats(FLAT["revenue.total"], FLAT);
  assert.equal(revenue.test, "companion");
  assert.equal(revenue.via, "revenue.orders");

  // Amount up but orders down: the order test says nothing about the amount.
  const disagree = effectStats(
    { key: "revenue.total", unit: "eur", value: 2000, previous: 1000 },
    { "revenue.orders": { key: "revenue.orders", value: 5, previous: 40 } }
  );
  assert.equal(disagree.z, 0);

  const avg = effectStats(FLAT["knowledge.hoursToAnswer"], FLAT);
  assert.equal(avg.test, "none");
  assert.equal(effectStats({ key: "x", unit: "count", value: null, previous: 3 }).test, "none");
});

// ── Classification ────────────────────────────────────────────────────────────

const rateMetric = (value, previous, base, previousBase, good = "up") => ({ key: "t.rate", unit: "rate", value, previous, base, previousBase, good });
const classify = (m, ctx = {}) => classifyMetricEffect(m, effectStats(m, {}), { days: 14, ...ctx });

test("classify: clear improvement with large samples is 'Deutlich besser', confidence high", () => {
  const r = classify(rateMetric(0.3, 0.15, 400, 400));
  assert.equal(r.verdict, "besser_belastbar");
  assert.equal(r.confidence, "hoch");
  assert.equal(r.significant, true);
});

test("classify: a move inside the noise is a tendency; a tiny one is 'unverändert'", () => {
  const tendency = classify(rateMetric(0.2, 0.15, 60, 60));
  assert.equal(tendency.verdict, "besser_tendenz");
  assert.equal(tendency.confidence, "mittel");
  assert.match(tendency.reasons.join(" "), /Zufall/);
  const flat = classify(rateMetric(0.205, 0.2, 400, 400));
  assert.equal(flat.verdict, "unveraendert");
});

test("classify: a small sample is never 'belastbar' and has low confidence", () => {
  const r = classify(rateMetric(0.9, 0.1, 10, 10));
  assert.equal(r.verdict, "besser_tendenz");
  assert.equal(r.confidence, "niedrig");
  assert.match(r.reasons.join(" "), /Kleine Stichprobe/);
});

test("classify: falling is better for 'good: down' metrics; a clear rise is 'Deutlich schlechter'", () => {
  assert.equal(classify(rateMetric(0.1, 0.25, 300, 300, "down")).verdict, "besser_belastbar");
  assert.equal(classify(rateMetric(0.4, 0.2, 300, 300, "down")).verdict, "schlechter_belastbar");
  assert.equal(classify(rateMetric(0.4, 0.2, 300, 300, "none")).verdict, "veraendert");
});

test("classify: no data, too early and measurement changes get no effect verdict", () => {
  assert.equal(classify(rateMetric(null, 0.2, 0, 100)).verdict, "nicht_messbar");
  assert.equal(classify({ key: "c", unit: "count", value: 0, previous: 0, good: "up" }).verdict, "nicht_messbar");
  const early = classify(rateMetric(0.3, 0.1, 400, 400), { days: 3 });
  assert.equal(early.verdict, "zu_frueh");
  assert.match(early.reasons[0], /Erst 3 Tage/);
  const changed = classify(rateMetric(0.3, 0.1, 400, 400), { measurementChange: true });
  assert.equal(changed.verdict, "nicht_vergleichbar");
  assert.equal(changed.confidence, null);
});

test("classify: confounders and a short window lower the confidence", () => {
  assert.equal(classify(rateMetric(0.3, 0.15, 400, 400), { confounders: 2 }).confidence, "mittel");
  assert.equal(classify(rateMetric(0.3, 0.15, 400, 400), { confounders: 1, days: 8 }).confidence, "niedrig");
});

// ── Changes ───────────────────────────────────────────────────────────────────

test("extractMetricKeys finds only known keys, in order, once", () => {
  const keys = extractMetricKeys("signin.popupLinked ÷ Shopify > 90 %; [capture.submitRate] und signin.popupLinked, foo.bar", Object.keys(FLAT));
  assert.deepEqual(keys, ["signin.popupLinked", "capture.submitRate"]);
});

test("metricByLabel maps a v1 free-text effect to the metric it names", () => {
  assert.equal(metricByLabel("Weniger Rückfragen; Qualität „Abgesprungen“ sinkt.", FLAT), "quality.droppedOff");
  assert.equal(metricByLabel("Mehr Umsatz", FLAT), null);
  assert.equal(metricByLabel(null, FLAT), null);
});

test("metricsForChange: success metric, else the expected effect, else the lane default — plus guardrails", () => {
  const own = metricsForChange({ lane: "campaign", successMetric: { key: "campaigns.clickRate" } }, FLAT);
  assert.equal(own.source, "erfolgsmass");
  assert.deepEqual(own.metrics, [
    { key: "campaigns.clickRate", role: "primary" },
    { key: "campaigns.unsubscribeRate", role: "guardrail" },
  ]);
  const named = metricsForChange({ lane: "chat", expectedEffect: "[journey.chatToOrder] steigt" }, FLAT);
  assert.equal(named.source, "erwartete_wirkung");
  assert.deepEqual(
    named.metrics.map((m) => m.key),
    ["journey.chatToOrder", "quality.unmetNeed"],
    "a guardrail equal to the primary is not repeated"
  );
  const fallback = metricsForChange({ lane: "operator" }, FLAT);
  assert.equal(fallback.source, "standard");
  assert.equal(fallback.metrics[0].key, "revenue.total");
});

test("buildChangeList: directives by their live version, implemented suggestions, newest first", () => {
  const changes = buildChangeList({ directives: SAMPLE_DIRECTIVES, suggestions: SAMPLE_CHANGE_SUGGESTIONS, flat: FLAT, today: SAMPLE_TODAY });
  assert.deepEqual(
    changes.map((c) => c.ref),
    ["D4", "S14", "D2", "S12", "D1", "D3"]
  );
  const d1 = changes.find((c) => c.ref === "D1");
  assert.equal(d1.suggestionId, 11, "the adopted suggestion is measured through its directive");
  assert.equal(d1.metricSource, "erfolgsmass");
  assert.equal(d1.metrics[0].key, "quality.droppedOff");
  assert.deepEqual(d1.target, { value: 0.15, direction: "down" });
  assert.ok(!changes.some((c) => c.ref === "S11"), "no double count of an adopted suggestion");
  assert.ok(!changes.some((c) => c.ref === "S13"), "planned is not live");
  const d2 = changes.find((c) => c.ref === "D2");
  assert.equal(d2.date, "2026-08-25", "the latest wording starts the measurement");
  assert.equal(d2.state, "geaendert");
  assert.equal(d2.metricSource, "standard");
  const d3 = changes.find((c) => c.ref === "D3");
  assert.equal(d3.until, "2026-07-20");
  assert.equal(d3.state, "deaktiviert");
  const s14 = changes.find((c) => c.ref === "S14");
  assert.equal(s14.metricSource, "erwartete_wirkung");
  assert.equal(s14.metrics[0].key, "quality.droppedOff");
  assert.equal(s14.lane, "chat");
});

test("buildChangeList respects the lookback and the cap", () => {
  const old = buildChangeList({ directives: SAMPLE_DIRECTIVES, suggestions: [], flat: FLAT, today: "2026-12-30" });
  assert.deepEqual(
    old.map((c) => c.ref),
    ["D4"],
    "only changes of the last 120 days"
  );
  const many = Array.from({ length: 12 }, (_, i) => ({
    id: 100 + i,
    title: `Maßnahme ${i}`,
    lane: "shop",
    category: "operator",
    status: "implemented",
    statusChangedAt: `2026-08-${String(10 + i).padStart(2, "0")}T08:00:00Z`,
    expectedEffect: null,
  }));
  assert.equal(buildChangeList({ suggestions: many, flat: FLAT, today: SAMPLE_TODAY }).length, MAX_MEASURED_CHANGES);
  assert.equal(dayOf("2026-09-07 23:30:00+00"), "2026-09-07");
  assert.equal(dayOf("garbage"), null);
});

// ── Windows ───────────────────────────────────────────────────────────────────

test("changeWindow: after = the day after the change up to the horizon, never today; before = equally long", () => {
  const w = changeWindow({ date: "2026-08-20", horizonDays: 14 }, SAMPLE_TODAY);
  assert.deepEqual(
    { from: w.from, to: w.to, days: w.days, complete: w.complete, before: w.before },
    { from: "2026-08-21", to: "2026-09-03", days: 14, complete: true, before: { from: "2026-08-07", to: "2026-08-20" } }
  );
  const running = changeWindow({ date: "2026-09-02", horizonDays: 14 }, SAMPLE_TODAY);
  assert.equal(running.to, "2026-09-08", "ends yesterday");
  assert.equal(running.days, 6);
  assert.equal(running.complete, false);
  const fresh = changeWindow({ date: "2026-09-08", horizonDays: 14 }, SAMPLE_TODAY);
  assert.equal(fresh.days, 0);
  assert.equal(fresh.before, null);
  const off = changeWindow({ date: "2026-06-30", until: "2026-07-10", horizonDays: 14 }, SAMPLE_TODAY);
  assert.equal(off.to, "2026-07-09", "a deactivated directive is measured while it was live");
  assert.equal(off.complete, true);
  assert.equal(windowKey(w), "2026-08-21..2026-09-03");
});

test("switchChanges lists switches that flipped between two runs", () => {
  const before = [
    { key: "pageContext", label: "Seitenkontext im Chat", value: false },
    { key: "pageContextHoldoutPct", label: "Kontrollgruppe", value: 0 },
  ];
  const after = [
    { key: "pageContext", label: "Seitenkontext im Chat", value: true },
    { key: "pageContextHoldoutPct", label: "Kontrollgruppe", value: 0 },
    { key: "newSwitch", label: "Neu", value: true },
  ];
  const between = { from: "2026-08-01", to: "2026-09-01" };
  assert.deepEqual(switchChanges(before, after, between), [{ key: "pageContext", label: "Seitenkontext im Chat", from: false, to: true, between }]);
  assert.deepEqual(switchChanges(null, after, between), []);
});

// ── Measuring ─────────────────────────────────────────────────────────────────

function changes() {
  return buildChangeList({ directives: SAMPLE_DIRECTIVES, suggestions: SAMPLE_CHANGE_SUGGESTIONS, flat: FLAT, today: SAMPLE_TODAY });
}

test("measureChange: before/after with both sample sizes, verdict, confounders and target", () => {
  const all = changes();
  const d1 = all.find((c) => c.ref === "D1");
  const w = changeWindow(d1, SAMPLE_TODAY);
  const m = measureChange(d1, { snapshot: sampleWindowSnapshot(w.from, w.to), today: SAMPLE_TODAY, allChanges: all, releases: [] });
  assert.equal(m.ref, "D1");
  assert.equal(m.window.days, 14);
  const primary = m.metrics[0];
  assert.equal(primary.key, "quality.droppedOff");
  assert.equal(primary.value, 0.1757);
  assert.equal(primary.previous, 0.197);
  assert.deepEqual(primary.testN, { after: 74, before: 66 });
  assert.equal(primary.test, "proportion");
  assert.equal(m.verdict, "besser_tendenz", "falling drop-off is better, but inside the noise");
  assert.equal(m.confidence, "niedrig", "other changes in the window lower the confidence");
  assert.ok(m.confounders.some((c) => c.kind === "change" && /Anweisung/.test(c.label)));
  assert.ok(m.confounders.every((c) => !c.measurement));
  assert.deepEqual(m.target, { value: 0.15, direction: "down", reached: false });
  assert.equal(m.metrics[1].role, "guardrail");
});

test("measureChange: a measurement release in the window → 'nicht vergleichbar', never an effect", () => {
  const change = {
    ref: "S50",
    kind: "suggestion",
    id: 50,
    suggestionId: 50,
    title: "Mo-Links in Mails",
    lane: "operator",
    date: "2026-08-20",
    until: null,
    state: "umgesetzt",
    metricSource: "standard",
    metrics: [{ key: "revenue.total", role: "primary" }],
    horizonDays: 14,
    target: null,
  };
  const releases = [{ date: "2026-08-28", key: "attribution-window", title: "Bestell-Zuordnung: Fenster ab der letzten Beratung" }];
  const m = measureChange(change, { snapshot: sampleWindowSnapshot("2026-08-21", "2026-09-03"), today: SAMPLE_TODAY, releases });
  assert.equal(m.verdict, "nicht_vergleichbar");
  assert.equal(m.confounders[0].measurement, true);
  // A product release is only a confounder.
  const product = measureChange(
    { ...change, metrics: [{ key: "chat.engagement", role: "primary" }] },
    { snapshot: sampleWindowSnapshot("2026-08-21", "2026-09-03"), today: SAMPLE_TODAY, releases: [{ date: "2026-08-28", key: "page-context-typed", title: "Seitenkontext" }] }
  );
  assert.notEqual(product.verdict, "nicht_vergleichbar");
  assert.equal(product.confounders[0].measurement, false);
  // A release on the first day of the before-window is outside the compared span.
  const outside = measureChange(change, {
    snapshot: sampleWindowSnapshot("2026-08-21", "2026-09-03"),
    today: SAMPLE_TODAY,
    releases: [{ date: "2026-08-07", key: "attribution-window", title: "x" }],
  });
  assert.notEqual(outside.verdict, "nicht_vergleichbar");
});

test("measureChange: section notes of the window snapshot and measurement switches also block the comparison", () => {
  const change = {
    ref: "S51",
    kind: "suggestion",
    id: 51,
    suggestionId: 51,
    title: "Popup-Text",
    lane: "frontend",
    date: "2026-08-20",
    until: null,
    state: "umgesetzt",
    metricSource: "erfolgsmass",
    metrics: [{ key: "signin.popupRate", role: "primary" }],
    horizonDays: 14,
    target: null,
  };
  const noted = measureChange(change, {
    snapshot: sampleWindowSnapshot("2026-08-21", "2026-09-03", { releaseNotes: { signin: { current: ["Erst ab dem 04.10.2026 aussagekräftig."], previous: [] } } }),
    today: SAMPLE_TODAY,
    releases: [],
  });
  assert.equal(noted.verdict, "nicht_vergleichbar");
  assert.match(noted.metrics[0].reasons.join(" "), /04\.10\.2026/);

  const revenueChange = { ...change, ref: "S52", metrics: [{ key: "revenue.total", role: "primary" }] };
  const sw = [{ key: "attributionSessionAnchor", label: "Zuordnungsfenster ab letzter Beratung", from: false, to: true, between: { from: "2026-08-25", to: "2026-09-09" } }];
  const switched = measureChange(revenueChange, { snapshot: sampleWindowSnapshot("2026-08-21", "2026-09-03"), today: SAMPLE_TODAY, switchHistory: sw, releases: [] });
  assert.equal(switched.verdict, "nicht_vergleichbar");
  assert.match(switched.confounders[0].label, /Schalter „Zuordnungsfenster ab letzter Beratung“ zwischen 25\.08\.2026 und 09\.09\.2026/);
});

test("measureChange: too fresh changes and summariseMeasurements", () => {
  const all = changes();
  const d4 = all.find((c) => c.ref === "D4");
  const m = measureChange(d4, { snapshot: null, today: SAMPLE_TODAY });
  assert.equal(m.verdict, "zu_frueh");
  const s = summariseMeasurements([m, { verdict: "besser_tendenz" }]);
  assert.equal(s.total, 2);
  assert.equal(s.assessable, true);
  assert.equal(summariseMeasurements([m]).assessable, false);
});

// ── Movers ────────────────────────────────────────────────────────────────────

test("snapshotMovers: better and worse decision metrics, measurement-changed sections apart", () => {
  const movers = snapshotMovers(sampleRunSnapshot());
  const improved = movers.improved.map((m) => m.key);
  assert.ok(improved.includes("revenue.total"));
  assert.ok(improved.length <= 6);
  // The fixture's sign-in section carries a previous-period note → not a mover.
  assert.ok(movers.notComparable.some((m) => m.key === "signin.popupRate"));
  assert.ok(!improved.includes("signin.popupRate"));
  // Significant moves first.
  const firstPlain = movers.improved.findIndex((m) => !m.significant);
  if (firstPlain >= 0) assert.ok(movers.improved.slice(firstPlain).every((m) => !m.significant));
  for (const m of [...movers.improved, ...movers.worsened]) assert.ok(MOVER_KEYS.includes(m.key));
  assert.ok(movers.steady >= 1, "journey.chatToOrder did not move");
  assert.deepEqual(snapshotMovers(null), { improved: [], worsened: [], notComparable: [], steady: 0 });
});
