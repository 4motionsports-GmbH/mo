"use client";

// The "side panel" of stored Komplettanalysen. Each generated report is a page;
// this lists them newest-first and highlights the active one (usePathname), with
// a status pill + spinner for in-progress reports. The "Neue Komplettanalyse"
// entry links to the generator (the section's base route).

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

export function ReportSidebar({ reports }: { reports: SidebarReport[] }) {
  const pathname = usePathname();
  const onGenerator = pathname === "/admin/analytics";

  return (
    <nav className="space-y-2" aria-label="Gespeicherte Analysen">
      <Link
        href="/admin/analytics"
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors",
          onGenerator
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border bg-card text-foreground hover:bg-secondary"
        )}
      >
        <Plus className="size-4" />
        Neue Komplettanalyse
      </Link>

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
            const active = pathname === `/admin/analytics/${r.id}`;
            return (
              <li key={r.id}>
                <Link
                  href={`/admin/analytics/${r.id}`}
                  className={cn(
                    "block rounded-md border px-3 py-2 transition-colors",
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
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
