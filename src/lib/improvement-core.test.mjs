import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RUN_PHASES,
  RUN_PHASE_LABELS,
  STRATEGIST_PHASES,
  OWNER_LANES,
  OWNER_LANE_LABELS,
  OWNER_LANE_DESCRIPTIONS,
  PASS_LANES,
  SHOP_CATEGORIES,
  MO_CATEGORIES,
  SUGGESTION_STATUSES,
  SUGGESTION_STATUS_LABELS,
  backlogMatrix,
  dedupeSuggestions,
  nextRunPhase,
  ownerLaneOf,
  priorityScore,
  priorityTier,
  renderReportExtract,
  resolveRunPeriod,
  MAX_RUN_PERIOD_DAYS,
  runPhaseIndex,
  runVersion,
  storageLaneFor,
  suggestionFingerprint,
} from "./improvement-core.mjs";

// ── Versions and phases ───────────────────────────────────────────────────────

test("runVersion tells snapshot runs (v2) from the older report runs (v1)", () => {
  assert.equal(runVersion({ version: 2, period: {} }), 2);
  assert.equal(runVersion({ conversations: 12, analyzedShare: 50 }), 1);
  assert.equal(runVersion(null), 1);
});

test("nextRunPhase: daten → messung → (wirkungscheck) → chat → betrieb → done", () => {
  assert.equal(nextRunPhase("daten"), "messung");
  assert.equal(nextRunPhase("messung", { hasAssessable: true }), "wirkungscheck");
  assert.equal(nextRunPhase("messung", { hasAssessable: false }), "vorschlaege_chat");
  assert.equal(nextRunPhase("wirkungscheck"), "vorschlaege_chat");
  assert.equal(nextRunPhase("vorschlaege_chat"), "vorschlaege_betrieb");
  assert.equal(nextRunPhase("vorschlaege_betrieb"), "done");
  assert.equal(nextRunPhase("nonsense"), "done");
  assert.equal(runPhaseIndex("wirkungscheck"), 2);
  assert.equal(runPhaseIndex("vorschlaege_shop"), -1, "legacy phases are not part of the v2 machine");
});

test("every phase — v2 and legacy — has a German label; strategist phases are v2 phases", () => {
  for (const p of [...RUN_PHASES, "wirkung", "vorschlaege", "vorschlaege_shop", "vorschlaege_mo"]) {
    assert.ok(RUN_PHASE_LABELS[p], `label for ${p}`);
  }
  for (const p of STRATEGIST_PHASES) assert.ok(RUN_PHASES.includes(p));
});

// ── Period ────────────────────────────────────────────────────────────────────

test("resolveRunPeriod: presets are full days up to yesterday; report and custom ranges", () => {
  const today = "2026-10-06";
  assert.deepEqual(resolveRunPeriod({ preset: "30d" }, today), {
    from: "2026-09-06",
    to: "2026-10-05",
    days: 30,
    label: "06.09.2026 – 05.10.2026",
  });
  assert.equal(resolveRunPeriod({ preset: "7d" }, today).from, "2026-09-29");
  assert.deepEqual(resolveRunPeriod({ preset: "report", reportRange: { from: "2026-08-10", to: "2026-09-08" } }, today).days, 30);
  assert.equal(resolveRunPeriod({ preset: "report" }, today), null);
  const custom = resolveRunPeriod({ preset: "custom", from: "2026-10-09", to: "2026-09-01" }, today);
  assert.deepEqual([custom.from, custom.to], ["2026-09-01", "2026-10-05"], "swapped and clamped to yesterday");
  assert.equal(resolveRunPeriod({ preset: "custom", from: "2024-01-01", to: "2026-09-30" }, today).days, MAX_RUN_PERIOD_DAYS);
  assert.equal(resolveRunPeriod({ preset: "custom", from: "2026-10-07", to: "2026-10-08" }, today), null, "entirely in the future");
  assert.equal(resolveRunPeriod({ preset: "custom", from: "x", to: "2026-09-01" }, today), null);
  assert.equal(resolveRunPeriod({ preset: "nonsense" }, today), null);
});

