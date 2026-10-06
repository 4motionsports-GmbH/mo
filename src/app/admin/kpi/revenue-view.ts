// Assembles the revenue centre („Umsatz durch Mo“, „Wie der Umsatz entstand“,
// „Was genau passiert ist“) from its three sources — the live ledger
// (lib/mo-revenue-store), the cached Shopify code lookup (lib/kpi-revenue-store
// via lib/kpi-cache) and the AI cost of both periods — through the pure, tested
// lib/mo-revenue.mjs. Server-only plain data; the sections only render it.

import type { Cached } from "@/lib/kpi-cache";
import type { MoRevenue } from "@/lib/kpi-revenue-store";
import type { MoRevenueData } from "@/lib/mo-revenue-store";
import {
  classifyRevenueOrder,
  daysAfterChat,
  markConsultedLines,
  mergeCodeRedemptions,
  orderPathSummary,
  orderTrendPoints,
  periodDelta,
  revenuePerAiEuro,
  revenueSeries,
  summariseRevenue,
} from "@/lib/mo-revenue.mjs";
import { isRealisedFinancialStatus } from "@/lib/kpi-revenue-core.mjs";
import type { RevenueSeriesBucket } from "./revenue-series";

export type RevenueSummary = ReturnType<typeof summariseRevenue>;

/** One row of „Was genau passiert ist“ — plain, serialisable. */
export interface RevenueDrillRow {
  key: string;
  date: string | null;
  orderName: string | null;
  amount: number | null;
  currency: string;
  realised: boolean;
  financialStatus: string | null;
  tier: "assisted" | "influenced" | "direct";
  channel: string;
  moCodes: string[];
  lines: Array<{ title: string; quantity: number; price: number | null; consulted: boolean }>;
  story: { lead: string; lag: string | null; match: string | null };
  /** Whole days from the last chat of the session to the order. */
  daysAfterChat: number | null;
  customerId: number | null;
  conversationId: number | null;
  /** „ledger“ = per webhook erfasst; „shopify_code“ = per Code-Abgleich ergänzt. */
  origin: "ledger" | "shopify_code";
}

export interface RevenueView {
  currency: string;
  summary: RevenueSummary;
  /** The ledger alone — the base of every comparison with the previous period. */
  ledgerSummary: RevenueSummary;
  previous: { from: string; to: string; days: number; summary: RevenueSummary } | null;
  deltas: {
    revenue: { value: number | null; isNew: boolean };
    orders: { value: number | null; isNew: boolean };
    aov: { value: number | null; isNew: boolean };
    roi: { value: number | null; isNew: boolean };
  };
  series: { weekly: boolean; buckets: RevenueSeriesBucket[] };
  /** Orders over time for the tile sparkline (weekly sums for long daily series). */
  orderPoints: Array<{ x: string; y: number }>;
  aiCost: number | null;
  roi: number | null;
  previousRoi: number | null;
  /** Coded orders added from the Shopify lookup (not in the ledger). */
  codeComplement: {
    shopifyConfigured: boolean;
    orders: number;
    revenue: number;
    alreadyCounted: number;
    unknown: number;
    sampled: boolean;
    fetchedAt: string;
    fromCache: boolean;
  };
  rows: RevenueDrillRow[];
  detailsTruncated: boolean;
  unresolved: { unknownToken: number; outsideWindow: number };
  ingestionSeen: boolean;
  attributionWindowDays: number;
  sessionAnchor: boolean;
}

