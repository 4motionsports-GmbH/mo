// Shared dashboard presentational bits (KPI tab + Overview tab), themed via the
// admin design tokens. Extracted from KpiTab so the Übersicht tab reuses the
// EXACT same KPI card / section chrome rather than re-implementing it.

import * as React from "react";
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

// Stat — a single headline KPI card (label, value, optional hint).
export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
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
