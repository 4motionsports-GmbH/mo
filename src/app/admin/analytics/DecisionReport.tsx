"use client";

// The decision-grade Komplettanalyse (sections v2): the strategist's
// executive summary and decisions on top, then how the revenue through Mo came
// about, the funnel bottlenecks, what changed since the previous report,
// customers and campaigns, the prioritised recommendations (filterable by
// owner), experiments, risks and data-quality caveats — every claim next to
// the business-snapshot numbers it rests on, every action with a link into
// the admin screen where it is taken. The full snapshot and the analysis
// chapters (insights, personas, customer knowledge, appendix) follow below.

import * as React from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleQuestionMark,
  Compass,
  FlaskConical,
  Funnel,
  History,
  Lightbulb,
  ListChecks,
  Megaphone,
  Minus,
  PiggyBank,
  ShieldAlert,
  Target,
  Users,
} from "lucide-react";
import type { ReportSections } from "@/lib/analytics-report-store";
import { flattenSnapshot, formatMetricValue } from "@/lib/business-snapshot-core.mjs";
import { OWNERS, OWNER_LABELS, comparisonDelta } from "@/lib/analytics-report-synthesis-core.mjs";
import { formatAdmin, ADMIN_DATE_MEDIUM } from "@/lib/admin-datetime.mjs";
import { germanDate } from "@/lib/kpi-range.mjs";
import { num } from "@/lib/admin-format.mjs";
import {
  BarList,
  Callout,
  Card,
  CardContent,
  Disclosure,
  Section,
  SegmentedControl,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "../ui";
import {
  AdminLinkButton,
  AdminTextLink,
  BreakdownTable,
  DeltaPill,
  FunnelBars,
  LevelBadge,
  MetricTable,
  MetricTile,
  OwnerBadge,
  type SnapshotMetric,
} from "./report-parts";
import { FoundationChapters } from "./FoundationChapters";

type Sections = ReportSections;
type Decision = NonNullable<ReportSections["decision"]>;
type Snapshot = NonNullable<ReportSections["snapshot"]>;

const NAV: ReadonlyArray<{ id: string; label: string }> = [
  { id: "r-ueberblick", label: "Auf einen Blick" },
  { id: "r-entscheidungen", label: "Entscheidungen" },
  { id: "r-umsatz", label: "Umsatz" },
  { id: "r-engpaesse", label: "Engpässe" },
  { id: "r-veraenderung", label: "Veränderung" },
  { id: "r-kunden", label: "Kunden" },
  { id: "r-kampagnen", label: "Kampagnen" },
  { id: "r-massnahmen", label: "Maßnahmen" },
  { id: "r-experimente", label: "Experimente" },
  { id: "r-risiken", label: "Risiken" },
  { id: "r-kennzahlen", label: "Alle Kennzahlen" },
  { id: "r-grundlagen", label: "Grundlagen" },
];

const EFFORT_NAMES: Record<string, string> = { high: "hoch", medium: "mittel", low: "niedrig" };

function sectionOf(snapshot: Snapshot | null, key: string) {
  return snapshot?.sections.find((s) => s.key === key) ?? null;
}

function tableOf(snapshot: Snapshot | null, sectionKey: string, tableKey: string) {
  return sectionOf(snapshot, sectionKey)?.tables.find((t) => t.key === tableKey) ?? null;
}

function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
  if (!children) return null;
  return <p className={cn("text-sm leading-relaxed text-foreground", className)}>{children}</p>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

export function DecisionReport({ sections }: { sections: Sections }) {
  const snapshot = sections.snapshot ?? null;
  const decision: Decision | null = sections.decision ?? null;
  const range = snapshot?.period ? { from: snapshot.period.from, to: snapshot.period.to } : null;
  const flat = React.useMemo(() => (snapshot ? flattenSnapshot(snapshot) : {}), [snapshot]);
  const m = (key: string) => (flat[key] ?? null) as SnapshotMetric | null;

  return (
    <div className="flex flex-col gap-10">
      <nav aria-label="Abschnitte des Berichts" className="-mb-4 flex flex-wrap gap-1.5">
        {NAV.map((n) => (
          <a
            key={n.id}
            href={`#${n.id}`}
            className="rounded-md border border-border bg-card px-2 py-1 text-2xs font-medium text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground"
          >
            {n.label}
          </a>
        ))}
      </nav>

      <Overview sections={sections} decision={decision} snapshot={snapshot} m={m} />
      <Decisions decision={decision} range={range} />
      <Revenue decision={decision} snapshot={snapshot} m={m} range={range} />
      <Bottlenecks decision={decision} snapshot={snapshot} range={range} />
      <Changes sections={sections} decision={decision} />
      <Customers decision={decision} snapshot={snapshot} m={m} range={range} />
      <Campaigns decision={decision} snapshot={snapshot} m={m} range={range} />
      <Recommendations decision={decision} range={range} />
      <Experiments decision={decision} />
      <Risks decision={decision} snapshot={snapshot} />
      <AllMetrics snapshot={snapshot} range={range} />

      <section id="r-grundlagen" className="scroll-mt-24">
        <Section
          title="Grundlagen der Analyse"
          level={3}
          info="Die KI-Auswertungen, auf denen die Entscheidungen aufbauen: Gesprächs-Insights, Personas mit Top-Fragen, das aggregierte Kundenwissen, optional einzelne Kundenprofile und jedes analysierte Gespräch."
        >
          <FoundationChapters sections={sections} collapsible />
        </Section>
      </section>
    </div>
  );
}

// ── Auf einen Blick ──────────────────────────────────────────────────────────

function Overview({
  sections,
  decision,
  snapshot,
  m,
}: {
  sections: Sections;
  decision: Decision | null;
  snapshot: Snapshot | null;
  m: (key: string) => SnapshotMetric | null;
}) {
  const notes = [...(sections.notes ?? []), ...(decision?.notes ?? [])];
  const efforts = decision?.efforts;
  const meta = [
    snapshot?.period ? `Zeitraum ${snapshot.period.label}` : null,
    snapshot?.previous ? `verglichen mit ${snapshot.previous.label}` : null,
    decision?.status !== "unavailable" && efforts?.decisions
      ? `Synthese: Opus 5.5, Denktiefe ${EFFORT_NAMES[efforts.decisions] ?? efforts.decisions}`
      : null,
  ].filter(Boolean);
  const tiles: Array<[string, string]> = [
    ["revenue.total", "Mo-Umsatz (bezahlt)"],
    ["ledger.moShare", "Anteil am Shop-Umsatz"],
    ["chat.chats", "Gespräche"],
    ["consent.newSubscribers", "Neue Einwilligungen"],
    ["costs.total", "KI-Kosten"],
    ["costs.roi", "Mo-Umsatz je KI-Euro"],
  ];
  return (
    <section id="r-ueberblick" className="scroll-mt-24">
      <Section
        title="Auf einen Blick"
        level={3}
        info="Die Lage des Zeitraums in wenigen Sätzen, geschrieben vom Strategie-Modell (Opus 5.5) aus den Geschäftsdaten unten. Alle Zahlen stammen aus denselben Abfragen wie die KPIs; die Veränderung bezieht sich auf die gleich lange Vorperiode."
      >
        <Card className="border-l-4 border-l-accent">
          <CardContent className="flex flex-col gap-3 p-5">
            {decision && decision.headline ? (
              <>
                <p className="text-base font-semibold leading-snug tracking-tight text-foreground">{decision.headline}</p>
                <Prose>{decision.summary}</Prose>
              </>
            ) : (
              <Empty>
                Keine Synthese verfügbar — die Kennzahlen unten sind vollständig, die Entscheidungen fehlen
                {decision?.notes?.length ? ` (${decision.notes.join(" ")})` : "."}
              </Empty>
            )}
            {meta.length > 0 && <p className="text-2xs text-muted-foreground">{meta.join(" · ")}</p>}
          </CardContent>
        </Card>
        {snapshot && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
            {tiles.map(([k, label]) => (
              <MetricTile key={k} metric={m(k)} label={label} />
            ))}
          </div>
        )}
        {decision && decision.status === "partial" && (
          <Callout tone="warning" compact className="mt-3" title="Synthese unvollständig">
            {decision.notes.join(" ") || "Ein Teil der Synthese konnte nicht erstellt werden."}
          </Callout>
        )}
        {notes.length > 0 && decision?.status !== "partial" && (
          <Callout tone="neutral" compact className="mt-3">
            {notes.map((n, i) => (
              <p key={i}>{n}</p>
            ))}
          </Callout>
        )}
      </Section>
    </section>
  );
}