// ── Owner lanes ───────────────────────────────────────────────────────────────

test("owner lanes have labels and descriptions; the passes cover every lane", () => {
  for (const l of OWNER_LANES) {
    assert.ok(OWNER_LANE_LABELS[l]);
    assert.ok(OWNER_LANE_DESCRIPTIONS[l]);
  }
  const covered = new Set([...PASS_LANES.vorschlaege_chat, ...PASS_LANES.vorschlaege_betrieb]);
  assert.deepEqual([...covered].sort(), [...OWNER_LANES].sort());
  assert.ok(PASS_LANES.vorschlaege_chat.includes("chat"), "directives come from the chat pass");
  assert.ok(!PASS_LANES.vorschlaege_betrieb.includes("chat"));
});

test("ownerLaneOf: v2 rows keep the lane in `category`, v1 rows are mapped", () => {
  assert.equal(ownerLaneOf({ lane: "shop", category: "campaign" }), "campaign");
  assert.equal(ownerLaneOf({ lane: "mo", category: "anweisung" }), "chat");
  assert.equal(ownerLaneOf({ lane: "mo", category: "wissen" }), "operator");
  assert.equal(ownerLaneOf({ lane: "mo", category: "tools" }), "developer");
  assert.equal(ownerLaneOf({ lane: "shop", category: "marketing" }), "campaign");
  assert.equal(ownerLaneOf({ lane: "shop", category: "ux_storefront" }), "frontend");
  assert.equal(ownerLaneOf({ lane: "mo", category: "unbekannt" }), "chat");
  assert.equal(ownerLaneOf({ lane: "shop", category: "" }), "operator");
  // Every v1 category is mapped deliberately.
  for (const c of [...Object.keys(SHOP_CATEGORIES), ...Object.keys(MO_CATEGORIES)]) {
    assert.ok(OWNER_LANES.includes(ownerLaneOf({ category: c })), c);
  }
  assert.equal(storageLaneFor("chat"), "mo");
  assert.equal(storageLaneFor("campaign"), "shop");
});

test("statuses keep their plain-language labels", () => {
  assert.deepEqual(SUGGESTION_STATUSES, ["open", "accepted", "implemented", "dismissed"]);
  assert.equal(SUGGESTION_STATUS_LABELS.accepted, "Geplant");
});

// ── Priority and backlog ──────────────────────────────────────────────────────

test("priority: impact × confidence ÷ effort, damped by risk, in three tiers", () => {
  const top = priorityScore({ impact: "hoch", effort: "niedrig", confidence: "hoch", risk: "niedrig" });
  assert.equal(top, 3);
  assert.equal(priorityTier(top), 1);
  const mid = priorityScore({ impact: "mittel", effort: "mittel", confidence: "mittel" });
  assert.equal(priorityTier(mid), 2);
  const low = priorityScore({ impact: "niedrig", effort: "hoch", confidence: "niedrig", risk: "hoch" });
  assert.equal(priorityTier(low), 3);
  // Risk lowers, never raises.
  assert.ok(priorityScore({ impact: "hoch", effort: "niedrig", confidence: "hoch", risk: "hoch" }) < top);
  // v1 rows have no confidence / risk: they count as "mittel" / undamped.
  assert.equal(priorityScore({ impact: "hoch", effort: "mittel" }), priorityScore({ impact: "hoch", effort: "mittel", confidence: "mittel" }));
  assert.equal(priorityTier(Number.NaN), 3);
});

