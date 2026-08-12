import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextRunPhase,
  suggestionFingerprint,
  computeKpiBaseline,
  computeBaselineDelta,
  renderDeltaMd,
  parseSuggestionsResponse,
  dedupeSuggestions,
  renderPriorSuggestions,
  renderReportExtract,
  buildSuggestPrompt,
  MAX_SUGGESTIONS_PER_RUN,
  MAX_DIRECTIVE_CHARS,
} from "./improvement-core.mjs";

// ── Phase machine ─────────────────────────────────────────────────────────────

test("nextRunPhase walks wirkung → vorschlaege → done and tolerates junk", () => {
  assert.equal(nextRunPhase("wirkung"), "vorschlaege");
  assert.equal(nextRunPhase("vorschlaege"), "done");
  assert.equal(nextRunPhase("done"), "done");
  assert.equal(nextRunPhase("nonsense"), "done");
});

// ── Fingerprint ───────────────────────────────────────────────────────────────

test("suggestionFingerprint normalises umlauts, case, punctuation and whitespace", () => {
  // Same normalisation as qa-core: accents stripped (ö→o), ß→ss, lowercase,
  // punctuation → space, whitespace collapsed.
  assert.equal(
    suggestionFingerprint("Größere  Auswahl an Laufbändern!"),
    "grossere auswahl an laufbandern"
  );
  assert.equal(suggestionFingerprint("Maße prüfen"), "masse prufen");
  assert.equal(suggestionFingerprint(null), "");
});

// ── Baseline + delta ──────────────────────────────────────────────────────────

const sections = (over = {}) => ({
  kpis: {
    conversations: 200,
    analyzed: 150,
    tiers: { anonymous: 150, emailOnly: 30, signedIn: 20 },
    withError: 10,
    emailCaptured: 40,
    cartUsed: 30,
    checkoutOffered: 60,
  },
  categories: [{ label: "Produktberatung", count: 100 }],
  qualities: [
    { label: "Gut gelöst", count: 90 },
    { label: "Bedürfnis unerfüllt", count: 30 },
  ],
  personas: [],
  notes: [],
  insightsMd: null,
  customerKnowledgeMd: null,
  ...over,
});

test("computeKpiBaseline produces one-decimal percent rates", () => {
  const b = computeKpiBaseline(sections());
  assert.equal(b.conversations, 200);
  assert.equal(b.emailCapturedShare, 20);
  assert.equal(b.cartUsedShare, 15);
  assert.equal(b.withErrorShare, 5);
  assert.equal(b.qualityShares["Gut gelöst"], 45);
});

test("computeKpiBaseline reports null rates for an empty window", () => {
  const b = computeKpiBaseline(sections({ kpis: { conversations: 0 } }));
  assert.equal(b.conversations, 0);
  assert.equal(b.emailCapturedShare, null);
});

test("computeBaselineDelta compares only mutually measurable rates", () => {
  const prev = computeKpiBaseline(sections());
  const cur = computeKpiBaseline(
    sections({
      kpis: { ...sections().kpis, emailCaptured: 60 },
      qualities: [{ label: "Gut gelöst", count: 110 }],
    })
  );
  const delta = computeBaselineDelta(prev, cur);
  const email = delta.rows.find((r) => r.key === "emailCapturedShare");
  assert.equal(email.prev, 20);
  assert.equal(email.cur, 30);
  assert.equal(email.delta, 10);
  const gut = delta.rows.find((r) => r.key === "quality:Gut gelöst");
  assert.equal(gut.delta, 10);
  // "Bedürfnis unerfüllt" is absent from cur → no row.
  assert.equal(delta.rows.some((r) => r.key.includes("unerfüllt")), false);
  assert.equal(computeBaselineDelta(null, cur), null);
});

test("renderDeltaMd renders a table and a graceful empty state", () => {
  const prev = computeKpiBaseline(sections());
  const md = renderDeltaMd(computeBaselineDelta(prev, prev));
  assert.match(md, /\| Kennzahl \|/);
  assert.match(md, /E-Mail-Capture-Quote/);
  assert.match(renderDeltaMd(null), /Keine vergleichbaren Kennzahlen/);
});

// ── Suggestions parser ────────────────────────────────────────────────────────

const validItem = (over = {}) => ({
  lane: "shop",
  category: "sortiment",
  title: "Mehr klappbare Laufbänder aufnehmen",
  rationale: "Viele Wohnungs-Personas fragen danach.",
  proposal: "Zwei klappbare Modelle unter 800 € listen.",
  expected_effect: "Warenkorb-Klick-Quote steigt",
  impact: "hoch",
  effort: "mittel",
  evidence: ["Persona Einsteiger: 12 Nachfragen"],
  ...over,
});

test("parseSuggestionsResponse accepts plain JSON and code-fenced JSON", () => {
  const payload = JSON.stringify({ vorschlaege: [validItem()] });
  for (const text of [payload, "```json\n" + payload + "\n```"]) {
    const res = parseSuggestionsResponse(text);
    assert.equal(res.ok, true);
    assert.equal(res.suggestions.length, 1);
    assert.equal(res.suggestions[0].lane, "shop");
    assert.equal(res.suggestions[0].impact, "hoch");
    assert.ok(res.suggestions[0].fingerprint.length > 0);
  }
});

