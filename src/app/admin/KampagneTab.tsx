// Kampagne screen (server-rendered) — the review desk for personalized emails
// to the shop's Shopify marketing subscribers (docs/CAMPAIGNS.md §5).
//
// Data is fetched once on the SERVER (counts, the drafted queue with resolved
// recommendation products, attached bundles, hero state and the cross-channel
// last-send fact, the skipped contacts, the legal-gate flags, whether the
// campaign design has a hero, the recorded AI costs for the Vorbereiten
// estimate and the 30-day delivery strip) and handed to the client
// KampagneWorkspace, which owns the desk: selection, filters, the review
// checks, the keyboard shortcuts and every mutation (guarded
// /api/admin/campaign/* routes). The send history is paged and searched on
// demand (GET /api/admin/campaign/history).

import {
  estimateCampaignCosts,
  getCampaignCounts,
  getCampaignDeliverySummary,
  listDraftedQueue,
  listSkippedContacts,
  listSuppressedEmails,
} from "@/lib/campaign-store";
import { listActiveBundlesForCampaignContacts } from "@/lib/bundle-offers-store";
import { resolveProductSelections } from "@/lib/product-catalog";
import { recommendationView } from "@/lib/campaign-recommendation-view";
import {
  isCampaignSendsApproved,
  isSingleOptInAllowed,
  marketingMinSendIntervalDays,
} from "@/lib/campaign-flags.mjs";
import { parseDeskView, parseQueueFilter } from "@/lib/campaign-desk-core.mjs";
import { getCachedEmailDesignForKind } from "@/lib/email-design-store";
import { emailDesignHasHero, listEmailDesignMeta } from "@/lib/email-designs/registry";
import { isHeroGenerationConfigured } from "@/lib/email-hero";
import { isShopifyConfigured } from "@/lib/shopify";
import { KampagneWorkspace } from "./lazy";
import type { CampaignQueueItemProps } from "./kampagne/types";
import { Callout } from "./ui";

export async function KampagneTab({
  dbReady,
  initialContactId,
  initialView,
  initialFilter,
}: {
  dbReady: boolean;
  initialContactId: number | null;
  initialView: string | undefined;
  initialFilter: string | undefined;
}) {
  if (!dbReady) {
    return (
      <Callout tone="warning">
        Keine Datenbank konfiguriert (DATABASE_URL) — das Kampagnen-Modul kann keine Kontakte
        laden.
      </Callout>
    );
  }

  const shopifyConfigured = isShopifyConfigured();
  const [counts, queue, skipped, design, costs, sentSummary] = await Promise.all([
    getCampaignCounts(),
    listDraftedQueue(),
    listSkippedContacts(),
    getCachedEmailDesignForKind("campaign"),
    estimateCampaignCosts(),
    getCampaignDeliverySummary(30),
  ]);

  // Resolve the recommended products once for the whole queue (name, link,
  // image, price, stock for the review column and the checks). Ids may be
  // variant-pinned refs — resolve keyed by the full ref so the desk shows the
  // chosen variant's name and deep link.
  const allRecommendedIds = [...new Set(queue.flatMap((q) => q.draft.recommendedProductIds))];
  const recommendedSelections = allRecommendedIds.length
    ? await resolveProductSelections(allRecommendedIds)
    : [];
  const productByRef = new Map(recommendedSelections.map((s) => [s.ref, s]));

  // Attached (active) bundle offers for the whole queue in one query, and the
  // suppression state of every queued address (the send gate's fact, so the
  // desk can flag a refusal before the operator presses Senden).
  const [bundleByContact, suppressedEmails] = await Promise.all([
    listActiveBundlesForCampaignContacts(queue.map((q) => q.contact.id)),
    listSuppressedEmails(queue.map((q) => q.contact.email)),
  ]);

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
      recommendations: q.draft.recommendedProductIds.map((id) =>
        recommendationView(id, productByRef.get(id))
      ),
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
      heroUrl: q.draft.heroImageUrl,
      heroHeadline: q.draft.heroHeadline,
      lastSendAt: q.lastSendAt,
      draftUpdatedAt: q.draft.updatedAt ?? q.draft.createdAt,
      isTest: q.contact.isTest,
      suppressed: suppressedEmails.has(q.contact.email),
    };
  });

  const countsProps = counts ?? {
    pending: 0,
    pendingSendable: 0,
    drafted: 0,
    sentTotal: 0,
    sentToday: 0,
    skipped: 0,
    suppressed: 0,
    draftFailed: 0,
    byOptInLevel: {},
    lastSyncedAt: null,
  };

  // The desk keeps a local working copy of the queue. When a bulk action
  // (Sync / Vorbereiten / Neu aufbauen / Wiederherstellen / Entwurf erstellen)
  // changes the server-side queue it calls router.refresh(); the desk re-syncs
  // its working copy from the fresh props and keeps its position.
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
        isTest: s.contact.isTest,
      }))}
      sendsApproved={isCampaignSendsApproved()}
      allowSingleOptIn={isSingleOptInAllowed()}
      shopifyConfigured={shopifyConfigured}
      heroDesignActive={emailDesignHasHero(design?.key)}
      heroDesignName={
        design ? (listEmailDesignMeta().find((m) => m.key === design.key)?.name ?? design.key) : null
      }
      heroGenerationConfigured={isHeroGenerationConfigured()}
      minSendIntervalDays={marketingMinSendIntervalDays()}
      costs={costs}
      sentSummary={sentSummary}
      initialContactId={initialContactId}
      initialView={parseDeskView(initialView)}
      initialFilter={parseQueueFilter(initialFilter)}
    />
  );
}
