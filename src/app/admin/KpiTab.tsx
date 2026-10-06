// KPI screen (server-rendered). Owns ALL aggregation — every number comes from
// the store getters, fetched once on the server and handed to the sections as
// plain props. The two Shopify fan-outs (the code lookup of „Umsatz durch Mo“
// and the campaign funnel) go through lib/kpi-cache (10-minute cache per range,
// decision D-4); every pure-DB section is live — the revenue ledger included.
// Client islands: the sticky KpiToolbar (URL only), the charts (Recharts,
// loaded on demand), the sparkline, the order list and the Top-Fragen button.
//
// Layout: seven anchored groups (kpi/groups.ts, ordered by decision value —
// revenue first) — the toolbar's in-page navigation — each holding its
// sections (kpi/sections/*). Every section keeps its honesty caveat verbatim
// behind the (i) next to its title. Reference: docs/ADMIN_DASHBOARD.md §3.5, §5.

import {
  getAccountActivity,
  getConsentGateFunnel,
  getCoreMetrics,
  getEmailCaptureFunnel,
  getLocaleSplit,
  getLoginGateFunnel,
  getOrderStatusKpis,
  getPageContextKpis,
  getSigninDiagnosis,
} from "@/lib/kpi-store";
import { germanDay, releasesInRange } from "@/lib/kpi-releases.mjs";
import { getPersonaInsights } from "@/lib/kpi-persona";
import { getMoRevenueData } from "@/lib/mo-revenue-store";
import { getJourneyCounts } from "@/lib/kpi-journey-store";
import { previousPeriod } from "@/lib/mo-revenue.mjs";
import { getBundleKpis } from "@/lib/bundle-offers-store";
import { getQaKpis } from "@/lib/qa-store";
import { getFeedbackKpis } from "@/lib/feedback-store";
import { getConversationStats } from "@/lib/admin-conversations";
import { getCachedTopQuestionsMap } from "@/lib/kpi-top-questions";
import { getAiCostMetrics, type AiCostMetrics } from "@/lib/ai-usage-store";
import { getPhysicalLetterStats } from "@/lib/physical-letters-store";
import { loadKpiShopifyBlock } from "@/lib/kpi-cache";
import { getCustomerBaseKpis, getMoEffectKpis } from "@/lib/customer-list-store";
import { getInboxKpis } from "@/lib/inbox-store";
import type { KpiRange } from "@/lib/kpi-range";
import { plural } from "@/lib/admin-format.mjs";
import { Callout, Disclosure, InfoTip } from "./ui";
import { KPI_GROUPS, kpiGroupAnchor, type KpiGroup, type KpiGroupKey } from "./kpi/groups";
import { KpiToolbar } from "./kpi/KpiToolbar";
import { buildRevenueView } from "./kpi/revenue-view";
import { UmsatzSection } from "./kpi/sections/UmsatzSection";
import { UmsatzWegeSection } from "./kpi/sections/UmsatzWegeSection";
import { UmsatzBestellungenSection } from "./kpi/sections/UmsatzBestellungenSection";
import { JourneySection } from "./kpi/sections/JourneySection";
import { CoreSection } from "./kpi/sections/CoreSection";
import { PageContextSection } from "./kpi/sections/PageContextSection";
import { LoginGateSection } from "./kpi/sections/LoginGateSection";
import { ConsentGateSection } from "./kpi/sections/ConsentGateSection";
import { EmailCaptureSection } from "./kpi/sections/EmailCaptureSection";
import { AccountSection } from "./kpi/sections/AccountSection";
import { CampaignSection } from "./kpi/sections/CampaignSection";
import { BundleSection } from "./kpi/sections/BundleSection";
import { EingangSection } from "./kpi/sections/EingangSection";
import { QualitySection } from "./kpi/sections/QualitySection";
import { QaSection } from "./kpi/sections/QaSection";
import { FeedbackSection } from "./kpi/sections/FeedbackSection";
import { OrderStatusSection } from "./kpi/sections/OrderStatusSection";
import { AiCostSection } from "./kpi/sections/AiCostSection";
import { MoEffektSection } from "./kpi/sections/MoEffektSection";
import { KundenbasisSection } from "./kpi/sections/KundenbasisSection";
import { PersonaSection } from "./kpi/sections/PersonaSection";
import { PhysicalMailSection } from "./kpi/sections/PhysicalMailSection";

