"use client";

// Sparkline — the trend line of a stat tile (dataviz figure contract): a 2 px
// line in the de-emphasis hue, the latest point as an accent dot with a surface
// ring, a hairline crosshair with a readout on hover. Inline SVG, no chart
// library; the values behind it are also in the revenue table view, so the
// hover only enhances.

import * as React from "react";
import { ADMIN_DAY_MONTH, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, num } from "@/lib/admin-format.mjs";

const W = 160;
const H = 36;
const PAD = 5;

export function Sparkline({
  points,
  unit,
  label,
}: {
  /** Chronological values; `x` is a YYYY-MM-DD bucket start. */
  points: Array<{ x: string; y: number }>;
  /** How a value reads in the readout. */
  unit: "orders" | "eur";
  /** Accessible summary (e.g. „Bestellungen pro Tag“). */
  label: string;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const ref = React.useRef<SVGSVGElement | null>(null);
  if (points.length < 2) return null;

  const max = Math.max(...points.map((p) => p.y), 0) || 1;
  const xOf = (i: number) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const yOf = (v: number) => H - PAD - (Math.max(0, v) / max) * (H - 2 * PAD);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.y).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  const shown = hover ?? last;
  const fmt = (v: number) => (unit === "eur" ? eur(v, 0) : `${num(v)} ${v === 1 ? "Bestellung" : "Bestellungen"}`);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((rel - PAD) / (W - 2 * PAD)) * (points.length - 1));
    setHover(Math.max(0, Math.min(last, i)));
  };

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-9 w-full overflow-visible"
        role="img"
        aria-label={`${label}: zuletzt ${fmt(points[last].y)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <path
          d={path}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeOpacity={0.55}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {hover != null && (
          <line
            x1={xOf(hover)}
            x2={xOf(hover)}
            y1={0}
            y2={H}
            stroke="var(--border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* The dot is HTML so it stays round under preserveAspectRatio="none". */}
      <span
        aria-hidden
        className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-chart-1"
        style={{ left: `${(xOf(shown) / W) * 100}%`, top: `${(yOf(points[shown].y) / H) * 100}%` }}
      />
      {hover != null && (
        <span
          className="pointer-events-none absolute -top-6 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-1.5 py-0.5 text-2xs font-medium text-background shadow-sm"
          style={{ left: `${Math.min(85, Math.max(15, (xOf(hover) / W) * 100))}%` }}
        >
          <strong className="tabular-nums">{fmt(points[hover].y)}</strong>
          <span className="ml-1 opacity-80">{formatAdmin(`${points[hover].x}T12:00:00Z`, ADMIN_DAY_MONTH)}</span>
        </span>
      )}
    </div>
  );
}
