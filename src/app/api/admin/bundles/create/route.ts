// POST /api/admin/bundles/create
//   { customerId?, components: [{ productId, variantId?, quantity? }],
//     bundlePriceOverride?, title?, expiryDays?, marketingSendId?,
//     campaignContactId? }
//
// variantId (numeric Shopify id) pins a specific variant of the component —
// the picker's second-stage selection; omitted = default variant. A ref
// ("handle~123") as productId is split the same way. quantity: 1 to
// BUNDLE_QUANTITY_MAX (10) units of that item; omitted = 1.
//
// Refusals carry { error: { code, message }, offenders, offenderNames } — the
// German message already names the offending items.
//
// A set makes the attached draft a set mail (offer-mode.mjs): on success the
// campaign draft's / legacy draft's discount is cleared (discountCleared).
//
// Create a personalized bundle offer (S10). customerId is optional (null = an
// ad-hoc offer); campaignContactId attaches the offer to a campaign contact
// instead (docs/CAMPAIGNS.md §4). All the validation, snapshotting, Shopify
// creation and persistence live in createBundleOffer (lib/bundle-offers).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  createBundleOffer,
  type BundleComponentInput,
  type CreateBundleOfferOptions,
} from "@/lib/bundle-offers";
import { reportError } from "@/lib/observability";
import { BUNDLE_QUANTITY_MAX } from "@/lib/bundle-offer-core.mjs";
import { updateCampaignDraftDiscount } from "@/lib/campaign-store";
import { clearDraftDiscount } from "@/lib/marketing-store";

export const maxDuration = 60;

// Domain refusal reasons → HTTP statuses.
const STATUS_BY_REASON: Record<string, number> = {
  not_configured: 503,
  no_db: 503,
  empty: 400,
  unknown_products: 400,
  sold_out: 409,
  no_variant: 422,
  // The pinned variant vanished between picking and creating (catalog sync
  // ran in between) — a conflict the UI resolves by re-picking.
  variant_not_found: 409,
  bad_quantity: 400,
  bad_price: 400,
  create_failed: 502,
};

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let customerId: number | null;
  let components: BundleComponentInput[];
  let options: CreateBundleOfferOptions;
  try {
    const body = (await req.json()) as {
      customerId?: unknown;
      components?: unknown;
      bundlePriceOverride?: unknown;
      title?: unknown;
      expiryDays?: unknown;
      marketingSendId?: unknown;
      campaignContactId?: unknown;
    };

    // customerId optional (null = ad-hoc); when present it must be a positive int.
    if (body.customerId == null) {
      customerId = null;
    } else {
      const cid = Number(body.customerId);
      if (!Number.isInteger(cid) || cid <= 0) {
        return adminJsonError("bad_request", "customerId must be a positive integer or omitted", 400);
      }
      customerId = cid;
    }

    if (!Array.isArray(body.components) || body.components.length === 0) {
      return adminJsonError("bad_request", "components must be a non-empty array", 400);
    }
    let badQuantity = false;
    components = body.components.map((c) => {
      const item = c as { productId?: unknown; variantId?: unknown; quantity?: unknown };
      const productId = String(item.productId ?? "").trim();
      const variantId =
        item.variantId != null && String(item.variantId).trim() !== ""
          ? String(item.variantId).trim()
          : null;
      const quantity = item.quantity != null ? Number(item.quantity) : undefined;
      if (quantity != null && (!Number.isInteger(quantity) || quantity < 1 || quantity > BUNDLE_QUANTITY_MAX)) {
        badQuantity = true;
      }
      return {
        productId,
        ...(variantId ? { variantId } : {}),
        ...(quantity != null ? { quantity } : {}),
      };
    });
    if (components.some((c) => !c.productId)) {
      return adminJsonError("bad_request", "every component needs a productId", 400);
    }
    if (badQuantity) {
      return adminJsonError(
        "bad_quantity",
        `Anzahl pro Produkt: 1 bis ${BUNDLE_QUANTITY_MAX} Stück.`,
        400
      );
    }

    const expiryDays = body.expiryDays != null ? Number(body.expiryDays) : undefined;
    if (expiryDays != null && (!Number.isFinite(expiryDays) || expiryDays <= 0)) {
      return adminJsonError("bad_request", "expiryDays must be a positive number", 400);
    }
    const marketingSendId = body.marketingSendId != null ? Number(body.marketingSendId) : null;
    const campaignContactId =
      body.campaignContactId != null ? Number(body.campaignContactId) : null;
    if (campaignContactId != null && (!Number.isInteger(campaignContactId) || campaignContactId <= 0)) {
      return adminJsonError(
        "bad_request",
        "campaignContactId must be a positive integer or omitted",
        400
      );
    }

    options = {
      bundlePriceOverride:
        body.bundlePriceOverride != null ? (body.bundlePriceOverride as number | string) : null,
      title: body.title != null ? String(body.title) : null,
      ...(expiryDays != null ? { expiryDays } : {}),
      marketingSendId: Number.isInteger(marketingSendId) ? marketingSendId : null,
      campaignContactId,
    };
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const result = await createBundleOffer(customerId, components, options);
    if (result.ok) {
      // The set turns the draft into a set mail, which carries no discount
      // code (offer-mode.mjs): clear the draft's depth so the regenerate
      // writes for the set. Fail-soft — the send gates refuse a set mail that
      // still has a code anyway.
      let discountCleared = false;
      if (options.campaignContactId != null) {
        discountCleared = Boolean(
          await updateCampaignDraftDiscount(options.campaignContactId, 0, null, "all")
        );
      } else if (options.marketingSendId != null) {
        discountCleared = await clearDraftDiscount(options.marketingSendId);
      }
      return adminJson({ ok: true, offer: result.offer, redirectUrl: result.redirectUrl, discountCleared });
    }
    const status = STATUS_BY_REASON[result.reason] ?? 400;
    // Error envelope ({ error: { code, message } }) plus structured detail so the
    // S11 UI can surface which components were sold out / unknown.
    return adminJson(
      {
        error: { code: result.reason, message: result.message },
        ...(result.offenders ? { offenders: result.offenders } : {}),
        ...(result.offenderNames ? { offenderNames: result.offenderNames } : {}),
        ...(result.offer ? { offer: result.offer } : {}),
      },
      status
    );
  } catch (err) {
    reportError(err, { route: "api/admin/bundles/create" });
    return adminJsonError("internal_error", "Bundle creation failed.", 500);
  }
}
