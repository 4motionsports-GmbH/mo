"use client";

// The Verbesserung tab's self-contained workspace (docs/IMPROVEMENT_LOOP.md):
// a master–detail island like the Analyse tab. The sidebar lists stored
// improvement runs; the main area is either the "new run" panel (pick a
// completed Komplettanalyse → start), a running run (stepped to completion
// from here, one bounded model call per request), or a finished run
// (Wirkungs-Check + suggestions with their operator lifecycle). Below the
// run area sit the two standing cards: Mo's live ANWEISUNGEN layer (the
// versioned, secured instruction editor) and Mo's SELBSTBILD (the rendered
// system prompt + version hash).

import * as React from "react";
import { Loader2, AlertTriangle, Plus, Sparkles, Trash2, RefreshCcw } from "lucide-react";
import { Button, Card, CardContent, Badge, Select, toast, Markdown } from "../ui";
import { cn } from "../ui/cn";
import { RUN_PHASE_LABELS } from "@/lib/improvement-core.mjs";
import { SuggestionCard, type SuggestionItem } from "./SuggestionCard";
import { DirectivesCard, type DirectiveItem, type DirectiveLimits } from "./DirectivesCard";
import { SelfSnapshotCard, type SelfSnapshotInfo } from "./SelfSnapshotCard";

export interface RunListItem {
  id: number;
  reportTitle: string;
  rangeFrom: string;
  rangeTo: string;
  status: "running" | "complete" | "failed";
  phase: string;
  promptHash: string;
  costEur: number;
  suggestionCount: number;
  createdAt: string;
  completedAt: string | null;
}

interface DeltaRow {
  key: string;
  label: string;
  prev: number;
  cur: number;
  delta: number;
}

export interface RunDetail extends RunListItem {
  delta: { prevConversations: number; curConversations: number; rows: DeltaRow[] } | null;
  effectCheckMd: string | null;
  error: string | null;
  suggestions: SuggestionItem[];
}

export interface CompletedReportOption {
  id: number;
  title: string;
}

