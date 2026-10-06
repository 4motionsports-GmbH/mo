"use client";

// Small building blocks of the Verbesserung screen: owner-lane, priority,
// verdict, confidence and recommendation badges, and the metric chip that
// shows a frozen snapshot number (value, change against the previous window,
// sample sizes). Tones come from StatusBadge; numbers from business-snapshot-core.

import * as React from "react";
import {
  CodeXml,
  LayoutTemplate,
  Megaphone,
  MessageSquareText,
  Scale,
  UserCog,
} from "lucide-react";
import { formatMetricValue, isSmallSample } from "@/lib/business-snapshot-core.mjs";
import { OWNER_LANE_DESCRIPTIONS, OWNER_LANE_LABELS } from "@/lib/improvement-core.mjs";
import { VERDICT_LABELS } from "@/lib/improvement-effects.mjs";
import { REVIEW_LABELS } from "@/lib/improvement-decision.mjs";
import { num } from "@/lib/admin-format.mjs";
import type { EffectVerdict, FrozenMetric, Level, OwnerLane, ReviewRecommendation } from "@/lib/improvement-types";
import { StatusBadge, Tooltip, cn, type StatusTone } from "../ui";
import { DeltaPill } from "../analytics/report-parts";

export const LANE_ICONS: Record<OwnerLane, React.ReactNode> = {
  chat: <MessageSquareText />,
  operator: <UserCog />,
  campaign: <Megaphone />,
  frontend: <LayoutTemplate />,
  developer: <CodeXml />,
  legal: <Scale />,
};

export function LaneBadge({ lane }: { lane: OwnerLane }) {
  return (
    <Tooltip content={(OWNER_LANE_DESCRIPTIONS as Record<string, string>)[lane]}>
      <StatusBadge tone="neutral" dot={false} icon={LANE_ICONS[lane]}>
        {(OWNER_LANE_LABELS as Record<string, string>)[lane] ?? lane}
      </StatusBadge>
    </Tooltip>
  );
}

const TIER_TONES: Record<1 | 2 | 3, StatusTone> = { 1: "accent", 2: "info", 3: "neutral" };

export function PriorityBadge({ tier }: { tier: 1 | 2 | 3 }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-2xs font-semibold tabular-nums",
        tier === 1 && "bg-accent text-accent-foreground",
        tier === 2 && "bg-accent-soft text-accent",
        tier === 3 && "bg-surface-2 text-muted-foreground"
      )}
      aria-label={`Priorität ${tier}`}
    >
      P{tier}
    </span>
  );
}

export function tierTone(tier: 1 | 2 | 3): StatusTone {
  return TIER_TONES[tier];
}

const VERDICT_TONES: Record<EffectVerdict, StatusTone> = {
  besser_belastbar: "success",
  besser_tendenz: "success",
  unveraendert: "neutral",
  veraendert: "info",
  schlechter_tendenz: "warning",
  schlechter_belastbar: "destructive",
  nicht_vergleichbar: "warning",
  zu_frueh: "neutral",
  nicht_messbar: "neutral",
};

export function VerdictBadge({ verdict, size = "sm" }: { verdict: EffectVerdict; size?: "sm" | "md" }) {
  const tendency = verdict === "besser_tendenz" || verdict === "schlechter_tendenz";
  return (
    <StatusBadge tone={VERDICT_TONES[verdict] ?? "neutral"} dot={!tendency} size={size} className={cn(tendency && "border-dashed")}>
      {(VERDICT_LABELS as Record<string, string>)[verdict] ?? verdict}
    </StatusBadge>
  );
}

export function ConfidenceBadge({ level }: { level: Level | null }) {
  if (!level) return null;
  const tone: StatusTone = level === "hoch" ? "info" : level === "niedrig" ? "warning" : "neutral";
  return (
    <StatusBadge tone={tone} dot={false}>
      Konfidenz {level}
    </StatusBadge>
  );
}

const REVIEW_TONES: Record<ReviewRecommendation, StatusTone> = {
  beibehalten: "success",
  anpassen: "warning",
  zuruecknehmen: "destructive",
  beobachten: "neutral",
};

export function RecommendationBadge({ value }: { value: ReviewRecommendation }) {
  return (
    <StatusBadge tone={REVIEW_TONES[value] ?? "neutral"} dot={false} size="sm">
      {(REVIEW_LABELS as Record<string, string>)[value] ?? value}
    </StatusBadge>
  );
}

/** "n = 74 · VP n = 66" for a rate, "" otherwise. */
export function sampleText(m: Pick<FrozenMetric, "unit" | "base" | "previousBase" | "previous">): string {
  if (m.unit !== "rate" || m.base == null) return "";
  return `n = ${num(m.base)}${m.previousBase != null && m.previous != null ? ` · VP n = ${num(m.previousBase)}` : ""}`;
}

/**
 * A frozen snapshot number: label, value, change against the previous period
 * and the sample sizes — the evidence and baseline chips of a suggestion.
 */
export function MetricChip({ metric, className }: { metric: FrozenMetric; className?: string }) {
  const small = isSmallSample(metric as never);
  const samples = sampleText(metric);
  return (
    <span
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-2xs",
        className
      )}
    >
      <span className="text-muted-foreground">{metric.label}</span>
      <strong className="font-semibold tabular-nums text-foreground">{formatMetricValue(metric.unit, metric.value)}</strong>
      <DeltaPill metric={metric} />
      {metric.previous != null && (
        <span className="tabular-nums text-muted-foreground">VP {formatMetricValue(metric.unit, metric.previous)}</span>
      )}
      {samples && <span className={cn("tabular-nums", small ? "text-warning" : "text-muted-foreground")}>{samples}</span>}
    </span>
  );
}

/** Label: muted small caps line above a block. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>;
}
