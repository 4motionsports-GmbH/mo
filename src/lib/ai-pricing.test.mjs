import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MODEL_PRICES,
  DEFAULT_USD_EUR_RATE,
  parseModelPrices,
  loadModelPrices,
  usdEurRate,
  priceForModel,
  usdCostForUsage,
  usdToEur,
  eurCostForUsage,
} from "./ai-pricing.mjs";

test("priceForModel returns the table entry for a known model", () => {
  assert.deepEqual(priceForModel("claude-opus-4-8"), { input: 5, output: 25 });
  assert.deepEqual(priceForModel("text-embedding-3-small"), { input: 0.02, output: 0 });
});

test("priceForModel returns null for an unknown model", () => {
  assert.equal(priceForModel("some-future-model"), null);
});

test("usdCostForUsage uses per-million-token pricing", () => {
  // 1M input @ $3 + 1M output @ $15 = $18 on Sonnet 4.5.
  assert.equal(
    usdCostForUsage({
      model: "claude-sonnet-4-5-20250929",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }),
    18
  );
  // 1000 input @ $5/MTok + 500 output @ $25/MTok on Opus 4.8.
  const cost = usdCostForUsage({
    model: "claude-opus-4-8",
    inputTokens: 1000,
    outputTokens: 500,
  });
  assert.ok(Math.abs(cost - (1000 * 5 + 500 * 25) / 1_000_000) < 1e-12);
});

test("usdCostForUsage returns 0 for unknown models (no guessing)", () => {
  assert.equal(
    usdCostForUsage({ model: "mystery", inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    0
  );
});

test("usdCostForUsage floors negative / non-finite token counts to 0", () => {
  assert.equal(
    usdCostForUsage({ model: "claude-opus-4-8", inputTokens: -50, outputTokens: NaN }),
    0
  );
});

test("usdToEur applies the rate; default is 0.92", () => {
  assert.equal(usdToEur(100), 92);
  assert.equal(usdToEur(100, 0.9), 90);
  assert.equal(DEFAULT_USD_EUR_RATE, 0.92);
});

test("eurCostForUsage chains cost + conversion", () => {
  // 1M output on Sonnet 4.5 = $15 → €15 * 0.92 = €13.8 at default rate.
  const eur = eurCostForUsage({
    model: "claude-sonnet-4-5-20250929",
    inputTokens: 0,
    outputTokens: 1_000_000,
  });
  assert.ok(Math.abs(eur - 15 * 0.92) < 1e-9);
});

test("parseModelPrices overrides a model and adds new ones", () => {
  const prices = parseModelPrices(
    JSON.stringify({
      "claude-opus-4-8": { input: 6, output: 30 },
      "brand-new-model": { input: 1, output: 2 },
    })
  );
  assert.deepEqual(prices["claude-opus-4-8"], { input: 6, output: 30 });
  assert.deepEqual(prices["brand-new-model"], { input: 1, output: 2 });
  // Untouched defaults survive.
  assert.deepEqual(prices["claude-sonnet-4-5-20250929"], { input: 3, output: 15 });
});

test("parseModelPrices ignores malformed JSON and keeps the base table", () => {
  const prices = parseModelPrices("{not json");
  assert.deepEqual(prices, DEFAULT_MODEL_PRICES);
});

test("parseModelPrices ignores malformed entries (negative / missing fields)", () => {
  const prices = parseModelPrices(
    JSON.stringify({
      "claude-opus-4-8": { input: -1, output: 30 }, // negative input → ignored, base stands
      "text-embedding-3-small": { input: 0.05 }, // partial: keeps base output (0)
      bogus: { nope: true }, // no usable fields → skipped
    })
  );
  assert.deepEqual(prices["claude-opus-4-8"], { input: 5, output: 25 });
  assert.deepEqual(prices["text-embedding-3-small"], { input: 0.05, output: 0 });
  assert.equal(prices.bogus, undefined);
});

test("loadModelPrices reads MODEL_PRICES_JSON from the env", () => {
  const env = { MODEL_PRICES_JSON: JSON.stringify({ "claude-opus-4-8": { input: 9, output: 9 } }) };
  const prices = loadModelPrices(env);
  assert.deepEqual(prices["claude-opus-4-8"], { input: 9, output: 9 });
});

test("usdEurRate parses USD_EUR_RATE and falls back to the default", () => {
  assert.equal(usdEurRate({ USD_EUR_RATE: "0.88" }), 0.88);
  assert.equal(usdEurRate({}), 0.92);
  assert.equal(usdEurRate({ USD_EUR_RATE: "garbage" }), 0.92);
  assert.equal(usdEurRate({ USD_EUR_RATE: "-1" }), 0.92);
});
