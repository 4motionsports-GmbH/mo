"use client";

// The Analyse tab's self-contained workspace: a master–detail island that owns
// the stored-report side panel + the selected report, WITHOUT routing or a heavy
// /admin re-render. The initial list is seeded from the server; the workspace then
// fetches a report's detail on selection and refreshes the list after a report is
// created / completed / deleted — all via the lightweight GET endpoints.

import * as React from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent, Badge, Button } from "../ui";
import { germanDate } from "@/lib/kpi-range.mjs";
import { ReportSidebar, type SidebarReport } from "./ReportSidebar";
import { GenerateReportPanel } from "./GenerateReportPanel";
import { ReportProgressDriver } from "./ReportProgressDriver";
import { ReportActions } from "./ReportActions";
import { ReportView } from "./ReportView";
import type { AnalyticsReportDetail } from "@/lib/analytics-report-store";

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

function toSidebar(r: {
  id: number;
  title: string;
  from: string;
  to: string;
  status: SidebarReport["status"];
  costEur: number;
  createdAt: string;
}): SidebarReport {
  return {
    id: r.id,
    title: r.title,
    from: r.from,
    to: r.to,
    status: r.status,
    costEur: r.costEur,
    createdAt: r.createdAt,
  };
}

export function AnalyseWorkspace({ initialReports }: { initialReports: SidebarReport[] }) {
  const [reports, setReports] = React.useState<SidebarReport[]>(initialReports);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [detail, setDetail] = React.useState<AnalyticsReportDetail | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);

  const refreshList = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/analytics");
      if (!res.ok) return;
      const data = (await res.json().catch(() => ({}))) as { reports?: SidebarReport[] };
      if (Array.isArray(data.reports)) setReports(data.reports.map(toSidebar));
    } catch {
      /* keep the last good list */
    }
  }, []);

  const loadDetail = React.useCallback(async (id: number) => {
    setDetailError(null);
    try {
      const res = await fetch(`/api/admin/analytics/${id}`);
      const data = (await res.json().catch(() => ({}))) as {
        report?: AnalyticsReportDetail;
        error?: { message?: string };
      };
      if (!res.ok || !data.report) {
        setDetail(null);
        setDetailError(data.error?.message ?? "Report konnte nicht geladen werden.");
        return;
      }
      setDetail(data.report);
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

  const onCreated = React.useCallback(
    (id: number) => {
      refreshList();
      select(id);
    },
    [refreshList, select]
  );

  const onDone = React.useCallback(() => {
    refreshList();
    if (selectedId != null) loadDetail(selectedId);
  }, [refreshList, loadDetail, selectedId]);

  const onDeleted = React.useCallback(() => {
    refreshList();
    goNew();
  }, [refreshList, goNew]);

  let main: React.ReactNode;
  if (selectedId === null) {
    main = <GenerateReportPanel onCreated={onCreated} />;
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
      <SelectedReport key={detail.id} detail={detail} onDone={onDone} onDeleted={onDeleted} />
    );
  } else {
    main = (
      <Card>
        <CardContent className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Bericht wird geladen…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="w-full shrink-0 md:w-72">
        <ReportSidebar reports={reports} activeId={selectedId} onSelect={select} onNew={goNew} />
      </aside>
      <main className="min-w-0 flex-1">{main}</main>
    </div>
  );
}

function SelectedReport({
  detail,
  onDone,
  onDeleted,
}: {
  detail: AnalyticsReportDetail;
  onDone: () => void;
  onDeleted: () => void;
}) {
  const label =
    detail.from === detail.to
      ? germanDate(detail.from)
      : `${germanDate(detail.from)} – ${germanDate(detail.to)}`;

  const metaBits = [
    label,
    `erstellt ${fmtTs(detail.createdAt)}`,
    detail.status === "complete" && detail.completedAt ? `fertig ${fmtTs(detail.completedAt)}` : null,
    detail.costEur > 0 ? `KI-Kosten ~${eur(detail.costEur)}` : null,
    detail.options.includePerCustomer ? "inkl. Kundenprofile" : null,
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{detail.title}</h2>
            {detail.status === "running" && <Badge variant="info">läuft</Badge>}
            {detail.status === "failed" && <Badge variant="destructive">Fehler</Badge>}
            {detail.status === "complete" && <Badge variant="success">fertig</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{metaBits.join(" · ")}</p>
        </div>
        <ReportActions
          id={detail.id}
          canDownload={detail.status === "complete"}
          onDeleted={onDeleted}
        />
      </header>

      {detail.status === "running" && (
        <ReportProgressDriver
          id={detail.id}
          title={detail.title}
          initialPhase={detail.phase}
          initialCostEur={detail.costEur}
          initialProgress={{
            analyzed: detail.progress.analyzed,
            analyzeRemaining: detail.progress.analyzeRemaining,
            analyzeFailed: detail.progress.analyzeFailed,
            personasTotal: detail.progress.personasTotal,
            personasDone: detail.progress.personasDone,
            profilesTotal: detail.progress.profilesTotal,
            profilesDone: detail.progress.profilesDone,
            profilesFailed: detail.progress.profilesFailed,
          }}
          options={{ includePerCustomer: detail.options.includePerCustomer }}
          onDone={onDone}
        />
      )}

      {detail.status === "failed" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-semibold">Erstellung fehlgeschlagen</p>
          {detail.error && <p className="mt-1 text-[13px]">{detail.error}</p>}
          <p className="mt-1 text-[12px]">Bitte den Bericht löschen und neu erstellen.</p>
        </div>
      )}

      {detail.status === "complete" && detail.sections && <ReportView sections={detail.sections} />}
    </div>
  );
}
