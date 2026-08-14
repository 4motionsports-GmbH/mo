// Campaign draft preparation (Task C) — batch pre-generation so the review
// queue is instant: read → tweak → send/copy → next.
//
// Shared by POST /api/admin/campaign/prepare (batch over the next N pending
// contacts) and POST /api/admin/campaign/draft (single regenerate / depth
// change). Per contact: re-check suppression (fail-closed), read the order
// history from Shopify AT DRAFT TIME, pick recommendations, generate the AI
// draft around the PLACEHOLDER code (MO-XXXX) + projected expiry, and persist.
// Resilient: a per-contact failure marks that contact 'draft_failed' and the
// batch continues.
//
// Generation costs API money — there is deliberately NO cron that calls this;
// the admin triggers "Prepare next 50" explicitly.

import { isSuppressed } from "./email-capture-store";
import {
  PLACEHOLDER_DISCOUNT_CODE,
  discountExpiryDaysPublic,
  formatExpiryDateForLanguage,
} from "./shopify-discounts";
import { generateCampaignDraft } from "./campaign-draft";
import { loadCampaignPersonalization } from "./campaign-recommendations";
import { getActiveBundleForCampaignContact } from "./bundle-offers-store";
import { archiveBundleOffer, createBundleOffer } from "./bundle-offers";
import { bundleStattPrice } from "./bundle-email-core.mjs";
import { getProductsByIds } from "./product-catalog";
import { isAvailable } from "./availability.mjs";
import {
  getDraftForContact,
  listNextPendingContacts,
  markContactDraftFailed,
  saveCampaignDraft,
  upsertCampaignContact,
  type CampaignContactRow,
  type CampaignDraftRow,
} from "./campaign-store";
import { reportError } from "./observability";

/** Projected expiry the real MK- code will get, for the preview (same rule as
 * the marketing draft route: the send step swaps in the real date if they
 * drift apart). */
function projectedExpiry(): Date {
  return new Date(Date.now() + discountExpiryDaysPublic() * 86_400_000);
}

export interface PrepareDraftOptions {
  /**
   * Recompute the recommended products from the (possibly narrowed) purchase
   * basis instead of PRESERVING the draft's stored list. Default false: a
   * plain regenerate (text, discount depth, language) keeps the products the
   * card shows — including manual curation — so the prose and the picture grid
   * can never drift apart from the review card.
   */
  refreshRecommendations?: boolean;
  /**
   * New purchase-basis selection to persist (catalog product ids; null = all
   * purchases). Omit to keep the draft's stored selection.
   */
  purchaseSelection?: string[] | null;
}

/**
 * Generate + persist the draft for ONE contact. Throws on failure — batch
 * callers catch per contact. Returns null only when the DB vanished mid-run.
 */
