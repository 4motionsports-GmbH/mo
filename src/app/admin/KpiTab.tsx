// KPI screen (server-rendered). Owns ALL aggregation — every number comes from
// the kpi-store / kpi-persona / kpi-recommendation-loop / marketing-store /
// campaign-store / ai-usage-store getters, fetched once on the server and handed
// to the sections as plain props. The four Shopify-dependent getters go through
// lib/kpi-cache (10-minute cache per range, decision D-4); the pure-DB sections
// are live. Client islands: the sticky KpiToolbar (URL only), the charts
// (Recharts, loaded on demand) and the Top-Fragen button.
//
// Layout: five anchored groups (kpi/groups.ts) — the toolbar's in-page
// navigation — each holding its sections (kpi/sections/*). Every section keeps
// its honesty caveat verbatim behind the (i) next to its title.

import {
  getAccountActivity,
  getConsentGateFunnel,
  getCoreMetrics,
  getEmailCaptureFunnel,
  getLocaleSplit,
} from "@/lib/kpi-store";
import { getPersonaInsights } from "@/lib/kpi-persona";
import { getMoAttributionKpis } from "@/lib/mo-orders-store";
import { getBundleKpis } from "@/lib/bundle-offers-store";
import { getQaKpis } from "@/lib/qa-store";
import { getFeedbackKpis } from "@/lib/feedback-store";
import { getConversationStats } from "@/lib/admin-conversations";
import { getCachedTopQuestionsMap } from "@/lib/kpi-top-questions";
import { getAiCostMetrics } from "@/lib/ai-usage-store";
import { getPhysicalLetterStats } from "@/lib/physical-letters-store";
import { loadKpiShopifyBlock } from "@/lib/kpi-cache";
import type { KpiRange } from "@/lib/kpi-range";
import { Callout, InfoTip } from "./ui";
import { KPI_GROUPS, kpiGroupAnchor, type KpiGroup } from "./kpi/groups";
import { KpiToolbar } from "./kpi/KpiToolbar";
import { CoreSection } from "./kpi/sections/CoreSection";
import { LocaleSection } from "./kpi/sections/LocaleSection";
import { QualitySection } from "./kpi/sections/QualitySection";
import { QaSection } from "./kpi/sections/QaSection";
import { FeedbackSection } from "./kpi/sections/FeedbackSection";
import { AccountSection } from "./kpi/sections/AccountSection";
import { ConsentGateSection } from "./kpi/sections/ConsentGateSection";
import { EmailCaptureSection } from "./kpi/sections/EmailCaptureSection";
import { CampaignSection } from "./kpi/sections/CampaignSection";
import { BundleSection } from "./kpi/sections/BundleSection";
import { RevenueSection } from "./kpi/sections/RevenueSection";
import { AttributionSection } from "./kpi/sections/AttributionSection";
import { AiCostSection } from "./kpi/sections/AiCostSection";
import { PhysicalMailSection } from "./kpi/sections/PhysicalMailSection";
import { MarketingFunnelSection } from "./kpi/sections/MarketingFunnelSection";
import { PersonaSection } from "./kpi/sections/PersonaSection";
import { LoopSection } from "./kpi/sections/LoopSection";

export async function KpiTab({
  dbReady,
  range,
  fresh,
}: {
  dbReady: boolean;
  range: KpiRange;
  /** Raw ?kpiFresh= (unix seconds) — freshness floor for the Shopify cache. */
  fresh?: string | null;
}) {
  if (!dbReady) {
    return (
      <Callout tone="warning">
        Keine Datenbank konfiguriert (DATABASE_URL) — es können keine KPIs berechnet werden.
      </Callout>
    );
  }

  // The period applies to every group except "Gesamtwerte" (lifecycle / cohort
  // / lifetime aggregates, shown period-independent).
  const [
    core,
    attribution,
    aiCost,
    personas,
    shopify,
    gateFunnel,
    captureFunnel,
    bundles,
    qa,
    feedback,
    quality,
    locales,
    account,
    cachedQuestions,
    letterStats,
  ] = await Promise.all([
    getCoreMetrics(range),
    getMoAttributionKpis(range),
    getAiCostMetrics(range),
    getPersonaInsights(5),
    loadKpiShopifyBlock(range, fresh),
    getConsentGateFunnel(range),
    getEmailCaptureFunnel(range),
    getBundleKpis(range),
    getQaKpis(range),
    getFeedbackKpis(range),
    getConversationStats(range.from, range.to),
    getLocaleSplit(range),
    getAccountActivity(range),
    getCachedTopQuestionsMap(),
    getPhysicalLetterStats(),
  ]);

  const [beratung, marketing, umsatz, kosten, gesamt] = KPI_GROUPS;

  return (
    <div className="-mt-6 flex flex-col gap-10">
      <KpiToolbar
        preset={range.preset}
        from={range.from}
        to={range.to}
        label={range.label}
        shopifyFetchedAt={shopify.fetchedAt}
        shopifyFromCache={shopify.fromCache}
      />

      <Group group={beratung}>
        <CoreSection core={core} range={range} />
        <LocaleSection locales={locales} />
        <QualitySection stats={quality} />
        <QaSection kpis={qa} />
        <FeedbackSection kpis={feedback} />
        <AccountSection activity={account} />
      </Group>

      <Group group={marketing}>
        <ConsentGateSection funnel={gateFunnel} />
        <EmailCaptureSection funnel={captureFunnel} />
        <CampaignSection cached={shopify.campaign} />
        <BundleSection kpis={bundles} />
      </Group>

      <Group group={umsatz}>
        <RevenueSection cached={shopify.revenue} />
        <AttributionSection attribution={attribution} />
      </Group>

      <Group group={kosten}>
        <AiCostSection cost={aiCost} />
      </Group>

      <Group group={gesamt}>
        <PhysicalMailSection stats={letterStats} />
        <MarketingFunnelSection cached={shopify.funnel} />
        <PersonaSection personas={personas} cachedQuestions={cachedQuestions} />
        <LoopSection cached={shopify.loop} />
      </Group>
    </div>
  );
}

/** An anchored group heading (the toolbar's navigation target) + its sections. */
function Group({ group, children }: { group: KpiGroup; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-8">
      <div id={kpiGroupAnchor(group.key)} className="flex items-center gap-3 scroll-mt-36">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {group.label}
          <InfoTip label={`Was „${group.label}“ enthält`}>{group.description}</InfoTip>
        </h2>
        <div className="h-px flex-1 bg-border" aria-hidden />
        {!group.periodic && (
          <span className="text-2xs text-muted-foreground">vom Zeitraum unabhängig</span>
        )}
      </div>
      {children}
    </div>
  );
}
