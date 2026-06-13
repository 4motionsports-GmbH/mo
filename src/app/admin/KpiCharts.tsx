"use client";

// Recharts client islands for the KPI tab. The KPI tab itself stays a SERVER
// component (it owns all the DB aggregation); these components receive the
// already-computed, fully-serializable data as props and only render it. No data
// is fetched or recomputed here — pure presentation.
//
// Theming: Recharts writes colors as SVG presentation attributes, which ARE CSS,
// so `fill="var(--accent)"` / `stroke="var(--border)"` resolve through the admin
// design tokens (theme.css) and flip automatically with the `.dark` class on the
// admin shell root. No hard-coded hex, no theme prop threading.
//
// Loading: Recharts' ResponsiveContainer measures its parent after mount, so it
// can't render meaningfully on the server. Every chart is wrapped in
// <ChartFrame>, which shows a Skeleton placeholder of the right height until the
// component has mounted on the client — that doubles as the required loading
// state for client-rendered chart data.

import { useSyncExternalStore } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "./ui";

// Theme token references (resolve via CSS variables in theme.css).
const ACCENT = "var(--accent)";
const SUCCESS = "var(--success)";
const WARNING = "var(--warning)";
const MUTED = "var(--muted-foreground)";
const BORDER = "var(--border)";
const FOREGROUND = "var(--foreground)";

// Mount detection without setState-in-effect: false during SSR / first paint,
// true once hydrated on the client (so ResponsiveContainer can measure).
const noopSubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

// Gates a chart on client mount: Skeleton until ResponsiveContainer can measure.
function ChartFrame({
  height,
  children,
}: {
  height: number;
  children: React.ReactElement;
}) {
  const mounted = useMounted();
  if (!mounted) {
    return <Skeleton className="w-full rounded-lg" style={{ height }} />;
  }
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function deNumber(n: number): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: 0 });
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
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {label != null && label !== "" && (
        <div className="mb-1 font-semibold">{label}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: p.color ?? p.payload?.fill ?? ACCENT }}
          />
          <span>
            {p.name != null ? `${p.name}: ` : ""}
            <strong>{typeof p.value === "number" ? deNumber(p.value) : p.value}</strong>
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
  const dayTick = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  };

  return (
    <ChartFrame height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="chatsArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={BORDER} strokeDasharray="3 3" vertical={false} />
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
        <Tooltip
          content={<ChartTooltip />}
          labelFormatter={(v) => dayTick(String(v))}
          cursor={{ stroke: BORDER }}
        />
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
// Status split — abandoned vs converted (vs active) donut.
// ---------------------------------------------------------------------------

export function StatusSplitChart({
  active,
  abandoned,
  converted,
}: {
  active: number;
  abandoned: number;
  converted: number;
}) {
  const data = [
    { name: "Aktiv", value: active, fill: MUTED },
    { name: "Abgebrochen", value: abandoned, fill: WARNING },
    { name: "Konvertiert", value: converted, fill: SUCCESS },
  ].filter((d) => d.value > 0);

  if (data.length === 0) return null;

  return (
    <ChartFrame height={220}>
      <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
          stroke="var(--card)"
          strokeWidth={2}
          isAnimationActive={false}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
      </PieChart>
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
  const height = Math.max(120, data.length * 38 + 24);

  return (
    <ChartFrame height={height}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
      >
        <CartesianGrid stroke={BORDER} strokeDasharray="3 3" horizontal={false} />
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
// Funnel — shared renderer for the recommendation→purchase and marketing funnels.
// Stages must be passed in descending order (they form the funnel taper).
// ---------------------------------------------------------------------------

export interface FunnelStage {
  name: string;
  value: number;
}

// Accent → success gradient across the stages so the taper reads as "progress".
const FUNNEL_FILLS = [
  "var(--accent)",
  "color-mix(in srgb, var(--accent) 70%, var(--success))",
  "color-mix(in srgb, var(--accent) 35%, var(--success))",
  "var(--success)",
];

export function StageFunnelChart({ stages }: { stages: FunnelStage[] }) {
  const data = stages.map((s, i) => ({
    ...s,
    fill: FUNNEL_FILLS[Math.min(i, FUNNEL_FILLS.length - 1)],
  }));

  return (
    <ChartFrame height={Math.max(180, stages.length * 56)}>
      <FunnelChart margin={{ top: 8, right: 96, bottom: 8, left: 8 }}>
        <Tooltip content={<ChartTooltip />} />
        <Funnel dataKey="value" data={data} isAnimationActive={false} stroke="var(--card)">
          <LabelList
            position="right"
            dataKey="name"
            fill={FOREGROUND}
            stroke="none"
            fontSize={12}
          />
          <LabelList
            position="inside"
            dataKey="value"
            fill="#fff"
            stroke="none"
            fontSize={12}
          />
        </Funnel>
      </FunnelChart>
    </ChartFrame>
  );
}
