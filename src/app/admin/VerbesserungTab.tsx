// Verbesserung tab (server-rendered shell) — the closed improvement loop
// (docs/IMPROVEMENT_LOOP.md). Seeds everything the client workspace needs with
// cheap server queries: the stored runs, the completed Komplettanalysen (with
// whether their recommendations can still be imported), the open backlog of
// every run, the directive layer with each directive's measured effect from
// the newest run, the up-front estimate of a new run, and Mo's rendered
// self-snapshot (prompt + version hash — computed here so the operator always
// sees the LIVE state, exactly what a run started now would criticise).

import {
  getLatestMeasurements,
  listBacklog,
  listImprovementRuns,
  listReportsForRuns,
  listSuggestionOrigins,
  listSuggestionsForChanges,
} from "@/lib/improvement-store";
import { listDirectives, listDirectivesWithEvents } from "@/lib/directives-store";
import { buildMoSelfSnapshot } from "@/lib/mo-self-snapshot";
import { MAX_ACTIVE_DIRECTIVES, MAX_DIRECTIVE_CHARS } from "@/lib/improvement-core.mjs";
import { buildChangeList } from "@/lib/improvement-effects.mjs";
import { estimateImprovementCostUsd, estimateImprovementMinutes } from "@/lib/improvement-decision.mjs";
import { loadModelPrices, usdEurRate, usdToEur } from "@/lib/ai-pricing.mjs";
import { toYmd } from "@/lib/kpi-range.mjs";
import type { Measurement } from "@/lib/improvement-types";
import type { DirectiveEffect } from "./verbesserung/types";
import { VerbesserungWorkspace } from "./lazy";
import { Callout } from "./ui";

export async function VerbesserungTab({
  dbReady,
  initialRunId,
}: {
  dbReady: boolean;
  /** ?run= deep link to a stored run. */
  initialRunId: number | null;
}) {
  if (!dbReady) {
    return (
      <Callout tone="warning" className="mb-4">
        Keine Datenbank konfiguriert (DATABASE_URL) — der Verbesserungs-Loop benötigt die gespeicherten Läufe und
        Anweisungen.
      </Callout>
    );
  }

  const [runs, reports, origins, backlog, directives, history, changeSuggestions, latest, snapshot] = await Promise.all([
    listImprovementRuns(),
    listReportsForRuns(),
    listSuggestionOrigins(),
    listBacklog(),
    listDirectives(),
    listDirectivesWithEvents(),
    listSuggestionsForChanges(),
    getLatestMeasurements(),
    buildMoSelfSnapshot(),
  ]);

  // Which recommendation positions of each report are already in the backlog.
  const importedByReport = new Map<number, Set<number>>();
  for (const o of origins) {
    if (o.origin?.kind !== "report") continue;
    const set = importedByReport.get(o.origin.reportId) ?? new Set<number>();
    set.add(Number(o.origin.index));
    importedByReport.set(o.origin.reportId, set);
  }

  const changesToMeasure = buildChangeList({
    directives: history,
    suggestions: changeSuggestions,
    flat: {},
    today: toYmd(new Date()),
  }).length;
  const prices = loadModelPrices();
  const rate = usdEurRate();

  const directiveEffects: Record<number, DirectiveEffect> = {};
  for (const m of (latest?.measurements ?? []) as Measurement[]) {
    if (m.kind === "directive" && latest) {
      directiveEffects[m.id] = { runId: latest.runId, runCreatedAt: latest.createdAt, measurement: m };
    }
  }

  return (
    <VerbesserungWorkspace
      initialRuns={runs}
      completedReports={reports.map((r) => {
        const imported = importedByReport.get(r.id) ?? new Set<number>();
        const open = Array.from({ length: r.recommendations }, (_, i) => i).filter((i) => !imported.has(i)).length;
        return { id: r.id, title: r.title, from: r.from, to: r.to, decision: r.decision, recommendations: { total: r.recommendations, open } };
      })}
      initialBacklog={backlog}
      initialDirectives={directives}
      directiveLimits={{ maxActive: MAX_ACTIVE_DIRECTIVES, maxChars: MAX_DIRECTIVE_CHARS }}
      directiveEffects={directiveEffects}
      estimate={{
        eurWithEffectCheck: usdToEur(estimateImprovementCostUsd(prices, { withEffectCheck: true }), rate),
        eurWithoutEffectCheck: usdToEur(estimateImprovementCostUsd(prices, { withEffectCheck: false }), rate),
        minutes: estimateImprovementMinutes({ withEffectCheck: changesToMeasure > 0, changes: changesToMeasure }) as [number, number],
        changesToMeasure,
      }}
      selfSnapshot={{
        shortHash: snapshot.shortHash,
        promptText: snapshot.promptText,
        activeDirectiveCount: snapshot.activeDirectiveCount,
        publishedQaCount: snapshot.publishedQaCount,
      }}
      initialRunId={initialRunId}
    />
  );
}
