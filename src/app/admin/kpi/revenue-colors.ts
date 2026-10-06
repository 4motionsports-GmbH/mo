// Colours of the three attribution tiers — the categorical chart tokens in
// their fixed order (theme.css, validated palette). Assigned by tier, never by
// rank, so a tier keeps its colour in the chart, the split bar, the table and
// the drill-down list alike.

import type { RevenueSeriesKey } from "./revenue-series";

export const TIER_COLOR: Record<RevenueSeriesKey, string> = {
  assisted: "var(--chart-1)",
  influenced: "var(--chart-2)",
  direct: "var(--chart-3)",
};

/** The same, as Tailwind background utilities (literal, so they are generated). */
export const TIER_BG: Record<RevenueSeriesKey, string> = {
  assisted: "bg-chart-1",
  influenced: "bg-chart-2",
  direct: "bg-chart-3",
};

export const TIER_ORDER: readonly RevenueSeriesKey[] = ["assisted", "influenced", "direct"];
