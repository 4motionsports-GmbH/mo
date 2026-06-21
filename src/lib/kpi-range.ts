// Typed wrapper around the pure ./kpi-range.mjs resolver. TypeScript callers
// import the validated `KpiRange` shape from here; the node:test suite imports
// the .mjs directly. The runtime logic lives in ONE place (the .mjs) — this file
// only attaches the types.

import {
  resolveKpiRange as resolveKpiRangeImpl,
  DEFAULT_KPI_PRESET,
  MAX_CUSTOM_RANGE_DAYS,
  PRESET_DAYS,
} from "./kpi-range.mjs";

/** The four selectable periods. "custom" carries explicit from/to dates. */
export type KpiPreset = "7d" | "30d" | "90d" | "custom";

/** A resolved, validated, UTC calendar window for the KPI dashboard. */
export interface KpiRange {
  /** Which option produced this window. */
  preset: KpiPreset;
  /** Inclusive start, YYYY-MM-DD (UTC). */
  from: string;
  /** Inclusive end, YYYY-MM-DD (UTC). */
  to: string;
  /** Inclusive day count (to − from + 1). */
  days: number;
  /** Human-readable German label for display. */
  label: string;
}

export interface KpiRangeParams {
  kpiRange?: string | null;
  kpiFrom?: string | null;
  kpiTo?: string | null;
}

/**
 * Resolve URL params into a validated {@link KpiRange}. Always succeeds: invalid
 * or partial input falls back to the default preset (see the .mjs for the exact
 * clamping rules).
 */
export function resolveKpiRange(params: KpiRangeParams = {}, now?: Date): KpiRange {
  return resolveKpiRangeImpl(params, now) as KpiRange;
}

export { DEFAULT_KPI_PRESET, MAX_CUSTOM_RANGE_DAYS, PRESET_DAYS };
