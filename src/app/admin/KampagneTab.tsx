// Kampagne tab (server-rendered) — the review queue for personalized emails to
// the shop's Shopify marketing subscribers (docs/CAMPAIGNS.md, Task D).
//
// Data is fetched once on the SERVER (counts, the drafted queue with resolved
// recommendation products, the send history with redemption status, and the
// legal-gate flags) and handed to the client KampagneWorkspace, which owns the
// one-card-at-a-time review flow, the keyboard shortcuts, and the mutations
// (which go through the guarded /api/admin/campaign/* routes).

import {
  getCampaignCounts,
  listDraftedQueue,
  listCampaignSendHistory,
} from "@/lib/campaign-store";
import { getProductsByIds } from "@/lib/product-catalog";
import {
  isCampaignSendsApproved,
  isSingleOptInAllowed,
} from "@/lib/campaign-flags.mjs";
import { isShopifyConfigured } from "@/lib/shopify";
import { wasDiscountCodeRedeemed } from "@/lib/shopify-orders";
import {
  KampagneWorkspace,
  type CampaignQueueItemProps,
  type CampaignHistoryItemProps,
} from "./KampagneWorkspace";

// Bound the per-load Shopify redemption fan-out (same cap discipline as the
// marketing funnel / revenue KPI).
const HISTORY_REDEMPTION_MAX_CODES = 30;

export async function KampagneTab({ dbReady }: { dbReady: boolean }) {
  if (!dbReady) {
    return (
      <Banner tone="warn">
        Keine Datenbank konfiguriert (DATABASE_URL) — das Kampagnen-Modul kann keine
        Kontakte laden.
      </Banner>
    );
  }

  const shopifyConfigured = isShopifyConfigured();
  const [counts, queue, history] = await Promise.all([
    getCampaignCounts(),
    listDraftedQueue(),
    listCampaignSendHistory(),
  ]);

  // Resolve the recommended products once for the whole queue (names + URLs
  // for the review card).
  const allRecommendedIds = [
    ...new Set(queue.flatMap((q) => q.draft.recommendedProductIds)),
  ];
  const recommendedProducts = allRecommendedIds.length
    ? await getProductsByIds(allRecommendedIds)
    : [];
  const productById = new Map(recommendedProducts.map((p) => [p.id, p]));

  const queueItems: CampaignQueueItemProps[] = queue.map((q) => ({
    contactId: q.contact.id,
    email: q.contact.email,
    firstName: q.contact.firstName,
    lastName: q.contact.lastName,
    language: q.contact.language,
    optInLevel: q.contact.optInLevel ?? "UNKNOWN",
    ordersCount: q.contact.ordersCount,
    totalSpentCents: q.contact.totalSpentCents,
    subject: q.draft.subject,
    body: q.draft.body,
    discountPercent: q.draft.discountPercent,
    discountExpiresAt: q.draft.discountExpiresAt,
    lowConfidence: q.draft.lowConfidence,
    purchaseSummary: q.draft.purchaseSummary,
    recommendations: q.draft.recommendedProductIds.map((id) => {
      const p = productById.get(id);
      return { id, name: p?.name ?? id, url: p?.shopifyUrl ?? null };
    }),
  }));

  // Redemption status for the history sub-view (bounded fan-out; null =
  // unknown — never silently "not redeemed").
  const codesToCheck = history
    .filter((h) => h.discountCode)
    .slice(0, HISTORY_REDEMPTION_MAX_CODES);
  const redemptionByCode = new Map<string, boolean | null>();
  if (shopifyConfigured && codesToCheck.length > 0) {
    const results = await Promise.all(
      codesToCheck.map((h) => wasDiscountCodeRedeemed(h.discountCode as string))
    );
    codesToCheck.forEach((h, i) => {
      redemptionByCode.set(h.discountCode as string, results[i]);
    });
  }

  const historyItems: CampaignHistoryItemProps[] = history.map((h) => ({
    id: h.id,
    email: h.email,
    subject: h.subject,
    sentVia: h.sentVia,
    discountCode: h.discountCode,
    sentAt: h.sentAt,
    redeemed: h.discountCode ? (redemptionByCode.get(h.discountCode) ?? null) : null,
  }));

  return (
    <KampagneWorkspace
      counts={
        counts ?? {
          pending: 0,
          drafted: 0,
          sentTotal: 0,
          sentToday: 0,
          skipped: 0,
          suppressed: 0,
          draftFailed: 0,
          byOptInLevel: {},
        }
      }
      queue={queueItems}
      history={historyItems}
      sendsApproved={isCampaignSendsApproved()}
      allowSingleOptIn={isSingleOptInAllowed()}
      shopifyConfigured={shopifyConfigured}
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
