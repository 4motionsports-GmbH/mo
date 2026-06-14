// Bundle-offer service layer (S10) — the orchestration the admin API + cron call.
//
// Composes the pure core logic (bundle-offer-core.mjs), the DB store
// (bundle-offers-store.ts) and the Shopify seam (shopify-bundles.ts) into the
// three operations the product needs:
//   - createBundleOffer  — validate → snapshot → run the seam → persist active/failed
//   - archiveBundleOffer  — manual archive (S11 UI) → Shopify ARCHIVED + status=expired
//   - expireBundleOffers  — the daily cron sweep (idempotent)
//
// See docs/BUNDLES.md for the model, the two creation modes + seam, and the
// lifecycle; docs/BUNDLES_SPIKE.md for the live verification this builds on.

import { loadProductCatalog } from "./catalog-store";
import { buildShopifyCartUrl } from "./shopify-cart-url.mjs";
import { getBaseUrl } from "./base-url";
import { isShopifyConfigured } from "./shopify";
import {
  resolveBundleCreationMode,
  computeComponentsSum,
  computeCompareAtPrice,
  validateAndSnapshotComponents,
  toCents,
  centsToMoney,
  runBundleExpirySweep,
  isDeletableBundleStatus,
} from "./bundle-offer-core.mjs";
import {
  createBundleProduct,
  archiveBundleProduct,
  type BundleComponentSnapshot,
} from "./shopify-bundles";
import {
  insertPendingOffer,
  markOfferActive,
  markOfferFailed,
  markOfferExpired,
  deleteDraftOffer,
  getBundleOfferById,
  fetchDueBundleOffers,
  type BundleOfferRow,
  type BundleComponentRecord,
} from "./bundle-offers-store";
import { reportError } from "./observability";

export type {
  BundleOfferRow,
  BundleComponentRecord,
} from "./bundle-offers-store";
export { listBundleOffersForCustomer } from "./bundle-offers-store";

/** The configured creation mode (the seam selector). Default native_fixed_bundle. */
export function bundleCreationMode(): string {
  return resolveBundleCreationMode(process.env.BUNDLE_CREATION_MODE);
}

/** Days an offer stays live before the cron archives it (env-overridable, 7). */
export function bundleExpiryDays(): number {
  const raw = process.env.BUNDLE_OFFER_EXPIRY_DAYS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 7;
}

/** The tracked redirect URL the email CTA uses (/api/r/<token>). */
export function buildBundleRedirectUrl(redirectToken: string | null): string | null {
  if (!redirectToken) return null;
  return `${getBaseUrl()}/api/r/${redirectToken}`;
}

export interface BundleComponentInput {
  productId: string; // catalog id == Shopify handle
  quantity?: number;
}

export interface CreateBundleOfferOptions {
  /** Admin override for the bundle selling price (EUR). Defaults to the component sum. */
  bundlePriceOverride?: number | string | null;
  /** Bundle product title. Defaults to a derived "Set: A + B …". */
  title?: string | null;
  /** Days until expiry (default 7). */
  expiryDays?: number;
  /** Link to the marketing send this offer rides out with, if any. */
  marketingSendId?: number | null;
}

export type CreateBundleOfferResult =
  | { ok: true; offer: BundleOfferRow; redirectUrl: string | null }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "no_db"
        | "empty"
        | "unknown_products"
        | "sold_out"
        | "no_variant"
        | "bad_price"
        | "create_failed";
      message: string;
      /** Offending product ids for the validation reasons. */
      offenders?: string[];
      /** The persisted failed offer (create_failed), for audit. */
      offer?: BundleOfferRow;
    };

function deriveTitle(components: BundleComponentRecord[]): string {
  const names = components.map((c) => c.title);
  return `Set: ${names.join(" + ")}`.slice(0, 250);
}

const VALIDATION_MESSAGES: Record<string, string> = {
  empty: "A bundle needs at least one component.",
  unknown_products: "One or more components are not in the catalog.",
  sold_out: "One or more components are sold out — a native bundle would be unbuyable.",
  no_variant: "One or more components have no resolvable Shopify variant / price.",
};

/**
 * Create a personalized bundle offer end-to-end.
 *
 * Validates components against the sync-fresh catalog (REJECTING sold-out
 * offenders, since native bundles silently die at 0 stock), snapshots each
 * component's current unit price, computes the true component sum (the PAngV
 * "statt €X"), runs the configured creation seam, and persists the result:
 * status='active' with the Shopify ids + materialized cart URL on success, or
 * status='failed' with the recorded error.
 */
