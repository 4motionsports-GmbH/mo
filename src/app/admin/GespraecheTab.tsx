// Gespräche tab (server-rendered). The conversation inspector's data is fetched
// on the SERVER — the paginated list, the free distribution stats, the cached
// insights rollup, and the count of un-analysed conversations (for the bulk
// estimate) — then handed to the client workspace. ALL reads here are pure DB:
// ZERO model calls, zero tokens (the AI passes only run on explicit buttons).

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
import { GespraecheWorkspace } from "./GespraecheWorkspace";

export async function GespraecheTab({
  dbReady,
  filter,
}: {
  dbReady: boolean;
  filter: AdminConversationFilter;
}) {
  if (!dbReady) {
    return (
      <Banner tone="warn">
        Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Gespräche geladen
        werden.
      </Banner>
    );
  }

  const from = filter.range.from;
  const to = filter.range.to;

  const [{ items, total }, stats, insights, unanalyzed] = await Promise.all([
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
      pageSize={PAGE_SIZE}
      stats={stats}
      unanalyzed={unanalyzed}
      bulkEstimateEur={bulkEstimateEur}
      insights={insights}
      filter={{
        preset: filter.range.preset,
        from,
        to,
        label: filter.range.label,
        tier: filter.tier,
        hasError: filter.hasError,
        page: filter.page,
      }}
    />
  );
}

// Page-level banner (not-configured state), matching the other tabs.
function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-warning/30 bg-warning/10 text-warning"
      : "border-info/30 bg-info/10 text-info";
  return (
    <div className={`mb-4 rounded-lg border px-3.5 py-3 text-sm ${cls}`}>{children}</div>
  );
}
