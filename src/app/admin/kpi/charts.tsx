"use client";

// KPI chart entry points. Each chart is a next/dynamic wrapper around the
// Recharts module (./charts-recharts) with ssr:false: the server renders a
// Skeleton of the chart's exact height, the browser loads the Recharts chunk
// only on the KPI screen (TECH-E7) and swaps the chart in once mounted — the
// same visual sequence as before, minus ~600 KB of JS on every other screen.
//
// next/dynamic's `loading` component gets no props, so the placeholder height
// travels through a context that each wrapper provides.

import * as React from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "../ui";
import { CHATS_PER_DAY_HEIGHT, REVENUE_CHART_HEIGHT, personaChartHeight } from "./chart-geometry";
import type { RevenueSeriesBucket, RevenueSeriesKey } from "./revenue-series";

const HeightContext = React.createContext<number>(200);

function ChartSkeleton() {
  const height = React.useContext(HeightContext);
  return <Skeleton className="w-full rounded-lg" style={{ height }} />;
}

const ChatsPerDayImpl = dynamic(
  () => import("./charts-recharts").then((m) => m.ChatsPerDayChart),
  { ssr: false, loading: ChartSkeleton }
);
const PersonaDistributionImpl = dynamic(
  () => import("./charts-recharts").then((m) => m.PersonaDistributionChart),
  { ssr: false, loading: ChartSkeleton }
);
const RevenueOverTimeImpl = dynamic(
  () => import("./charts-recharts").then((m) => m.RevenueOverTimeChart),
  { ssr: false, loading: ChartSkeleton }
);

export function ChatsPerDayChart(props: { data: Array<{ day: string; count: number }> }) {
  return (
    <HeightContext.Provider value={CHATS_PER_DAY_HEIGHT}>
      <ChatsPerDayImpl {...props} />
    </HeightContext.Provider>
  );
}

export function PersonaDistributionChart({ data }: { data: Array<{ name: string; value: number }> }) {
  if (data.length === 0) return null;
  return (
    <HeightContext.Provider value={personaChartHeight(data.length)}>
      <PersonaDistributionImpl data={data} />
    </HeightContext.Provider>
  );
}

export function RevenueOverTimeChart(props: {
  buckets: RevenueSeriesBucket[];
  weekly: boolean;
  series: Array<{ key: RevenueSeriesKey; label: string; color: string }>;
}) {
  return (
    <HeightContext.Provider value={REVENUE_CHART_HEIGHT}>
      <RevenueOverTimeImpl {...props} />
    </HeightContext.Provider>
  );
}