export async function createBundleOffer(
  customerId: number | null,
  components: BundleComponentInput[],
  options: CreateBundleOfferOptions = {}
): Promise<CreateBundleOfferResult> {
  if (!isShopifyConfigured()) {
    return { ok: false, reason: "not_configured", message: "Shopify is not configured." };
  }

  // 1. Validate + snapshot against the sync-fresh catalog.
  const catalog = await loadProductCatalog();
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const validated = validateAndSnapshotComponents(byId, components);
  if (!validated.ok) {
    const offenders =
      validated.unknown ?? validated.soldOut ?? validated.noVariant ?? undefined;
    return {
      ok: false,
      reason: validated.reason,
      message: VALIDATION_MESSAGES[validated.reason] ?? "Invalid components.",
      ...(offenders ? { offenders } : {}),
    };
  }
  const snapshot = validated.components as BundleComponentRecord[];

  // 2. Pricing — true sum, admin price (override or the sum), PAngV compare-at.
  const componentsSum = computeComponentsSum(snapshot);
  let bundlePrice = componentsSum;
  if (options.bundlePriceOverride != null && options.bundlePriceOverride !== "") {
    const cents = toCents(options.bundlePriceOverride);
    if (cents == null || cents <= 0) {
      return {
        ok: false,
        reason: "bad_price",
        message: "bundlePriceOverride must be a positive amount.",
      };
    }
    bundlePrice = centsToMoney(cents);
  }
  const compareAtPrice = computeCompareAtPrice(bundlePrice, componentsSum);
  const currency = snapshot[0]?.currency ?? "EUR";
  const title = options.title?.trim() || deriveTitle(snapshot);
  const expiryDays = options.expiryDays && options.expiryDays > 0 ? options.expiryDays : bundleExpiryDays();
  const expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString();
  const mode = bundleCreationMode();

  // 3. Persist the pending offer (mints the redirect token).
  let pending: BundleOfferRow | null;
  try {
    pending = await insertPendingOffer({
      customerId,
      marketingSendId: options.marketingSendId ?? null,
      components: snapshot,
      componentsSum,
      bundlePrice,
      currency,
      title,
      creationMode: mode,
      expiresAt,
    });
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers", phase: "insertPendingOffer" });
    return {
      ok: false,
      reason: "create_failed",
      message: `Could not persist the offer: ${(err as Error).message}`,
    };
  }
  if (!pending) {
    return { ok: false, reason: "no_db", message: "No database configured." };
  }

  // 4. Run the seam (create + finalize + inventory settle).
  try {
    const product = await createBundleProduct({
      mode,
      title,
      components: snapshot as BundleComponentSnapshot[],
      bundlePrice,
      compareAtPrice,
    });

    // 5. Materialize the REAL cart permalink from the parent variant.
    const cartUrl = buildShopifyCartUrl(product.numericVariantId ?? product.variantId);

    const active = await markOfferActive(pending.id, {
      shopifyProductId: product.productId,
      shopifyVariantId: product.variantId,
      numericVariantId: product.numericVariantId,
      shopifyHandle: product.handle,
      bundleOperationId: product.operationId,
      cartUrl,
    });
    if (!active) {
      // The row moved out of 'pending' between insert and update (shouldn't
      // happen for a fresh offer) — surface it rather than silently dropping.
      return {
        ok: false,
        reason: "create_failed",
        message: "Offer was created on Shopify but its row could not be activated.",
        offer: pending,
      };
    }
    return { ok: true, offer: active, redirectUrl: buildBundleRedirectUrl(active.redirectToken) };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    reportError(err, { route: "lib/bundle-offers", phase: "createBundleProduct", offerId: pending.id });
    await markOfferFailed(pending.id, message);
    const failed = await getBundleOfferById(pending.id);
    return {
      ok: false,
      reason: "create_failed",
      message: `Bundle creation failed: ${message}`,
      ...(failed ? { offer: failed } : {}),
    };
  }
}

export type ArchiveBundleOfferResult =
  | { ok: true; offer: BundleOfferRow }
  | { ok: false; reason: "not_found" | "not_active" | "archive_failed"; message: string };

/**
 * Manually archive an offer (S11 UI). Archives the Shopify product (ARCHIVED,
 * never deleted) and flips the row to expired. Idempotent on the row side via
 * the status='active' guard. Only acts on active offers.
 */
