"use client";

// One improvement run: header + delete, the progress driver while running,
// the failure notice, and — when complete —
//   v2: Lage (headline, tiles, better / worse, backlog by lane), Wirkung
//       umgesetzter Änderungen (measured effects + the strategist's reading),
//       Vorschläge (decision cards, by lane, this run or every open one) and
//       the reference material (all metrics of the period, data quality);
//   v1: the original view (rate table, Wirkungs-Check text, cards per lane).

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Lightbulb, Loader2, Trash2 } from "lucide-react";
import { ADMIN_DATE_TIME_MEDIUM, formatAdmin } from "@/lib/admin-datetime.mjs";
import { germanDate } from "@/lib/kpi-range.mjs";
import { eur, num, pct, plural } from "@/lib/admin-format.mjs";
import { OWNER_LANES, OWNER_LANE_LABELS } from "@/lib/improvement-core.mjs";
import type { BusinessSnapshot } from "@/lib/business-snapshot";
import type { OwnerLane, RunAnalysisV2, RunBaselineV2 } from "@/lib/improvement-types";
import {
  Button,
  Callout,
  Card,
  CardContent,
  Disclosure,
  InfoTip,
  Markdown,
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
  toast,
  useConfirm,
} from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import { AdminTextLink, MetricTable } from "../analytics/report-parts";
import { EffectsSection } from "./EffectsSection";
import { RunNotes, RunOverview } from "./RunOverview";
import { RunProgress } from "./RunProgress";
import { SuggestionCard } from "./SuggestionCard";
import type { DeltaRow, RunDetail, SuggestionItem } from "./types";

