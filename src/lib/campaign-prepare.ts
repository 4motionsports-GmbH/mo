// Campaign draft preparation (Task C) — batch pre-generation so the review
// queue is instant: read → tweak → send/copy → next.
//
// Shared by POST /api/admin/campaign/prepare (batch over the next N pending
// recipients of ONE campaign), POST /api/admin/campaign/draft (single
// regenerate / depth change) and the nightly auto-prepare of campaigns that
// opted in (auto_prepare_per_day, bounded by CAMPAIGN_AUTO_PREPARE_COUNT).
// Per recipient: re-check block + consent (fail-closed), read the purchase
// history from the local order ledger (Shopify only for people not mirrored
// yet), pick recommendations, generate the AI draft around the PLACEHOLDER
// code (MO-XXXX) + projected expiry with the campaign's briefing, and
// persist. Resilient: a per-recipient failure marks that row 'draft_failed'
// and the batch continues.

import { isSuppressed } from "./email-capture-store";
import { getCampaignForContact, getCampaign, type Campaign } from "./campaigns-store";
import { campaignDiscountExpiry } from "./campaign-def.mjs";
import { formatAdmin, ADMIN_DATE } from "./admin-datetime.mjs";
import { loadPurchaseHistory } from "./customer-orders-store";
import {
  PLACEHOLDER_DISCOUNT_CODE,
  discountExpiryDaysPublic,
  formatExpiryDateForLanguage,
} from "./shopify-discounts";
import { generateCampaignDraft } from "./campaign-draft";
import type { EmailTextMode } from "./marketing-draft";
import { DEFAULT_EMAIL_TEXT_MODE, storedTextMode } from "./email-text-mode.mjs";
import { DEFAULT_DISCOUNT_SCOPE, parseDiscountScope, type DiscountScope } from "./discount-scope.mjs";
import { loadCampaignPersonalization } from "./campaign-recommendations";
import { getActiveBundleForCampaignContact } from "./bundle-offers-store";
import { archiveBundleOffer, createBundleOffer } from "./bundle-offers";
import { bundleStattPrice } from "./bundle-email-core.mjs";
import { resolveProductSelections } from "./product-catalog";
import type { Product } from "./types";
import {
  getDraftForContact,
  listNextPendingContacts,
  markContactDraftFailed,
  markContactSuppressed,
  saveCampaignDraft,
  type CampaignContactRow,
  type CampaignDraftRow,
} from "./campaign-store";
import { reportError } from "./observability";
import { getCustomerByEmail, getCustomerById, type Customer } from "./customer-store";
import { ARCHETYPE_META } from "./persona";
import type { PersonaArchetype } from "./types";

/** The customer record whose profile this draft reads: the linked customer,
 *  or — for a Testkontakt borrowing a real customer's history — that
 *  customer's. Null when there is none (the draft then works as before). */
async function profileCustomerFor(contact: CampaignContactRow): Promise<Customer | null> {
  if (contact.testSourceEmail) return getCustomerByEmail(contact.testSourceEmail);
  return contact.customerId != null ? getCustomerById(contact.customerId) : null;
}

/** Projected expiry the real MK- code will get, for the preview (same rule as
 * the send step, which swaps in the real date if they drift apart): an
 * Aktion's end date, else the usual validity. */
export function projectedExpiry(campaign: Pick<Campaign, "discountValidUntil"> | null): Date {
  return new Date(
    campaignDiscountExpiry(
      { discountValidUntil: campaign?.discountValidUntil ?? null },
      discountExpiryDaysPublic()
    )
  );
}

