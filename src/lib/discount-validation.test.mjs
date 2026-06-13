import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_PERCENT_MAX,
  DEFAULT_DISCOUNT_PERCENT,
  isValidDiscountPercent,
  parseDiscountPercent,
  clampDiscountPercent,
} from "./discount-validation.mjs";

test("bounds: default 0, range 0–50", () => {
  assert.equal(DISCOUNT_PERCENT_MIN, 0);
  assert.equal(DISCOUNT_PERCENT_MAX, 50);
  assert.equal(DEFAULT_DISCOUNT_PERCENT, 0);
});

test("isValidDiscountPercent accepts whole numbers in [0, 50]", () => {
  for (const n of [0, 1, 5, 17, 50]) {
    assert.equal(isValidDiscountPercent(n), true, `expected ${n} valid`);
  }
});

test("isValidDiscountPercent rejects out-of-range values", () => {
  assert.equal(isValidDiscountPercent(-1), false);
  assert.equal(isValidDiscountPercent(51), false);
  assert.equal(isValidDiscountPercent(100), false);
});

test("isValidDiscountPercent rejects non-integers and non-numbers", () => {
  assert.equal(isValidDiscountPercent(5.5), false);
  assert.equal(isValidDiscountPercent(NaN), false);
  assert.equal(isValidDiscountPercent(Infinity), false);
  assert.equal(isValidDiscountPercent("5"), false);
  assert.equal(isValidDiscountPercent(null), false);
  assert.equal(isValidDiscountPercent(undefined), false);
});

test("parseDiscountPercent accepts integer numbers and numeric strings", () => {
  assert.equal(parseDiscountPercent(0), 0);
  assert.equal(parseDiscountPercent(50), 50);
  assert.equal(parseDiscountPercent("0"), 0);
  assert.equal(parseDiscountPercent("25"), 25);
  assert.equal(parseDiscountPercent("  10  "), 10);
});

test("parseDiscountPercent returns null for invalid input", () => {
  assert.equal(parseDiscountPercent(""), null);
  assert.equal(parseDiscountPercent("   "), null);
  assert.equal(parseDiscountPercent("abc"), null);
  assert.equal(parseDiscountPercent("5.5"), null);
  assert.equal(parseDiscountPercent(5.5), null);
  assert.equal(parseDiscountPercent(-1), null);
  assert.equal(parseDiscountPercent(51), null);
  assert.equal(parseDiscountPercent(null), null);
  assert.equal(parseDiscountPercent(undefined), null);
  assert.equal(parseDiscountPercent({}), null);
});

test("clampDiscountPercent rounds and clamps into range", () => {
  assert.equal(clampDiscountPercent(-5), 0);
  assert.equal(clampDiscountPercent(0), 0);
  assert.equal(clampDiscountPercent(25), 25);
  assert.equal(clampDiscountPercent(50), 50);
  assert.equal(clampDiscountPercent(75), 50);
  assert.equal(clampDiscountPercent(4.6), 5);
  assert.equal(clampDiscountPercent(NaN), DEFAULT_DISCOUNT_PERCENT);
});
