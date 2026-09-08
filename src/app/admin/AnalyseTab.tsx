// Analyse tab (server-rendered shell). Seeds the stored-report list for the side
// panel on the SERVER (one cheap query — no `sections` payload), then hands off to
// the self-contained client workspace, which owns selection + detail/generation
// via the lightweight GET/POST endpoints (so switching reports never triggers a
// heavy /admin re-render).

import { listAnalyticsReports } from "@/lib/analytics-report-store";
import { AnalyseWorkspace } from "./analytics/AnalyseWorkspace";
import type { SidebarReport } from "./analytics/ReportSidebar";
import { Callout } from "./ui";

export async function AnalyseTab({ dbReady }: { dbReady: boolean }) {
  if (!dbReady) {
    return (
      <Callout tone="warning" className="mb-4">
        Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Analysen erstellt oder
        gespeichert werden.
      </Callout>
    );
  }

  const reports = await listAnalyticsReports();
  const initialReports: SidebarReport[] = reports.map((r) => ({
    id: r.id,
    title: r.title,
    from: r.from,
    to: r.to,
    status: r.status,
    costEur: r.costEur,
    createdAt: r.createdAt,
  }));

  return <AnalyseWorkspace initialReports={initialReports} />;
}
