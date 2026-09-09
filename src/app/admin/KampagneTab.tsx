// Kampagne screen (server-rendered) — the review queue for personalized emails
// to the shop's Shopify marketing subscribers (docs/CAMPAIGNS.md).
//
// Data is fetched once on the SERVER (counts, the drafted queue with resolved
// recommendation products and attached bundles, the skipped contacts, the
// legal-gate flags) and handed to the client KampagneWorkspace, which owns the
// one-card-at-a-time review flow, the keyboard shortcuts and the mutations
// (guarded /api/admin/campaign/* routes). The send history is paged and
// searched on demand (GET /api/admin/campaign/history) — it is no longer
// loaded, nor its redemption status checked in Shopify, on every render.

import {
  getCampaignCounts,
  listDraftedQueue,
  listSkippedContacts,
} from "@/lib/campaign-store";
import { listActiveBundlesForCampaignContacts } from "@/lib/bundle-offers-store";
import { resolveProductSelections } from "@/lib/product-catalog";
import {
  isCampaignSendsApproved,
  isSingleOptInAllowed,
} from "@/lib/campaign-flags.mjs";
import { isShopifyConfigured } from "@/lib/shopify";
import { KampagneWorkspace } from "./lazy";
import type { CampaignQueueItemProps } from "./kampagne/types";
import { Callout } from "./ui";

export async function KampagneTab({ dbReady }: { dbReady: boolean }) {
  if (!dbReady) {
    return (
      <Callout tone="warning">
        Keine Datenbank konfiguriert (DATABASE_URL) — das Kampagnen-Modul kann keine Kontakte
        laden.
      </Callout>
    );
  }

  const shopifyConfigured = isShopifyConfigured();
  const [counts, queue, skipped] = await Promise.all([
    getCampaignCounts(),
    listDraftedQueue(),
    listSkippedContacts(),
  ]);

  // Resolve the recommended products once for the whole queue (names + URLs
  // for the review card). Ids may be variant-pinned refs — resolve keyed by the
  // full ref so the card shows the chosen variant's name and deep link.
  const allRecommendedIds = [...new Set(queue.flatMap((q) => q.draft.recommendedProductIds))];
  const recommendedSelections = allRecommendedIds.length
    ? await resolveProductSelections(allRecommendedIds)
    : [];
  const productByRef = new Map(recommendedSelections.map((s) => [s.ref, s]));

  // Attached (active) bundle offers for the whole queue in one query.
  const bundleByContact = await listActiveBundlesForCampaignContacts(
    queue.map((q) => q.contact.id)
  );

  const queueItems: CampaignQueueItemProps[] = queue.map((q) => {
    const b = bundleByContact.get(q.contact.id);
    return {
      contactId: q.contact.id,
      email: q.contact.email,
      firstName: q.contact.firstName,
      lastName: q.contact.lastName,
      language: q.contact.language,
      languageOverride: q.contact.languageOverride,
      optInLevel: q.contact.optInLevel ?? "UNKNOWN",
      ordersCount: q.contact.ordersCount,
      totalSpentCents: q.contact.totalSpentCents,
      subject: q.draft.subject,
      body: q.draft.body,
      discountPercent: q.draft.discountPercent,
      discountExpiresAt: q.draft.discountExpiresAt,
      // Legacy drafts (pre-migration-0047, text_mode NULL) were generated
      // long-form — surface them as 'detailed'.
      textMode: q.draft.textMode ?? "detailed",
      segment: q.draft.segment,
      segmentDays: q.draft.segmentDays,
      lowConfidence: q.draft.lowConfidence,
      purchaseSummary: q.draft.purchaseSummary,
      purchaseSelectedIds: q.draft.purchaseSelectedIds,
      recommendations: q.draft.recommendedProductIds.map((id) => {
        const s = productByRef.get(id);
        return {
          id,
          name: s?.display?.name ?? s?.product.name ?? id,
          url: s?.display?.shopifyUrl ?? s?.product.shopifyUrl ?? null,
        };
      }),
      bundle: b
        ? {
            id: b.id,
            title: b.title ?? "Dein persönliches Set",
            components: b.components.map((c) => c.title),
            bundlePrice: b.bundlePrice,
            componentsSum: b.componentsSum,
            currency: b.currency,
            expiresAt: b.expiresAt,
          }
        : null,
    };
  });

  const countsProps = counts ?? {
    pending: 0,
    drafted: 0,
    sentTotal: 0,
    sentToday: 0,
    skipped: 0,
    suppressed: 0,
    draftFailed: 0,
    byOptInLevel: {},
  };

  // The workspace keeps a local working copy of the queue. When a bulk action
  // (Sync / Prepare / Reset / Unskip / Draft) changes the server-side queue it
  // calls router.refresh(); the workspace re-syncs its working copy from the
  // fresh props (see useCampaignActions) — the old full-page reload without
  // the reload.
  return (
    <KampagneWorkspace
      counts={countsProps}
      queue={queueItems}
      skipped={skipped.map((s) => ({
        contactId: s.contact.id,
        email: s.contact.email,
        firstName: s.contact.firstName,
        lastName: s.contact.lastName,
        hasDraft: s.hasDraft,
      }))}
      sendsApproved={isCampaignSendsApproved()}
      allowSingleOptIn={isSingleOptInAllowed()}
      shopifyConfigured={shopifyConfigured}
    />
  );
}