export function buildRevenueView({
  data,
  codes,
  aiCost,
  previousAiCost,
}: {
  data: MoRevenueData;
  codes: Cached<MoRevenue | null>;
  /** Total AI spend of the period / the previous period (EUR), null when unknown. */
  aiCost: number | null;
  previousAiCost: number | null;
}): RevenueView {
  const lookup = codes.value;
  const { extra, alreadyCounted } = mergeCodeRedemptions({
    ledgerCodes: data.ledgerCodes,
    ledgerOrderNames: data.ledgerOrderNames,
    redemptions: lookup?.redemptions ?? [],
  });
  const all = [...data.orders, ...extra];
  const summary = summariseRevenue(all);
  const ledgerSummary = extra.length > 0 ? summariseRevenue(data.orders) : summary;
  const previousSummary = data.previous ? summariseRevenue(data.previousOrders) : null;
  const extraSummary = summariseRevenue(extra);

  const series = revenueSeries(all, data.range);
  const roi = revenuePerAiEuro(summary.revenue, aiCost);
  const ledgerRoi = revenuePerAiEuro(ledgerSummary.revenue, aiCost);
  const previousRoi = previousSummary ? revenuePerAiEuro(previousSummary.revenue, previousAiCost) : null;

  const rows: RevenueDrillRow[] = [];
  for (const d of data.details) {
    const cls = classifyRevenueOrder(d);
    if (!cls) continue;
    const lines = markConsultedLines(d.lineItems, d.consultedHandles);
    rows.push({
      key: `l${d.id}`,
      date: d.processedAt,
      orderName: d.orderName,
      amount: d.total,
      currency: (d.currency ?? summary.currency).toUpperCase(),
      realised: isRealisedFinancialStatus(d.financialStatus),
      financialStatus: d.financialStatus,
      tier: cls.tier,
      channel: cls.channel,
      moCodes: cls.moCodes,
      lines,
      story: orderPathSummary({
        channel: cls.channel,
        moCodes: cls.moCodes,
        lastChatAt: d.lastChatAt,
        processedAt: d.processedAt,
        lines,
      }),
      daysAfterChat: daysAfterChat(d.lastChatAt, d.processedAt),
      customerId: d.customerId,
      conversationId: d.conversationId,
      origin: "ledger",
    });
  }
  extra.forEach((e, i) => {
    const cls = classifyRevenueOrder(e);
    if (!cls) return;
    rows.push({
      key: `s${i}`,
      date: e.processedAt,
      orderName: e.orderName,
      amount: e.total,
      currency: (e.currency ?? summary.currency).toUpperCase(),
      realised: isRealisedFinancialStatus(e.financialStatus),
      financialStatus: e.financialStatus,
      tier: cls.tier,
      channel: cls.channel,
      moCodes: cls.moCodes,
      lines: [],
      story: orderPathSummary({ channel: cls.channel, moCodes: cls.moCodes, origin: "shopify_code" }),
      daysAfterChat: null,
      customerId: null,
      conversationId: null,
      origin: "shopify_code",
    });
  });
  rows.sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0));

  return {
    currency: summary.currency,
    summary,
    ledgerSummary,
    previous: data.previous && previousSummary ? { ...data.previous, summary: previousSummary } : null,
    deltas: {
      revenue: periodDelta(ledgerSummary.revenue, previousSummary?.revenue),
      orders: periodDelta(ledgerSummary.orders, previousSummary?.orders),
      aov: periodDelta(ledgerSummary.aov, previousSummary?.aov),
      roi: periodDelta(ledgerRoi, previousRoi),
    },
    series: { weekly: series.granularity === "week", buckets: series.buckets },
    orderPoints: orderTrendPoints(series.buckets, series.granularity),
    aiCost,
    roi,
    previousRoi,
    codeComplement: {
      shopifyConfigured: lookup?.shopifyConfigured ?? false,
      orders: extraSummary.orders,
      revenue: extraSummary.revenue,
      alreadyCounted,
      unknown: lookup?.redemptionUnknown ?? 0,
      sampled: lookup?.sampled ?? false,
      fetchedAt: codes.fetchedAt,
      fromCache: codes.fromCache,
    },
    rows,
    detailsTruncated: data.detailsTruncated,
    unresolved: data.unresolved,
    ingestionSeen: data.ingestionSeen,
    attributionWindowDays: data.attributionWindowDays,
    sessionAnchor: data.sessionAnchor,
  };
}