/** Whole days between now and an expiry (the "gültig N Tage" the prose may state). */
export function daysUntil(d: Date): number {
  return Math.max(1, Math.round((d.getTime() - Date.now()) / 86_400_000));
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
  /**
   * Text mode for the generated prose (email-text-mode.mjs). Omit to keep the
   * existing draft's stored mode (legacy NULL = 'detailed'); a FIRST draft
   * without an explicit mode uses the modern default ('compact').
   */
  textMode?: EmailTextMode | null;
  /**
   * What the discount code applies to (discount-scope.mjs). Omit to keep the
   * existing draft's stored scope; a first draft defaults to "all".
   */
  discountScope?: DiscountScope | null;
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
  // The effective text mode: an explicit request wins, else the existing
  // draft's stored mode (legacy NULL = 'detailed'), else the modern default
  // for a brand-new draft.
  const textMode: EmailTextMode =
    opts.textMode ?? (existing ? storedTextMode(existing) : DEFAULT_EMAIL_TEXT_MODE);
  // The effective discount scope: an explicit request wins, else the existing
  // draft's stored scope, else "all" (the classic behaviour).
  const discountScope: DiscountScope = parseDiscountScope(
    opts.discountScope ?? existing?.discountScope ?? DEFAULT_DISCOUNT_SCOPE
  );

  // A Testkontakt may borrow a real customer's purchase history so the mail
  // is realistic (0057); everything else about the draft is the test address.
  // The central customer profile (migration 0059) steers both the product
  // picks and the prose.
  const loadedCustomer = await profileCustomerFor(contact);
  // An Art. 21 objection to profiling: no AI profile is read for the mail.
  const profileCustomer = loadedCustomer?.profileObjectionAt ? null : loadedCustomer;
  const campaign = await getCampaignForContact(contact.id);
  // The purchase history comes from the local order ledger once the person
  // is mirrored; a Testkontakt without a mirrored source reads Shopify.
  const preloaded = loadedCustomer ? await loadPurchaseHistory(loadedCustomer) : undefined;
  const { history, purchaseSummary, recommendations, segment } =
    await loadCampaignPersonalization(
      contact.testSourceEmail ?? contact.email,
      purchaseSelection,
      null,
      profileCustomer?.profileData ?? null,
      preloaded ?? undefined
    );

  // Which products the email recommends: preserve the draft's stored list
  // (auto-picked or manually curated, possibly variant-pinned refs) on a plain
  // regenerate; recompute only for the first draft or an explicit refresh.
  // Stored entries that dropped out of the catalog, went out of stock, or
  // whose PINNED VARIANT vanished are dropped (never silently downgraded to
  // the default variant — the operator approved a concrete price); when
  // nothing survives, fall back to a fresh auto-pick.
  // recommendedProducts are DISPLAY products (variant-projected for refs);
  // recommendedRefs is what gets re-saved, keeping variants intact.
  let recommendedProducts = recommendations.products;
  let recommendedRefs = recommendations.products.map((p) => p.id);
  let lowConfidence = recommendations.lowConfidence;
  if (!opts.refreshRecommendations && existing && existing.recommendedProductIds.length > 0) {
    const stored = (await resolveProductSelections(existing.recommendedProductIds)).filter(
      (s) => !s.missingVariant && s.available && s.display
    );
    if (stored.length > 0) {
      recommendedProducts = stored.map((s) => s.display as Product);
      recommendedRefs = stored.map((s) => s.ref);
      lowConfidence = existing.lowConfidence;
    }
  }

  // An explicit recommendation refresh keeps an attached bundle in sync with
  // the new product set: snapshots are immutable, so "update" = archive + new
  // offer from the fresh picks (same rule as the /recommendations route).
  if (opts.refreshRecommendations && recommendedProducts.length > 0) {
    const active = await getActiveBundleForCampaignContact(contact.id);
    // A refresh always holds fresh auto-picks — bare product ids, no refs.
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
  const expiry = hasDiscount ? projectedExpiry(campaign) : null;

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
    campaign: campaign
      ? {
          name: campaign.name,
          kind: campaign.kind,
          brief: campaign.brief,
          endsLabel: campaign.endsAt ? formatAdmin(campaign.endsAt, ADMIN_DATE) : null,
        }
      : null,
    adminNote: contact.adminNote,
    purchaseSummary,
    focusPurchaseTitles,
    recommendations: recommendedProducts.map((p) => ({
      name: p.name,
      url: p.shopifyUrl,
      category: p.category || null,
    })),
    lowConfidence,
    attachedBundle,
    textMode,
    segment,
    customerProfile: profileCustomer?.profileSummary
      ? {
          summary: profileCustomer.profileSummary,
          data: profileCustomer.profileData,
          personaDisplay:
            (profileCustomer.personaLabel &&
              ARCHETYPE_META[profileCustomer.personaLabel as PersonaArchetype]?.label) ||
            null,
        }
      : null,
    recommendationStrategy: recommendations.strategy,
    discountCode: hasDiscount ? PLACEHOLDER_DISCOUNT_CODE : null,
    discountPercent,
    discountScope,
    // The expiry label the prose states, in the contact's language (English
    // drafts get "31 July 2026" instead of the German 31.07.2026).
    discountExpiresLabel: expiry
      ? formatExpiryDateForLanguage(expiry, contact.language)
      : null,
    discountValidityDays: expiry ? daysUntil(expiry) : null,
  });

  return saveCampaignDraft({
    contactId: contact.id,
    subject: draft.subject,
    body: draft.body,
    discountPercent,
    discountExpiresAt: expiry ? expiry.toISOString() : null,
    discountScope,
    purchaseSummary,
    recommendedProductIds: recommendedRefs,
    productHighlights: draft.productHighlights,
    purchaseSelectedIds: purchaseSelection,
    textMode,
    segment: segment.key,
    segmentDays: segment.days,
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
  /** The contacts that got a draft in this run — the desk uses the ids to
   * generate heroes for the A group right after preparing. */
  preparedContactIds: number[];
}

/** Is the address blocked or without the one consent? (fail-closed) */
async function blockedForMarketing(contact: CampaignContactRow): Promise<string | null> {
  if (await isSuppressed(contact.email)) return "gesperrt";
  if (contact.isTest || contact.customerId == null) return null;
  const customer = await getCustomerById(contact.customerId);
  if (!customer) return "kein_kunde";
  return customer.emailConsentState === "subscribed" ? null : "keine_einwilligung";
}

export interface PrepareBatchInput {
  campaignId: number;
  count: number;
  /** Overrides of the campaign's offer defaults (the Vorbereiten popover). */
  discountPercent?: number;
  textMode?: EmailTextMode;
  discountScope?: DiscountScope;
  concurrency?: number;
}

/**
 * Prepare drafts for the next `count` pending recipients of one campaign,
 * with modest concurrency. Never throws — per-recipient failures are recorded
 * ('draft_failed') and the run continues. A campaign that is not active (or
 * whose end passed) prepares nothing.
 */
export async function prepareNextDrafts(input: PrepareBatchInput): Promise<PrepareBatchResult & { campaignClosed?: boolean }> {
  const { count } = input;
  const campaign = await getCampaign(input.campaignId);
  const empty = { requested: count, prepared: 0, failed: 0, suppressed: 0, exhausted: true, preparedContactIds: [] };
  if (!campaign || campaign.status !== "aktiv" || (campaign.endsAt && new Date(campaign.endsAt) <= new Date())) {
    return { ...empty, campaignClosed: true };
  }
  const discountPercent = input.discountPercent ?? campaign.discountPercent;
  const textMode = input.textMode ?? campaign.textMode ?? DEFAULT_EMAIL_TEXT_MODE;
  const discountScope = input.discountScope ?? campaign.discountScope ?? DEFAULT_DISCOUNT_SCOPE;
  const concurrency = input.concurrency ?? 3;
  const contacts = await listNextPendingContacts(campaign.id, count, { windowed: campaign.kind === "laufend" });
  const result: PrepareBatchResult = {
    requested: count,
    prepared: 0,
    failed: 0,
    suppressed: 0,
    exhausted: contacts.length < count,
    preparedContactIds: [],
  };

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < contacts.length) {
      const contact = contacts[cursor++];
      try {
        // Block + consent re-check at prepare time (fail-closed): a person
        // who opted out or got blocked since the last refresh is marked and
        // never drafted.
        const blocked = await blockedForMarketing(contact);
        if (blocked) {
          await markContactSuppressed(contact.id, blocked);
          result.suppressed++;
          continue;
        }
        const draft = await prepareDraftForContact(contact, discountPercent, { textMode, discountScope });
        if (draft) {
          result.prepared++;
          result.preparedContactIds.push(contact.id);
        } else {
          result.failed++;
        }
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
