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
  for (const tier of ["writer", "analyst", "deep"]) {
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
