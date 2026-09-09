// Building blocks shared by the KPI sections: KpiSection (anchored Section with
// the honesty caveat behind an InfoTip, badges and data-quality notes),
// StatGrid, SubHeading, ChartCard and the two title badges.

import * as React from "react";
import { AlertTriangle, BarChart3, Clock } from "lucide-react";
import { ADMIN_TIME, formatAdmin } from "@/lib/admin-datetime.mjs";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  InfoTip,
  Section,
  StatusBadge,
  Tooltip,
  cn,
} from "../ui";

/** Section-level explanation: the former subtitle (context) plus the caveat. */
export function Explain({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}

export function KpiSection({
  id,
  title,
  info,
  badges,
  actions,
  notes,
  empty,
  children,
}: {
  /** Anchor id (without the kpi- prefix). */
  id: string;
  title: React.ReactNode;
  /** The explanation + honesty caveat, shown in the (i) next to the title. */
  info?: React.ReactNode;
  /** Small badges after the title (Gesamtwert, Stand hh:mm). */
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  /** Data-quality notes that depend on the data (sampling, unknowns). */
  notes?: Array<string | false | null | undefined>;
  /** When set, renders an empty state instead of the children. */
  empty?: string | null;
  children?: React.ReactNode;
}) {
  const visibleNotes = (notes ?? []).filter((n): n is string => Boolean(n));
  return (
    <Section
      id={`kpi-${id}`}
      level={3}
      className="scroll-mt-36"
      title={
        <>
          <span>{title}</span>
          {badges}
        </>
      }
      info={info}
      actions={actions}
    >
      {empty ? (
        <EmptyState compact icon={<BarChart3 />} title={empty} />
      ) : (
        <>
          {children}
          {visibleNotes.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-2xs leading-relaxed text-muted-foreground">
              {visibleNotes.map((n) => (
                <li key={n} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden />
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

/** Badge for the lifetime aggregates that ignore the selected period. */
export function LifetimeBadge() {
  return (
    <Tooltip content="Gesamtwert — unabhängig vom gewählten Zeitraum.">
      <StatusBadge tone="neutral" dot={false} tabIndex={0}>
        Gesamtwert
      </StatusBadge>
    </Tooltip>
  );
}

/** "Stand hh:mm" for the Shopify-dependent sections served from the cache. */
export function FreshnessBadge({ fetchedAt, fromCache }: { fetchedAt: string; fromCache: boolean }) {
  return (
    <Tooltip
      content={
        fromCache
          ? "Shopify-abhängige Zahlen, bis zu 10 Minuten zwischengespeichert — „Aktualisieren“ in der Leiste oben lädt sie neu."
          : "Shopify-abhängige Zahlen, gerade frisch berechnet (werden 10 Minuten zwischengespeichert)."
      }
    >
      <StatusBadge tone={fromCache ? "neutral" : "success"} dot={false} icon={<Clock />} tabIndex={0}>
        Stand {formatAdmin(fetchedAt, ADMIN_TIME)}
      </StatusBadge>
    </Tooltip>
  );
}

const gridCols = {
  2: "grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
} as const;

export function StatGrid({
  cols = 4,
  className,
  children,
}: {
  cols?: keyof typeof gridCols;
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("grid gap-3", gridCols[cols], className)}>{children}</div>;
}

export function SubHeading({
  children,
  info,
  className,
}: {
  children: React.ReactNode;
  info?: React.ReactNode;
  className?: string;
}) {
  return (
    <h4 className={cn("mb-2 mt-5 flex items-center gap-1.5 text-sm font-medium text-foreground", className)}>
      {children}
      {info && <InfoTip panelClassName="max-w-md">{info}</InfoTip>}
    </h4>
  );
}

/** A chart (or bar list) in a card with a small title and optional InfoTip. */
export function ChartCard({
  title,
  info,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  info?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={className}>
      {title && (
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-1.5 text-sm">
            {title}
            {info && <InfoTip panelClassName="max-w-md">{info}</InfoTip>}
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className={cn(title ? "pt-0" : "p-4", bodyClassName)}>{children}</CardContent>
    </Card>
  );
}

/** Funnel chart on the left, stats on the right — the shared funnel layout. */
export function FunnelLayout({ chart, children }: { chart: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard>{chart}</ChartCard>
      <div className="grid grid-cols-2 content-start gap-3">{children}</div>
    </div>
  );
}
