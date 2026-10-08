"use client";

// Drives a 'running' report to completion (useStepLoop over POST
// /api/admin/analytics/step). Shows an overall progress bar, the live phase
// checklist with per-phase counters, the elapsed time of the current phase
// (the two strategist phases are one Opus call of several minutes each) and
// the cost so far; can be paused (the report stays resumable server-side),
// survives dropped connections and waits ("busy") while a step the server is
// still working on finishes.

import * as React from "react";
import { Loader2, Check, Circle, Pause, Play, AlertTriangle, Brain } from "lucide-react";
import { PHASE_LABELS, STRATEGIST_PHASES, phasesFor, phaseIndex } from "@/lib/analytics-report-core.mjs";
import { eur, num } from "@/lib/admin-format.mjs";
import { Button, Callout, Card, CardContent, InfoTip, ProgressBar, cn } from "../ui";
import { useStepLoop } from "../lib/use-step-loop";

interface DriverProgress {
  analyzed: number;
  analyzeRemaining: number;
  analyzeFailed: number;
  personasTotal: number;
  personasDone: number;
  profilesTotal: number;
  profilesDone: number;
  profilesFailed: number;
}

interface StepResponse {
  status?: string;
  phase?: string;
  progress?: Partial<DriverProgress>;
  costEur?: number;
  done?: boolean;
  busy?: boolean;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Seconds since `since` (re-rendered every second while `active`). */
function useElapsed(since: number, active: boolean): number {
  const [now, setNow] = React.useState(since);
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return Math.max(0, now - since);
}

export function ReportProgressDriver({
  id,
  title,
  initialPhase,
  initialProgress,
  initialCostEur,
  options,
  onDone,
}: {
  id: number;
  title: string;
  initialPhase: string;
  initialProgress: DriverProgress;
  initialCostEur: number;
  options: { includePerCustomer: boolean };
  /** Called once the report reaches a terminal state, so the workspace can
   *  reload the finished report + refresh the sidebar. */
  onDone: () => void;
}) {
  const [phase, setPhase] = React.useState(initialPhase);
  const [progress, setProgress] = React.useState<DriverProgress>(initialProgress);
  const [costEur, setCostEur] = React.useState(initialCostEur);
  const [busy, setBusy] = React.useState(false);
  const [phaseStartedAt, setPhaseStartedAt] = React.useState(() => Date.now());
  const phaseRef = React.useRef(initialPhase);

  const loop = useStepLoop<StepResponse>({
    path: "/api/admin/analytics/step",
    body: { id },
    onStep: (data) => {
      if (data.phase && data.phase !== phaseRef.current) {
        phaseRef.current = data.phase;
        setPhase(data.phase);
        setPhaseStartedAt(Date.now());
      }
      if (data.progress) setProgress((p) => ({ ...p, ...data.progress }));
      if (typeof data.costEur === "number") setCostEur(data.costEur);
      setBusy(Boolean(data.busy));
    },
    isDone: (data) => Boolean(data.done),
    isBusy: (data) => Boolean(data.busy),
    resumable: true,
    onDone,
  });

  const phases = (phasesFor(options) as string[]).filter((p) => p !== "done");
  const activeIdx = phaseIndex(phase, options);
  const labels = PHASE_LABELS as Record<string, string>;
  const running = !loop.error && !loop.paused;
  const strategist = (STRATEGIST_PHASES as readonly string[]).includes(phase);
  const elapsed = useElapsed(phaseStartedAt, running);
  // Overall progress: finished phases, plus the share of the analysis phase.
  const analyzeShare =
    phase === "analyze" && progress.analyzed + progress.analyzeRemaining > 0
      ? progress.analyzed / (progress.analyzed + progress.analyzeRemaining)
      : 0;
  const overall = phases.length > 0 ? ((Math.max(0, activeIdx) + analyzeShare) / phases.length) * 100 : 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {loop.error ? (
                <AlertTriangle className="size-4 text-destructive" aria-hidden />
              ) : loop.paused ? (
                <Pause className="size-4 text-muted-foreground" aria-hidden />
              ) : (
                <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
              )}
              {loop.error ? "Gestoppt" : loop.paused ? "Pausiert" : "Komplettanalyse wird erstellt…"}
              <InfoTip>
                Lass diesen Bericht geöffnet — er wird Schritt für Schritt erstellt und links im
                Seitenpanel gespeichert. Pausieren ist jederzeit möglich; beim Fortsetzen (oder beim
                nächsten Öffnen des Berichts) geht es an derselben Stelle weiter. Kurze
                Verbindungsabbrüche und Zeitüberschreitungen des Servers überbrückt die Seite
                automatisch; läuft auf dem Server noch ein Schritt, wartet sie darauf, statt ihn doppelt
                zu starten.
              </InfoTip>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {title}
              {running && loop.reconnecting && " · Server nicht erreichbar — es wird automatisch weiter versucht"}
              {running && busy && !loop.reconnecting && " · ein Schritt läuft noch auf dem Server — wird abgewartet"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">KI-Kosten bisher: ~{eur(costEur)}</span>
            {!loop.error &&
              (loop.paused ? (
                <Button size="sm" variant="outline" onClick={loop.resume}>
                  <Play /> Fortsetzen
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={loop.pause}>
                  <Pause /> Pause
                </Button>
              ))}
          </div>
        </div>

        <ProgressBar value={overall} label="Fortschritt der Komplettanalyse" />

        <ol className="flex flex-col gap-1.5">
          {phases.map((p, i) => {
            const done = activeIdx > i;
            const active = activeIdx === i;
            return (
              <li
                key={p}
                className={cn(
                  "flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm",
                  active ? "font-semibold text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/60"
                )}
              >
                {done ? (
                  <Check className="size-4 text-success" aria-hidden />
                ) : active ? (
                  <Loader2 className={cn("size-4 text-accent", running && "animate-spin")} aria-hidden />
                ) : (
                  <Circle className="size-3.5" aria-hidden />
                )}
                <span>{labels[p] ?? p}</span>
                {(STRATEGIST_PHASES as readonly string[]).includes(p) && (
                  <span className="rounded bg-accent-soft px-1 text-2xs font-medium text-accent">Opus 5.5</span>
                )}
                {active && p === "analyze" && (
                  <span className="text-2xs font-normal text-muted-foreground">
                    ({num(progress.analyzed)} analysiert
                    {progress.analyzeRemaining > 0 ? `, noch ${num(progress.analyzeRemaining)}` : ""}
                    {progress.analyzeFailed > 0 ? `, ${num(progress.analyzeFailed)} Fehler` : ""})
                  </span>
                )}
                {active && p === "personas" && progress.personasTotal > 0 && (
                  <span className="text-2xs font-normal text-muted-foreground">
                    ({num(progress.personasDone)}/{num(progress.personasTotal)})
                  </span>
                )}
                {active && p === "customer_profiles" && progress.profilesTotal > 0 && (
                  <span className="text-2xs font-normal text-muted-foreground">
                    ({num(progress.profilesDone)}/{num(progress.profilesTotal)}
                    {progress.profilesFailed > 0 ? `, ${num(progress.profilesFailed)} Fehler` : ""})
                  </span>
                )}
                {active && running && (
                  <span className="text-2xs font-normal tabular-nums text-muted-foreground">{mmss(elapsed)}</span>
                )}
              </li>
            );
          })}
        </ol>

        {strategist && running && (
          <Callout tone="info" compact icon={<Brain className="size-4" />}>
            Das Strategie-Modell liest die Geschäftsdaten und denkt gründlich nach — ein Durchgang dauert
            meist 1–4 Minuten. Überschreitet er das Zeitlimit, wird er automatisch mit etwas weniger
            Denktiefe wiederholt.
          </Callout>
        )}

        {loop.error && (
          <Callout
            tone="destructive"
            title="Erstellung gestoppt"
            action={
              <Button size="xs" variant="outline" onClick={loop.resume}>
                <Play /> Erneut versuchen
              </Button>
            }
          >
            {loop.error}
          </Callout>
        )}
      </CardContent>
    </Card>
  );
}
