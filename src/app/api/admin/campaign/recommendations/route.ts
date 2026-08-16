// POST /api/admin/campaign/recommendations  { contactId, productIds }
//
// Review-time manual control over a draft's recommended products: the admin
// swaps products in/out via the catalog picker (same /api/admin/catalog/search
// backing as the bundle composer). Persists the curated list on the draft and
// — when a bundle offer is attached — REBUILDS the offer to match: bundle
// snapshots are immutable (prices are pinned at creation), so "update" means
// archive the old set + create a new one from the new product list through the
// unchanged bundle mechanism. A bundle rebuild failure never loses the saved
// recommendations; it is reported so the admin can retry.
//
// The PROSE is not touched here — the UI chains a regenerate right after,
// which PRESERVES this curated list (prepareDraftForContact), so the fresh
// text talks about exactly these products. Auth + CSRF via guardAdminPost.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  getContactById,
  updateCampaignDraftRecommendations,
} from "@/lib/campaign-store";
import {
  getActiveBundleForCampaignContact,
} from "@/lib/bundle-offers-store";
import { archiveBundleOffer, createBundleOffer } from "@/lib/bundle-offers";
import { resolveProductSelections } from "@/lib/product-catalog";
import { parseProductRef } from "@/lib/product-ref.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;

// Keep the email focused — same ballpark as the generated 2–3 picks.
const MAX_RECOMMENDATIONS = 5;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let contactId: number;
  let productIds: string[];
  try {
    const body = (await req.json()) as { contactId?: unknown; productIds?: unknown };
    contactId = Number(body.contactId);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return adminJsonError("bad_request", "contactId required", 400);
    }
    if (!Array.isArray(body.productIds)) {
      return adminJsonError("bad_request", "productIds must be an array", 400);
    }
    productIds = [...new Set(body.productIds.map((p) => String(p ?? "").trim()))].filter(
      Boolean
    );
    if (productIds.length === 0 || productIds.length > MAX_RECOMMENDATIONS) {
      return adminJsonError(
        "bad_request",
        `productIds must contain 1–${MAX_RECOMMENDATIONS} catalog product ids.`,
        400
      );
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const contact = await getContactById(contactId);
    if (!contact) return adminJsonError("not_found", "Contact not found.", 404);
    if (contact.status !== "drafted") {
      return adminJsonError("not_editable", "Contact is not in review.", 409);
    }

    // Validate against the sync-fresh catalog; refuse unknown products,
    // vanished pinned variants and sold-out picks (a recommendation must be
    // currently recommendable — same bar as generation's filterAvailable and
    // the bundle's compose-time check). productIds may be refs
    // ("handle~variantId") pinning a concrete variant.
    const selections = await resolveProductSelections(productIds);
    const foundRefs = new Set(selections.map((s) => s.ref));
    const unknown = productIds.filter((id) => !foundRefs.has(id));
    if (unknown.length > 0) {
      return adminJson(
        { error: { code: "unknown_products", message: "Not in the catalog." }, offenders: unknown },
        400
      );
    }
    const goneVariants = selections.filter((s) => s.missingVariant).map((s) => s.ref);
    if (goneVariants.length > 0) {
      return adminJson(
        {
          error: {
            code: "variant_not_found",
            message: "The selected variant no longer exists — re-pick it.",
          },
          offenders: goneVariants,
        },
        409
      );
    }
    const soldOut = selections.filter((s) => !s.available).map((s) => s.ref);
    if (soldOut.length > 0) {
      return adminJson(
        { error: { code: "sold_out", message: "Sold-out products cannot be recommended." }, offenders: soldOut },
        409
      );
    }

    const draft = await updateCampaignDraftRecommendations(contactId, productIds);
    if (!draft) {
      return adminJsonError("not_editable", "Draft not found or no longer editable.", 409);
    }

    // Keep an attached bundle in sync: archive + recreate from the new list.
    let bundle = null;
    let bundleError: string | null = null;
    const existing = await getActiveBundleForCampaignContact(contactId);
    if (existing) {
      const archived = await archiveBundleOffer(existing.id);
      if (!archived.ok) {
        bundleError = `Bestehendes Set konnte nicht archiviert werden: ${archived.message}`;
      } else {
        const created = await createBundleOffer(
          null,
          productIds.map((ref) => {
            const { productId, variantId } = parseProductRef(ref);
            return { productId, ...(variantId ? { variantId } : {}) };
          }),
          { campaignContactId: contactId }
        );
        if (created.ok) bundle = created.offer;
        else bundleError = `Set konnte nicht neu erstellt werden: ${created.message}`;
      }
    }

    return adminJson({
      ok: true,
      // id = the full ref, so the review card round-trips variants intact;
      // name/url are the variant-projected display values.
      recommendations: selections.map((s) => ({
        id: s.ref,
        name: s.display?.name ?? s.product.name,
        url: s.display?.shopifyUrl ?? s.product.shopifyUrl ?? null,
      })),
      bundle: bundle
        ? {
            id: bundle.id,
            title: bundle.title ?? "Dein persönliches Set",
            components: bundle.components.map((c) => c.title),
            bundlePrice: bundle.bundlePrice,
            componentsSum: bundle.componentsSum,
            currency: bundle.currency,
            expiresAt: bundle.expiresAt,
          }
        : null,
      bundleError,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/recommendations" });
    return adminJsonError("internal_error", "Could not update the recommendations.", 500);
  }
}