export async function prepareDraftForContact(
  contact: CampaignContactRow,
  discountPercent: number,
  opts: PrepareDraftOptions = {}
): Promise<CampaignDraftRow | null> {
  const existing = await getDraftForContact(contact.id);
  // The effective purchase basis: an explicit new selection wins, else the
  // draft's stored one, else all purchases.
  const purchaseSelection =
    opts.purchaseSelection !== undefined
      ? opts.purchaseSelection
      : (existing?.purchaseSelectedIds ?? null);

  const { history, purchaseSummary, recommendations } = await loadCampaignPersonalization(
    contact.email,
    purchaseSelection
  );

  // Which products the email recommends: preserve the draft's stored list
  // (auto-picked or manually curated) on a plain regenerate; recompute only
  // for the first draft or an explicit refresh. Stored products that dropped
  // out of the catalog / went out of stock are silently dropped; when nothing
  // survives, fall back to a fresh auto-pick.
  let recommendedProducts = recommendations.products;
  let lowConfidence = recommendations.lowConfidence;
  if (!opts.refreshRecommendations && existing && existing.recommendedProductIds.length > 0) {
    const stored = (await getProductsByIds(existing.recommendedProductIds)).filter((p) =>
      isAvailable(p)
    );
    if (stored.length > 0) {
      recommendedProducts = stored;
      lowConfidence = existing.lowConfidence;
    }
  }

  // An explicit recommendation refresh keeps an attached bundle in sync with
  // the new product set: snapshots are immutable, so "update" = archive + new
  // offer from the fresh picks (same rule as the /recommendations route).
  if (opts.refreshRecommendations && recommendedProducts.length > 0) {
    const active = await getActiveBundleForCampaignContact(contact.id);
    const newIds = recommendedProducts.map((p) => p.id);
    const sameSet =
      active &&
      active.components.length === newIds.length &&
      active.components.every((c) => newIds.includes(c.productId));
    if (active && !sameSet) {
      const archived = await archiveBundleOffer(active.id);
      if (archived.ok) {
        const created = await createBundleOffer(
          null,
          newIds.map((productId) => ({ productId })),
          { campaignContactId: contact.id }
        );
        if (!created.ok) {
          reportError(new Error(`Bundle rebuild failed: ${created.message}`), {
            route: "lib/campaign-prepare",
            phase: "rebuildBundle",
            contactId: String(contact.id),
          });
        }
      }
    }
  }

  const hasDiscount = discountPercent > 0;
  const expiry = hasDiscount ? projectedExpiry() : null;

  // An attached (active) bundle offer is referenced NATURALLY in the prose;
  // the deterministic offer block itself is appended at send time
  // (campaign-email.ts). Same division of labour as the marketing draft.
  const bundle = await getActiveBundleForCampaignContact(contact.id);
  const attachedBundle = bundle
    ? {
        title:
          bundle.title ??
          (contact.language === "en" ? "Your personal set" : "Dein persönliches Set"),
        componentNames: bundle.components.map((c) => c.title),
        hasSaving: bundleStattPrice(bundle.bundlePrice, bundle.componentsSum) != null,
      }
    : null;

  // A narrowed basis also steers the PROSE: the purchase reference sticks to
  // the selected products (titles resolved from the fetched history).
  const focusPurchaseTitles =
    purchaseSelection && history
      ? [
          ...new Set(
            history.orders
              .flatMap((o) => o.items)
              .filter((i) => i.handle && purchaseSelection.includes(i.handle))
              .map((i) => i.title)
              .filter((t): t is string => Boolean(t))
          ),
        ]
      : null;

  const draft = await generateCampaignDraft({
    language: contact.language,
    firstName: contact.firstName,
    purchaseSummary,
    focusPurchaseTitles,
    recommendations: recommendedProducts.map((p) => ({
      name: p.name,
      url: p.shopifyUrl,
      category: p.category || null,
    })),
    lowConfidence,
    attachedBundle,
    discountCode: hasDiscount ? PLACEHOLDER_DISCOUNT_CODE : null,
    discountPercent,
    // The expiry label the prose states, in the contact's language (English
    // drafts get "31 July 2026" instead of the German 31.07.2026).
    discountExpiresLabel: expiry
      ? formatExpiryDateForLanguage(expiry, contact.language)
      : null,
    discountValidityDays: hasDiscount ? discountExpiryDaysPublic() : null,
  });

  return saveCampaignDraft({
    contactId: contact.id,
    subject: draft.subject,
    body: draft.body,
    discountPercent,
    discountExpiresAt: expiry ? expiry.toISOString() : null,
    purchaseSummary,
    recommendedProductIds: recommendedProducts.map((p) => p.id),
    productHighlights: draft.productHighlights,
    purchaseSelectedIds: purchaseSelection,
    lowConfidence,
  });
}

export interface PrepareBatchResult {
  requested: number;
  prepared: number;
  failed: number;
  /** Contacts found suppressed at prepare time (marked, never drafted). */
  suppressed: number;
  /** Fewer pending contacts existed than requested. */
  exhausted: boolean;
}

/**
 * Prepare drafts for the next `count` pending contacts, sequentially with
 * modest concurrency. Never throws — per-contact failures are recorded
 * ('draft_failed') and the run continues.
 */
export async function prepareNextDrafts(
  count: number,
  discountPercent: number,
  concurrency = 3
): Promise<PrepareBatchResult> {
  const contacts = await listNextPendingContacts(count);
  const result: PrepareBatchResult = {
    requested: count,
    prepared: 0,
    failed: 0,
    suppressed: 0,
    exhausted: contacts.length < count,
  };

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < contacts.length) {
      const contact = contacts[cursor++];
      try {
        // Suppression re-check at prepare time (fail-closed): a contact whose
        // address opted out since the last sync is marked and never drafted.
        if (await isSuppressed(contact.email)) {
          await upsertCampaignContact({
            shopifyCustomerId: contact.shopifyCustomerId,
            email: contact.email,
            firstName: contact.firstName,
            lastName: contact.lastName,
            language: contact.language,
            optInLevel: contact.optInLevel ?? "UNKNOWN",
            consentUpdatedAt: contact.consentUpdatedAt,
            ordersCount: contact.ordersCount,
            totalSpentCents: contact.totalSpentCents,
            status: "suppressed",
          });
          result.suppressed++;
          continue;
        }
        const draft = await prepareDraftForContact(contact, discountPercent);
        if (draft) result.prepared++;
        else result.failed++;
      } catch (err) {
        reportError(err, {
          route: "lib/campaign-prepare",
          phase: "prepareContact",
          contactId: String(contact.id),
        });
        await markContactDraftFailed(contact.id);
        result.failed++;
      }
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, contacts.length)) },
    () => worker()
  );
  await Promise.all(workers);
  return result;
}