export function RunStatusBadge({ status }: { status: RunDetail["status"] }) {
  if (status === "running") {
    return (
      <StatusBadge tone="info" dot={false} icon={<Loader2 className="animate-spin" />}>
        läuft
      </StatusBadge>
    );
  }
  if (status === "failed") {
    return (
      <StatusBadge tone="destructive" dot={false} icon={<AlertTriangle />}>
        Fehler
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="success" dot={false} icon={<CheckCircle2 />}>
      fertig
    </StatusBadge>
  );
}

const NAV: ReadonlyArray<{ id: string; label: string }> = [
  { id: "v-lage", label: "Lage" },
  { id: "v-wirkung", label: "Wirkung" },
  { id: "v-vorschlaege", label: "Vorschläge" },
  { id: "v-grundlagen", label: "Kennzahlen & Messhinweise" },
];

export function RunView({
  detail,
  backlog,
  onDone,
  onDeleted,
  onSuggestionChanged,
}: {
  detail: RunDetail;
  backlog: SuggestionItem[];
  onDone: () => void;
  onDeleted: () => void;
  onSuggestionChanged: (s: SuggestionItem) => void;
}) {
  const v2 = detail.version === 2 && detail.baseline ? (detail.baseline as unknown as RunBaselineV2) : null;
  const analysis = v2 ? (detail.delta as unknown as RunAnalysisV2 | null) : null;
  const metaBits = [
    `${germanDate(detail.rangeFrom)} – ${germanDate(detail.rangeTo)}`,
    `erstellt ${formatAdmin(detail.createdAt, ADMIN_DATE_TIME_MEDIUM, detail.createdAt)}`,
    detail.costEur > 0 ? `KI-Kosten ~${eur(detail.costEur)}` : null,
    `Prompt-Version ${detail.promptHash.slice(0, 12)}`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Verbesserungslauf · {detail.reportTitle}</h2>
            <RunStatusBadge status={detail.status} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {metaBits.join(" · ")}
            {detail.reportId != null && (
              <>
                {" · "}
                <Link href={`/admin?tab=analyse&report=${detail.reportId}`} className="font-medium text-accent hover:underline">
                  Komplettanalyse #{detail.reportId}
                </Link>
              </>
            )}
          </p>
        </div>
        <DeleteRunButton id={detail.id} onDeleted={onDeleted} />
      </header>

      {detail.status === "running" && (
        <RunProgress
          id={detail.id}
          title={detail.reportTitle}
          initialPhase={detail.phase}
          initialCostEur={detail.costEur}
          onDone={onDone}
        />
      )}

      {detail.status === "failed" && (
        <Callout tone="destructive" title="Lauf fehlgeschlagen">
          {detail.error && <p>{detail.error}</p>}
          <p className="mt-1 text-xs">Bitte den Lauf löschen und neu starten.</p>
        </Callout>
      )}

      {detail.status === "complete" &&
        (v2 && analysis ? (
          <DecisionRunBody
            detail={detail}
            baseline={v2}
            analysis={analysis}
            backlog={backlog}
            onSuggestionChanged={onSuggestionChanged}
          />
        ) : (
          <LegacyRunBody detail={detail} onSuggestionChanged={onSuggestionChanged} />
        ))}
    </div>
  );
}

// ── v2 ────────────────────────────────────────────────────────────────────────

type Scope = "run" | "open";
type LaneFilter = "all" | OwnerLane;

function DecisionRunBody({
  detail,
  baseline,
  analysis,
  backlog,
  onSuggestionChanged,
}: {
  detail: RunDetail;
  baseline: RunBaselineV2;
  analysis: RunAnalysisV2;
  backlog: SuggestionItem[];
  onSuggestionChanged: (s: SuggestionItem) => void;
}) {
  const snapshot = baseline.snapshot;
  const range = snapshot?.period ? { from: snapshot.period.from, to: snapshot.period.to } : null;
  const [lane, setLane] = React.useState<LaneFilter>("all");
  const [scope, setScope] = React.useState<Scope>("run");
  const notes = analysis.state?.notes ?? [];

  const selectLane = React.useCallback((l: OwnerLane) => {
    setScope("open");
    setLane(l);
    document.getElementById("v-vorschlaege")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="flex flex-col gap-10">
      <nav aria-label="Abschnitte des Laufs" className="-mb-4 flex flex-wrap gap-1.5">
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

      <div className="flex flex-col gap-3">
        <RunOverview snapshot={snapshot} analysis={analysis} backlog={backlog} onLaneSelect={selectLane} />
        <RunNotes notes={notes} />
      </div>

      <EffectsSection measurements={analysis.measurement?.measurements ?? []} review={analysis.review} />

      <SuggestionsSection
        runSuggestions={detail.suggestions}
        backlog={backlog}
        imported={analysis.imported ?? 0}
        lane={lane}
        onLane={setLane}
        scope={scope}
        onScope={setScope}
        range={range}
        onChanged={onSuggestionChanged}
      />

      <ReferenceSection snapshot={snapshot} analysis={analysis} />
    </div>
  );
}

const STATUS_ORDER: Record<SuggestionItem["status"], number> = { open: 0, accepted: 1, implemented: 2, dismissed: 3 };

function bySortOrder(a: SuggestionItem, b: SuggestionItem): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.tier - b.tier || b.priority - a.priority || a.id - b.id;
}

function SuggestionsSection({
  runSuggestions,
  backlog,
  imported,
  lane,
  onLane,
  scope,
  onScope,
  range,
  onChanged,
}: {
  runSuggestions: SuggestionItem[];
  backlog: SuggestionItem[];
  imported: number;
  lane: LaneFilter;
  onLane: (l: LaneFilter) => void;
  scope: Scope;
  onScope: (s: Scope) => void;
  range: { from: string; to: string } | null;
  onChanged: (s: SuggestionItem) => void;
}) {
  const source = scope === "run" ? runSuggestions : backlog;
  const counts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of source) c[s.ownerLane] = (c[s.ownerLane] ?? 0) + 1;
    return c;
  }, [source]);
  const effectiveLane: LaneFilter = lane !== "all" && !counts[lane] ? "all" : lane;
  const shown = React.useMemo(
    () => source.filter((s) => effectiveLane === "all" || s.ownerLane === effectiveLane).sort(bySortOrder),
    [source, effectiveLane]
  );
  const laneOptions = [
    { value: "all" as LaneFilter, label: `Alle (${num(source.length)})` },
    ...(OWNER_LANES as readonly OwnerLane[])
      .filter((l) => counts[l])
      .map((l) => ({ value: l as LaneFilter, label: `${(OWNER_LANE_LABELS as Record<string, string>)[l]} (${num(counts[l])})` })),
  ];
  const decided = runSuggestions.filter((s) => s.status !== "open").length;

  return (
    <section id="v-vorschlaege" className="scroll-mt-24">
      <Section
        title={
          <span className="inline-flex items-center gap-1.5">
            <Lightbulb className="size-4 text-accent" aria-hidden />
            Vorschläge
          </span>
        }
        level={3}
        info="Nach Priorität (Wirkung × Konfidenz ÷ Aufwand, gedämpft durch das Risiko); jeder Vorschlag nennt seine Belege als Zahlen aus den Geschäftsdaten, die erwartete Wirkung, die Erfolgskennzahl (der nächste Lauf misst sie), wer handelt und wo. Nichts passiert automatisch: Anweisungen an Mo werden erst mit „Übernehmen“ live, alles andere wird eingeplant und als erledigt markiert, sobald es umgesetzt ist. Maßnahmen der Komplettanalyse sind als solche markiert."
        actions={
          <SegmentedControl
            label="Welche Vorschläge"
            size="sm"
            value={scope}
            onChange={(v) => onScope(v)}
            options={[
              { value: "run" as Scope, label: `Dieser Lauf (${num(runSuggestions.length)})` },
              { value: "open" as Scope, label: `Alle offenen (${num(backlog.length)})` },
            ]}
          />
        }
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {laneOptions.length > 2 ? (
            <SegmentedControl label="Nach Bereich filtern" size="sm" value={effectiveLane} onChange={onLane} options={laneOptions} />
          ) : (
            <span />
          )}
          {scope === "run" && runSuggestions.length > 0 && (
            <span className="text-2xs text-muted-foreground">
              {num(decided)} von {num(runSuggestions.length)} entschieden
              {imported > 0 ? ` · ${plural(imported, "Maßnahme", "Maßnahmen")} aus der Komplettanalyse` : ""}
            </span>
          )}
        </div>
        {shown.length === 0 ? (
          <Callout tone="neutral">
            {scope === "run"
              ? "Keine neuen Vorschläge in diesem Lauf — alles bereits Vorgeschlagene ist noch offen oder umgesetzt."
              : "Nichts offen — alle Vorschläge sind entschieden."}
          </Callout>
        ) : (
          <ol className="flex flex-col gap-3">
            {shown.map((s) => (
              <li key={s.id}>
                <SuggestionCard suggestion={s} onChanged={onChanged} range={range} showRun={scope === "open"} />
              </li>
            ))}
          </ol>
        )}
      </Section>
    </section>
  );
}

