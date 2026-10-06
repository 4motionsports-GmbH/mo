"use client";

// Building blocks of the decision-grade Komplettanalyse (DecisionReport):
// metric tiles with the change against the previous period, metric and
// breakdown tables from the business snapshot, funnel bars, owner / level
// badges and the deep links into the admin screens where the operator acts.
// Numbers render through business-snapshot-core (admin-format underneath).

import * as React from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CodeXml,
  LayoutTemplate,
  Minus,
  Scale,
  UserCog,
} from "lucide-react";
import {
  adminLinkFor,
  formatMetricDelta,
  formatMetricValue,
  isSmallSample,
  metricDelta,
} from "@/lib/business-snapshot-core.mjs";
import {
  EFFORT_LABELS,
  LEVEL_LABELS,
  OWNER_DESCRIPTIONS,
  OWNER_LABELS,
} from "@/lib/analytics-report-synthesis-core.mjs";
import { num, ratio } from "@/lib/admin-format.mjs";
import type { SnapshotFunnel, SnapshotMetric, SnapshotTable } from "@/lib/business-snapshot";
import {
  Card,
  CardContent,
  InfoTip,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  buttonVariants,
  cn,
  type StatusTone,
} from "../ui";

export type { SnapshotMetric };
type Range = { from: string; to: string } | null;

// ── Change against the previous period ───────────────────────────────────────

/** "+12 %" / "+3,4 Pp." pill, green when favourable, red when not. */
export function DeltaPill({ metric, className }: { metric: Pick<SnapshotMetric, "value" | "previous" | "unit" | "good">; className?: string }) {
  const d = metricDelta(metric as SnapshotMetric);
  const text = formatMetricDelta(metric as SnapshotMetric);
  if (!d || !text) return null;
  const Icon = d.abs === 0 ? Minus : d.abs > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-2xs font-medium tabular-nums",
        d.favourable === null && "bg-surface-2 text-muted-foreground",
        d.favourable === true && "bg-success/10 text-success",
        d.favourable === false && "bg-destructive/10 text-destructive",
        className
      )}
    >
      <Icon className="size-3" aria-hidden />
      {text}
      <span className="sr-only"> gegenüber der Vorperiode</span>
    </span>
  );
}

