// Pure date-range resolution for the admin KPI dashboard's date picker.
//
// The KPI tab is a SERVER component: the chosen period arrives as URL search
// params (?kpiRange=7d|30d|90d|custom plus ?kpiFrom / ?kpiTo for custom) and is
// resolved here into a concrete, validated { from, to } calendar window that the
// indexed range queries (conversations / kpi_events / ai_usage on created_at, and
// the Shopify order search) consume directly.
//
// Everything is computed in UTC and clamped/validated so the resolved range is
// ALWAYS safe to hand to a parameterised SQL `::date` cast — invalid or partial
// input never reaches the database; it falls back to the default preset instead.
//
// Plain .mjs (no I/O, injectable clock) so the node:test runner imports it
// directly; the thin typed wrapper lives in ./kpi-range.ts.

/** Day counts for the fixed presets. */
export const PRESET_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

/** The preset used when nothing valid is supplied. */
export const DEFAULT_KPI_PRESET = "30d";

/** Hard cap on a custom span so a query can never scan an unbounded history. */
export const MAX_CUSTOM_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * UTC calendar date (YYYY-MM-DD) for a Date.
 * @param {Date} date
 * @returns {string}
 */
export function toYmd(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * Parse a STRICT YYYY-MM-DD into a UTC ms timestamp, or null when malformed or
 * not a real calendar date (e.g. 2026-02-31, which would otherwise roll over).
 * @param {unknown} s
 * @returns {number | null}
 */
export function parseYmd(s) {
  if (typeof s !== "string" || !YMD_RE.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/**
 * The YYYY-MM-DD that is `delta` days from `ymd` (delta may be negative). Returns
 * the input unchanged when it isn't a valid date.
 * @param {string} ymd
 * @param {number} delta
 * @returns {string}
 */
export function shiftYmd(ymd, delta) {
  const ms = parseYmd(ymd);
  if (ms == null) return ymd;
  return toYmd(new Date(ms + delta * DAY_MS));
}

/**
 * Inclusive day count between two YMD strings (to − from + 1). Returns 1 for
 * malformed input so a label never shows 0/NaN days.
 * @param {string} from
 * @param {string} to
 * @returns {number}
 */
export function daysBetween(from, to) {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (a == null || b == null) return 1;
  return Math.floor((b - a) / DAY_MS) + 1;
}

/**
 * "21.06.2026" from "2026-06-21" (German display format).
 * @param {string} ymd
 * @returns {string}
 */
export function germanDate(ymd) {
  const ms = parseYmd(ymd);
  if (ms == null) return ymd;
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

function presetRange(preset, todayYmd) {
  const days = PRESET_DAYS[preset];
  return {
    preset,
    from: shiftYmd(todayYmd, -(days - 1)),
    to: todayYmd,
    days,
    label: `Letzte ${days} Tage`,
  };
}

/**
 * Resolve the KPI date range from URL params. ALWAYS returns a valid, bounded
 * window: missing/partial/invalid input falls back to the default preset, a
 * reversed custom pair is swapped, a future end is clamped to today, and an
 * over-long custom span is clamped to MAX_CUSTOM_RANGE_DAYS. The result is safe
 * to pass straight to the parameterised range queries.
 *
 * @param {{ kpiRange?: string|null, kpiFrom?: string|null, kpiTo?: string|null }} [params]
 * @param {Date} [now] Injectable clock (defaults to real now); "today" is UTC.
 * @returns {{ preset: string, from: string, to: string, days: number, label: string }}
 */
export function resolveKpiRange(params = {}, now = new Date()) {
  const todayYmd = toYmd(now);
  const preset = params?.kpiRange;

  if (preset === "7d" || preset === "30d" || preset === "90d") {
    return presetRange(preset, todayYmd);
  }

  if (preset === "custom") {
    let fromMs = parseYmd(params?.kpiFrom);
    let toMs = parseYmd(params?.kpiTo);
    if (fromMs != null && toMs != null) {
      // Reversed pair → swap so the window is still valid.
      if (fromMs > toMs) {
        const t = fromMs;
        fromMs = toMs;
        toMs = t;
      }
      const todayMs = /** @type {number} */ (parseYmd(todayYmd));
      // Never let the window run into the future.
      if (toMs > todayMs) toMs = todayMs;
      if (fromMs > toMs) fromMs = toMs;
      // Clamp the span so the query stays bounded.
      const span = Math.floor((toMs - fromMs) / DAY_MS) + 1;
      if (span > MAX_CUSTOM_RANGE_DAYS) {
        fromMs = toMs - (MAX_CUSTOM_RANGE_DAYS - 1) * DAY_MS;
      }
      const from = toYmd(new Date(fromMs));
      const to = toYmd(new Date(toMs));
      return {
        preset: "custom",
        from,
        to,
        days: daysBetween(from, to),
        label: `${germanDate(from)} – ${germanDate(to)}`,
      };
    }
    // Incomplete / invalid custom dates → fall through to the default preset.
  }

  return presetRange(DEFAULT_KPI_PRESET, todayYmd);
}
