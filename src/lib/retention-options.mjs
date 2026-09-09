// Retention window parsing — ONE rule for every window (TECH-C1):
//
//   · absent / empty / non-numeric / negative  → the documented default
//   · 0                                         → the step is DISABLED
//   · n ≥ 1                                     → n days (or minutes)
//
// Before this module five windows were parsed with a minimum of 0 and used
// directly as cutoffs, so `RETENTION_DAYS=0` meant "delete every conversation
// tonight" while `FEEDBACK_RETENTION_DAYS=0` meant "keep feedback forever".
// runRetention (lib/retention.ts) now skips a step whose window is 0.
//
// The attribution window is not a retention window: the ingest reads the same
// variable with a minimum of 1 (lib/mo-orders-store), and this parser mirrors
// that — 0 or invalid falls back to the default.
//
// Pure and env-injectable so node:test covers it.

export const RETENTION_DEFAULTS = Object.freeze({
  RETENTION_DAYS: 180,
  KPI_RETENTION_DAYS: 180,
  ABANDON_AFTER_MINUTES: 30,
  SUPPRESSED_CAPTURE_PURGE_DAYS: 30,
  CORRESPONDENCE_RETENTION_DAYS: 365,
  PHYSICAL_LETTER_RETENTION_DAYS: 365,
  FEEDBACK_RETENTION_DAYS: 365,
  CUSTOMER_INACTIVITY_RETENTION_DAYS: 1095,
  ADMIN_ACCESS_LOG_RETENTION_DAYS: 730,
  CAMPAIGN_CONTACT_RETENTION_DAYS: 365,
  ANALYTICS_REPORT_RETENTION_DAYS: 365,
  MO_ATTRIBUTION_WINDOW_DAYS: 30,
});

/**
 * Parse one window. `0` disables (returned as 0); anything that is not a
 * non-negative integer string falls back to `fallback`.
 * @param {unknown} raw
 * @param {number} fallback
 * @param {{ min?: number }} [options] `min` (default 0) — the smallest accepted
 *   value; pass 1 for windows that must never be disabled.
 * @returns {number}
 */
export function parseWindow(raw, fallback, { min = 0 } = {}) {
  if (typeof raw !== "string" || !/^\s*\d+\s*$/.test(raw)) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n;
}

/**
 * @typedef {{
 *   retentionDays: number, kpiRetentionDays: number, abandonAfterMinutes: number,
 *   suppressedPurgeDays: number, correspondenceRetentionDays: number,
 *   physicalLetterRetentionDays: number, feedbackRetentionDays: number,
 *   customerInactivityRetentionDays: number, adminAccessLogRetentionDays: number,
 *   campaignContactRetentionDays: number, analyticsReportRetentionDays: number,
 *   attributionWindowDays: number,
 * }} RetentionOptions
 */

/**
 * All retention windows from an env object (defaults to process.env).
 * @param {Record<string, string | undefined>} [env]
 * @returns {RetentionOptions}
 */
export function parseRetentionOptions(env = process.env) {
  const d = RETENTION_DEFAULTS;
  const w = (name) => parseWindow(env[name], d[name]);
  return {
    retentionDays: w("RETENTION_DAYS"),
    kpiRetentionDays: w("KPI_RETENTION_DAYS"),
    abandonAfterMinutes: w("ABANDON_AFTER_MINUTES"),
    suppressedPurgeDays: w("SUPPRESSED_CAPTURE_PURGE_DAYS"),
    correspondenceRetentionDays: w("CORRESPONDENCE_RETENTION_DAYS"),
    physicalLetterRetentionDays: w("PHYSICAL_LETTER_RETENTION_DAYS"),
    feedbackRetentionDays: w("FEEDBACK_RETENTION_DAYS"),
    customerInactivityRetentionDays: w("CUSTOMER_INACTIVITY_RETENTION_DAYS"),
    adminAccessLogRetentionDays: w("ADMIN_ACCESS_LOG_RETENTION_DAYS"),
    campaignContactRetentionDays: w("CAMPAIGN_CONTACT_RETENTION_DAYS"),
    analyticsReportRetentionDays: w("ANALYTICS_REPORT_RETENTION_DAYS"),
    // Not a retention window — never 0 (see header).
    attributionWindowDays: parseWindow(env.MO_ATTRIBUTION_WINDOW_DAYS, d.MO_ATTRIBUTION_WINDOW_DAYS, { min: 1 }),
  };
}
