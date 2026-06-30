"use client";

// Drives a 'running' report to completion. On mount it steps the server
// generator sequentially (POST /step) until `done`, then refreshes so the server
// re-renders the finished report. Shows the live phase, per-phase counters and
// the cost so far, and can be paused (the report stays resumable server-side).

import * as React from "react";
import { Loader2, Check, Circle, Pause, Play, AlertTriangle } from "lucide-react";
import { Button, Card, CardContent } from "../ui";
import { cn } from "../ui/cn";
import { PHASE_LABELS, phasesFor, phaseIndex } from "@/lib/analytics-report-core.mjs";

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
  error?: string | { message?: string };
}

function eur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
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
  const [error, setError] = React.useState<string | null>(null);
  const [paused, setPaused] = React.useState(false);

  const pausedRef = React.useRef(false);
  const runningRef = React.useRef(false);
  // Keep the latest onDone without making it a runLoop dependency, so a parent
  // re-render passing a fresh callback identity never restarts the stepping loop.
  const onDoneRef = React.useRef(onDone);
  React.useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const runLoop = React.useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setError(null);
    try {
      while (!pausedRef.current) {
        const res = await fetch("/api/admin/analytics/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = (await res.json().catch(() => ({}))) as StepResponse;
        if (!res.ok) {
          // Transient (network / 5xx): the report is still 'running' server-side,
          // so the inline "Erneut versuchen" resumes from where it stopped.
          const msg = typeof data.error === "object" ? data.error?.message : data.error;
          setError(msg ?? "Ein Schritt ist fehlgeschlagen.");
          break;
        }
        if (data.phase) setPhase(data.phase);
        if (data.progress) setProgress((p) => ({ ...p, ...data.progress }));
        if (typeof data.costEur === "number") setCostEur(data.costEur);
        if (data.done) {
          // Terminal (complete OR failed): hand back to the workspace to reload
          // the finished report + refresh the sidebar.
          onDoneRef.current();
          break;
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, [id]);

  // Auto-start on mount; stop stepping if the component unmounts.
  React.useEffect(() => {
    pausedRef.current = false;
    runLoop();
    return () => {
      pausedRef.current = true;
    };
  }, [runLoop]);

  const phases = phasesFor(options) as string[];
  const activeIdx = phaseIndex(phase, options);
  const labels = PHASE_LABELS as Record<string, string>;

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {error ? (
                <AlertTriangle className="size-4 text-destructive" />
              ) : paused ? (
                <Pause className="size-4 text-muted-foreground" />
              ) : (
                <Loader2 className="size-4 animate-spin text-accent" />
              )}
              {error ? "Gestoppt" : paused ? "Pausiert" : "Komplettanalyse wird erstellt…"}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{title}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted-foreground">
              KI-Kosten bisher: ~{eur(costEur)}
            </span>
            {!error &&
              (paused ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPaused(false);
                    pausedRef.current = false;
                    runLoop();
                  }}
                >
                  <Play /> Fortsetzen
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPaused(true);
                    pausedRef.current = true;
                  }}
                >
                  <Pause /> Pause
                </Button>
              ))}
          </div>
        </div>

        {/* Phase checklist */}
        <ol className="space-y-1.5">
          {phases
            .filter((p) => p !== "done")
            .map((p, i) => {
              const done = activeIdx > i;
              const active = activeIdx === i;
              return (
                <li
                  key={p}
                  className={cn(
                    "flex items-center gap-2 text-[13px]",
                    active ? "font-semibold text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/60"
                  )}
                >
                  {done ? (
                    <Check className="size-4 text-success" />
                  ) : active ? (
                    <Loader2 className="size-4 animate-spin text-accent" />
                  ) : (
                    <Circle className="size-3.5" />
                  )}
                  <span>{labels[p] ?? p}</span>
                  {active && p === "analyze" && (
                    <span className="text-[11px] text-muted-foreground">
                      ({progress.analyzed} analysiert
                      {progress.analyzeRemaining > 0 ? `, noch ${progress.analyzeRemaining}` : ""}
                      {progress.analyzeFailed > 0 ? `, ${progress.analyzeFailed} Fehler` : ""})
                    </span>
                  )}
                  {active && p === "personas" && progress.personasTotal > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      ({progress.personasDone}/{progress.personasTotal})
                    </span>
                  )}
                  {active && p === "customer_profiles" && progress.profilesTotal > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      ({progress.profilesDone}/{progress.profilesTotal}
                      {progress.profilesFailed > 0 ? `, ${progress.profilesFailed} Fehler` : ""})
                    </span>
                  )}
                </li>
              );
            })}
        </ol>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[12px] text-destructive">
            <p className="font-semibold">Erstellung gestoppt</p>
            <p className="mt-0.5">{error}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                setPaused(false);
                pausedRef.current = false;
                runLoop();
              }}
            >
              <Play /> Erneut versuchen
            </Button>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Du kannst diese Seite geöffnet lassen — der Bericht wird Schritt für Schritt erstellt und
          links im Seitenpanel gespeichert. Pausieren ist jederzeit möglich; die Analyse läuft beim
          Fortsetzen weiter.
        </p>
      </CardContent>
    </Card>
  );
}
