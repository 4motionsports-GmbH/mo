// Kampagnen screen (server-rendered) — without `?campaign=` the overview of
// every campaign (cards + editor, kampagnen/CampaignsOverview); with
// `?campaign=<slug|id>` the review desk of THAT campaign (docs/CAMPAIGNS.md
// §2 and §5). A legacy desk link with only `?contact=` opens the desk of the
// campaign the recipient belongs to.
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
import {
  getCampaignForContact,
  listCampaigns,
  resolveCampaign,
  type Campaign,
  type CampaignWithStats,
} from "@/lib/campaigns-store";
import { campaignPhase } from "@/lib/campaign-def.mjs";
import { describeAudienceSpec } from "@/lib/audience-spec.mjs";
import { campaignAutoPrepareConfig } from "@/lib/campaign-flags.mjs";
import { DISCOUNT_PERCENT_MAX } from "@/lib/discount-validation.mjs";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";
import { loadProductCatalog } from "@/lib/catalog-store";
import { listActiveBundlesForCampaignContacts } from "@/lib/bundle-offers-store";
import { resolveProductSelections } from "@/lib/product-catalog";
import { recommendationView } from "@/lib/campaign-recommendation-view";
import {
  isCampaignSendsApproved,
  isSingleOptInAllowed,
  marketingMinSendIntervalDays,
} from "@/lib/campaign-flags.mjs";
import { parseDeskView, parseQueueFilter } from "@/lib/campaign-desk-core.mjs";
import { bundleItemLabel, bundleItemList } from "@/lib/bundle-offer-core.mjs";
import { getCachedEmailDesignForKind, getEmailDesignForKey } from "@/lib/email-design-store";
import { designSupportsKind, emailDesignHasHero, listEmailDesignMeta } from "@/lib/email-designs/registry";
import { isHeroGenerationConfigured } from "@/lib/email-hero";
import { isShopifyConfigured } from "@/lib/shopify";
import { CampaignsOverview, KampagneWorkspace } from "./lazy";
import type { CampaignQueueItemProps } from "./kampagne/types";
import type { CampaignCardProps } from "./kampagnen/types";

const personaLabel = (k: string) =>
  k === "unknown" ? "ohne Persona" : (ARCHETYPE_META[k as PersonaArchetype]?.label ?? k);

function audienceText(c: Campaign, all: CampaignWithStats[]): string {
  return describeAudienceSpec(c.audience, {
    personaLabel,
    campaignName: (id: number) => all.find((x) => x.id === id)?.name ?? `#${id}`,
  });
}

function cardProps(c: CampaignWithStats, all: CampaignWithStats[]): CampaignCardProps {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    kind: c.kind,
    status: c.status,
    phase: campaignPhase(c),
    brief: c.brief,
    audience: c.audience as CampaignCardProps["audience"],
    audienceText: audienceText(c, all),
    audienceMode: c.audienceMode,
    priority: c.priority,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    dailyTarget: c.dailyTarget,
    autoPreparePerDay: c.autoPreparePerDay,
    reentryDays: c.reentryDays,
    discountPercent: c.discountPercent,
    discountScope: c.discountScope,
    discountValidUntil: c.discountValidUntil,
    designKey: c.designKey,
    heroMode: c.heroMode,
    textMode: c.textMode,
    moPromo: c.moPromo,
    ctaKind: c.ctaKind,
    ctaUrl: c.ctaUrl,
    audienceRefreshedAt: c.audienceRefreshedAt,
    stats: c.stats,
  };
}

async function Overview({
  campaigns,
  initialEdit,
  notFound,
}: {
  campaigns: CampaignWithStats[];
  initialEdit: number | "new" | null;
  notFound?: boolean;
}) {
  const catalog = await loadProductCatalog().catch(() => []);
  const categories = [...new Set(catalog.map((p) => p.category).filter((c): c is string => Boolean(c)))].sort((a, b) =>
    a.localeCompare(b, "de")
  );
  return (
    <CampaignsOverview
      campaigns={campaigns.map((c) => cardProps(c, campaigns))}
      initialEdit={initialEdit}
      notFound={notFound}
      sendsApproved={isCampaignSendsApproved()}
      options={{
        designs: listEmailDesignMeta()
          .filter((d) => !d.isDefault && designSupportsKind(d.key, "campaign"))
          .map((d) => ({ key: d.key, name: d.name })),
        personas: Object.values(ARCHETYPE_META).map((m) => ({ key: m.id, label: m.label })),
        categories,
        maxDiscountPercent: DISCOUNT_PERCENT_MAX,
        autoPrepareBudget: campaignAutoPrepareConfig().count,
      }}
    />
  );
}
import { Callout } from "./ui";

export async function KampagneTab({
  dbReady,
  campaignRef,
  editRef,
  initialContactId,
  initialView,
  initialFilter,
}: {
  dbReady: boolean;
  /** `?campaign=` (slug or id); undefined = the overview. */
  campaignRef: string | undefined;
  /** `?edit=<id|new>` — open the editor on the overview. */
  editRef: string | undefined;
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

  const campaigns = await listCampaigns({ includeArchived: true });
  const editId = editRef === "new" ? "new" : /^\d+$/.test(editRef ?? "") ? Number(editRef) : null;
  let campaign: Campaign | null = null;
  if (campaignRef) campaign = await resolveCampaign(campaignRef);
  else if (initialContactId && editId === null) campaign = await getCampaignForContact(initialContactId);
  if (!campaign || editId !== null) {
    return <Overview campaigns={campaigns} initialEdit={editId} notFound={Boolean(campaignRef) && !campaign} />;
  }
  const campaignId = campaign.id;

  const shopifyConfigured = isShopifyConfigured();
  const [counts, queue, skipped, design, costs, sentSummary] = await Promise.all([
    getCampaignCounts(campaignId, { windowed: campaign.kind === "laufend" }),
    listDraftedQueue(campaignId),
    listSkippedContacts(campaignId),
    campaign.designKey ? getEmailDesignForKey(campaign.designKey, "campaign") : getCachedEmailDesignForKind("campaign"),
    estimateCampaignCosts(),
    getCampaignDeliverySummary(30, campaignId),
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
      discountScope: q.draft.discountScope,
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
            components: bundleItemList(b.components).map(bundleItemLabel),
            bundlePrice: b.bundlePrice,
            componentsSum: b.componentsSum,
            currency: b.currency,
            expiresAt: b.expiresAt,
          }
        : null,
      heroUrl: q.draft.heroImageUrl,
      heroHeadline: q.draft.heroHeadline,
      lastSendAt: q.lastSendAt,
      customerId: q.contact.customerId,
      profile: q.profile,
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
      key={campaignId}
      campaign={{
        id: campaign.id,
        name: campaign.name,
        slug: campaign.slug,
        kind: campaign.kind,
        status: campaign.status,
        phase: campaignPhase(campaign),
        discountPercent: campaign.discountPercent,
        discountScope: campaign.discountScope,
        textMode: campaign.textMode,
        heroMode: campaign.heroMode,
        dailyTarget: campaign.dailyTarget,
        audienceText: audienceText(campaign, campaigns),
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        audienceRefreshedAt: campaign.audienceRefreshedAt,
      }}
      campaigns={campaigns
        .filter((c) => c.status !== "archiviert")
        .map((c) => ({ id: c.id, name: c.name, slug: c.slug, kind: c.kind, phase: campaignPhase(c), drafted: c.stats.drafted }))}
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
      heroDesignActive={campaign.heroMode !== "none" && emailDesignHasHero(design?.key)}
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
