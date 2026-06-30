// /admin/analytics/<id> — one stored report (a "page" in the side panel). A
// running report renders the live progress driver; a completed one renders the
// full structured view + PDF download; a failed one shows the error.

import { notFound } from "next/navigation";
import { isDbConfigured } from "@/lib/db";
import { getAnalyticsReport } from "@/lib/analytics-report-store";
import { germanDate } from "@/lib/kpi-range.mjs";
import { Badge } from "../../ui";
import { ReportProgressDriver } from "../ReportProgressDriver";
import { ReportView } from "../ReportView";
import { ReportActions } from "../ReportActions";

export const dynamic = "force-dynamic";

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

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm text-warning">
        Keine Datenbank konfiguriert (DATABASE_URL).
      </div>
    );
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const report = await getAnalyticsReport(id);
  if (!report) notFound();

  const label =
    report.from === report.to
      ? germanDate(report.from)
      : `${germanDate(report.from)} – ${germanDate(report.to)}`;

  const metaBits = [
    label,
    `erstellt ${fmtTs(report.createdAt)}`,
    report.status === "complete" && report.completedAt ? `fertig ${fmtTs(report.completedAt)}` : null,
    report.costEur > 0 ? `KI-Kosten ~${eur(report.costEur)}` : null,
    report.options.includePerCustomer ? "inkl. Kundenprofile" : null,
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{report.title}</h2>
            {report.status === "running" && <Badge variant="info">läuft</Badge>}
            {report.status === "failed" && <Badge variant="destructive">Fehler</Badge>}
            {report.status === "complete" && <Badge variant="success">fertig</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{metaBits.join(" · ")}</p>
        </div>
        <ReportActions id={id} canDownload={report.status === "complete"} />
      </header>

      {report.status === "running" && (
        <ReportProgressDriver
          id={id}
          title={report.title}
          initialPhase={report.phase}
          initialCostEur={report.costEur}
          initialProgress={{
            analyzed: report.progress.analyzed,
            analyzeRemaining: report.progress.analyzeRemaining,
            analyzeFailed: report.progress.analyzeFailed,
            personasTotal: report.progress.personasTotal,
            personasDone: report.progress.personasDone,
            profilesTotal: report.progress.profilesTotal,
            profilesDone: report.progress.profilesDone,
            profilesFailed: report.progress.profilesFailed,
          }}
          options={{ includePerCustomer: report.options.includePerCustomer }}
        />
      )}

      {report.status === "failed" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-semibold">Erstellung fehlgeschlagen</p>
          {report.error && <p className="mt-1 text-[13px]">{report.error}</p>}
          <p className="mt-1 text-[12px]">Bitte den Bericht löschen und neu erstellen.</p>
        </div>
      )}

      {report.status === "complete" && report.sections && <ReportView sections={report.sections} />}
    </div>
  );
}
