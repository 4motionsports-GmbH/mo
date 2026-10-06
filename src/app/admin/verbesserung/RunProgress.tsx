"use client";

// Drives a running Verbesserungslauf to completion (useStepLoop over POST
// /api/admin/improve/step) and shows where it is: an overall progress bar,
// the phase checklist (the three strategist phases tagged „Opus 5.5“), the
// elapsed time of the current phase, the measurement counter, the attempt and
// thinking depth of a strategist pass (a timed-out pass is retried with less
// depth) and the cost so far. Pausable; dropped connections are bridged; a
// step still running on the server is waited for ("busy"), never doubled.

import * as React from "react";
import { AlertTriangle, Brain, Check, Circle, Loader2, Pause, Play, SkipForward } from "lucide-react";
import { RUN_PHASES, RUN_PHASE_LABELS, STRATEGIST_PHASES, runPhaseIndex } from "@/lib/improvement-core.mjs";
import { eur, num } from "@/lib/admin-format.mjs";
import { Button, Callout, Card, CardContent, InfoTip, ProgressBar, cn } from "../ui";
import { useStepLoop } from "../lib/use-step-loop";

interface StepProgress {
  measured: number;
  toMeasure: number | null;
  attempt: number;
  effort: "high" | "medium" | "low" | null;
  suggestions: number;
}

interface StepResponse {
  status?: string;
  phase?: string;
  costEur?: number;
  done?: boolean;
  busy?: boolean;
  progress?: StepProgress | null;
}

const EFFORT_NAMES: Record<string, string> = { high: "hoch", medium: "mittel", low: "niedrig" };
const PHASES = (RUN_PHASES as readonly string[]).filter((p) => p !== "done");

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Milliseconds since `since`, re-rendered every second while `active`. */
function useElapsed(since: number, active: boolean): number {
  const [now, setNow] = React.useState(since);
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return Math.max(0, now - since);
}

export function RunProgress({
  id,
  title,
  initialPhase,
  initialCostEur,
  onDone,
}: {
  id: number;
  title: string;
  initialPhase: string;
  initialCostEur: number;
  onDone: () => void;
}) {
  const [phase, setPhase] = React.useState(initialPhase);
  const [progress, setProgress] = React.useState<StepProgress | null>(null);
  const [costEur, setCostEur] = React.useState(initialCostEur);
  const [busy, setBusy] = React.useState(false);
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const [phaseStartedAt, setPhaseStartedAt] = React.useState(() => Date.now());
  const phaseRef = React.useRef(initialPhase);

  const loop = useStepLoop<StepResponse>({
    path: "/api/admin/improve/step",
    body: { id },
    onStep: (data) => {
      if (data.phase && data.phase !== phaseRef.current) {
        const from = runPhaseIndex(phaseRef.current);
        const to = runPhaseIndex(data.phase);
        if (from >= 0 && to > from + 1) setSkipped((s) => [...s, ...PHASES.slice(from + 1, to)]);
        phaseRef.current = data.phase;
        setPhase(data.phase);
        setPhaseStartedAt(Date.now());
      }
      if (data.progress) setProgress(data.progress);
      if (typeof data.costEur === "number") setCostEur(data.costEur);
      setBusy(Boolean(data.busy));
    },
    isDone: (data) => Boolean(data.done),
    isBusy: (data) => Boolean(data.busy),
    onDone,
  });

  const running = !loop.error && !loop.paused;
  const activeIdx = runPhaseIndex(phase);
  const strategist = (STRATEGIST_PHASES as readonly string[]).includes(phase);
  const elapsed = useElapsed(phaseStartedAt, running);
  const measureShare =
    phase === "messung" && progress?.toMeasure ? Math.min(1, progress.measured / progress.toMeasure) : 0;
  const overall = activeIdx >= 0 ? ((activeIdx + measureShare) / PHASES.length) * 100 : 0;
  const labels = RUN_PHASE_LABELS as Record<string, string>;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {loop.error ? (
                <AlertTriangle className="size-4 text-destructive" aria-hidden />
              ) : loop.paused ? (
                <Pause className="size-4 text-muted-foreground" aria-hidden />
              ) : (
                <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
              )}
              {loop.error ? "Gestoppt" : loop.paused ? "Pausiert" : "Verbesserungslauf wird erstellt…"}
              <InfoTip panelClassName="max-w-md">
                Lass den Lauf geöffnet — er wird Schritt für Schritt erstellt und links gespeichert. Zuerst die
                Geschäftsdaten und die Messung der umgesetzten Änderungen (ohne KI), dann bis zu drei
                Durchgänge des Strategie-Modells (Opus 5.5) von je 1–4 Minuten. Pausieren ist jederzeit möglich;
                beim Fortsetzen geht es an derselben Stelle weiter. Kurze Verbindungsabbrüche überbrückt die
                Seite; läuft auf dem Server noch ein Schritt, wartet sie darauf.
              </InfoTip>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {title}
              {loop.reconnecting && " · Verbindung unterbrochen — es wird automatisch weiter versucht"}
              {busy && !loop.reconnecting && " · ein Schritt läuft noch auf dem Server — wird abgewartet"}
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

        <ProgressBar value={overall} label="Fortschritt des Verbesserungslaufs" />

        <ol className="flex flex-col gap-1.5">
          {activeIdx < 0 && (
            <li className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Loader2 className={cn("size-4 text-accent", running && "animate-spin")} aria-hidden />
              {labels[phase] ?? "Wird vorbereitet"} — wird auf den neuen Ablauf umgestellt
            </li>
          )}
          {PHASES.map((p, i) => {
            const isSkipped = skipped.includes(p);
            const done = activeIdx > i && !isSkipped;
            const active = activeIdx === i;
            return (
              <li
                key={p}
                className={cn(
                  "flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm",
                  active ? "font-semibold text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/60"
                )}
              >
                {isSkipped ? (
                  <SkipForward className="size-4 text-muted-foreground/60" aria-hidden />
                ) : done ? (
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
                {isSkipped && <span className="text-2xs font-normal">übersprungen — nichts zu bewerten</span>}
                {active && p === "messung" && progress?.toMeasure != null && (
                  <span className="text-2xs font-normal text-muted-foreground">
                    ({num(progress.measured)} von {num(progress.toMeasure)} Änderungen gemessen)
                  </span>
                )}
                {active && strategist && progress && progress.attempt > 0 && progress.effort && (
                  <span className="text-2xs font-normal text-warning">
                    {num(progress.attempt + 1)}. Versuch · Denktiefe {EFFORT_NAMES[progress.effort] ?? progress.effort}
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
            Das Strategie-Modell liest die Geschäftsdaten, die Messung und den Backlog und denkt gründlich nach — ein
            Durchgang dauert meist 1–4 Minuten. Überschreitet er das Zeitlimit, wird er automatisch mit etwas weniger
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
