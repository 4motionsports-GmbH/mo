// Shared dashboard presentational bits (KPI tab + Overview tab), themed via the
// admin design tokens. Extracted from KpiTab so the Übersicht tab reuses the
// EXACT same KPI card / section chrome rather than re-implementing it.

import * as React from "react";
import { Info } from "lucide-react";
import { Card, CardContent } from "./card";

// Section — a titled block with an optional subtitle. Used to group the headline
// KPI cards, quick links and activity feeds.
export function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      {subtitle && <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{subtitle}</p>}
      {!subtitle && <div className="h-2.5" />}
      {children}
    </section>
  );
}

// Stat — a single headline KPI card (label, value, optional hint). An optional
// `tooltip` adds a small info affordance next to the label whose native title
// reveals a one-line "what's counted" note on hover/focus (used for the precise
// revenue KPI); it's also exposed to assistive tech via aria-label.
export function Stat({
  label,
  value,
  hint,
  tooltip,
}: {
  label: string;
  value: string;
  hint?: string;
  tooltip?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>{label}</span>
          {tooltip && (
            <span
              title={tooltip}
              aria-label={tooltip}
              tabIndex={0}
              className="inline-flex cursor-help text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
            >
              <Info className="size-3" aria-hidden />
            </span>
          )}
        </div>
        <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</div>}
      </CardContent>
    </Card>
  );
}

// Caveat — the required-honesty note attached to a KPI. Kept verbatim per KPI.
export function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5">
      {children}
    </p>
  );
}
