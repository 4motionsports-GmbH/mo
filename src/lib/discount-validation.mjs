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

// Matches an integer percentage written as "10 %", "10%", or "10 Prozent"
// (case-insensitive). `\s*` also matches a non-breaking space (U+00A0), which
// German typography puts before "%". The negative lookbehind `(?<!\d)` makes it
// digit-boundary safe, so "15 %" yields 15 (never a stray 5) and "150 %" yields
// 150 (out of range, ignored below). Up to 3 digits keeps it anchored.
const PERCENT_TOKEN = /(?<!\d)(\d{1,3})\s*(?:%|prozent)/gi;

/**
 * Server-side backstop for the dashboard's regenerate-lockout: detect when the
 * drafted prose CLEARLY states a different discount than the chosen depth.
 *
 * Why this is needed: the minted code and the deadline ship deterministically
 * from the stored row, but the PERCENTAGE the customer reads ("du bekommst 10 %")
 * comes only from the editable prose. An operator who hand-edits the body to a
 * different number — or a direct API caller — could otherwise ship copy that
 * promises e.g. 20 % while the coupon grants 10 %. The UI already blocks this by
 * forcing a re-generate when the depth changes; this is the same guarantee
 * enforced at the single send chokepoint.
 *
 * CONSERVATIVE BY DESIGN so it can never false-block a legitimate send:
 *   - Considers only percentages in the plausible discount range [1, MAX], so
 *     rhetorical figures like "sei zu 100 % zufrieden" are ignored.
 *   - Reports a mismatch ONLY when at least one in-range percentage appears AND
 *     none of them equals the chosen depth (i.e. a wrong number is stated while
 *     the correct one is absent). Prose that states no percentage at all (the
 *     discount conveyed solely via the deterministic code line) is allowed.
 *
 * @param {number} percent  the chosen depth stored on the row
 * @param {string} body     the drafted prose (marketing_sends.drafted_text)
 * @returns {{ mismatch: boolean, found: number[] }} `found` = the distinct
 *          in-range percentages seen in the prose (for logging/diagnostics).
 */
export function detectDiscountTextMismatch(percent, body) {
  if (!isValidDiscountPercent(percent) || percent <= 0) {
    return { mismatch: false, found: [] };
  }
  const text = typeof body === "string" ? body : "";
  const found = [];
  for (const m of text.matchAll(PERCENT_TOKEN)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= DISCOUNT_PERCENT_MAX && !found.includes(n)) {
      found.push(n);
    }
  }
  const mismatch = found.length > 0 && !found.includes(percent);
  return { mismatch, found };
}