// ── Jetzt entscheiden ────────────────────────────────────────────────────────

function Decisions({ decision, range }: { decision: Decision | null; range: { from: string; to: string } | null }) {
  const items = decision?.decisions ?? [];
  return (
    <section id="r-entscheidungen" className="scroll-mt-24">
      <Section
        title="Jetzt entscheiden"
        level={3}
        info="Die 3–5 Entscheidungen, die jetzt anstehen — wichtigste zuerst. Jede nennt, wer handelt (Betrieb, Entwicklung, Frontend, Anwalt), die erwartete Wirkung, wie belastbar die Datenlage ist, woran man den Erfolg misst und wo im Admin gehandelt wird."
      >
        {items.length === 0 ? (
          <Empty>Keine Entscheidungen in diesem Bericht.</Empty>
        ) : (
          <ol className="grid gap-3 xl:grid-cols-2">
            {items.map((d, i) => (
              <li key={i}>
                <Card className="h-full">
                  <CardContent className="flex h-full flex-col gap-2.5 p-4">
                    <div className="flex items-start gap-3">
                      <span
                        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
                        aria-hidden
                      >
                        {i + 1}
                      </span>
                      <h4 className="text-sm font-semibold leading-snug text-foreground">{d.title}</h4>
                    </div>
                    <Prose className="text-muted-foreground">{d.rationale}</Prose>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <OwnerBadge owner={d.owner} />
                      <LevelBadge kind="impact" value={d.impact} />
                      <LevelBadge kind="confidence" value={d.confidence} />
                    </div>
                    <div className="mt-auto flex flex-col gap-1.5 border-t border-border pt-2.5">
                      {d.metric && (
                        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Target className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
                          <span className="min-w-0 break-words">
                            <span className="font-medium text-foreground">Erfolg: </span>
                            {d.metric}
                          </span>
                        </p>
                      )}
                      <div className="flex justify-end">
                        <AdminTextLink target={d.link} range={range} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </section>
  );
}

// ── Umsatz über Mo ───────────────────────────────────────────────────────────

function Revenue({
  decision,
  snapshot,
  m,
  range,
}: {
  decision: Decision | null;
  snapshot: Snapshot | null;
  m: (key: string) => SnapshotMetric | null;
  range: { from: string; to: string } | null;
}) {
  const sources = tableOf(snapshot, "revenue", "revenue.sources");
  return (
    <section id="r-umsatz" className="scroll-mt-24">
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <PiggyBank className="size-4 text-accent" aria-hidden />
            Umsatz über Mo
          </span>
        }
        level={3}
        info="Bezahlte Bestellungen mit Mo-Markierung oder Mo-Code (Bestell-Webhook): Direkt = Mo-Code oder Mo-Link, Beraten & gekauft = Warenkorb-Markierung und ein beratenes Produkt gekauft, Beraten, anderes gekauft = Markierung ohne Produktüberschneidung. Eine Untergrenze: Käufe auf einem anderen Gerät sind unsichtbar."
        actions={<AdminTextLink target="kpi_umsatz" range={range} />}
      >
        <div className="flex flex-col gap-4">
          {decision?.revenue.summary ? <Prose>{decision.revenue.summary}</Prose> : <Empty>Keine Einordnung verfügbar.</Empty>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricTile metric={m("revenue.total")} label="Mo-Umsatz (bezahlt)" />
            <MetricTile metric={m("revenue.direct")} label="Direkt" />
            <MetricTile metric={m("revenue.assisted")} label="Beraten & gekauft" />
            <MetricTile metric={m("revenue.influenced")} label="Beraten, anderes gekauft" />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            {(decision?.revenue.drivers ?? []).length > 0 ? (
              <ul className="flex flex-col gap-2">
                {decision!.revenue.drivers.map((d, i) => (
                  <li key={i} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
                    <div className="text-xs font-semibold text-foreground">{d.title}</div>
                    <div className="text-xs text-muted-foreground">{d.detail}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <span />
            )}
            {sources && (
              <Card>
                <CardContent className="overflow-x-auto p-3">
                  <BreakdownTable table={sources} />
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </Section>
    </section>
  );
}

// ── Engpässe ─────────────────────────────────────────────────────────────────

function Bottlenecks({
  decision,
  snapshot,
  range,
}: {
  decision: Decision | null;
  snapshot: Snapshot | null;
  range: { from: string; to: string } | null;
}) {
  const items = decision?.bottlenecks ?? [];
  const funnels = snapshot?.funnels ?? [];
  return (
    <section id="r-engpaesse" className="scroll-mt-24">
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <Funnel className="size-4 text-accent" aria-hidden />
            Engpässe im Funnel
          </span>
        }
        level={3}
        info="Wo zwischen Chat, Anmeldung, Einwilligung, E-Mail, Kampagne und Kauf am meisten verloren geht. Rechts die gemessenen Stufen: Balken relativ zur ersten Stufe, daneben der Übergang von der vorigen Stufe und der Wert der Vorperiode (VP). Chat, Anmeldung und Einwilligung zählen Sitzungen, das Formular Ereignisse, Kampagnen Mails."
      >
        <div className="flex flex-col gap-4">
          {items.length === 0 ? (
            <Empty>Keine Engpässe benannt.</Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((b, i) => (
                <Card key={i} className="h-full">
                  <CardContent className="flex h-full flex-col gap-1.5 p-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h4 className="text-sm font-semibold text-foreground">{b.stage}</h4>
                      <LevelBadge kind="impact" value={b.impact} />
                    </div>
                    <Prose className="text-muted-foreground">{b.finding}</Prose>
                    {b.evidence && (
                      <span className="self-start rounded-md bg-surface-2 px-2 py-0.5 text-2xs font-medium tabular-nums text-foreground">
                        {b.evidence}
                      </span>
                    )}
                    <div className="mt-auto flex justify-end pt-1">
                      <AdminTextLink target={b.link} range={range} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {funnels.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {funnels.map((f) => (
                <Card key={f.key}>
                  <CardContent className="p-3.5">
                    <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                      <div className="text-xs font-semibold text-foreground">{f.title}</div>
                      <AdminTextLink target={f.link} range={range} />
                    </div>
                    <FunnelBars funnel={f} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </Section>
    </section>
  );
}

// ── Seit dem letzten Bericht ─────────────────────────────────────────────────

const DIRECTION_ICON: Record<string, React.ReactNode> = {
  besser: <ArrowUpRight className="size-4 text-success" aria-hidden />,
  schlechter: <ArrowDownRight className="size-4 text-destructive" aria-hidden />,
  gleich: <Minus className="size-4 text-muted-foreground" aria-hidden />,
  unklar: <CircleQuestionMark className="size-4 text-warning" aria-hidden />,
};
const DIRECTION_LABEL: Record<string, string> = { besser: "besser", schlechter: "schlechter", gleich: "unverändert", unklar: "unklar" };

function Changes({ sections, decision }: { sections: Sections; decision: Decision | null }) {
  const c = sections.comparison ?? null;
  const items = decision?.changes.items ?? [];
  return (
    <section id="r-veraenderung" className="scroll-mt-24">
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <History className="size-4 text-accent" aria-hidden />
            Seit dem letzten Bericht
          </span>
        }
        level={3}
        info="Vergleich mit dem zuletzt gespeicherten fertigen Bericht: rechts die Kennzahlen jetzt und damals (bei unterschiedlich langen Zeiträumen je Tag), links die Einordnung — auch, ob die damals empfohlenen Maßnahmen sichtbar wirken. Ohne früheren Bericht vergleicht die Einordnung mit der Vorperiode."
      >
        {c && (
          <p className="mb-3 text-xs text-muted-foreground">
            Verglichen mit{" "}
            <Link href={`/admin?tab=analyse&report=${c.previousReportId}`} className="font-medium text-accent hover:underline">
              {c.title || `Bericht #${c.previousReportId}`}
            </Link>
            {c.title && c.title.includes(germanDate(c.from)) ? "" : ` (${c.from === c.to ? germanDate(c.from) : `${germanDate(c.from)} – ${germanDate(c.to)}`})`}
            {c.completedAt ? ` · erstellt ${formatAdmin(c.completedAt, ADMIN_DATE_MEDIUM, "")}` : ""}
            {c.perDay ? " · unterschiedlich lange Zeiträume: Mengen je Tag" : ""}
            {c.basis === "legacy" ? " · älterer Bericht: nur die Kennzahlen, die jeder Bericht hat" : ""}
          </p>
        )}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="flex flex-col gap-3">
            {decision?.changes.summary ? <Prose>{decision.changes.summary}</Prose> : null}
            {items.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {items.map((it, i) => (
                  <li key={i} className="flex gap-2.5 rounded-lg border border-border bg-card px-3 py-2">
                    <span className="mt-0.5 shrink-0">
                      {DIRECTION_ICON[it.direction] ?? DIRECTION_ICON.unklar}
                      <span className="sr-only">{DIRECTION_LABEL[it.direction]}</span>
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground">{it.title}</div>
                      <div className="text-xs text-muted-foreground">{it.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              !decision?.changes.summary && <Empty>Keine Einordnung verfügbar.</Empty>
            )}
          </div>
          <div>
            {c && c.metrics.length > 0 ? (
              <Card>
                <CardContent className="overflow-x-auto p-0 pb-1">
                  <Table className="text-xs [&_td]:tabular-nums">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kennzahl</TableHead>
                        <TableHead align="right">Jetzt</TableHead>
                        <TableHead align="right">Damals</TableHead>
                        <TableHead align="right">Veränderung</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {c.metrics.map((row) => {
                        const unit = row.unit as SnapshotMetric["unit"];
                        const fmt = (v: number | null) =>
                          c.perDay && (unit === "count" || unit === "eur") && v !== null
                            ? `${unit === "eur" ? formatMetricValue("eur", v) : num(v, 1)} / Tag`
                            : formatMetricValue(unit, v);
                        return (
                          <TableRow key={row.key}>
                            <TableCell className="text-foreground">{row.label}</TableCell>
                            <TableCell align="right" className="whitespace-nowrap font-medium text-foreground">
                              {fmt(row.now)}
                            </TableCell>
                            <TableCell align="right" className="whitespace-nowrap text-muted-foreground">
                              {fmt(row.then)}
                            </TableCell>
                            <TableCell align="right" className="whitespace-nowrap">
                              {comparisonDelta(row) ? (
                                <DeltaPill metric={{ value: row.now, previous: row.then, unit, good: row.good as SnapshotMetric["good"] }} />
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : (
              <Callout tone="neutral" compact>
                Kein früherer Bericht gespeichert — die Veränderung bezieht sich auf die Vorperiode.
              </Callout>
            )}
            {c && (c.previousDecisions.length > 0 || c.previousRecommendations.length > 0) && (
              <Disclosure className="mt-3" title="Damals empfohlen" meta={`${num(c.previousDecisions.length + c.previousRecommendations.length)} Punkte`}>
                <ul className="flex flex-col gap-1 text-xs text-foreground">
                  {c.previousDecisions.map((d, i) => (
                    <li key={`d${i}`}>• {d.title}</li>
                  ))}
                  {c.previousRecommendations.map((r, i) => (
                    <li key={`r${i}`}>
                      • {r.title}
                      {r.successMetric && <span className="text-muted-foreground"> — Messung: {r.successMetric}</span>}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
          </div>
        </div>
      </Section>
    </section>
  );
}

// ── Kunden & Segmente ────────────────────────────────────────────────────────

function Customers({
  decision,
  snapshot,
  m,
  range,
}: {
  decision: Decision | null;
  snapshot: Snapshot | null;
  m: (key: string) => SnapshotMetric | null;
  range: { from: string; to: string } | null;
}) {
  const segments = tableOf(snapshot, "customers", "customers.segments");
  const items = decision?.segments ?? [];
  return (
    <section id="r-kunden" className="scroll-mt-24">
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-4 text-accent" aria-hidden />
            Kunden & Segmente
          </span>
        }
        level={3}
        info="Bestell-Ledger des Zeitraums (alle Shop-Bestellungen, netto Erstattungen) mit Erst- und Wiederkäufer:innen, der Lebenszyklus und der Mo-Effekt (Stand heute; vergleichbar gewichtet, eine Korrelation — kein Beweis) und was daraus für die Ansprache folgt."
        actions={<AdminTextLink target="kunden" range={range} />}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricTile metric={m("ledger.revenue")} label="Shop-Umsatz (Ledger)" />
          <MetricTile metric={m("ledger.repeatShare")} label="Wiederkäufer:innen" />
          <MetricTile
            metric={m("moEffect.repurchaseMo")}
            label="Wiederkauf mit Mo"
            info={`Wiederkaufquote der Shopify-Kund:innen, die mit Mo gesprochen haben; vergleichbar ohne Mo: ${formatMetricValue("rate", m("moEffect.repurchaseComparable")?.value ?? null)} (Korrelation, kein Beweis).`}
          />
          <MetricTile metric={m("customers.subscribedShare")} label="Mit Einwilligung" />
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="flex flex-col gap-2.5">
            {items.length === 0 ? (
              <Empty>Keine Segment-Erkenntnisse.</Empty>
            ) : (
              items.map((s, i) => (
                <Card key={i}>
                  <CardContent className="flex flex-col gap-1.5 p-3.5">
                    <h4 className="text-sm font-semibold text-foreground">{s.segment}</h4>
                    <Prose className="text-muted-foreground">{s.insight}</Prose>
                    <p className="flex items-start gap-1.5 text-xs text-foreground">
                      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
                      {s.action}
                    </p>
                    <div className="flex justify-end">
                      <AdminTextLink target={s.link} range={range} />
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
          {segments && (
            <Card>
              <CardContent className="p-4">
                <div className="mb-2 text-xs font-semibold text-foreground">{segments.title}</div>
                <BarList
                  rows={segments.rows.map((r) => ({
                    key: r.key,
                    label: r.label,
                    count: Number((r.values as Record<string, number | null>).n ?? 0),
                  }))}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </Section>
    </section>
  );
}

// ── Kampagnen ───────────────────────────────────────────────────────────────

function Campaigns({
  decision,
  snapshot,
  m,
  range,
}: {
  decision: Decision | null;
  snapshot: Snapshot | null;
  m: (key: string) => SnapshotMetric | null;
  range: { from: string; to: string } | null;
}) {
  const table = tableOf(snapshot, "campaigns", "campaigns.byCampaign");
  const items = decision?.campaigns.items ?? [];
  return (
    <section id="r-kampagnen" className="scroll-mt-24">
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <Megaphone className="size-4 text-accent" aria-hidden />
            Kampagnen
          </span>
        }
        level={3}
        info="Kampagnen-Mails im Zeitraum (ohne Testmails): Klicks auf Button oder Set, Chat-Starts aus der Mail, bezahlte Bestellungen mit dem MK-Code der Kampagne, Abmeldungen und Briefe. Öffnungen werden bewusst nicht gemessen (kein Tracking-Pixel)."
        actions={<AdminTextLink target="kampagnen" range={range} />}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricTile metric={m("campaigns.sent")} label="Mails gesendet" />
          <MetricTile metric={m("campaigns.clickRate")} label="Klickrate" />
          <MetricTile metric={m("campaigns.revenue")} label="Umsatz mit MK-Code" />
          <MetricTile metric={m("campaigns.unsubscribeRate")} label="Abmeldequote" />
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {decision?.campaigns.summary && <Prose>{decision.campaigns.summary}</Prose>}
          {items.length > 0 && (
            <div className="grid gap-2.5 xl:grid-cols-2">
              {items.map((c, i) => (
                <div key={i} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
                  <div className="text-xs font-semibold text-foreground">{c.campaign}</div>
                  <div className="text-xs text-muted-foreground">{c.insight}</div>
                  <div className="mt-1 flex items-start gap-1.5 text-xs text-foreground">
                    <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
                    {c.action}
                  </div>
                </div>
              ))}
            </div>
          )}
          {table && table.rows.length > 0 ? (
            <Card>
              <CardContent className="overflow-x-auto p-3">
                <BreakdownTable table={table} />
              </CardContent>
            </Card>
          ) : (
            <Empty>Keine Kampagnen-Mails im Zeitraum.</Empty>
          )}
        </div>
      </Section>
    </section>
  );
}

// ── Maßnahmen ────────────────────────────────────────────────────────────────

type OwnerFilter = "all" | (typeof OWNERS)[number];

function Recommendations({ decision, range }: { decision: Decision | null; range: { from: string; to: string } | null }) {
  const all = React.useMemo(() => decision?.recommendations ?? [], [decision]);
  const [owner, setOwner] = React.useState<OwnerFilter>("all");
  const counts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of all) c[r.owner] = (c[r.owner] ?? 0) + 1;
    return c;
  }, [all]);
  const options = [
    { value: "all" as OwnerFilter, label: `Alle (${all.length})` },
    ...OWNERS.filter((o) => counts[o]).map((o) => ({
      value: o as OwnerFilter,
      label: `${(OWNER_LABELS as Record<string, string>)[o]} (${counts[o]})`,
    })),
  ];
  const shown = all.map((r, i) => ({ r, rank: i + 1 })).filter(({ r }) => owner === "all" || r.owner === owner);
  return (
    <section id="r-massnahmen" className="scroll-mt-24">
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <ListChecks className="size-4 text-accent" aria-hidden />
            Maßnahmen nach Priorität
          </span>
        }
        level={3}
        info="Priorisiert nach Wirkung × Konfidenz ÷ Aufwand. Jede Maßnahme nennt die erwartete Wirkung (mit Annahme), den Aufwand, wie belastbar die Daten sind, wer handelt und woran der Erfolg gemessen wird — die Kennzahl in eckigen Klammern ist der Schlüssel aus den Geschäftsdaten. Die Verbesserung kann diese Messung im nächsten Lauf prüfen."
        actions={
          all.length > 0 && options.length > 2 ? (
            <SegmentedControl label="Nach Verantwortung filtern" size="sm" value={owner} options={options} onChange={setOwner} />
          ) : undefined
        }
      >
        {all.length === 0 ? (
          <Empty>Keine Maßnahmen in diesem Bericht.</Empty>
        ) : (
          <ol className="flex flex-col gap-3">
            {shown.map(({ r, rank }) => (
              <li key={rank}>
                <Card>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="mt-0.5 shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-accent">
                          #{rank}
                        </span>
                        <h4 className="text-sm font-semibold leading-snug text-foreground">{r.title}</h4>
                      </div>
                      <AdminLinkButton target={r.link} range={range} />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <LevelBadge kind="impact" value={r.impact} />
                      <LevelBadge kind="effort" value={r.effort} />
                      <LevelBadge kind="confidence" value={r.confidence} />
                      <OwnerBadge owner={r.owner} />
                    </div>
                    <dl className="grid gap-x-6 gap-y-2 text-xs md:grid-cols-2">
                      <div>
                        <dt className="font-medium text-muted-foreground">Warum</dt>
                        <dd className="text-foreground">{r.why}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-muted-foreground">Erste Schritte</dt>
                        <dd className="text-foreground">{r.action}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-muted-foreground">Erwartete Wirkung</dt>
                        <dd className="text-foreground">{r.expectedImpact}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-muted-foreground">Erfolgsmessung</dt>
                        <dd className="flex items-start gap-1.5 text-foreground">
                          <Target className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
                          {r.successMetric}
                        </dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </section>
  );
}

// ── Experimente ──────────────────────────────────────────────────────────────

function Experiments({ decision }: { decision: Decision | null }) {
  const items = decision?.experiments ?? [];
  return (
    <section id="r-experimente" className="scroll-mt-24">
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <FlaskConical className="size-4 text-accent" aria-hidden />
            Experimente
          </span>
        }
        level={3}
        info="Experimente, die eine offene Frage klären, statt zu raten — mit Hypothese, Aufbau, primärer Kennzahl, Laufzeit bzw. Fallzahl je Gruppe und dem Kriterium, ab dem es als Erfolg gilt. Vor dem Start festlegen und erst am Ziel auswerten."
      >
        {items.length === 0 ? (
          <Empty>Keine Experimente vorgeschlagen.</Empty>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {items.map((e, i) => (
              <Card key={i}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 className="text-sm font-semibold text-foreground">{e.title}</h4>
                    <OwnerBadge owner={e.owner} />
                  </div>
                  <p className="text-xs italic text-muted-foreground">{e.hypothesis}</p>
                  <dl className="grid gap-1.5 text-xs">
                    <ExperimentRow label="Aufbau" value={e.design} />
                    <ExperimentRow label="Kennzahl" value={e.metric} />
                    <ExperimentRow label="Laufzeit" value={e.duration} />
                    <ExperimentRow label="Erfolg, wenn" value={e.successCriterion} />
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </section>
  );
}

function ExperimentRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

// ── Risiken & Datenqualität ──────────────────────────────────────────────────

function Risks({ decision, snapshot }: { decision: Decision | null; snapshot: Snapshot | null }) {
  const risks = decision?.risks ?? [];
  const modelCaveats = decision?.dataQuality ?? [];
  const caveats = snapshot?.caveats ?? [];
  const warnings = caveats.filter((c) => c.level === "warning");
  const infos = caveats.filter((c) => c.level !== "warning");
  const switches = snapshot?.switches ?? [];
  return (
    <section id="r-risiken" className="scroll-mt-24">
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <ShieldAlert className="size-4 text-accent" aria-hidden />
            Risiken & Datenqualität
          </span>
        }
        level={3}
        info="Risiken für Umsatz, Recht, Technik und Ruf mit Gegenmaßnahme; dazu die Messhinweise, die die Zahlen einschränken: Releases zwischen den Zeiträumen, kleine Stichproben, Schalter (Stand heute) und die festen Regeln der Messung."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="flex flex-col gap-2.5">
            {risks.length === 0 ? (
              <Empty>Keine Risiken benannt.</Empty>
            ) : (
              risks.map((r, i) => (
                <Card key={i}>
                  <CardContent className="flex flex-col gap-1.5 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-foreground">{r.title}</h4>
                      <div className="flex gap-1.5">
                        <LevelBadge kind="severity" value={r.severity} />
                        <OwnerBadge owner={r.owner} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{r.detail}</p>
                    {r.mitigation && (
                      <p className="flex items-start gap-1.5 text-xs text-foreground">
                        <Compass className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
                        {r.mitigation}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
          <div className="flex flex-col gap-3">
            {(warnings.length > 0 || modelCaveats.length > 0) && (
              <Callout tone="warning" title="Messhinweise, die Entscheidungen einschränken">
                <ul className="mt-1 flex flex-col gap-1.5">
                  {warnings.map((c, i) => (
                    <li key={`w${i}`}>
                      <span className="font-medium">{c.title}:</span> {c.detail}
                    </li>
                  ))}
                  {modelCaveats.map((c, i) => (
                    <li key={`m${i}`}>
                      <span className="font-medium">{c.title}:</span> {c.detail}
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
            {infos.length > 0 && (
              <Disclosure title="Weitere Messhinweise und Releases" meta={`${num(infos.length)} Hinweise`}>
                <ul className="flex flex-col gap-1.5 text-xs text-foreground">
                  {infos.map((c, i) => (
                    <li key={i}>
                      <span className="font-medium">{c.title}:</span> <span className="text-muted-foreground">{c.detail}</span>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
            {switches.length > 0 && (
              <Disclosure title="Schalter (Stand heute)" meta="nicht historisch">
                <ul className="grid gap-1 text-xs sm:grid-cols-2">
                  {switches.map((s) => (
                    <li key={s.key} className="flex items-center justify-between gap-2">
                      <span className="truncate text-muted-foreground">{s.label}</span>
                      {typeof s.value === "number" ? (
                        <StatusBadge tone="neutral" dot={false}>
                          {num(s.value)}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone={s.value ? "success" : "neutral"}>{s.value ? "an" : "aus"}</StatusBadge>
                      )}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
          </div>
        </div>
      </Section>
    </section>
  );
}

// ── Alle Kennzahlen ──────────────────────────────────────────────────────────

function AllMetrics({ snapshot, range }: { snapshot: Snapshot | null; range: { from: string; to: string } | null }) {
  if (!snapshot) return null;
  return (
    <section id="r-kennzahlen" className="scroll-mt-24">
      <Section
        title="Alle Kennzahlen"
        level={3}
        info="Die vollständigen Geschäftsdaten, auf denen der Bericht beruht — je Bereich jede Kennzahl mit Vorperiode und Veränderung sowie die Aufschlüsselungen (VP = Vorperiode). Dieselben Abfragen wie auf dem KPI-Bildschirm; „Stand heute“ markiert Gesamtwerte ohne Vorperiode."
      >
        <div className="flex flex-col gap-2">
          {snapshot.sections.map((s) => (
            <Disclosure
              key={s.key}
              title={s.title}
              meta={`${num(s.metrics.filter((x) => x.value !== null).length)} Kennzahlen`}
              actions={<AdminTextLink target={s.link} range={range} />}
            >
              <div className="flex flex-col gap-4">
                <MetricTable metrics={s.metrics} />
                {s.tables.map((t) => (
                  <BreakdownTable key={t.key} table={t} />
                ))}
                {(s.notes.length > 0 || s.previousNotes.length > 0) && (
                  <ul className="flex flex-col gap-1 text-2xs text-muted-foreground">
                    {s.notes.map((n, i) => (
                      <li key={`n${i}`}>{n}</li>
                    ))}
                    {s.previousNotes.map((n, i) => (
                      <li key={`p${i}`}>Vorperiode: {n}</li>
                    ))}
                  </ul>
                )}
              </div>
            </Disclosure>
          ))}
        </div>
      </Section>
    </section>
  );
}