function ReferenceSection({ snapshot, analysis }: { snapshot: BusinessSnapshot | null; analysis: RunAnalysisV2 }) {
  const range = snapshot?.period ? { from: snapshot.period.from, to: snapshot.period.to } : null;
  const switchHistory = analysis.measurement?.switchHistory ?? [];
  return (
    <section id="v-grundlagen" className="scroll-mt-24">
      <Section
        title="Kennzahlen & Messhinweise"
        level={3}
        info="Die vollständige Geschäftsübersicht des Zeitraums, auf der dieser Lauf aufbaut (dieselben Zahlen wie die KPIs), und alles, was ihre Aussagekraft einschränkt: Releases, kleine Stichproben, Schalter."
      >
        {!snapshot ? (
          <p className="text-xs text-muted-foreground">Keine Geschäftsdaten gespeichert.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {snapshot.sections.map((s) => (
              <Disclosure
                key={s.key}
                title={s.title}
                meta={`${num(s.metrics.filter((m) => m.value !== null || m.previous !== null).length)} Kennzahlen${s.scope === "lifetime" ? " · Stand heute" : ""}`}
                actions={<AdminTextLink target={s.link} range={range} />}
              >
                <MetricTable metrics={s.metrics} />
              </Disclosure>
            ))}
            <Disclosure title="Datenqualität & Messhinweise" meta={`${num(snapshot.caveats.length + switchHistory.length)} Hinweise`}>
              <ul className="flex flex-col gap-1.5 text-xs">
                {switchHistory.map((s) => (
                  <li key={s.key} className="text-warning">
                    <span className="font-medium">Schalter umgestellt: {s.label}</span> — zwischen {germanDate(s.between.from)} und{" "}
                    {germanDate(s.between.to)} ({String(s.from)} → {String(s.to)}).
                  </li>
                ))}
                {snapshot.caveats.map((c, i) => (
                  <li key={i} className={cn(c.level === "warning" ? "text-foreground" : "text-muted-foreground")}>
                    <span className="font-medium">
                      {c.level === "warning" && <AlertTriangle className="mr-1 inline size-3 text-warning" aria-hidden />}
                      {c.title}:
                    </span>{" "}
                    {c.detail}
                  </li>
                ))}
              </ul>
              {snapshot.switches.length > 0 && (
                <p className="mt-3 text-2xs text-muted-foreground">
                  Schalter (Stand heute):{" "}
                  {snapshot.switches
                    .map((s) => `${s.label}: ${typeof s.value === "number" ? num(s.value) : s.value ? "an" : "aus"}`)
                    .join(" · ")}
                </p>
              )}
            </Disclosure>
          </div>
        )}
      </Section>
    </section>
  );
}

// ── v1 ────────────────────────────────────────────────────────────────────────

