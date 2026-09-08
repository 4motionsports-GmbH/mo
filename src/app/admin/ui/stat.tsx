// Shared dashboard presentational bits (KPI tab + Overview tab), themed via the
// admin design tokens: Section (titled block with InfoTip + actions), Stat
// (headline KPI card with optional delta) and Caveat (honesty note).

import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { pct } from "@/lib/admin-format.mjs";
import { Card, CardContent } from "./card";
import { cn } from "./cn";
import { InfoTip } from "./info-tip";

// Section — a titled block. `info` puts the explanation into an InfoTip next to
// the title; `subtitle` remains for the rare one-liner that must stay visible.
export function Section({
  title,
  subtitle,
  info,
  actions,
  className,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  info?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight text-foreground">
            {title}
            {info && <InfoTip>{info}</InfoTip>}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export interface StatDelta {
  /** Change in percent (already ×100). */
  value: number;
  /** Which direction is good — colours the badge (default up). */
  good?: "up" | "down" | "none";
  /** Short context, e.g. "vs. Vorperiode". */
  label?: string;
}

// Stat — a single headline KPI card: label (+ InfoTip), value, optional hint,
// optional delta badge, optional icon. With `href` the whole card is a link
// (arrow on hover). `tooltip` is the legacy name for `info`.
export function Stat({
  label,
  value,
  hint,
  tooltip,
  info,
  delta,
  icon,
  href,
  size = "md",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tooltip?: React.ReactNode;
  info?: React.ReactNode;
  delta?: StatDelta | null;
  icon?: React.ReactNode;
  href?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const explanation = info ?? tooltip;
  const card = (
    <Card
      className={cn(
        "h-full",
        href && "transition-colors group-hover:border-accent/50 group-hover:bg-accent-soft/60",
        className
      )}
    >
      <CardContent className={cn("relative", size === "sm" ? "p-3" : "p-4")}>
        <div className={cn("flex items-center gap-1 text-xs text-muted-foreground", href && "pr-5")}>
          {icon && (
            <span className="mr-0.5 inline-flex shrink-0 [&_svg]:size-3.5" aria-hidden>
              {icon}
            </span>
          )}
          <span className="truncate">{label}</span>
          {explanation && <InfoTip>{explanation}</InfoTip>}
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <div
            className={cn(
              "font-semibold tabular-nums tracking-tight text-foreground",
              size === "sm" ? "text-xl" : "text-2xl"
            )}
          >
            {value}
          </div>
          {delta && <DeltaBadge delta={delta} />}
        </div>
        {hint && <div className="mt-0.5 text-2xs text-muted-foreground/80">{hint}</div>}
        {href && (
          <ArrowRight
            className="absolute right-3 top-3 size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
            aria-hidden
          />
        )}
      </CardContent>
    </Card>
  );
  if (!href) return card;
  return (
    <Link
      href={href}
      className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {card}
    </Link>
  );
}

function DeltaBadge({ delta }: { delta: StatDelta }) {
  const good = delta.good ?? "up";
  const positive = delta.value > 0;
  const flat = delta.value === 0 || !Number.isFinite(delta.value);
  const favourable = good === "none" || flat ? null : good === "up" ? positive : !positive;
  const Icon = flat ? Minus : positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-2xs font-medium tabular-nums",
        favourable === null && "bg-surface-2 text-muted-foreground",
        favourable === true && "bg-success/10 text-success",
        favourable === false && "bg-destructive/10 text-destructive"
      )}
      title={delta.label}
    >
      <Icon className="size-3" aria-hidden />
      {pct(delta.value, 1, { sign: true })}
      {delta.label && <span className="sr-only"> {delta.label}</span>}
    </span>
  );
}

// Caveat — the required-honesty note attached to a KPI. Kept verbatim per KPI.
export function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-2xs leading-relaxed text-muted-foreground/80 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5">
      {children}
    </p>
  );
}
