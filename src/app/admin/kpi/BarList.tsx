// BarList — compact CSS bar list (label · bar · count) for the distribution
// splits of the KPI screen (languages, qualities, categories, call sites,
// triggers, favourite products). Server-renderable, no chart library.

import { num } from "@/lib/admin-format.mjs";

export interface BarListRow {
  key: string;
  label: string;
  /** Bar scale (relative to the row max). */
  count: number;
  /** Optional suffix after the count (e.g. a share). */
  hint?: string;
  /** Overrides the rendered count text entirely (e.g. an EUR amount). */
  display?: string;
}

export function BarList({
  rows,
  empty = "Noch keine Daten.",
}: {
  rows: BarListRow[];
  empty?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>;
  }
  // True max (no floor of 1): EUR rows scale correctly below 1; `|| 1` only
  // guards the all-zero case against a division by zero.
  const max = Math.max(...rows.map((r) => r.count), 0) || 1;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2">
          <span className="basis-[45%] truncate text-xs text-muted-foreground" title={r.label}>
            {r.label}
          </span>
          <span className="h-3.5 flex-1 overflow-hidden rounded bg-muted" aria-hidden>
            <span
              className="block h-full rounded bg-accent"
              style={{ width: `${(Math.max(0, r.count) / max) * 100}%` }}
            />
          </span>
          <span className="shrink-0 basis-20 text-right text-xs tabular-nums text-muted-foreground">
            {r.display ?? `${num(r.count)}${r.hint ? ` · ${r.hint}` : ""}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
