// Tests for the conversation-inspector core helpers + the inspector's guardrails.
//
// Pure-logic coverage (tier, readable filter, defensive JSON parse, cache
// decision, bulk cost estimate, rollup tally + prompt) PLUS source-level guardrail
// checks that encode the task's requirements:
//   - list/transcript make NO model call (admin-conversations has no AI import)
//   - the rollup reads CACHED SUMMARIES, not transcripts
//   - erasing a conversation removes its analysis (analysis lives on the row)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  classifyTier,
  isReadableTurn,
  parseAnalysisResponse,
  shouldRegenerate,
  estimateAnalysisCostUsd,
  tallyCategories,
  tallyQualities,
  buildRollupPrompt,
  ANALYSIS_CATEGORIES,
  ANALYSIS_QUALITIES,
} from "./conversation-analysis-core.mjs";
import { DEFAULT_MODEL_PRICES } from "./ai-pricing.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, rel), "utf8");

// ── classifyTier ──────────────────────────────────────────────────────────────
test("classifyTier: signed-in wins, then email, else anonymous", () => {
  assert.equal(classifyTier({ signedIn: true, identified: true }), "signed-in");
  assert.equal(classifyTier({ signedIn: true, identified: false }), "signed-in");
  assert.equal(classifyTier({ signedIn: false, identified: true }), "email-only");
  assert.equal(classifyTier({ signedIn: false, identified: false }), "anonymous");
});

// ── isReadableTurn (the shared readable-turn filter) ──────────────────────────
test("isReadableTurn: keeps human/bot text, drops tool/empty/system rows", () => {
  assert.equal(isReadableTurn({ role: "user", content: "hallo", toolName: null }), true);
  assert.equal(isReadableTurn({ role: "assistant", content: "hi", toolName: null }), true);
  // tool-bookkeeping row (tool_name set) is dropped even on an assistant row
  assert.equal(
    isReadableTurn({ role: "assistant", content: "{}", toolName: "show_product" }),
    false
  );
  assert.equal(isReadableTurn({ role: "system", content: "x", toolName: null }), false);
  assert.equal(isReadableTurn({ role: "tool", content: "x", toolName: null }), false);
  assert.equal(isReadableTurn({ role: "user", content: "   ", toolName: null }), false);
  assert.equal(isReadableTurn({ role: "user", content: "", toolName: null }), false);
  assert.equal(isReadableTurn(null), false);
});

// ── parseAnalysisResponse ─────────────────────────────────────────────────────
test("parseAnalysisResponse: clean JSON", () => {
  const r = parseAnalysisResponse(
    '{"summary":"Kunde fragt nach Hantelbank.","category":"product-advice","tags":["Hantelbank","Kraft"],"quality":"handled_well"}'
  );
  assert.equal(r.summary, "Kunde fragt nach Hantelbank.");
  assert.equal(r.category, "product-advice");
  assert.deepEqual(r.tags, ["Hantelbank", "Kraft"]);
  assert.equal(r.quality, "handled_well");
});

test("parseAnalysisResponse: tolerates ```json fences and surrounding prose", () => {
  const r = parseAnalysisResponse(
    'Hier das Ergebnis:\n```json\n{"summary":"x","category":"sizing","tags":[],"quality":"satisfied"}\n```\nDanke!'
  );
  assert.equal(r.category, "sizing");
  assert.equal(r.quality, "satisfied");
});

test("parseAnalysisResponse: coerces unknown category/quality to safe fallbacks", () => {
  const r = parseAnalysisResponse('{"summary":"x","category":"banana","quality":"meh","tags":"nope"}');
  assert.equal(r.category, "other");
  assert.equal(r.quality, "unclear");
  assert.deepEqual(r.tags, []); // non-array tags → []
});

test("parseAnalysisResponse: clamps + dedups tags to <=6", () => {
  const r = parseAnalysisResponse(
    '{"summary":"x","category":"complaint","quality":"unmet_need","tags":["a","a","b","c","d","e","f","g"]}'
  );
  assert.equal(r.tags.length, 6);
  assert.deepEqual(r.tags, ["a", "b", "c", "d", "e", "f"]);
});

test("parseAnalysisResponse: garbage → null (treated as model error, not cached)", () => {
  assert.equal(parseAnalysisResponse("not json at all"), null);
  assert.equal(parseAnalysisResponse(""), null);
  assert.equal(parseAnalysisResponse(undefined), null);
});

// ── shouldRegenerate (cache-or-recompute) ─────────────────────────────────────
test("shouldRegenerate: cached + !force ⇒ false (free re-open); force ⇒ true", () => {
  assert.equal(shouldRegenerate({ hasCached: true, force: false }), false);
  assert.equal(shouldRegenerate({ hasCached: true, force: true }), true);
  assert.equal(shouldRegenerate({ hasCached: false, force: false }), true);
  assert.equal(shouldRegenerate({ hasCached: false, force: true }), true);
});

