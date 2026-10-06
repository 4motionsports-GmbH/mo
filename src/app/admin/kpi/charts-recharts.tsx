"use client";

// Recharts implementation of the KPI charts. Loaded ONLY through ./charts
// (next/dynamic, ssr:false), so the Recharts bundle is a separate chunk that the
// browser fetches on the KPI screen alone (TECH-E7). The KPI tab itself stays a
// SERVER component (it owns all the DB aggregation); these components receive
// the already-computed, fully-serializable data as props and only render it.
//
// Theming: Recharts writes colors as SVG presentation attributes, which ARE CSS,
// so `fill="var(--accent)"` / `stroke="var(--border)"` resolve through the admin
// design tokens (theme.css) and flip automatically with the `.dark` class on the
// admin shell root. No hard-coded hex, no theme prop threading.
//
// Sizing: ResponsiveContainer measures its parent, so every chart sits in a
// <ChartFrame> of a fixed height taken from ./chart-geometry — the same numbers
// the dynamic wrapper uses for its loading skeleton.

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ADMIN_DAY_MONTH, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, num } from "@/lib/admin-format.mjs";
import { niceTicks } from "@/lib/chart-ticks.mjs";
import {
  CHATS_PER_DAY_HEIGHT,
  REVENUE_CHART_HEIGHT,
  personaChartHeight,
} from "./chart-geometry";
import type { RevenueSeriesBucket, RevenueSeriesKey } from "./revenue-series";

// Theme token references (resolve via CSS variables in theme.css).
const ACCENT = "var(--accent)";
const MUTED = "var(--muted-foreground)";
const BORDER = "var(--border)";
const FOREGROUND = "var(--foreground)";

// Fixed-height frame so ResponsiveContainer has something to measure.
function ChartFrame({
  height,
  children,
}: {
  height: number;
  children: React.ReactElement;
}) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Themed tooltip — an HTML popover styled with the design tokens.
// ---------------------------------------------------------------------------

interface TooltipItem {
  name?: string | number;
  value?: string | number;
  color?: string;
  payload?: { fill?: string };
}