export async function archiveBundleOffer(id: number): Promise<ArchiveBundleOfferResult> {
  const offer = await getBundleOfferById(id);
  if (!offer) return { ok: false, reason: "not_found", message: "Offer not found." };
  if (offer.status !== "active") {
    return { ok: false, reason: "not_active", message: `Offer is ${offer.status}, not active.` };
  }
  try {
    if (offer.shopifyProductId) {
      await archiveBundleProduct(offer.shopifyProductId);
    }
    await markOfferExpired(id);
    const updated = (await getBundleOfferById(id)) ?? offer;
    return { ok: true, offer: updated };
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers", phase: "archiveBundleOffer", offerId: id });
    return {
      ok: false,
      reason: "archive_failed",
      message: `Could not archive the offer: ${(err as Error).message}`,
    };
  }
}

export type DeleteDraftBundleOfferResult =
  | { ok: true; offer: BundleOfferRow }
  | {
      ok: false;
      reason: "not_found" | "not_deletable" | "delete_failed";
      message: string;
    };

/**
 * DELETE a draft/unsent bundle offer (S11 UI). STRICT: only the never-published
 * DRAFT states (pending/failed — see isDeletableBundleStatus) are deletable. An
 * active/published or expired offer is rejected with `not_deletable` so the
 * admin uses the ARCHIVE path (archiveBundleOffer), which keeps the Shopify
 * product ARCHIVED and the row for audit/KPIs — delete never orphans a live,
 * sellable product or erases sent/redeemed history.
 *
 * Pre-send a draft shouldn't carry a Shopify product, but we guard anyway: if a
 * (pending/failed) row somehow has a shopify_product_id we ARCHIVE that product
 * first rather than leaving it orphaned on the store, then remove the row.
 */
export async function deleteDraftBundleOffer(
  id: number
): Promise<DeleteDraftBundleOfferResult> {
  const offer = await getBundleOfferById(id);
  if (!offer) return { ok: false, reason: "not_found", message: "Offer not found." };
  if (!isDeletableBundleStatus(offer.status)) {
    return {
      ok: false,
      reason: "not_deletable",
      message: `Offer is ${offer.status}; published/expired offers must be archived, not deleted.`,
    };
  }
  try {
    // Defensive: a draft shouldn't have a live product, but never orphan one.
    if (offer.shopifyProductId) {
      await archiveBundleProduct(offer.shopifyProductId);
    }
    const deleted = await deleteDraftOffer(id);
    if (!deleted) {
      // The row moved out of a deletable state between read and delete (e.g. a
      // racing activation) — surface it rather than reporting a phantom success.
      return {
        ok: false,
        reason: "not_deletable",
        message: "Offer is no longer a deletable draft (it may have just gone live).",
      };
    }
    return { ok: true, offer };
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers", phase: "deleteDraftBundleOffer", offerId: id });
    return {
      ok: false,
      reason: "delete_failed",
      message: `Could not delete the draft offer: ${(err as Error).message}`,
    };
  }
}

export interface ExpireBundleOffersResult {
  archived: number;
  failed: number;
  scanned: number;
  ranAt: string;
}

/**
 * The daily expiry sweep (cron). Archives the Shopify product of every active
 * offer past its deadline and flips it to expired. Idempotent (guarded UPDATE +
 * active-only work list); archive failures are logged LOUDLY and retried next
 * run (the offer stays active+due). Throws only when no DB is configured, so the
 * cron route can report a visible 503.
 */
export async function expireBundleOffers(
  nowIso: string = new Date().toISOString()
): Promise<ExpireBundleOffersResult> {
  const { archived, failed, scanned } = await runBundleExpirySweep({
    fetchDueOffers: () => fetchDueBundleOffers(nowIso),
    archiveProduct: (productId: string) => archiveBundleProduct(productId),
    markExpired: async (id: number | string) => {
      await markOfferExpired(Number(id));
    },
    onError: (err, offer) => {
      reportError(err, {
        route: "lib/bundle-offers",
        phase: "expireBundleOffers",
        offerId: (offer as { id?: number }).id,
      });
      console.error("[bundle-offers] expiry archive FAILED — will retry next run", {
        offerId: (offer as { id?: number }).id,
        error: (err as Error)?.message ?? String(err),
      });
    },
  });
  return { archived, failed, scanned, ranAt: new Date().toISOString() };
}
