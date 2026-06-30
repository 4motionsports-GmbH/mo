// Layout for the Analytics ("Komplettanalyse") section — a master–detail shell
// with the stored-reports SIDE PANEL on the left and the active report (or the
// generator) on the right. Nested inside the admin layout, so it inherits the
// admin design system + theme. The report list is fetched on the SERVER and kept
// fresh by the soft navigations / router.refresh() the client pieces trigger.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { isDbConfigured } from "@/lib/db";
import { listAnalyticsReports } from "@/lib/analytics-report-store";
import { ReportSidebar, type SidebarReport } from "./ReportSidebar";

export const dynamic = "force-dynamic";

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const dbReady = isDbConfigured();
  const reports = dbReady ? await listAnalyticsReports() : [];
  const sidebar: SidebarReport[] = reports.map((r) => ({
    id: r.id,
    title: r.title,
    from: r.from,
    to: r.to,
    status: r.status,
    costEur: r.costEur,
    createdAt: r.createdAt,
  }));

  return (
    <div className="mx-auto max-w-7xl px-5 pb-16 pt-6">
      <header className="mb-5">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Dashboard
        </Link>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-foreground">
          Analytics · Komplettanalysen
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vollständige, gespeicherte KI-Überblicke je Zeitintervall — alle Analysen verdichtet an
          einem Ort, als PDF exportierbar.
        </p>
      </header>

      <div className="flex flex-col gap-6 md:flex-row">
        <aside className="w-full shrink-0 md:w-72">
          <ReportSidebar reports={sidebar} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