/** A headline metric: label, value, change and the previous value. */
export function MetricTile({ metric, info }: { metric: SnapshotMetric | null; info?: React.ReactNode }) {
  if (!metric) return null;
  const small = isSmallSample(metric);
  return (
    <Card className="h-full">
      <CardContent className="p-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{metric.label}</span>
          {info && <InfoTip>{info}</InfoTip>}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <div className="text-xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatMetricValue(metric.unit, metric.value)}
          </div>
          <DeltaPill metric={metric} />
        </div>
        <div className="mt-0.5 text-2xs text-muted-foreground">
          {metric.previous !== null ? `Vorperiode ${formatMetricValue(metric.unit, metric.previous)}` : "Stand heute"}
          {metric.unit === "rate" && metric.base != null ? ` · n = ${num(metric.base)}` : ""}
          {small && <span className="text-warning"> · kleine Stichprobe</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/** Every metric of a snapshot section as rows: value, previous period, change. */
export function MetricTable({ metrics }: { metrics: SnapshotMetric[] }) {
  const rows = metrics.filter((m) => m.value !== null || m.previous !== null);
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">Keine Daten im Zeitraum.</p>;
  return (
    <Table className="text-xs [&_td]:tabular-nums">
      <TableHeader>
        <TableRow>
          <TableHead>Kennzahl</TableHead>
          <TableHead align="right">Zeitraum</TableHead>
          <TableHead align="right">Vorperiode</TableHead>
          <TableHead align="right">Veränderung</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((m) => (
          <TableRow key={m.key}>
            <TableCell>
              <span className="text-foreground">{m.label}</span>
              {m.hint && <span className="ml-1 text-2xs text-muted-foreground">({m.hint})</span>}
              {isSmallSample(m) && (
                <span className="ml-1 text-2xs text-warning">n = {num(m.base)}</span>
              )}
            </TableCell>
            <TableCell align="right" className="font-medium text-foreground">
              {formatMetricValue(m.unit, m.value)}
            </TableCell>
            <TableCell align="right" className="text-muted-foreground">
              {m.previous === null ? "—" : formatMetricValue(m.unit, m.previous)}
            </TableCell>
            <TableCell align="right">
              <DeltaPill metric={m} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A breakdown table of the snapshot (sources, campaigns, call sites, …). */
export function BreakdownTable({ table, compact = false }: { table: SnapshotTable; compact?: boolean }) {
  if (table.rows.length === 0) return null;
  const hasPrevious = table.rows.some((r) => "previous" in r && r.previous);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-foreground">
        {table.title}
        {"note" in table && table.note && <InfoTip>{table.note}</InfoTip>}
      </div>
      <Table className="text-xs [&_td]:tabular-nums">
        <TableHeader>
          <TableRow>
            <TableHead>{compact ? "" : "Zeile"}</TableHead>
            {table.columns.map((c) => (
              <TableHead key={c.key} align="right">
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((r) => {
            const prev = "previous" in r ? (r.previous as Record<string, number | null> | undefined) : undefined;
            return (
              <TableRow key={r.key}>
                <TableCell className="max-w-[16rem] truncate text-foreground">{r.label}</TableCell>
                {table.columns.map((c) => {
                  const v = (r.values as Record<string, number | null>)[c.key];
                  const p = prev?.[c.key];
                  return (
                    <TableCell key={c.key} align="right">
                      <div className="font-medium text-foreground">{formatMetricValue(c.unit as SnapshotMetric["unit"], v)}</div>
                      {hasPrevious && p !== undefined && (
                        <div className="text-2xs text-muted-foreground">VP {formatMetricValue(c.unit as SnapshotMetric["unit"], p)}</div>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Funnels ───────────────────────────────────────────────────────────────────

/** Horizontal funnel bars: each step relative to the first, with the step conversion. */
export function FunnelBars({ funnel }: { funnel: SnapshotFunnel }) {
  const first = funnel.steps[0]?.value ?? 0;
  return (
    <ol className="flex flex-col gap-2">
      {funnel.steps.map((s, i) => {
        const prevStep = i > 0 ? funnel.steps[i - 1].value : null;
        const conv = prevStep && prevStep > 0 && s.value !== null ? s.value / prevStep : null;
        const width = first > 0 && s.value !== null ? Math.max(2, (s.value / first) * 100) : 0;
        return (
          <li key={s.label}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-muted-foreground">{s.label}</span>
              <span className="shrink-0 tabular-nums">
                <strong className="font-semibold text-foreground">{num(s.value)}</strong>
                {conv !== null && <span className="ml-1.5 text-muted-foreground">{ratio(conv, 0)}</span>}
                {s.previous !== null && <span className="ml-1.5 text-2xs text-muted-foreground">VP {num(s.previous)}</span>}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded bg-muted" aria-hidden>
              <div className="h-full rounded bg-accent" style={{ width: `${width}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────

const OWNER_ICONS: Record<string, React.ReactNode> = {
  operator: <UserCog />,
  developer: <CodeXml />,
  frontend: <LayoutTemplate />,
  lawyer: <Scale />,
};

export function OwnerBadge({ owner }: { owner: string }) {
  const label = (OWNER_LABELS as Record<string, string>)[owner] ?? owner;
  const description = (OWNER_DESCRIPTIONS as Record<string, string>)[owner];
  const badge = (
    <StatusBadge tone="neutral" dot={false} icon={OWNER_ICONS[owner]}>
      {label}
    </StatusBadge>
  );
  return description ? <Tooltip content={description}>{badge}</Tooltip> : badge;
}

type LevelKind = "impact" | "confidence" | "severity" | "effort";

const LEVEL_PREFIX: Record<LevelKind, string> = {
  impact: "Wirkung",
  confidence: "Konfidenz",
  severity: "Schwere",
  effort: "Aufwand",
};

function levelTone(kind: LevelKind, value: string): StatusTone {
  if (kind === "effort") return value === "klein" ? "success" : value === "gross" ? "warning" : "neutral";
  if (kind === "severity") return value === "hoch" ? "destructive" : value === "mittel" ? "warning" : "neutral";
  if (kind === "confidence") return value === "hoch" ? "info" : value === "niedrig" ? "warning" : "neutral";
  return value === "hoch" ? "accent" : value === "mittel" ? "info" : "neutral";
}

export function LevelBadge({ kind, value }: { kind: LevelKind; value: string }) {
  const label =
    kind === "effort" ? (EFFORT_LABELS as Record<string, string>)[value] : (LEVEL_LABELS as Record<string, string>)[value];
  return (
    <StatusBadge tone={levelTone(kind, value)} dot={false}>
      {LEVEL_PREFIX[kind]} {label ?? value}
    </StatusBadge>
  );
}

// ── Admin links ───────────────────────────────────────────────────────────────

/** "Öffnen: Kampagnen →" — the admin screen where the operator acts. */
export function AdminLinkButton({ target, range, className }: { target: string; range: Range; className?: string }) {
  const link = adminLinkFor(target, range);
  if (!link) return null;
  return (
    <Link href={link.href} className={cn(buttonVariants({ variant: "outline", size: "xs" }), className)}>
      {link.label}
      <ArrowRight aria-hidden />
    </Link>
  );
}

/** A small text link to an admin screen (section headers). */
export function AdminTextLink({ target, range }: { target: string; range: Range }) {
  const link = adminLinkFor(target, range);
  if (!link) return null;
  return (
    <Link href={link.href} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
      {link.label}
      <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}
