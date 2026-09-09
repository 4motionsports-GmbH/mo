"use client";

// Drives a 'running' report to completion (useStepLoop over POST
// /api/admin/analytics/step). Shows the live phase checklist, per-phase
// counters and the cost so far; can be paused (the report stays resumable
// server-side) and survives dropped connections.

import * as React from "react";
import { Loader2, Check, Circle, Pause, Play, AlertTriangle } from "lucide-react";
import { PHASE_LABELS, phasesFor, phaseIndex } from "@/lib/analytics-report-core.mjs";
import { eur, num } from "@/lib/admin-format.mjs";
import { Button, Callout, Card, CardContent, InfoTip, cn } from "../ui";
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

  const loop = useStepLoop<StepResponse>({
    path: "/api/admin/analytics/step",
    body: { id },
    onStep: (data) => {
      if (data.phase) setPhase(data.phase);
      if (data.progress) setProgress((p) => ({ ...p, ...data.progress }));
      if (typeof data.costEur === "number") setCostEur(data.costEur);
    },
    isDone: (data) => Boolean(data.done),
    onDone,
  });

  const phases = (phasesFor(options) as string[]).filter((p) => p !== "done");
  const activeIdx = phaseIndex(phase, options);
  const labels = PHASE_LABELS as Record<string, string>;

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
                Du kannst diese Seite geöffnet lassen — der Bericht wird Schritt für Schritt erstellt
                und links im Seitenpanel gespeichert. Pausieren ist jederzeit möglich; die Analyse
                läuft beim Fortsetzen weiter. Kurze Verbindungsabbrüche überbrückt die Seite
                automatisch.
              </InfoTip>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {title}
              {loop.reconnecting && " · Verbindung unterbrochen — es wird automatisch weiter versucht"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">KI-Kosten bisher: ~{eur(costEur)}</span>
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

        <ol className="flex flex-col gap-1.5">
          {phases.map((p, i) => {
            const done = activeIdx > i;
            const active = activeIdx === i;
            return (
              <li
                key={p}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  active ? "font-semibold text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/60"
                )}
              >
                {done ? (
                  <Check className="size-4 text-success" aria-hidden />
                ) : active ? (
                  <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
                ) : (
                  <Circle className="size-3.5" aria-hidden />
                )}
                <span>{labels[p] ?? p}</span>
                {active && p === "analyze" && (
                  <span className="text-2xs text-muted-foreground">
                    ({num(progress.analyzed)} analysiert
                    {progress.analyzeRemaining > 0 ? `, noch ${num(progress.analyzeRemaining)}` : ""}
                    {progress.analyzeFailed > 0 ? `, ${num(progress.analyzeFailed)} Fehler` : ""})
                  </span>
                )}
                {active && p === "personas" && progress.personasTotal > 0 && (
                  <span className="text-2xs text-muted-foreground">
                    ({num(progress.personasDone)}/{num(progress.personasTotal)})
                  </span>
                )}
                {active && p === "customer_profiles" && progress.profilesTotal > 0 && (
                  <span className="text-2xs text-muted-foreground">
                    ({num(progress.profilesDone)}/{num(progress.profilesTotal)}
                    {progress.profilesFailed > 0 ? `, ${num(progress.profilesFailed)} Fehler` : ""})
                  </span>
                )}
              </li>
            );
          })}
        </ol>

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
