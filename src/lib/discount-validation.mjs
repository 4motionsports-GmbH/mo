// Shared discount-percentage validation for the personalised-email flow.
//
// The admin enters a whole-number percent in a numeric input (DEFAULT 0, range
// 0–50). 0 = no code is minted and no discount block appears in the email;
// >0 mints the MS5- code through the existing send-path safeguards with the
// chosen percentage. This module is the single source of truth for the bounds,
// validated CLIENT-side (the dashboard input) AND SERVER-side (the draft
// routes). Plain .mjs so the node:test runner can import it directly.

/** Smallest allowed discount percent (0 = no discount, the default). */
export const DISCOUNT_PERCENT_MIN = 0;
/** Largest allowed discount percent. */
export const DISCOUNT_PERCENT_MAX = 50;
/** The default when nothing is entered — applying a discount is deliberate. */
export const DEFAULT_DISCOUNT_PERCENT = 0;

/**
 * Is `n` a valid discount percent: an integer within [MIN, MAX]?
 * Rejects non-numbers, NaN/Infinity, fractions, and out-of-range values.
 */
export function isValidDiscountPercent(n) {
  return (
    typeof n === "number" &&
    Number.isInteger(n) &&
    n >= DISCOUNT_PERCENT_MIN &&
    n <= DISCOUNT_PERCENT_MAX
  );
}

/**
 * Coerce arbitrary input (string from a form field, number, etc.) to a valid
 * discount percent, or null when it can't be interpreted as one. Used to
 * normalise request bodies and form values before validating/storing.
 *   - Accepts an integer number or an integer-valued numeric string.
 *   - Trims surrounding whitespace on strings; empty string → null.
 *   - Rejects fractions and anything outside [MIN, MAX].
 */
export function parseDiscountPercent(raw) {
  let n;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    n = Number(trimmed);
  } else {
    return null;
  }
  return isValidDiscountPercent(n) ? n : null;
}

/**
 * Clamp a numeric value into the allowed range, rounding to a whole percent.
 * For the client input's onChange so a typed value can't visually exceed the
 * bounds; non-numeric input falls back to the default.
 */
export function clampDiscountPercent(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_DISCOUNT_PERCENT;
  if (v < DISCOUNT_PERCENT_MIN) return DISCOUNT_PERCENT_MIN;
  if (v > DISCOUNT_PERCENT_MAX) return DISCOUNT_PERCENT_MAX;
  return v;
}