function eur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}
function fmtTs(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("de-DE", { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

export function VerbesserungWorkspace({
  initialRuns,
  completedReports,
  initialDirectives,
  directiveLimits,
  selfSnapshot,
}: {
  initialRuns: RunListItem[];
  completedReports: CompletedReportOption[];
  initialDirectives: DirectiveItem[];
  directiveLimits: DirectiveLimits;
  selfSnapshot: SelfSnapshotInfo;
}) {
  const [runs, setRuns] = React.useState<RunListItem[]>(initialRuns);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<RunDetail | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);

  const refreshList = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/improve");
      if (!res.ok) return;
      const data = (await res.json().catch(() => ({}))) as { runs?: RunListItem[] };
      if (Array.isArray(data.runs)) setRuns(data.runs);
    } catch {
      /* keep the last good list */
    }
  }, []);

  const loadDetail = React.useCallback(async (id: number) => {
    setDetailError(null);
    try {
      const res = await fetch(`/api/admin/improve/${id}`);
      const data = (await res.json().catch(() => ({}))) as {
        run?: RunDetail;
        error?: { message?: string };
      };
      if (!res.ok || !data.run) {
        setDetail(null);
        setDetailError(data.error?.message ?? "Lauf konnte nicht geladen werden.");
        return;
      }
      setDetail(data.run);
    } catch {
      setDetail(null);
      setDetailError("Netzwerkfehler — bitte erneut versuchen.");
    }
  }, []);

  const select = React.useCallback(
    (id: number) => {
      setSelectedId(id);
      setDetail(null);
      loadDetail(id);
    },
    [loadDetail]
  );

  const goNew = React.useCallback(() => {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  const onRunDone = React.useCallback(() => {
    refreshList();
    if (selectedId != null) loadDetail(selectedId);
  }, [refreshList, loadDetail, selectedId]);

  const onSuggestionChanged = React.useCallback(
    (updated: SuggestionItem) => {
      setDetail((d) =>
        d
          ? { ...d, suggestions: d.suggestions.map((s) => (s.id === updated.id ? updated : s)) }
          : d
      );
    },
    []
  );

  let main: React.ReactNode;
  if (selectedId === null) {
    main = (
      <NewRunPanel
        completedReports={completedReports}
        hasRuns={runs.length > 0}
        onCreated={(id) => {
          refreshList();
          select(id);
        }}
      />
    );
  } else if (detailError) {
    main = (
      <Card>
        <CardContent className="space-y-2 p-5 text-sm">
          <div className="flex items-center gap-2 font-semibold text-destructive">
            <AlertTriangle className="size-4" />
            {detailError}
          </div>
          <Button size="sm" variant="outline" onClick={() => loadDetail(selectedId)}>
            Erneut laden
          </Button>
        </CardContent>
      </Card>
    );
  } else if (detail && detail.id === selectedId) {
    main = (
      <RunView
        key={detail.id}
        detail={detail}
        onDone={onRunDone}
        onDeleted={() => {
          refreshList();
          goNew();
        }}
        onSuggestionChanged={onSuggestionChanged}
      />
    );
  } else {
    main = (
      <Card>
        <CardContent className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Lauf wird geladen…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="w-full shrink-0 md:w-72">
        <RunSidebar runs={runs} activeId={selectedId} onSelect={select} onNew={goNew} />
      </aside>
      <main className="min-w-0 flex-1 space-y-6">
        {main}
        <DirectivesCard initialDirectives={initialDirectives} limits={directiveLimits} />
        <SelfSnapshotCard info={selfSnapshot} />
      </main>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function RunSidebar({
  runs,
  activeId,
  onSelect,
  onNew,
}: {
  runs: RunListItem[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
}) {
  return (
    <nav className="space-y-2" aria-label="Verbesserungsläufe">
      <button
        type="button"
        onClick={onNew}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-semibold transition-colors",
          activeId === null
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border bg-card text-foreground hover:bg-secondary"
        )}
      >
        <Plus className="size-4" />
        Neuer Verbesserungslauf
      </button>

      <div className="px-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Läufe ({runs.length})
      </div>

      {runs.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          Noch keine Läufe. Starte oben deinen ersten Verbesserungslauf über eine fertige
          Komplettanalyse.
        </p>
      ) : (
        <ul className="space-y-1">
          {runs.map((r) => {
            const active = activeId === r.id;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onSelect(r.id)}
                  className={cn(
                    "block w-full rounded-md border px-3 py-2 text-left transition-colors",
                    active
                      ? "border-accent/40 bg-accent/10"
                      : "border-border bg-card hover:bg-secondary"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-foreground">
                      <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{r.reportTitle}</span>
                    </span>
                    {r.status === "running" ? (
                      <Badge variant="info" className="gap-1">
                        <Loader2 className="size-3 animate-spin" />
                        läuft
                      </Badge>
                    ) : r.status === "failed" ? (
                      <Badge variant="destructive">Fehler</Badge>
                    ) : (
                      <Badge variant="success">fertig</Badge>
                    )}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{fmtDate(r.createdAt)}</span>
                    {r.status === "complete" && (
                      <span>{r.suggestionCount} Vorschläge</span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}

// ── New-run panel ─────────────────────────────────────────────────────────────

function NewRunPanel({
  completedReports,
  hasRuns,
  onCreated,
}: {
  completedReports: CompletedReportOption[];
  hasRuns: boolean;
  onCreated: (id: number) => void;
}) {
  const [reportId, setReportId] = React.useState<string>(
    completedReports.length > 0 ? String(completedReports[0].id) : ""
  );
  const [busy, setBusy] = React.useState(false);

  const start = React.useCallback(async () => {
    const id = Number(reportId);
    if (!Number.isInteger(id) || id <= 0 || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/improve/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: number;
        error?: { message?: string };
      };
      if (!res.ok || !data.id) {
        toast({
          variant: "error",
          title: "Lauf konnte nicht gestartet werden",
          description: data.error?.message ?? "Unbekannter Fehler.",
        });
        return;
      }
      onCreated(data.id);
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
    } finally {
      setBusy(false);
    }
  }, [reportId, busy, onCreated]);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Sparkles className="size-4 text-accent" />
            Neuer Verbesserungslauf
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Mo liest eine fertige Komplettanalyse zusammen mit seiner eigenen aktuellen
            Konfiguration (System-Prompt, Wissen, Anweisungen) und erarbeitet daraus konkrete,
            belegte Verbesserungsvorschläge — für den Online-Shop und für sich selbst.
            {hasRuns &&
              " Da es bereits Läufe gibt, prüft er zuerst ehrlich, ob die zuletzt beschlossenen Maßnahmen laut Kennzahlen wirken (Wirkungs-Check)."}
          </p>
        </div>

        {completedReports.length === 0 ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm text-warning">
            Noch keine fertige Komplettanalyse vorhanden — bitte zuerst im Tab „Analyse“ eine
            Komplettanalyse erstellen.
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground" htmlFor="vb-report">
                Grundlage (fertige Komplettanalyse)
              </label>
              <Select
                id="vb-report"
                value={reportId}
                onChange={(e) => setReportId(e.target.value)}
              >
                {completedReports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                1–2 Modell-Aufrufe (Sonnet) · typischerweise deutlich unter 0,50 €. Es wird
                nichts automatisch geändert — jeder Vorschlag wartet auf deine Entscheidung.
              </p>
              <Button onClick={start} disabled={busy || !reportId}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Lauf starten
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Run view (running / failed / complete) ────────────────────────────────────

function RunView({
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
  const metaBits = [
    `${fmtDate(detail.rangeFrom)} – ${fmtDate(detail.rangeTo)}`,
    `erstellt ${fmtTs(detail.createdAt)}`,
    detail.costEur > 0 ? `KI-Kosten ~${eur(detail.costEur)}` : null,
    `Prompt-Version ${detail.promptHash.slice(0, 12)}`,
  ].filter(Boolean);

  const moSuggestions = detail.suggestions.filter((s) => s.lane === "mo");
  const shopSuggestions = detail.suggestions.filter((s) => s.lane === "shop");

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Verbesserungslauf · {detail.reportTitle}
            </h2>
            {detail.status === "running" && <Badge variant="info">läuft</Badge>}
            {detail.status === "failed" && <Badge variant="destructive">Fehler</Badge>}
            {detail.status === "complete" && <Badge variant="success">fertig</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{metaBits.join(" · ")}</p>
        </div>
        <DeleteRunButton id={detail.id} onDeleted={onDeleted} />
      </header>

      {detail.status === "running" && <RunDriver id={detail.id} phase={detail.phase} onDone={onDone} />}

      {detail.status === "failed" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-semibold">Lauf fehlgeschlagen</p>
          {detail.error && <p className="mt-1 text-[13px]">{detail.error}</p>}
          <p className="mt-1 text-[12px]">Bitte den Lauf löschen und neu starten.</p>
        </div>
      )}

      {detail.status === "complete" && (
        <>
          {(detail.delta || detail.effectCheckMd) && (
            <Card>
              <CardContent className="space-y-3 p-5">
                <h3 className="text-sm font-semibold text-foreground">
                  Wirkungs-Check — was haben die bisherigen Maßnahmen bewirkt?
                </h3>
                {detail.delta && detail.delta.rows.length > 0 && (
                  <DeltaTable delta={detail.delta} />
                )}
                {detail.effectCheckMd ? (
                  <Markdown content={detail.effectCheckMd} className="text-[13px]" />
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    Kein Wirkungs-Check in diesem Lauf — es gab noch keine angenommenen oder
                    umgesetzten Maßnahmen aus früheren Läufen.
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Kennzahlen sind Quoten je Gespräch im jeweiligen Analysezeitraum. Bewegungen
                  zeigen Korrelation, keine bewiesene Ursache.
                </p>
              </CardContent>
            </Card>
          )}

          {detail.suggestions.length === 0 ? (
            <Card>
              <CardContent className="p-5 text-sm text-muted-foreground">
                Keine neuen Vorschläge — alles bereits Vorgeschlagene ist noch offen oder
                umgesetzt. Der nächste Lauf über einen neuen Zeitraum bringt neue Evidenz.
              </CardContent>
            </Card>
          ) : (
            <>
              <SuggestionGroup
                heading={`Vorschläge für Mo selbst (${moSuggestions.length})`}
                items={moSuggestions}
                onChanged={onSuggestionChanged}
              />
              <SuggestionGroup
                heading={`Vorschläge für den Online-Shop (${shopSuggestions.length})`}
                items={shopSuggestions}
                onChanged={onSuggestionChanged}
              />
            </>
          )}

          <p className="text-[11px] text-muted-foreground">
            Mo passt sein Verhalten nie automatisch an: Jeder Vorschlag wird erst wirksam, wenn
            du ihn hier annimmst bzw. als Anweisung übernimmst oder die Änderung selbst umsetzt.
            Der Status fließt in den Wirkungs-Check des nächsten Laufs ein.
          </p>
        </>
      )}
    </div>
  );
}

function SuggestionGroup({
  heading,
  items,
  onChanged,
}: {
  heading: string;
  items: SuggestionItem[];
  onChanged: (s: SuggestionItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
      {items.map((s) => (
        <SuggestionCard key={s.id} suggestion={s} onChanged={onChanged} />
      ))}
    </section>
  );
}

function DeltaTable({
  delta,
}: {
  delta: NonNullable<RunDetail["delta"]>;
}) {
  const fmt = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 pr-3 font-medium">Kennzahl</th>
            <th className="py-1.5 pr-3 font-medium">vorher</th>
            <th className="py-1.5 pr-3 font-medium">jetzt</th>
            <th className="py-1.5 font-medium">Δ</th>
          </tr>
        </thead>
        <tbody>
          {delta.rows.map((r) => (
            <tr key={r.key} className="border-b border-border/50">
              <td className="py-1.5 pr-3 text-foreground">{r.label}</td>
              <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{fmt(r.prev)}</td>
              <td className="py-1.5 pr-3 tabular-nums text-foreground">{fmt(r.cur)}</td>
              <td
                className={cn(
                  "py-1.5 tabular-nums font-medium",
                  r.delta > 0 ? "text-success" : r.delta < 0 ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {r.delta > 0 ? "+" : ""}
                {r.delta.toLocaleString("de-DE", { maximumFractionDigits: 1 })} pp
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Basis: {delta.prevConversations} Gespräche (voriger Lauf) vs. {delta.curConversations}{" "}
        Gespräche (dieser Lauf).
      </p>
    </div>
  );
}

// ── Driver: steps a running run to completion ────────────────────────────────

function RunDriver({
  id,
  phase: initialPhase,
  onDone,
}: {
  id: number;
  phase: string;
  onDone: () => void;
}) {
  const [phase, setPhase] = React.useState(initialPhase);
  const [error, setError] = React.useState<string | null>(null);
  const runningRef = React.useRef(false);
  const onDoneRef = React.useRef(onDone);
  React.useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const runLoop = React.useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);
    try {
      for (;;) {
        const res = await fetch("/api/admin/improve/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          phase?: string;
          done?: boolean;
          error?: string | { message?: string };
        };
        if (!res.ok) {
          const msg =
            typeof data.error === "object" && data.error?.message
              ? data.error.message
              : "Schritt fehlgeschlagen.";
          setError(msg);
          return;
        }
        if (typeof data.phase === "string") setPhase(data.phase);
        if (data.done) {
          onDoneRef.current();
          return;
        }
      }
    } catch {
      setError("Netzwerkfehler — bitte erneut versuchen.");
    } finally {
      runningRef.current = false;
    }
  }, [id]);

  React.useEffect(() => {
    runLoop();
  }, [runLoop]);

  const label =
    (RUN_PHASE_LABELS as Record<string, string>)[phase] ?? "Wird verarbeitet…";

  return (
    <Card>
      <CardContent className="space-y-2 p-5 text-sm">
        {error ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-semibold text-destructive">
              <AlertTriangle className="size-4" />
              {error}
            </div>
            <Button size="sm" variant="outline" onClick={runLoop}>
              <RefreshCcw className="size-3.5" />
              Fortsetzen
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-foreground">
            <Loader2 className="size-4 animate-spin text-accent" />
            {label}…
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Ein bis zwei Modell-Aufrufe — das kann bis zu ein-zwei Minuten dauern.
        </p>
      </CardContent>
    </Card>
  );
}

function DeleteRunButton({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const del = React.useCallback(async () => {
    if (busy) return;
    if (!window.confirm("Diesen Verbesserungslauf samt Vorschlägen löschen?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/improve/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        toast({ variant: "error", title: "Löschen fehlgeschlagen" });
        return;
      }
      onDeleted();
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
    } finally {
      setBusy(false);
    }
  }, [id, busy, onDeleted]);

  return (
    <Button size="sm" variant="outline" onClick={del} disabled={busy}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      Löschen
    </Button>
  );
}
