// /admin/analytics — the section landing: the generator for a new Komplettanalyse.
// The stored reports live in the sidebar (the layout); selecting one routes to
// /admin/analytics/<id>.

import { isDbConfigured } from "@/lib/db";
import { GenerateReportPanel } from "./GenerateReportPanel";

export const dynamic = "force-dynamic";

export default function AnalyticsLandingPage() {
  if (!isDbConfigured()) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm text-warning">
        Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Analysen erstellt oder
        gespeichert werden.
      </div>
    );
  }
  return <GenerateReportPanel />;
}