test("parseSuggestionsResponse extracts the JSON object out of surrounding prose", () => {
  const text = "Hier die Vorschläge:\n" + JSON.stringify({ vorschlaege: [validItem()] });
  assert.equal(parseSuggestionsResponse(text).ok, true);
});

test("parseSuggestionsResponse rejects garbage and empty payloads", () => {
  assert.equal(parseSuggestionsResponse("kein json").ok, false);
  assert.equal(parseSuggestionsResponse(JSON.stringify({ foo: 1 })).ok, false);
  assert.equal(parseSuggestionsResponse(JSON.stringify({ vorschlaege: [{}] })).ok, false);
});

test("parseSuggestionsResponse validates lane, falls back on category, drops incomplete items", () => {
  const res = parseSuggestionsResponse(
    JSON.stringify({
      vorschlaege: [
        validItem({ lane: "weird" }), // dropped — unknown lane
        validItem({ category: "unbekannt" }), // kept — category falls back
        validItem({ title: "" }), // dropped — no title
      ],
    })
  );
  assert.equal(res.ok, true);
  assert.equal(res.suggestions.length, 1);
  assert.equal(res.suggestions[0].category, "sortiment");
});

test("directive is kept only for lane=mo and clamped to the directive cap", () => {
  const long = "x".repeat(MAX_DIRECTIVE_CHARS + 100);
  const res = parseSuggestionsResponse(
    JSON.stringify({
      vorschlaege: [
        validItem({ lane: "mo", category: "anweisung", directive: long }),
        validItem({ directive: "sollte verschwinden" }),
      ],
    })
  );
  assert.equal(res.ok, true);
  assert.ok(res.suggestions[0].directive.length <= MAX_DIRECTIVE_CHARS);
  assert.equal(res.suggestions[1].directive, null);
});

test("parser caps the number of suggestions per run", () => {
  const many = Array.from({ length: MAX_SUGGESTIONS_PER_RUN + 5 }, (_, i) =>
    validItem({ title: `Vorschlag Nummer ${i}` })
  );
  const res = parseSuggestionsResponse(JSON.stringify({ vorschlaege: many }));
  assert.equal(res.suggestions.length, MAX_SUGGESTIONS_PER_RUN);
});

test("dedupeSuggestions drops fingerprint matches (existing AND within-batch)", () => {
  const res = parseSuggestionsResponse(
    JSON.stringify({
      vorschlaege: [
        validItem(),
        validItem({ title: "Mehr klappbare Laufbänder aufnehmen!" }), // same fp
        validItem({ title: "Etwas ganz anderes" }),
      ],
    })
  );
  const kept = dedupeSuggestions(res.suggestions, [
    suggestionFingerprint("Etwas ganz anderes"),
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].title, "Mehr klappbare Laufbänder aufnehmen");
});

// ── Prompt builders ───────────────────────────────────────────────────────────

test("renderPriorSuggestions lists status + effect and has an empty state", () => {
  assert.equal(renderPriorSuggestions([]), "(keine)");
  const md = renderPriorSuggestions([
    {
      lane: "mo",
      title: "Titel A",
      status: "implemented",
      expectedEffect: "Quote X steigt",
      statusNote: "seit Mai live",
    },
  ]);
  assert.match(md, /\[Mo\] · Titel A/);
  assert.match(md, /Umgesetzt/);
  assert.match(md, /Quote X steigt/);
  assert.match(md, /seit Mai live/);
});

test("renderReportExtract carries KPIs, distributions and clamps narratives", () => {
  const md = renderReportExtract(
    sections({ insightsMd: "A".repeat(10_000), notes: ["Anhang begrenzt."] }),
    { maxNarrativeChars: 500 }
  );
  assert.match(md, /Gespräche im Zeitraum: 200/);
  assert.match(md, /Gut gelöst: 90/);
  assert.match(md, /Anhang begrenzt\./);
  const insights = md.split("### Aggregierte Insights")[1];
  assert.ok(insights.length < 600);
});

test("buildSuggestPrompt assembles all provided sections in order", () => {
  const prompt = buildSuggestPrompt({
    reportTitle: "Testbericht",
    rangeFrom: "2026-08-01",
    rangeTo: "2026-08-07",
    reportMd: "REPORT",
    selfSnapshot: "SELF",
    priorSuggestions: [],
    deltaMd: "DELTA",
    effectCheckMd: "WIRKUNG",
  });
  const order = ["Testbericht", "REPORT", "SELF", "(keine)", "DELTA", "WIRKUNG", "JSON"];
  let last = -1;
  for (const needle of order) {
    const idx = prompt.indexOf(needle);
    assert.ok(idx > last, `${needle} fehlt oder falsche Reihenfolge`);
    last = idx;
  }
});
