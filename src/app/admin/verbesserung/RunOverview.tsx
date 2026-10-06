"use client";

// The top of a finished Verbesserungslauf (v2): the situation in a few
// sentences (the strategist's headline, or a factual line without it), the
// headline metrics of the period, what got better and what got worse (the
// same significance test as the effect measurement; metrics whose
// measurement changed are listed apart), and the backlog of open and planned
// suggestions of every run by owner lane and priority.

import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ListTodo } from "lucide-react";
import { adminLinkFor, flattenSnapshot, formatMetricValue } from "@/lib/business-snapshot-core.mjs";
import { backlogMatrix, OWNER_LANE_LABELS } from "@/lib/improvement-core.mjs";
import { snapshotMovers } from "@/lib/improvement-effects.mjs";
import { num } from "@/lib/admin-format.mjs";
import type { BusinessSnapshot } from "@/lib/business-snapshot";
import type { OwnerLane, RunAnalysisV2 } from "@/lib/improvement-types";
import { Callout, Card, CardContent, InfoTip, Section, Tooltip, cn } from "../ui";
import { DeltaPill, MetricTile, type SnapshotMetric } from "../analytics/report-parts";
import { LANE_ICONS, PriorityBadge } from "./parts";
import type { SuggestionItem } from "./types";

const EFFORT_NAMES: Record<string, string> = { high: "hoch", medium: "mittel", low: "niedrig" };

const TILES: Array<[string, string]> = [
  ["revenue.total", "Umsatz durch Mo"],
  ["journey.chatToOrder", "Beratung → Bestellung"],
  ["chat.chats", "Gespräche"],
  ["consent.newSubscribers", "Neue Einwilligungen"],
  ["quality.handledWell", "Gut gelöst"],
  ["costs.roi", "Umsatz je 1 € KI-Kosten"],
];

type Mover = ReturnType<typeof snapshotMovers>["improved"][number];

export function RunOverview({
  snapshot,
  analysis,
  backlog,
  onLaneSelect,
}: {
  snapshot: BusinessSnapshot | null;
  analysis: RunAnalysisV2;
  backlog: SuggestionItem[];
  onLaneSelect: (lane: OwnerLane) => void;
}) {
  const flat = React.useMemo(() => (snapshot ? flattenSnapshot(snapshot) : {}), [snapshot]);
  const movers = React.useMemo(() => snapshotMovers(snapshot), [snapshot]);
  const range = snapshot?.period ? { from: snapshot.period.from, to: snapshot.period.to } : null;
  const sectionLinks = React.useMemo(
    () => Object.fromEntries((snapshot?.sections ?? []).map((s) => [s.key, s.link])),
    [snapshot]
  );
  const synthesis = analysis.synthesis;
  const efforts = Object.values(analysis.state.efforts ?? {}).filter(Boolean) as string[];
  const measured = analysis.measurement.measurements.length;
  const meta = [
    snapshot?.period ? `Zeitraum ${snapshot.period.label}` : null,
    snapshot?.previous ? `verglichen mit ${snapshot.previous.label}` : null,
    efforts.length ? `Strategie-Modell Opus 5.5, Denktiefe ${[...new Set(efforts)].map((e) => EFFORT_NAMES[e] ?? e).join(" / ")}` : null,
  ].filter(Boolean);

  return (
    <section id="v-lage" className="scroll-mt-24">
      <Section
        title="Lage"
        level={3}
        info="Die Lage des Zeitraums gegenüber der gleich lang davor liegenden Vorperiode — aus der Geschäftsübersicht (dieselben Abfragen wie die KPIs). Den Text schreibt das Strategie-Modell (Opus 5.5) aus diesen Zahlen; „Besser“ und „Schlechter“ sind gerechnet, nicht geschrieben."
      >
        <Card className="border-l-4 border-l-accent">
          <CardContent className="flex flex-col gap-2.5 p-5 pt-5">
            {synthesis?.headline ? (
              <>
                <p className="text-base font-semibold leading-snug tracking-tight text-foreground">{synthesis.headline}</p>
                {synthesis.summary && <p className="text-sm leading-relaxed text-foreground">{synthesis.summary}</p>}
              </>
            ) : (
              <p className="text-sm leading-relaxed text-foreground">
                {num(movers.improved.length)} Entscheidungs-Kennzahlen besser, {num(movers.worsened.length)} schlechter als in der
                Vorperiode; {measured === 1 ? "eine umgesetzte Änderung" : `${num(measured)} umgesetzte Änderungen`} gemessen.
                <span className="text-muted-foreground"> Ohne Text des Strategie-Modells.</span>
              </p>
            )}
            {meta.length > 0 && <p className="text-2xs text-muted-foreground">{meta.join(" · ")}</p>}
          </CardContent>
        </Card>

        {snapshot && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
            {TILES.map(([k, label]) => (
              <MetricTile key={k} metric={(flat[k] ?? null) as SnapshotMetric | null} label={label} />
            ))}
          </div>
        )}

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <MoverCard
            title="Besser geworden"
            icon={<ArrowUpRight className="size-4 text-success" aria-hidden />}
            items={movers.improved}
            empty="Keine Entscheidungs-Kennzahl hat sich nennenswert verbessert."
            range={range}
            sectionLinks={sectionLinks}
          />
          <MoverCard
            title="Schlechter geworden"
            icon={<ArrowDownRight className="size-4 text-destructive" aria-hidden />}
            items={movers.worsened}
            empty="Keine Entscheidungs-Kennzahl hat sich nennenswert verschlechtert."
            range={range}
            sectionLinks={sectionLinks}
            footer={
              movers.notComparable.length > 0 ? (
                <p className="flex items-center gap-1 text-2xs text-muted-foreground">
                  {num(movers.notComparable.length)} nicht vergleichbar (Messänderung im Zeitraum)
                  <InfoTip>{movers.notComparable.map((m) => m.label).join(" · ")}</InfoTip>
                </p>
              ) : null
            }
          />
        </div>
        <div className="mt-3">
          <BacklogCard backlog={backlog} onLaneSelect={onLaneSelect} />
        </div>
      </Section>
    </section>
  );
}

