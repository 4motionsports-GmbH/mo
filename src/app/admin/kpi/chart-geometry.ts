// Chart heights shared by the Recharts module and its dynamic-import wrapper,
// so the loading skeleton has the exact size of the chart it stands in for
// (each height includes the x-axis band).

export const CHATS_PER_DAY_HEIGHT = 220;
export const REVENUE_CHART_HEIGHT = 232;

export function personaChartHeight(rows: number): number {
  return Math.max(120, rows * 38 + 24);
}