function ChartTooltip({
  active,
  payload,
  label,
  formatLabel,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  formatLabel?: (label: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {label != null && label !== "" && (
        <div className="mb-1 font-semibold">{formatLabel ? formatLabel(String(label)) : label}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: p.color ?? p.payload?.fill ?? ACCENT }}
          />
          <span>
            {p.name != null ? `${p.name}: ` : ""}
            <strong>{typeof p.value === "number" ? num(p.value) : p.value}</strong>
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chats per day — area chart over the trailing window.
// ---------------------------------------------------------------------------

export function ChatsPerDayChart({
  data,
}: {
  data: Array<{ day: string; count: number }>;
}) {
  // Show ~7 evenly-spaced date ticks so a 30-day axis doesn't crowd.
  const tickInterval = Math.max(0, Math.floor(data.length / 7) - 1);
  const dayTick = (iso: string): string => formatAdmin(iso, ADMIN_DAY_MONTH, iso);

  return (
    <ChartFrame height={CHATS_PER_DAY_HEIGHT}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="chatsArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={BORDER} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={dayTick}
          interval={tickInterval}
          tick={{ fill: MUTED, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: BORDER }}
          minTickGap={8}
        />
        <YAxis
          allowDecimals={false}
          width={32}
          tick={{ fill: MUTED, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<ChartTooltip formatLabel={dayTick} />} cursor={{ stroke: BORDER }} />
        <Area
          type="monotone"
          dataKey="count"
          name="Chats"
          stroke={ACCENT}
          strokeWidth={2}
          fill="url(#chatsArea)"
          activeDot={{ r: 4, fill: ACCENT, stroke: "var(--card)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Persona distribution — chats per persona, horizontal bars.
// ---------------------------------------------------------------------------

export function PersonaDistributionChart({
  data,
}: {
  data: Array<{ name: string; value: number }>;
}) {
  if (data.length === 0) return null;

  return (
    <ChartFrame height={personaChartHeight(data.length)}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
      >
        <CartesianGrid stroke={BORDER} horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fill: MUTED, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: BORDER }}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={140}
          tick={{ fill: FOREGROUND, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--secondary)" }} />
        <Bar dataKey="value" name="Chats" fill={ACCENT} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList dataKey="value" position="right" fill={MUTED} fontSize={11} />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Revenue over time — „Umsatz durch Mo“ per day (or week) stacked by tier.
// Thin columns (≤ 24 px), a 2 px surface gap between stacked segments, the
// rounded data end only on the top segment, one tooltip listing every tier.
// Colours: the categorical chart tokens in the fixed tier order.
// ---------------------------------------------------------------------------

interface RevenueChartRow extends RevenueSeriesBucket {
  /** Topmost / bottommost non-zero tier of the stack (shape geometry). */
  top: RevenueSeriesKey | null;
  bottom: RevenueSeriesKey | null;
}

interface SegmentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: RevenueChartRow;
}

function stackSegment(series: RevenueSeriesKey) {
  return function Segment(props: SegmentProps) {
    const { x = 0, y = 0, width = 0, fill, payload } = props;
    let height = props.height ?? 0;
    if (!payload || width <= 0 || height <= 0) return <g />;
    // 2 px surface gap towards the segment below.
    if (payload.bottom !== series) height = Math.max(0, height - 2);
    if (height <= 0) return <g />;
    if (payload.top !== series) return <rect x={x} y={y} width={width} height={height} fill={fill} />;
    const r = Math.min(4, width / 2, height);
    const d = `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
    return <path d={d} fill={fill} />;
  };
}

function RevenueTooltip({
  active,
  payload,
  series,
  weekly,
}: {
  active?: boolean;
  payload?: Array<{ payload?: RevenueChartRow }>;
  series: Array<{ key: RevenueSeriesKey; label: string; color: string }>;
  weekly: boolean;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const day = formatAdmin(`${row.start}T12:00:00Z`, ADMIN_DAY_MONTH, row.start);
  return (
    <div className="min-w-44 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-semibold">{weekly ? `Woche ab ${day}` : day}</span>
        <span className="text-muted-foreground">
          {num(row.orders)} {row.orders === 1 ? "Bestellung" : "Bestellungen"}
        </span>
      </div>
      {[...series].reverse().map((s) => (
        <div key={s.key} className="flex items-center gap-2 py-0.5">
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden />
          <strong className="tabular-nums">{eur(row[s.key])}</strong>
          <span className="text-muted-foreground">{s.label}</span>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-2 border-t border-border pt-1">
        <strong className="tabular-nums">{eur(row.total)}</strong>
        <span className="text-muted-foreground">gesamt</span>
      </div>
    </div>
  );
}

export function RevenueOverTimeChart({
  buckets,
  weekly,
  series,
}: {
  buckets: RevenueSeriesBucket[];
  weekly: boolean;
  /** Bottom → top, in the fixed tier order. */
  series: Array<{ key: RevenueSeriesKey; label: string; color: string }>;
}) {
  const data: RevenueChartRow[] = buckets.map((b) => {
    const present = series.filter((s) => b[s.key] > 0).map((s) => s.key);
    return { ...b, top: present[present.length - 1] ?? null, bottom: present[0] ?? null };
  });
  const tickInterval = Math.max(0, Math.ceil(data.length / 8) - 1);
  const dayTick = (iso: string): string => formatAdmin(`${iso}T12:00:00Z`, ADMIN_DAY_MONTH, iso);
  const yTicks = niceTicks(Math.max(0, ...data.map((d) => d.total)), 5);
  return (
    <ChartFrame height={REVENUE_CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="20%">
        <CartesianGrid stroke={BORDER} vertical={false} />
        <XAxis
          dataKey="start"
          tickFormatter={dayTick}
          interval={tickInterval}
          tick={{ fill: MUTED, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: BORDER }}
          minTickGap={8}
        />
        <YAxis
          width={64}
          domain={[0, yTicks[yTicks.length - 1]]}
          ticks={yTicks}
          tickFormatter={(v: number) => eur(v, 0)}
          tick={{ fill: MUTED, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          content={<RevenueTooltip series={series} weekly={weekly} />}
          cursor={{ fill: "var(--secondary)", fillOpacity: 0.6 }}
        />
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId="umsatz"
            fill={s.color}
            maxBarSize={24}
            isAnimationActive={false}
            shape={stackSegment(s.key)}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}
