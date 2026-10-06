import { test } from "node:test";
import assert from "node:assert/strict";
import { niceTicks } from "./chart-ticks.mjs";

test("round steps that cover the maximum", () => {
  assert.deepEqual(niceTicks(2148), [0, 1000, 2000, 3000]);
  assert.deepEqual(niceTicks(2148, 5), [0, 500, 1000, 1500, 2000, 2500]);
  assert.deepEqual(niceTicks(900), [0, 250, 500, 750, 1000]);
  assert.deepEqual(niceTicks(1000), [0, 250, 500, 750, 1000]);
  assert.deepEqual(niceTicks(7), [0, 2, 4, 6, 8]);
  assert.deepEqual(niceTicks(0.3), [0, 0.1, 0.2, 0.3]);
});

test("empty or invalid input", () => {
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.deepEqual(niceTicks(-5), [0, 1]);
  assert.deepEqual(niceTicks(Number.NaN), [0, 1]);
});