function MoverCard({
  title,
  icon,
  items,
  empty,
  range,
  sectionLinks,
  footer,
}: {
  title: string;
  icon: React.ReactNode;
  items: Mover[];
  empty: string;
  range: { from: string; to: string } | null;
  sectionLinks: Record<string, string>;
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-2 p-4 pt-4">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {icon}
          {title}
          <InfoTip>
            Entscheidungs-Kennzahlen gegenüber der Vorperiode. ● statistisch klar (|z| ≥ 1,96 bei ausreichender
            Stichprobe), ○ Tendenz im Rahmen des Zufalls. Beträge und Durchschnitte ohne Fallzahl zählen nur als Tendenz.
          </InfoTip>
        </h4>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">{empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {items.map((m) => {
              const link = m.section ? adminLinkFor(sectionLinks[m.section] ?? "", range) : null;
              const label = <span className="line-clamp-2 text-xs leading-snug text-foreground">{m.label}</span>;
              return (
                <li key={m.key} className="flex items-center gap-2 py-1.5">
                  <Tooltip content={m.significant ? "Statistisch klar" : m.small ? "Tendenz — kleine Stichprobe" : "Tendenz — im Rahmen des Zufalls"}>
                    <span
                      className={cn(
                        "inline-block size-2 shrink-0 rounded-full border",
                        m.significant
                          ? m.verdict.startsWith("besser")
                            ? "border-success bg-success"
                            : "border-destructive bg-destructive"
                          : "border-muted-foreground bg-transparent"
                      )}
                      aria-label={m.significant ? "statistisch klar" : "Tendenz"}
                    />
                  </Tooltip>
                  {link ? (
                    <Link href={link.href} className="min-w-0 flex-1 hover:underline">
                      {label}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1">{label}</span>
                  )}
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                    {formatMetricValue(m.unit, m.value)}
                  </span>
                  <DeltaPill metric={m as unknown as SnapshotMetric} className="shrink-0" />
                </li>
              );
            })}
          </ul>
        )}
        {footer && <div className="mt-auto pt-1">{footer}</div>}
      </CardContent>
    </Card>
  );
}

function BacklogCard({ backlog, onLaneSelect }: { backlog: SuggestionItem[]; onLaneSelect: (lane: OwnerLane) => void }) {
  const matrix = React.useMemo(() => backlogMatrix(backlog), [backlog]);
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-2 p-4 pt-4">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <ListTodo className="size-4 text-accent" aria-hidden />
          Offen nach Bereich
          <InfoTip>
            Alle neuen und geplanten Vorschläge aller Läufe (auch aus der Komplettanalyse) nach dem Bereich, der handelt,
            und nach Priorität (Wirkung × Konfidenz ÷ Aufwand, gedämpft durch das Risiko). Ein Klick zeigt die Vorschläge
            des Bereichs.
          </InfoTip>
        </h4>
        {matrix.total === 0 ? (
          <p className="text-xs text-muted-foreground">Nichts offen — alle Vorschläge sind entschieden.</p>
        ) : (
          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 2xl:grid-cols-3">
            {matrix.lanes.map((row) => (
              <li key={row.lane}>
                <button
                  type="button"
                  onClick={() => onLaneSelect(row.lane as OwnerLane)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="inline-flex text-muted-foreground [&_svg]:size-3.5" aria-hidden>
                    {LANE_ICONS[row.lane as OwnerLane]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {(OWNER_LANE_LABELS as Record<string, string>)[row.lane]}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {([1, 2, 3] as const).map((t) =>
                      row.tiers[t] > 0 ? (
                        <span key={t} className="inline-flex items-center gap-0.5 tabular-nums">
                          <PriorityBadge tier={t} />
                          <span className="text-muted-foreground">{num(row.tiers[t])}</span>
                        </span>
                      ) : null
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {matrix.total > 0 && (
          <p className="mt-auto pt-1 text-2xs text-muted-foreground">
            {num(matrix.total)} offen, davon {num(matrix.lanes.reduce((n, l) => n + l.planned, 0))} geplant
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Notes of the run and the snapshot's caveats — „Datenqualität & Messhinweise“. */
export function RunNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <Callout tone="neutral" compact>
      {notes.map((n, i) => (
        <p key={i}>{n}</p>
      ))}
    </Callout>
  );
}
