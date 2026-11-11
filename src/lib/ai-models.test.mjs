import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_TIERS,
  HAIKU_MODEL,
  OPUS_MODEL,
  SONNET_MODEL,
  anthropicOptionsFor,
  maxOutputTokensFor,
  modelFor,
} from "./ai-models.mjs";
import { DEFAULT_MODEL_PRICES, priceForModel } from "./ai-pricing.mjs";

test("each tier maps to the intended model", () => {
  assert.equal(modelFor("chat"), SONNET_MODEL);
  assert.equal(modelFor("writer"), SONNET_MODEL);
  assert.equal(modelFor("analyst"), SONNET_MODEL);
  assert.equal(modelFor("deep"), OPUS_MODEL);
  assert.equal(modelFor("strategist"), OPUS_MODEL);
  assert.equal(modelFor("designer"), OPUS_MODEL);
  assert.equal(modelFor("bulk"), HAIKU_MODEL);
});

test("every tier's model is priced, so the cost KPI never reads €0", () => {
  for (const { model } of Object.values(AI_TIERS)) {
    assert.ok(priceForModel(model, DEFAULT_MODEL_PRICES), `no price for ${model}`);
  }
});

test("chat keeps thinking off (between_tools) at an effort between_tools accepts", () => {
  const opts = anthropicOptionsFor("chat");
  assert.deepEqual(opts.anthropic.thinking, { type: "between_tools" });
  assert.ok(["low", "medium", "high"].includes(opts.anthropic.effort));
  assert.equal(opts.anthropic.fallbacks, "default");
});

test("thinking tiers send adaptive thinking, an effort and the refusal fallback", () => {
  for (const tier of ["writer", "analyst", "deep", "strategist", "designer"]) {
    const { anthropic } = anthropicOptionsFor(tier);
    assert.deepEqual(anthropic.thinking, { type: "adaptive" });
    assert.ok(anthropic.effort);
    assert.equal(anthropic.fallbacks, "default");
  }
});

test("bulk (Haiku) runs with the model defaults — no thinking, no effort, no fallback", () => {
  assert.deepEqual(anthropicOptionsFor("bulk"), {});
});

test("output caps add thinking headroom only where the tier thinks", () => {
  assert.equal(maxOutputTokensFor("bulk", 600), 600);
  assert.equal(maxOutputTokensFor("chat", 600), 600);
  assert.ok(maxOutputTokensFor("writer", 700) > 700);
  assert.ok(maxOutputTokensFor("analyst", 900) > maxOutputTokensFor("writer", 900));
  assert.ok(maxOutputTokensFor("deep", 1500) > 1500);
});

test("the strategist tier thinks hard: Opus at effort high with more headroom than deep", () => {
  assert.equal(anthropicOptionsFor("strategist").anthropic.effort, "high");
  assert.ok(maxOutputTokensFor("strategist", 4000) > maxOutputTokensFor("deep", 4000));
});

test("the designer tier (owner 11.11.2026: quality over speed): Opus 5.5, adaptive, effort high, the most headroom", () => {
  assert.equal(modelFor("designer"), OPUS_MODEL);
  assert.deepEqual(anthropicOptionsFor("designer"), {
    anthropic: { thinking: { type: "adaptive" }, effort: "high", fallbacks: "default" },
  });
  // a whole block document (answer budget 32,000) plus the thinking headroom — far below Opus' 128k cap
  assert.equal(maxOutputTokensFor("designer", 32000), 64000);
  for (const tier of Object.keys(AI_TIERS)) {
    if (tier !== "designer") assert.ok(AI_TIERS.designer.thinkingHeadroom >= AI_TIERS[tier].thinkingHeadroom, `${tier} has more headroom`);
  }
});