test("backlogMatrix counts open and planned suggestions by lane and tier", () => {
  const m = backlogMatrix([
    { status: "open", category: "chat", impact: "hoch", effort: "niedrig", confidence: "hoch" },
    { status: "accepted", category: "chat", impact: "mittel", effort: "mittel", confidence: "mittel" },
    { status: "open", lane: "shop", category: "marketing", impact: "niedrig", effort: "hoch" },
    { status: "implemented", category: "operator", impact: "hoch", effort: "niedrig" },
    { status: "dismissed", category: "legal", impact: "hoch", effort: "niedrig" },
  ]);
  assert.equal(m.total, 3);
  assert.deepEqual(
    m.lanes.map((l) => l.lane),
    ["chat", "campaign"],
    "OWNER_LANES order, empty lanes left out"
  );
  assert.deepEqual(m.lanes[0].tiers, { 1: 1, 2: 1, 3: 0 });
  assert.equal(m.lanes[0].planned, 1);
  assert.deepEqual(m.lanes[1].tiers, { 1: 0, 2: 0, 3: 1 });
  assert.deepEqual(backlogMatrix([]), { total: 0, lanes: [] });
});

// ── Fingerprint ───────────────────────────────────────────────────────────────

test("suggestionFingerprint normalises umlauts, case, punctuation and whitespace", () => {
  assert.equal(suggestionFingerprint("Größere  Auswahl an Laufbändern!"), "grossere auswahl an laufbandern");
  assert.equal(suggestionFingerprint("Maße prüfen"), "masse prufen");
  assert.equal(suggestionFingerprint(null), "");
});

test("dedupeSuggestions drops fingerprint matches (existing AND within the batch)", () => {
  const items = ["Mehr klappbare Laufbänder aufnehmen", "Mehr klappbare Laufbänder aufnehmen!", "Etwas ganz anderes"].map((title) => ({
    title,
    fingerprint: suggestionFingerprint(title),
  }));
  const kept = dedupeSuggestions(items, [suggestionFingerprint("Etwas ganz anderes")]);
  assert.deepEqual(
    kept.map((k) => k.title),
    ["Mehr klappbare Laufbänder aufnehmen"]
  );
});

// ── Report extract ────────────────────────────────────────────────────────────

const sections = (over = {}) => ({
  kpis: { conversations: 200, analyzed: 150, tiers: { anonymous: 150, emailOnly: 30, signedIn: 20 }, withError: 10, emailCaptured: 40, cartUsed: 30, checkoutOffered: 60 },
  categories: [{ label: "Produktberatung", count: 100 }],
  qualities: [
    { label: "Gut gelöst", count: 90 },
    { label: "Bedürfnis unerfüllt", count: 30 },
  ],
  personas: [{ personaDisplay: "Heimtrainer:in", chatCount: 12, favoriteProducts: [{ name: "Laufband X" }], topQuestionsMd: "- Wie laut?" }],
  notes: [],
  insightsMd: null,
  customerKnowledgeMd: null,
  ...over,
});

test("renderReportExtract carries KPIs, distributions, personas and clamps narratives", () => {
  const md = renderReportExtract(sections({ insightsMd: "A".repeat(10_000), notes: ["Anhang begrenzt."] }), { maxNarrativeChars: 500 });
  assert.match(md, /Gespräche im Zeitraum: 200/);
  assert.match(md, /Gut gelöst: 90/);
  assert.match(md, /Persona Heimtrainer:in: 12 Gespräch\(e\) · häufig empfohlen: Laufband X/);
  assert.match(md, /Top-Fragen je Persona/);
  assert.match(md, /Anhang begrenzt\./);
  const insights = md.split("### Aggregierte Insights")[1].split("###")[0];
  assert.ok(insights.length < 600);
});

test("renderReportExtract masks personal data in the narratives", () => {
  const md = renderReportExtract(sections({ customerKnowledgeMd: "Kundin anna@example.com fragte nach Bestellung #12345." }));
  assert.ok(!md.includes("anna@example.com"));
  assert.ok(!md.includes("#12345"));
  assert.match(md, /\[E-Mail\]/);
});