function LegacyRunBody({ detail, onSuggestionChanged }: { detail: RunDetail; onSuggestionChanged: (s: SuggestionItem) => void }) {
  const delta = detail.delta as { prevConversations?: number; curConversations?: number; rows?: DeltaRow[] } | null;
  const moSuggestions = detail.suggestions.filter((s) => s.lane === "mo");
  const shopSuggestions = detail.suggestions.filter((s) => s.lane === "shop");
  return (
    <>
      <Callout tone="neutral" compact>
        Lauf vor der Umstellung auf die Geschäftsdaten (06.10.2026): Kennzahlen aus der Komplettanalyse, Vorschläge ohne
        Erfolgskennzahl. Ein neuer Lauf misst übernommene Anweisungen und erledigte Vorschläge daraus.
      </Callout>
      {(delta?.rows?.length || detail.effectCheckMd) && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              Wirkungs-Check — was haben die bisherigen Maßnahmen bewirkt?
              <InfoTip>
                Kennzahlen sind Quoten je Gespräch im jeweiligen Analysezeitraum. Bewegungen zeigen Korrelation, keine bewiesene
                Ursache.
              </InfoTip>
            </h3>
            {delta?.rows && delta.rows.length > 0 && <DeltaTable rows={delta.rows} prev={delta.prevConversations ?? 0} cur={delta.curConversations ?? 0} />}
            {detail.effectCheckMd ? (
              <Markdown content={detail.effectCheckMd} className="text-sm" />
            ) : (
              <p className="text-sm text-muted-foreground">
                Kein Wirkungs-Check in diesem Lauf — es gab noch keine angenommenen oder umgesetzten Maßnahmen aus früheren Läufen.
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {detail.suggestions.length === 0 ? (
        <Callout tone="neutral">Keine Vorschläge in diesem Lauf.</Callout>
      ) : (
        <>
          <LegacyGroup heading={`Vorschläge für Mo selbst (${num(moSuggestions.length)})`} items={moSuggestions} onChanged={onSuggestionChanged} />
          <LegacyGroup heading={`Vorschläge für den Online-Shop (${num(shopSuggestions.length)})`} items={shopSuggestions} onChanged={onSuggestionChanged} />
        </>
      )}
    </>
  );
}

function LegacyGroup({ heading, items, onChanged }: { heading: string; items: SuggestionItem[]; onChanged: (s: SuggestionItem) => void }) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
      {items.map((s) => (
        <SuggestionCard key={s.id} suggestion={s} onChanged={onChanged} range={null} />
      ))}
    </section>
  );
}

function DeltaTable({ rows, prev, cur }: { rows: DeltaRow[]; prev: number; cur: number }) {
  return (
    <div>
      <Table className="text-xs [&_td]:tabular-nums">
        <TableHeader>
          <TableRow>
            <TableHead>Kennzahl</TableHead>
            <TableHead align="right">vorher</TableHead>
            <TableHead align="right">jetzt</TableHead>
            <TableHead align="right">Δ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="text-foreground">{r.label}</TableCell>
              <TableCell align="right" className="text-muted-foreground">
                {pct(r.prev)}
              </TableCell>
              <TableCell align="right">{pct(r.cur)}</TableCell>
              <TableCell
                align="right"
                className={cn("font-medium", r.delta > 0 ? "text-success" : r.delta < 0 ? "text-destructive" : "text-muted-foreground")}
              >
                {r.delta > 0 ? "+" : ""}
                {num(r.delta, 1)} pp
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-1 text-2xs text-muted-foreground">
        Basis: {plural(prev, "Gespräch", "Gespräche")} (voriger Lauf) vs. {plural(cur, "Gespräch", "Gespräche")} (dieser Lauf).
      </p>
    </div>
  );
}

function DeleteRunButton({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const del = useAsyncAction(
    async () => {
      const ok = await confirm({
        title: "Verbesserungslauf löschen?",
        description:
          "Der Lauf wird samt seinen Vorschlägen dauerhaft entfernt. Bereits übernommene Anweisungen bleiben bestehen.",
        confirmLabel: "Löschen",
        tone: "destructive",
      });
      if (!ok) return false;
      try {
        await adminFetch("/api/admin/improve/delete", { body: { id } });
      } catch (err) {
        toast({ variant: "error", title: "Löschen fehlgeschlagen", description: friendlyErrorMessage(err) });
        throw err;
      }
      return true;
    },
    { errorToast: false, onSuccess: (deleted) => deleted && onDeleted() }
  );
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => void del.run()} loading={del.pending}>
        {!del.pending && <Trash2 />}
        Löschen
      </Button>
      {confirmDialog}
    </>
  );
}

