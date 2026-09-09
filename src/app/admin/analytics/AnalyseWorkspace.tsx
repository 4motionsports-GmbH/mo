"use client";

// The Analyse screen's workspace: a master–detail island that owns the
// stored-report rail + the selected report. The initial list is seeded from the
// server; the workspace fetches a report's detail on selection (kept in the
// URL as ?report=) and refreshes the list after a report is created /
// completed / deleted — all via the lightweight GET endpoints.

import * as React from "react";
import { FileText, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { AnalyticsReportDetail } from "@/lib/analytics-report-store";
import { germanDate } from "@/lib/kpi-range.mjs";
import { ADMIN_DATE_MEDIUM, ADMIN_DATE_TIME_MEDIUM, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, num } from "@/lib/admin-format.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  SidebarList,
  Skeleton,
  SplitPane,
  StatusBadge,
  type SidebarListItem,
} from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { GenerateReportPanel } from "./GenerateReportPanel";
import { ReportProgressDriver } from "./ReportProgressDriver";
import { ReportActions } from "./ReportActions";
import { ReportView } from "./ReportView";
import type { SidebarReport } from "./types";

function syncReportParam(id: number | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete("report");
  else url.searchParams.set("report", String(id));
  window.history.replaceState(window.history.state, "", url.toString());
}

export function ReportStatusBadge({ status }: { status: SidebarReport["status"] }) {
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

export function AnalyseWorkspace({
  initialReports,
  initialReportId,
}: {
  initialReports: SidebarReport[];
  initialReportId: number | null;
}) {
  const [reports, setReports] = React.useState<SidebarReport[]>(initialReports);
  const [selectedId, setSelectedId] = React.useState<number | null>(initialReportId);
  const [loaded, setLoaded] = React.useState<{
    id: number;
    detail: AnalyticsReportDetail | null;
    error: string | null;
  } | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  const refreshList = React.useCallback(async () => {
    try {
      const data = await adminFetch<{ reports?: SidebarReport[] }>("/api/admin/analytics");
      if (Array.isArray(data.reports)) {
        setReports(
          data.reports.map((r) => ({
            id: r.id,
            title: r.title,
            from: r.from,
            to: r.to,
            status: r.status,
            costEur: r.costEur,
            createdAt: r.createdAt,
          }))
        );
      }
    } catch {
      /* keep the last good list */
    }
  }, []);

  // Detail of the selected report — loading is derived (the loaded record
  // belongs to another id), so no setState is needed when the id changes.
  React.useEffect(() => {
    if (selectedId == null) return;
    const controller = new AbortController();
    adminFetch<{ report?: AnalyticsReportDetail }>(`/api/admin/analytics/${selectedId}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        setLoaded({
          id: selectedId,
          detail: data.report ?? null,
          error: data.report ? null : "Report konnte nicht geladen werden.",
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({
          id: selectedId,
          detail: null,
          error: friendlyErrorMessage(err, "Report konnte nicht geladen werden."),
        });
      });
    return () => controller.abort();
  }, [selectedId, reloadKey]);

  const select = React.useCallback((id: number) => {
    setSelectedId(id);
    syncReportParam(id);
  }, []);
  const goNew = React.useCallback(() => {
    setSelectedId(null);
    syncReportParam(null);
  }, []);
  const reloadDetail = React.useCallback(() => setReloadKey((k) => k + 1), []);

  const onCreated = React.useCallback(
    (id: number) => {
      void refreshList();
      select(id);
    },
    [refreshList, select]
  );
  const onDone = React.useCallback(() => {
    void refreshList();
    reloadDetail();
  }, [refreshList, reloadDetail]);
  const onDeleted = React.useCallback(() => {
    void refreshList();
    goNew();
  }, [refreshList, goNew]);

  const current = loaded && loaded.id === selectedId ? loaded : null;

  let main: React.ReactNode;
  if (selectedId === null) {
    main = <GenerateReportPanel onCreated={onCreated} />;
  } else if (!current) {
    main = (
      <Card>
        <CardContent className="space-y-2 p-5" aria-busy="true" aria-label="Bericht wird geladen">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  } else if (!current.detail) {
    main = (
      <Callout
        tone="destructive"
        action={
          <Button size="xs" variant="outline" onClick={reloadDetail}>
            Erneut laden
          </Button>
        }
      >
        {current.error ?? "Report konnte nicht geladen werden."}
      </Callout>
    );
  } else {
    main = <SelectedReport key={current.detail.id} detail={current.detail} onDone={onDone} onDeleted={onDeleted} />;
  }

  const items: SidebarListItem[] = reports.map((r) => ({
    id: r.id,
    title: r.title,
    icon: <FileText />,
    badge: <ReportStatusBadge status={r.status} />,
    metaLeft: formatAdmin(r.createdAt, ADMIN_DATE_MEDIUM, r.createdAt),
    metaRight: r.status === "complete" && r.costEur > 0 ? `~${eur(r.costEur)}` : undefined,
  }));

  return (
    <SplitPane
      listWidth="md"
      listLabel="Gespeicherte Analysen"
      stickyTopClassName="lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)]"
      list={
        <SidebarList
          label="Gespeicherte Analysen"
          newLabel="Neue Komplettanalyse"
          onNew={goNew}
          newActive={selectedId === null}
          heading={`Gespeichert (${num(reports.length)})`}
          items={items}
          activeId={selectedId}
          onSelect={select}
          emptyText="Noch keine Analysen. Erstelle oben deine erste Komplettanalyse."
        />
      }
      detail={main}
    />
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
  const fmtTs = (iso: string | null) => formatAdmin(iso, ADMIN_DATE_TIME_MEDIUM, iso || "—");
  const label =
    detail.from === detail.to ? germanDate(detail.from) : `${germanDate(detail.from)} – ${germanDate(detail.to)}`;
  const metaBits = [
    label,
    `erstellt ${fmtTs(detail.createdAt)}`,
    detail.status === "complete" && detail.completedAt ? `fertig ${fmtTs(detail.completedAt)}` : null,
    detail.costEur > 0 ? `KI-Kosten ~${eur(detail.costEur)}` : null,
    detail.options.includePerCustomer ? "inkl. Kundenprofile" : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{detail.title}</h2>
            <ReportStatusBadge status={detail.status} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{metaBits.join(" · ")}</p>
        </div>
        <ReportActions id={detail.id} canDownload={detail.status === "complete"} onDeleted={onDeleted} />
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
        <Callout tone="destructive" title="Erstellung fehlgeschlagen">
          {detail.error && <p>{detail.error}</p>}
          <p className="mt-1 text-xs">Bitte den Bericht löschen und neu erstellen.</p>
        </Callout>
      )}

      {detail.status === "complete" && detail.sections && <ReportView sections={detail.sections} />}
    </div>
  );
}
