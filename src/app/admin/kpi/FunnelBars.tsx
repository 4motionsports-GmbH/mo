// FunnelBars — the one funnel of the KPI screen (journey, sign-in popup,
// consent, e-mail capture, campaigns). Server-rendered HTML, no chart library:
// one row per stage — label, a bar on a same-hue track that stands for the
// largest stage (so every bar reads as „share of the start“), the value and its
// share — and under each bar the step conversion and the loss. Stages are
// ordered, so they share ONE hue (dataviz: one series, one colour); the values
// are always printed, never only in a tooltip. One grid for all rows, so the
// bars align and a label never truncates.

import * as React from "react";
import { ArrowDown, TriangleAlert } from "lucide-react";
import { num, ratio } from "@/lib/admin-format.mjs";
import { InfoTip, cn } from "../ui";

export interface FunnelBarStage {
  key?: string;
  label: string;
  value: number;
  /** Explanation of the stage (InfoTip next to the label). */
  info?: React.ReactNode;
}

export function FunnelBars({
  stages,
  unit,
  highlightBiggestDrop = false,
  className,
}: {
  stages: FunnelBarStage[];
  /** What is counted, for the screen-reader summary (e.g. „Sitzungen“). */
  unit?: string;
  /** Marks the step with the largest relative loss („größter Abbruch“). */
  highlightBiggestDrop?: boolean;
  className?: string;
}) {
  if (stages.length === 0) return null;
  const start = Math.max(0, stages[0].value);
  const max = Math.max(start, ...stages.map((s) => s.value), 0) || 1;

  let biggest = -1;
  if (highlightBiggestDrop) {
    let best = 0;
    for (let i = 1; i < stages.length; i++) {
      const prev = stages[i - 1].value;
      if (prev <= 0) continue;
      const rate = (prev - stages[i].value) / prev;
      if (rate > best) {
        best = rate;
        biggest = i;
      }
    }
  }

  return (
    <div
      role="list"
      aria-label={unit ? `Funnel in ${unit}` : "Funnel"}
      className={cn("grid grid-cols-[max-content_minmax(0,1fr)_auto] items-center gap-x-3", className)}
    >
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const width = Math.max(0, Math.min(100, (s.value / max) * 100));
        const step = prev != null && prev > 0 ? s.value / prev : null;
        const lost = prev != null ? Math.max(0, prev - s.value) : 0;
        const isBiggest = i === biggest;
        return (
          <React.Fragment key={s.key ?? s.label}>
            {prev != null && (
              <div
                className={cn(
                  "col-start-2 col-end-4 flex items-center gap-1.5 py-1 text-2xs",
                  isBiggest ? "font-medium text-warning" : "text-muted-foreground"
                )}
              >
                {isBiggest ? (
                  <TriangleAlert className="size-3 shrink-0" aria-hidden />
                ) : (
                  <ArrowDown className="size-3 shrink-0" aria-hidden />
                )}
                <span className="tabular-nums">
                  {step == null ? "—" : `${ratio(step)} weiter`}
                  {lost > 0 && ` · −${num(lost)}`}
                </span>
                {isBiggest && <span>· größter Abbruch</span>}
              </div>
            )}
            <span role="listitem" className="col-start-1 flex items-center gap-1 text-xs text-foreground">
              {s.label}
              {s.info && <InfoTip label={`Was „${s.label}“ zählt`}>{s.info}</InfoTip>}
              <span className="sr-only">
                : {num(s.value)}
                {i > 0 && start > 0 ? ` (${ratio(s.value / start)})` : ""}
              </span>
            </span>
            <span className="h-6 overflow-hidden rounded-sm bg-accent-soft" aria-hidden>
              <span
                className="block h-full rounded-r-sm bg-chart-1"
                style={{ width: `${width}%`, minWidth: s.value > 0 ? "2px" : 0 }}
              />
            </span>
            <span className="min-w-[4.5rem] text-right" aria-hidden>
              <span className="text-sm font-semibold tabular-nums text-foreground">{num(s.value)}</span>
              {i > 0 && (
                <span className="ml-1.5 text-2xs tabular-nums text-muted-foreground">
                  {start > 0 ? ratio(s.value / start) : "—"}
                </span>
              )}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}
