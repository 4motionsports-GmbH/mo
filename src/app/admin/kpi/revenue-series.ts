// Shape of one bucket of „Umsatz durch Mo“ over time — shared by the server
// (revenueSeries in lib/mo-revenue.mjs builds it) and the Recharts chart.

export type RevenueSeriesKey = "assisted" | "influenced" | "direct";

export interface RevenueSeriesBucket {
  /** YYYY-MM-DD — the day, or the first day of the week bucket. */
  start: string;
  assisted: number;
  influenced: number;
  direct: number;
  total: number;
  orders: number;
}