// ── estimateAnalysisCostUsd ───────────────────────────────────────────────────
test("estimateAnalysisCostUsd: zero for none, positive + linear otherwise", () => {
  assert.equal(estimateAnalysisCostUsd(0, DEFAULT_MODEL_PRICES), 0);
  const one = estimateAnalysisCostUsd(1, DEFAULT_MODEL_PRICES);
  const ten = estimateAnalysisCostUsd(10, DEFAULT_MODEL_PRICES);
  assert.ok(one > 0, "one conversation has a positive estimate");
  assert.ok(Math.abs(ten - one * 10) < 1e-9, "estimate scales linearly");
  // Haiku is cheap: a single analysis is well under one cent.
  assert.ok(one < 0.01, "single analysis under $0.01");
});

test("Haiku model is priced (so cost is never silently zero)", () => {
  assert.deepEqual(DEFAULT_MODEL_PRICES["claude-haiku-4-5"], { input: 1, output: 5 });
});

// ── tally + rollup prompt (the rollup reads SUMMARIES, not transcripts) ────────
test("tallyCategories / tallyQualities: counts, sorts desc, coerces unknown", () => {
  const analyses = [
    { category: "product-advice", quality: "handled_well" },
    { category: "product-advice", quality: "unmet_need" },
    { category: "sizing", quality: "handled_well" },
    { category: "banana", quality: "weird" }, // coerced to other / unclear
  ];
  const cats = tallyCategories(analyses);
  assert.equal(cats[0].category, "product-advice");
  assert.equal(cats[0].count, 2);
  assert.ok(cats.some((c) => c.category === "other"));
  const quals = tallyQualities(analyses);
  assert.equal(quals[0].count, 2); // handled_well x2
  assert.ok(quals.some((q) => q.quality === "unclear"));
});

test("buildRollupPrompt: uses only cached summary fields (never a transcript)", () => {
  const analyses = [
    { summary: "Kunde sucht Laufband.", category: "product-advice", quality: "handled_well", tags: ["Laufband"] },
    { summary: "", category: "off-topic", quality: "unclear", tags: [] }, // empty summary dropped
  ];
  const prompt = buildRollupPrompt(analyses);
  assert.ok(prompt.includes("Kunde sucht Laufband."), "includes the cached summary");
  assert.ok(prompt.includes("Produktberatung"), "includes the German category label");
  assert.ok(prompt.includes("Laufband"), "includes tags");
  assert.ok(!prompt.includes("Kunde:") && !prompt.includes("Berater:"), "no transcript turns");
  // empty-summary row is excluded
  assert.equal(prompt.split("\n").length, 1);
});

test("category/quality vocabularies cover the documented set", () => {
  for (const c of ["product-advice", "refund/return", "sizing", "price/discount", "technical-question", "complaint", "off-topic"]) {
    assert.ok(ANALYSIS_CATEGORIES.includes(c), `category ${c}`);
  }
  assert.ok(ANALYSIS_QUALITIES.includes("unmet_need"));
  assert.ok(ANALYSIS_QUALITIES.includes("dropped_off"));
});

// ── Guardrails (source-level) ─────────────────────────────────────────────────
test("GUARDRAIL: list/transcript data layer makes no model call (zero tokens)", () => {
  const src = read("./admin-conversations.ts");
  assert.ok(!src.includes("generateText"), "no generateText in the data layer");
  assert.ok(!src.includes("generateObject"), "no generateObject in the data layer");
  assert.ok(!src.includes("@ai-sdk/anthropic"), "no Anthropic import in the data layer");
});

test("GUARDRAIL: the rollup reads cached summaries, not transcripts", () => {
  // loadAnalysesForRollup selects the cached analysis columns, never messages.
  const dl = read("./admin-conversations.ts");
  const fn = dl.slice(dl.indexOf("export async function loadAnalysesForRollup"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.ok(body.includes("analysis_summary"), "rollup loader selects analysis_summary");
  assert.ok(!body.includes("FROM messages"), "rollup loader does not read the messages table");

  // The insights pass consumes the cached summaries; it never pulls a transcript.
  const ins = read("./conversation-insights.ts");
  assert.ok(ins.includes("loadAnalysesForRollup"), "insights uses the cached-summary loader");
  assert.ok(ins.includes("buildRollupPrompt"), "insights builds the prompt from summaries");
  assert.ok(!ins.includes("getAdminConversationDetail"), "insights never loads a transcript");
  assert.ok(!ins.includes(".transcript"), "insights never reads a transcript field");
});

test("GUARDRAIL: analysis cache lives on the conversation row (dropped on erase)", () => {
  const mig = read("../../migrations/0031_conversation_analysis.sql");
  assert.ok(mig.includes("ALTER TABLE conversations"), "analysis columns added to conversations");
  assert.ok(mig.includes("analysis_summary"), "analysis_summary column present");
  assert.ok(mig.includes("analysis_updated_at"), "analysis_updated_at column present");
  // the rollup cache is a sibling table keyed by date range
  assert.ok(mig.includes("CREATE TABLE IF NOT EXISTS conversation_insights"));
});
