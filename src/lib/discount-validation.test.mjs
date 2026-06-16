import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_PERCENT_MAX,
  DEFAULT_DISCOUNT_PERCENT,
  isValidDiscountPercent,
  parseDiscountPercent,
  clampDiscountPercent,
  detectDiscountTextMismatch,
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

test("detectDiscountTextMismatch: matching depth in prose is NOT a mismatch", () => {
  for (const body of [
    "Mit deinem Code bekommst du 10% auf deine Auswahl.",
    "Du sparst 10 % auf alles.", // spaced
    "Es sind ganze 10 Prozent Rabatt.", // spelled out
    "Dein 10%-Code gehört nur dir.",
    "Du sparst 10 % (mit geschütztem Leerzeichen).", // NBSP before %
  ]) {
    assert.equal(detectDiscountTextMismatch(10, body).mismatch, false, body);
  }
});

test("detectDiscountTextMismatch: a different in-range percent IS a mismatch", () => {
  assert.equal(detectDiscountTextMismatch(10, "Du sparst 20 % auf alles.").mismatch, true);
  assert.equal(detectDiscountTextMismatch(15, "Nutze deine 5 % Ersparnis.").mismatch, true);
  assert.equal(detectDiscountTextMismatch(10, "10 statt — jetzt 25%!").mismatch, true);
});

test("detectDiscountTextMismatch: rhetorical out-of-range percentages are ignored", () => {
  // "100 %" is not a plausible discount depth → must never block a send.
  assert.equal(detectDiscountTextMismatch(10, "Sei zu 100 % zufrieden!").mismatch, false);
  // The correct depth present alongside a rhetorical 100 % is fine.
  assert.equal(
    detectDiscountTextMismatch(10, "10 % Rabatt und 100 % Zufriedenheit.").mismatch,
    false
  );
  assert.equal(detectDiscountTextMismatch(10, "Spare 200% deiner Zeit.").mismatch, false);
});

test("detectDiscountTextMismatch: prose with no percentage at all is allowed", () => {
  // Discount conveyed only via the deterministic code line → don't block.
  assert.equal(
    detectDiscountTextMismatch(10, "Dein persönlicher Code liegt im Warenkorb bereit.").mismatch,
    false
  );
  assert.equal(detectDiscountTextMismatch(10, "").mismatch, false);
});

test("detectDiscountTextMismatch: digit-boundary safe (15 % is 15, not 5)", () => {
  // depth 5, prose says 15 % → mismatch; the "5" inside "15" must not match.
  const r = detectDiscountTextMismatch(5, "Du sparst 15 %.");
  assert.equal(r.mismatch, true);
  assert.deepEqual(r.found, [15]);
  // depth 50, prose "50 %" matches; the trailing 0 must not break boundary.
  assert.equal(detectDiscountTextMismatch(50, "Volle 50% Nachlass.").mismatch, false);
});

test("detectDiscountTextMismatch: 0 / invalid depth never blocks", () => {
  assert.equal(detectDiscountTextMismatch(0, "Egal welcher 20 % Text.").mismatch, false);
  assert.equal(detectDiscountTextMismatch(NaN, "20 %").mismatch, false);
  assert.equal(detectDiscountTextMismatch(10, undefined).mismatch, false);
});
