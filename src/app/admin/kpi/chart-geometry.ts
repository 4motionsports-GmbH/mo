// Chart heights shared by the Recharts module and its dynamic-import wrapper,
// so the loading skeleton has the exact size of the chart it stands in for.

export const CHATS_PER_DAY_HEIGHT = 220;
export const STATUS_SPLIT_HEIGHT = 220;

export function personaChartHeight(rows: number): number {
  return Math.max(120, rows * 38 + 24);
}

export function funnelChartHeight(stages: number): number {
  return Math.max(180, stages * 56);
}
