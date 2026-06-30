"use client";

// The "side panel" of stored Komplettanalysen, inside the Analyse tab. Each
// generated report is selectable here and shown in the main area; the active one
// is highlighted. Selection is in-tab client state (no route navigation), so
// switching reports is instant. "Neue Komplettanalyse" returns to the generator.

import * as React from "react";
import { Loader2, Plus, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "../ui/cn";
import { Badge } from "../ui";

export interface SidebarReport {
  id: number;
  title: string;
  from: string;
  to: string;
  status: "running" | "complete" | "failed";
  costEur: number;
  createdAt: string;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("de-DE", { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function StatusPill({ status }: { status: SidebarReport["status"] }) {
  if (status === "running") {
    return (
      <Badge variant="info" className="gap-1">
        <Loader2 className="size-3 animate-spin" />
        läuft
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="size-3" />
        Fehler
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="gap-1">
      <CheckCircle2 className="size-3" />
      fertig
    </Badge>
  );
}

export function ReportSidebar({
  reports,
  activeId,
  onSelect,
  onNew,
}: {
  reports: SidebarReport[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
}) {
  const onGenerator = activeId === null;

  return (
    <nav className="space-y-2" aria-label="Gespeicherte Analysen">
      <button
        type="button"
        onClick={onNew}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-semibold transition-colors",
          onGenerator
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border bg-card text-foreground hover:bg-secondary"
        )}
      >
        <Plus className="size-4" />
        Neue Komplettanalyse
      </button>

      <div className="px-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Gespeichert ({reports.length})
      </div>

      {reports.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          Noch keine Analysen. Erstelle oben deine erste Komplettanalyse.
        </p>
      ) : (
        <ul className="space-y-1">
          {reports.map((r) => {
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
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{r.title}</span>
                    </span>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{fmtDate(r.createdAt)}</span>
                    {r.status === "complete" && r.costEur > 0 && (
                      <span className="tabular-nums">
                        ~
                        {r.costEur.toLocaleString("de-DE", {
                          style: "currency",
                          currency: "EUR",
                          maximumFractionDigits: 2,
                        })}
                      </span>
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
