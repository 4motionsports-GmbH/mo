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
  formatGermanExpiryDate,
} from "./shopify-discounts";
import { generateCampaignDraft } from "./campaign-draft";
import { loadCampaignPersonalization } from "./campaign-recommendations";
import {
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

/**
 * Generate + persist the draft for ONE contact. Throws on failure — batch
 * callers catch per contact. Returns null only when the DB vanished mid-run.
 */
export async function prepareDraftForContact(
  contact: CampaignContactRow,
  discountPercent: number
): Promise<CampaignDraftRow | null> {
  const { purchaseSummary, recommendations } = await loadCampaignPersonalization(
    contact.email
  );

  const hasDiscount = discountPercent > 0;
  const expiry = hasDiscount ? projectedExpiry() : null;

  const draft = await generateCampaignDraft({
    language: contact.language,
    firstName: contact.firstName,
    purchaseSummary,
    recommendations: recommendations.products.map((p) => ({
      name: p.name,
      url: p.shopifyUrl,
      category: p.category || null,
    })),
    lowConfidence: recommendations.lowConfidence,
    discountCode: hasDiscount ? PLACEHOLDER_DISCOUNT_CODE : null,
    discountPercent,
    discountExpiresLabel: expiry ? formatGermanExpiryDate(expiry) : null,
    discountValidityDays: hasDiscount ? discountExpiryDaysPublic() : null,
  });

  return saveCampaignDraft({
    contactId: contact.id,
    subject: draft.subject,
    body: draft.body,
    discountPercent,
    discountExpiresAt: expiry ? expiry.toISOString() : null,
    purchaseSummary,
    recommendedProductIds: recommendations.products.map((p) => p.id),
    lowConfidence: recommendations.lowConfidence,
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