/** Total AI spend of a period, null when nothing was captured. */
function spend(cost: AiCostMetrics | null): number | null {
  return cost && cost.capturedSince != null ? cost.totalSpendEur : null;
}

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

  // „Umsatz je 1 € KI-Kosten“ compares with the period of equal length before.
  const prev = previousPeriod(range);
  const prevRange: KpiRange | null = prev ? { preset: "custom", ...prev, label: "" } : null;

  // The period applies to every group except "Gesamtwerte" (lifecycle / cohort
  // / lifetime aggregates, shown period-independent).
  const [
    revenueData,
    shopify,
    aiCost,
    prevAiCost,
    journey,
    core,
    locales,
    pageContext,
    loginGate,
    signinDiagnosis,
    gateFunnel,
    captureFunnel,
    account,
    bundles,
    inboxKpis,
    quality,
    qa,
    feedback,
    orderStatus,
    moEffect,
    customerBase,
    personas,
    cachedQuestions,
    letterStats,
  ] = await Promise.all([
    getMoRevenueData(range),
    loadKpiShopifyBlock(range, fresh),
    getAiCostMetrics(range),
    prevRange ? getAiCostMetrics(prevRange) : Promise.resolve(null),
    getJourneyCounts(range),
    getCoreMetrics(range),
    getLocaleSplit(range),
    getPageContextKpis(range),
    getLoginGateFunnel(range),
    getSigninDiagnosis(range),
    getConsentGateFunnel(range),
    getEmailCaptureFunnel(range),
    getAccountActivity(range),
    getBundleKpis(range),
    getInboxKpis(range),
    getConversationStats(range.from, range.to),
    getQaKpis(range),
    getFeedbackKpis(range),
    getOrderStatusKpis(range),
    getMoEffectKpis(),
    getCustomerBaseKpis(),
    getPersonaInsights(5),
    getCachedTopQuestionsMap(),
    getPhysicalLetterStats(),
  ]);

  const revenue = revenueData
    ? buildRevenueView({
        data: revenueData,
        codes: shopify.revenue,
        aiCost: spend(aiCost),
        previousAiCost: spend(prevAiCost),
      })
    : null;
  const setChannel = revenue?.summary.byChannel.find((c) => c.key === "set");
  const group = (key: KpiGroupKey) => KPI_GROUPS.find((g) => g.key === key) as KpiGroup;
  const releases = releasesInRange(range);

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

      {releases.length > 0 && (
        // Open by default only while short — a long list would push „Umsatz
        // durch Mo“ off the first screen; each affected section notes it too.
        <Disclosure
          className="-mb-4 bg-surface-2"
          title="Änderungen im Zeitraum"
          meta={`${plural(releases.length, "Änderung", "Änderungen")} · zuletzt ${germanDay(releases[releases.length - 1].date)}`}
          defaultOpen={releases.length <= 3}
        >
          <ul className="flex flex-col gap-1 text-sm">
            {releases.map((r) => (
              <li key={r.key}>
                <span className="font-medium tabular-nums">{germanDay(r.date)}</span> · {r.title}{" "}
                <InfoTip label={`Was sich am ${germanDay(r.date)} geändert hat`}>{r.detail}</InfoTip>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <Group group={group("umsatz")}>
        <UmsatzSection view={revenue} range={range} />
        <UmsatzWegeSection view={revenue} />
        <UmsatzBestellungenSection view={revenue} />
      </Group>

      <Group group={group("funnel")}>
        <JourneySection counts={journey} />
        <CoreSection core={core} locales={locales} range={range} />
        <PageContextSection kpis={pageContext} range={range} />
      </Group>

      <Group group={group("kunden")}>
        <LoginGateSection funnel={loginGate} diagnosis={signinDiagnosis} range={range} />
        <ConsentGateSection funnel={gateFunnel} range={range} />
        <EmailCaptureSection funnel={captureFunnel} range={range} />
        <AccountSection activity={account} range={range} />
      </Group>

      <Group group={group("kampagnen")}>
        <CampaignSection cached={shopify.campaign} range={range} />
        <BundleSection
          kpis={bundles}
          purchases={
            revenue && setChannel
              ? { orders: setChannel.orders, revenue: setChannel.revenue, currency: revenue.currency }
              : null
          }
        />
        <EingangSection kpis={inboxKpis} />
      </Group>

      <Group group={group("qualitaet")}>
        <QualitySection stats={quality} />
        <QaSection kpis={qa} />
        <FeedbackSection kpis={feedback} />
        <OrderStatusSection kpis={orderStatus} />
      </Group>

      <Group group={group("kosten")}>
        <AiCostSection cost={aiCost} />
      </Group>

      <Group group={group("gesamt")}>
        <MoEffektSection kpis={moEffect} />
        <KundenbasisSection kpis={customerBase} />
        <PersonaSection personas={personas} cachedQuestions={cachedQuestions} />
        <PhysicalMailSection stats={letterStats} />
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
