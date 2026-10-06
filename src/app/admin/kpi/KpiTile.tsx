// KpiTile + DeltaPill — the stat tiles of the revenue centre (dataviz figure
// contract): label (+ InfoTip), the value in proportional figures, a signed
// change against a NAMED period (icon + text, colour by whether up is good) and
// an optional sparkline. The plain `Stat` stays for the other sections.

import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from "lucide-react";
import { pct } from "@/lib/admin-format.mjs";
import { Card, CardContent, InfoTip, cn } from "../ui";

export interface TileDelta {
  /** Change in percent (×100); null when there is no base. */
  value: number | null;
  /** True when the base was 0 and there is something now. */
  isNew?: boolean;
  /** Which direction is good (default up). */
  good?: "up" | "down";
}

/** Signed change vs the previous period — never colour alone (arrow + text). */
export function DeltaPill({ delta, against }: { delta: TileDelta; against: string }) {
  if (delta.value == null) {
    if (!delta.isNew) return null;
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-2xs font-medium text-accent">
        <Sparkles className="size-3" aria-hidden />
        neu ggü. {against}
      </span>
    );
  }
  const flat = delta.value === 0;
  const up = delta.value > 0;
  const good = delta.good ?? "up";
  const favourable = flat ? null : good === "up" ? up : !up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-2xs font-medium",
        favourable === null && "bg-surface-2 text-muted-foreground",
        favourable === true && "bg-success/10 text-success",
        favourable === false && "bg-destructive/10 text-destructive"
      )}
    >
      <Icon className="size-3" aria-hidden />
      <span className="tabular-nums">{pct(delta.value, 1, { sign: true })}</span>
      <span className="ml-0.5 font-normal opacity-80">ggü. {against}</span>
    </span>
  );
}

export function KpiTile({
  label,
  info,
  value,
  delta,
  against,
  hint,
  trend,
  className,
}: {
  label: React.ReactNode;
  info?: React.ReactNode;
  value: React.ReactNode;
  delta?: TileDelta | null;
  /** Name of the comparison period (e.g. „Vorzeitraum“). */
  against?: string;
  hint?: React.ReactNode;
  /** A sparkline (or any small trend figure) under the value. */
  trend?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("h-full", className)}>
      <CardContent className="flex h-full flex-col p-4">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{label}</span>
          {info && <InfoTip panelClassName="max-w-sm">{info}</InfoTip>}
        </div>
        <div className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
        {delta && against && (
          <div className="mt-1">
            <DeltaPill delta={delta} against={against} />
          </div>
        )}
        {hint && <div className="mt-1.5 text-2xs text-muted-foreground">{hint}</div>}
        {trend && <div className="mt-auto pt-3">{trend}</div>}
      </CardContent>
    </Card>
  );
}
