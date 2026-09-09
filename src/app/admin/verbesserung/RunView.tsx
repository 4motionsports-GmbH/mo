"use client";

// One improvement run: header + delete, the step driver while running, the
// failure notice, and — when complete — the Wirkungs-Check (delta table +
// narrative) and the suggestion cards in their two lanes.

import * as React from "react";
import { Loader2, RefreshCcw, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { RUN_PHASE_LABELS } from "@/lib/improvement-core.mjs";
import { ADMIN_DATE_MEDIUM, ADMIN_DATE_TIME_MEDIUM, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, num, pct, plural } from "@/lib/admin-format.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  InfoTip,
  Markdown,
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
import { useStepLoop } from "../lib/use-step-loop";
import { SuggestionCard, type SuggestionItem } from "./SuggestionCard";
import type { RunDetail } from "./types";

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

export function RunView({
  detail,
  onDone,
  onDeleted,
  onSuggestionChanged,
}: {
  detail: RunDetail;
  onDone: () => void;
  onDeleted: () => void;
  onSuggestionChanged: (s: SuggestionItem) => void;
}) {
  const fmtDate = (iso: string) => formatAdmin(iso, ADMIN_DATE_MEDIUM, iso);
  const metaBits = [
    `${fmtDate(detail.rangeFrom)} – ${fmtDate(detail.rangeTo)}`,
    `erstellt ${formatAdmin(detail.createdAt, ADMIN_DATE_TIME_MEDIUM, detail.createdAt)}`,
    detail.costEur > 0 ? `KI-Kosten ~${eur(detail.costEur)}` : null,
    `Prompt-Version ${detail.promptHash.slice(0, 12)}`,
  ].filter(Boolean);

  const moSuggestions = detail.suggestions.filter((s) => s.lane === "mo");
  const shopSuggestions = detail.suggestions.filter((s) => s.lane === "shop");

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Verbesserungslauf · {detail.reportTitle}
            </h2>
            <RunStatusBadge status={detail.status} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{metaBits.join(" · ")}</p>
        </div>
        <DeleteRunButton id={detail.id} onDeleted={onDeleted} />
      </header>

      {detail.status === "running" && <RunDriver id={detail.id} phase={detail.phase} onDone={onDone} />}

      {detail.status === "failed" && (
        <Callout tone="destructive" title="Lauf fehlgeschlagen">
          {detail.error && <p>{detail.error}</p>}
          <p className="mt-1 text-xs">Bitte den Lauf löschen und neu starten.</p>
        </Callout>
      )}

      {detail.status === "complete" && (
        <>
          {(detail.delta || detail.effectCheckMd) && (
            <Card>
              <CardContent className="flex flex-col gap-3 p-5">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  Wirkungs-Check — was haben die bisherigen Maßnahmen bewirkt?
                  <InfoTip>
                    Kennzahlen sind Quoten je Gespräch im jeweiligen Analysezeitraum. Bewegungen
                    zeigen Korrelation, keine bewiesene Ursache.
                  </InfoTip>
                </h3>
                {detail.delta && detail.delta.rows.length > 0 && <DeltaTable delta={detail.delta} />}
                {detail.effectCheckMd ? (
                  <Markdown content={detail.effectCheckMd} className="text-sm" />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Kein Wirkungs-Check in diesem Lauf — es gab noch keine angenommenen oder
                    umgesetzten Maßnahmen aus früheren Läufen.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {detail.suggestions.length === 0 ? (
            <Callout tone="neutral">
              Keine neuen Vorschläge — alles bereits Vorgeschlagene ist noch offen oder umgesetzt.
              Der nächste Lauf über einen neuen Zeitraum bringt neue Evidenz.
            </Callout>
          ) : (
            <>
              <SuggestionGroup
                heading={`Vorschläge für Mo selbst (${num(moSuggestions.length)})`}
                items={moSuggestions}
                onChanged={onSuggestionChanged}
              />
              <SuggestionGroup
                heading={`Vorschläge für den Online-Shop (${num(shopSuggestions.length)})`}
                items={shopSuggestions}
                onChanged={onSuggestionChanged}
                info="Nichts passiert automatisch: Ein Vorschlag wird erst wirksam, wenn du ihn übernimmst oder selbst umsetzt. Deine Entscheidungen (Erledigt / Verworfen) fließen in den Wirkungs-Check des nächsten Laufs ein."
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

function SuggestionGroup({
  heading,
  items,
  onChanged,
  info,
}: {
  heading: string;
  items: SuggestionItem[];
  onChanged: (s: SuggestionItem) => void;
  info?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        {heading}
        {info && <InfoTip>{info}</InfoTip>}
      </h3>
      {items.map((s) => (
        <SuggestionCard key={s.id} suggestion={s} onChanged={onChanged} />
      ))}
    </section>
  );
}

function DeltaTable({ delta }: { delta: NonNullable<RunDetail["delta"]> }) {
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
          {delta.rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="text-foreground">{r.label}</TableCell>
              <TableCell align="right" className="text-muted-foreground">
                {pct(r.prev)}
              </TableCell>
              <TableCell align="right">{pct(r.cur)}</TableCell>
              <TableCell
                align="right"
                className={cn(
                  "font-medium",
                  r.delta > 0 ? "text-success" : r.delta < 0 ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {r.delta > 0 ? "+" : ""}
                {num(r.delta, 1)} pp
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="mt-1 text-2xs text-muted-foreground">
        Basis: {plural(delta.prevConversations, "Gespräch", "Gespräche")} (voriger Lauf) vs.{" "}
        {plural(delta.curConversations, "Gespräch", "Gespräche")} (dieser Lauf).
      </p>
    </div>
  );
}

/** Steps a running run to completion (POST /api/admin/improve/step). */
function RunDriver({ id, phase: initialPhase, onDone }: { id: number; phase: string; onDone: () => void }) {
  const [phase, setPhase] = React.useState(initialPhase);
  const loop = useStepLoop<{ phase?: string; done?: boolean; busy?: boolean }>({
    path: "/api/admin/improve/step",
    body: { id },
    onStep: (data) => {
      if (typeof data.phase === "string") setPhase(data.phase);
    },
    isDone: (data) => Boolean(data.done),
    isBusy: (data) => Boolean(data.busy),
    onDone,
  });
  const label = (RUN_PHASE_LABELS as Record<string, string>)[phase] ?? "Wird verarbeitet…";

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-5 text-sm">
        {loop.error ? (
          <Callout
            tone="destructive"
            compact
            action={
              <Button size="xs" variant="outline" onClick={loop.resume}>
                <RefreshCcw /> Fortsetzen
              </Button>
            }
          >
            {loop.error}
          </Callout>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-foreground">
            <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
            {label}…
            {loop.reconnecting && (
              <span className="text-xs text-muted-foreground">
                (Verbindung unterbrochen — es wird automatisch weiter versucht)
              </span>
            )}
            <InfoTip>
              Zwei bis drei Modell-Aufrufe nacheinander — insgesamt kann das einige Minuten dauern.
              Kurze Verbindungsabbrüche überbrückt die Seite automatisch; der Lauf läuft serverseitig
              weiter.
            </InfoTip>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeleteRunButton({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const del = useAsyncAction(
    async () => {
      const ok = await confirm({
        title: "Verbesserungslauf löschen?",
        description: "Der Lauf wird samt seinen Vorschlägen dauerhaft entfernt. Bereits übernommene Anweisungen bleiben bestehen.",
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
