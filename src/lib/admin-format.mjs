// Deterministic number / currency / duration formatting for the admin
// back-office (pure, no I/O — plain .mjs so it is unit-tested with node:test,
// like admin-datetime.mjs). The locale is pinned to de-DE so the server and the
// operator's browser render the same string (hydration safety, see
// admin-datetime.mjs for the full explanation) and so two panels showing the
// same kind of number can never drift apart.
//
// Every helper accepts numbers or numeric strings and renders FORMAT_EMPTY for
// absent / unparseable input instead of throwing or printing "NaN".

export const FORMAT_EMPTY = "—";
const LOCALE = "de-DE";

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finite(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Plain number with a thousands separator — "1.234" / "12,5".
 * @param {unknown} value
 * @param {number} [digits] maximum fraction digits (default 0)
 * @param {string} [fallback]
 */
export function num(value, digits = 0, fallback = FORMAT_EMPTY) {
  const n = finite(value);
  if (n === null) return fallback;
  return n.toLocaleString(LOCALE, { maximumFractionDigits: digits });
}

/**
 * Compact number for tight KPI tiles — "1,3 Mio." / "842".
 * @param {unknown} value
 * @param {string} [fallback]
 */
export function compactNum(value, fallback = FORMAT_EMPTY) {
  const n = finite(value);
  if (n === null) return fallback;
  return n.toLocaleString(LOCALE, { notation: "compact", maximumFractionDigits: 1 });
}

/**
 * Amount in a given ISO currency — "12,34 €". `digits` is the maximum number of
 * fraction digits (at least two are always shown, so "12 €" never appears next
 * to "12,50 €"); pass 4 for per-consultation AI costs that are fractions of a
 * cent. Falls back to "<amount> <code>" when the code is not a valid currency.
 * @param {unknown} value
 * @param {string} [currency]
 * @param {number} [digits]
 * @param {string} [fallback]
 */
export function money(value, currency = "EUR", digits = 2, fallback = FORMAT_EMPTY) {
  const n = finite(value);
  if (n === null) return fallback;
  const fraction = Math.max(0, Math.floor(digits));
  try {
    return n.toLocaleString(LOCALE, {
      style: "currency",
      currency,
      minimumFractionDigits: Math.min(2, fraction),
      maximumFractionDigits: fraction,
    });
  } catch {
    return `${num(n, fraction)} ${currency}`;
  }
}

/**
 * Euro amount — "12,34 €"; `eur(0.0239, 4)` → "0,0239 €".
 * @param {unknown} value
 * @param {number} [digits]
 * @param {string} [fallback]
 */
export function eur(value, digits = 2, fallback = FORMAT_EMPTY) {
  return money(value, "EUR", digits, fallback);
}

/**
 * Euro amount from integer cents (Shopify totals, campaign spend) — "4,49 €".
 * @param {unknown} cents
 * @param {string} [fallback]
 */
export function eurFromCents(cents, fallback = FORMAT_EMPTY) {
  const n = finite(cents);
  if (n === null) return fallback;
  return eur(n / 100, 2, fallback);
}

/**
 * Percentage from a value that already is a percentage (0–100) — "12,3 %".
 * @param {unknown} value
 * @param {number} [digits]
 * @param {{ fallback?: string, sign?: boolean }} [options] `sign` prefixes "+"
 *   for positive values (deltas)
 */
export function pct(value, digits = 1, { fallback = FORMAT_EMPTY, sign = false } = {}) {
  const n = finite(value);
  if (n === null) return fallback;
  const text = n.toLocaleString(LOCALE, { maximumFractionDigits: digits });
  return `${sign && n > 0 ? "+" : ""}${text} %`;
}

/**
 * Percentage from a ratio (0–1) — `ratio(0.123)` → "12,3 %".
 * @param {unknown} value
 * @param {number} [digits]
 * @param {{ fallback?: string, sign?: boolean }} [options]
 */
export function ratio(value, digits = 1, options = {}) {
  const n = finite(value);
  if (n === null) return options.fallback ?? FORMAT_EMPTY;
  return pct(n * 100, digits, options);
}

/**
 * Duration given in hours — "3,5 Std." below two days, "2,1 Tage" from there.
 * @param {unknown} value
 * @param {string} [fallback]
 */
export function hours(value, fallback = FORMAT_EMPTY) {
  const n = finite(value);
  if (n === null) return fallback;
  if (n >= 48) return `${num(n / 24, 1)} Tage`;
  return `${num(n, 1)} Std.`;
}

/**
 * Count with a German singular/plural noun — `plural(1, "Kontakt", "Kontakte")`
 * → "1 Kontakt".
 * @param {unknown} count
 * @param {string} singular
 * @param {string} pluralForm
 */
export function plural(count, singular, pluralForm) {
  const n = finite(count);
  if (n === null) return `${FORMAT_EMPTY} ${pluralForm}`;
  return `${num(n)} ${n === 1 ? singular : pluralForm}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** @type {[number, string, string][]} unit size, singular, plural */
const RELATIVE_UNITS = [
  [MINUTE, "Min.", "Min."],
  [HOUR, "Std.", "Std."],
  [DAY, "Tag", "Tagen"],
  [WEEK, "Woche", "Wochen"],
  [MONTH, "Monat", "Monaten"],
  [YEAR, "Jahr", "Jahren"],
];

/**
 * Relative time in German — "gerade eben", "vor 5 Min.", "vor 3 Std.",
 * "vor 2 Tagen", "vor 3 Wochen", "vor 4 Monaten", "vor 2 Jahren"; future
 * instants read "in 5 Min.". Deterministic: pass `now` explicitly in tests and
 * on the server (the caller decides the reference instant, not the module).
 * @param {string | number | Date | null | undefined} value
 * @param {number | Date} [now]
 * @param {string} [fallback]
 */
export function relativeTime(value, now = Date.now(), fallback = FORMAT_EMPTY) {
  if (value === null || value === undefined || value === "") return fallback;
  const d = value instanceof Date ? value : new Date(value);
  const ref = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(d.getTime()) || !Number.isFinite(ref)) return fallback;

  const diff = ref - d.getTime();
  const past = diff >= 0;
  const abs = Math.abs(diff);
  if (abs < 45_000) return past ? "gerade eben" : "gleich";

  let index = 0;
  for (let i = RELATIVE_UNITS.length - 1; i >= 0; i--) {
    if (abs >= RELATIVE_UNITS[i][0]) {
      index = i;
      break;
    }
  }
  // Round to the chosen unit, but bump up when rounding overflows it
  // (e.g. 23.8 h → "vor 1 Tag" instead of "vor 24 Std.").
  let count = Math.round(abs / RELATIVE_UNITS[index][0]);
  if (
    index < RELATIVE_UNITS.length - 1 &&
    count * RELATIVE_UNITS[index][0] >= RELATIVE_UNITS[index + 1][0]
  ) {
    index += 1;
    count = Math.round(abs / RELATIVE_UNITS[index][0]);
  }
  if (count < 1) count = 1;
  const noun = count === 1 ? RELATIVE_UNITS[index][1] : RELATIVE_UNITS[index][2];
  return past ? `vor ${count} ${noun}` : `in ${count} ${noun}`;
}

/**
 * Cut text for table cells and list rows — "Lorem ipsum…". `max` counts the
 * ellipsis; never cuts below one character.
 * @param {unknown} text
 * @param {number} [max]
 */
export function truncate(text, max = 80) {
  if (text === null || text === undefined) return "";
  const s = String(text);
  const limit = Math.max(1, Math.floor(max));
  if (s.length <= limit) return s;
  return `${s.slice(0, limit - 1).trimEnd()}…`;
}
