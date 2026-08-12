// Verbesserung tab (server-rendered shell) — the closed improvement loop
// (docs/IMPROVEMENT_LOOP.md). Seeds everything the client workspace needs with
// cheap server queries: the stored run list, the completed Komplettanalysen (a
// run's required input), the directive layer, and Mo's rendered self-snapshot
// (prompt + version hash — computed here so the operator always sees the LIVE
// state, exactly what a run started now would criticise).

import { listImprovementRuns } from "@/lib/improvement-store";
import { listAnalyticsReports } from "@/lib/analytics-report-store";
import { listDirectives } from "@/lib/directives-store";
import { buildMoSelfSnapshot } from "@/lib/mo-self-snapshot";
import { MAX_ACTIVE_DIRECTIVES, MAX_DIRECTIVE_CHARS } from "@/lib/improvement-core.mjs";
import { VerbesserungWorkspace } from "./verbesserung/VerbesserungWorkspace";

export async function VerbesserungTab({ dbReady }: { dbReady: boolean }) {
  if (!dbReady) {
    return (
      <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm text-warning">
        Keine Datenbank konfiguriert (DATABASE_URL) — der Verbesserungs-Loop benötigt die
        gespeicherten Analysen und Anweisungen.
      </div>
    );
  }

  const [runs, reports, directives, snapshot] = await Promise.all([
    listImprovementRuns(),
    listAnalyticsReports(),
    listDirectives(),
    buildMoSelfSnapshot(),
  ]);

  return (
    <VerbesserungWorkspace
      initialRuns={runs}
      completedReports={reports
        .filter((r) => r.status === "complete")
        .map((r) => ({ id: r.id, title: r.title }))}
      initialDirectives={directives}
      directiveLimits={{ maxActive: MAX_ACTIVE_DIRECTIVES, maxChars: MAX_DIRECTIVE_CHARS }}
      selfSnapshot={{
        shortHash: snapshot.shortHash,
        promptText: snapshot.promptText,
        activeDirectiveCount: snapshot.activeDirectiveCount,
        publishedQaCount: snapshot.publishedQaCount,
      }}
    />
  );
}
