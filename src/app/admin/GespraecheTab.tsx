// Gespräche tab (server-rendered). The conversation inspector's data is fetched
// on the SERVER — the paginated list (with its total in the same query), the
// free distribution stats, the cached insights rollup, and the count of
// un-analysed conversations (for the bulk estimate) — then handed to the client
// workspace (./gespraeche). ALL reads here are pure DB: ZERO model calls, zero
// tokens (the AI passes only run on explicit buttons).

import {
  listAdminConversations,
  getConversationStats,
  getCachedInsights,
  countUnanalyzedInRange,
  PAGE_SIZE,
  type AdminConversationFilter,
} from "@/lib/admin-conversations";
import { estimateAnalysisCostUsd } from "@/lib/conversation-analysis-core.mjs";
import { loadModelPrices, usdEurRate, usdToEur } from "@/lib/ai-pricing.mjs";
import { flattenConversationFilter } from "@/lib/admin-conversation-filter.mjs";
import { GespraecheWorkspace } from "./lazy";
import type { ConversationFilterState } from "./gespraeche/types";
import { Callout } from "./ui";

export async function GespraecheTab({
  dbReady,
  filter,
  initialConversationId,
}: {
  dbReady: boolean;
  filter: AdminConversationFilter;
  /** ?gid= deep link (Kunden → Beratungen → „Im Gespräche-Tab öffnen“). */
  initialConversationId: number | null;
}) {
  if (!dbReady) {
    return (
      <Callout tone="warning" className="mb-4">
        Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Gespräche geladen
        werden.
      </Callout>
    );
  }

  const from = filter.range.from;
  const to = filter.range.to;

  const [{ items, total, page }, stats, insights, unanalyzed] = await Promise.all([
    listAdminConversations(filter),
    getConversationStats(from, to),
    getCachedInsights(from, to),
    countUnanalyzedInRange(from, to),
  ]);

  // Estimated bulk cost (N × cheap-model cost), priced via the same JS path the
  // dashboard uses — shown before the operator confirms the sammelaktion.
  const bulkEstimateEur = usdToEur(
    estimateAnalysisCostUsd(unanalyzed, loadModelPrices()),
    usdEurRate()
  );

  return (
    <GespraecheWorkspace
      items={items}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      stats={stats}
      unanalyzed={unanalyzed}
      bulkEstimateEur={bulkEstimateEur}
      insights={insights}
      filter={flattenConversationFilter(filter) as ConversationFilterState}
      initialConversationId={initialConversationId}
    />
  );
}
