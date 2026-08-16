// POST /api/admin/campaign/draft
//   { contactId, discountPercent, regenerate?, refreshRecommendations?,
//     purchaseSelection? }
//
// Generate (or re-generate) the draft for ONE campaign contact — the single-
// contact sibling of /prepare, used by the queue's "Regenerate" action, by
// discount-depth changes, and by the purchase-basis selection. Same idempotency
// rule as the marketing draft route (shouldReuseCampaignDraft): an open draft
// is reused only when the depth matches and no explicit regenerate was
// requested; otherwise it is OVERWRITTEN so the text and the eventual real
// MK- code can never disagree.
//
// A plain regenerate PRESERVES the draft's stored recommended products
// (auto-picked or manually curated — see prepareDraftForContact), so the prose
// always talks about exactly the products the review card shows.
// `refreshRecommendations: true` recomputes them instead — from the purchase
// basis in `purchaseSelection` (catalog product ids; null = all purchases;
// omitted = the draft's stored selection). An attached bundle is rebuilt to
// match on refresh.
//
// The response carries the persisted draft PLUS the resolved recommendation
// products and the (possibly rebuilt) bundle, so the review card can patch
// itself without a reload. Auth + CSRF via guardAdminPost (the proxy already
// gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  getContactById,
  getDraftForContact,
  type CampaignDraftRow,
} from "@/lib/campaign-store";
import { prepareDraftForContact } from "@/lib/campaign-prepare";
import { shouldReuseCampaignDraft } from "@/lib/campaign-draft-core.mjs";
import { getActiveBundleForCampaignContact } from "@/lib/bundle-offers-store";
import { resolveProductSelections } from "@/lib/product-catalog";
import { isSuppressed } from "@/lib/email-capture-store";
import {
  parseDiscountPercent,
  DISCOUNT_PERCENT_MAX,
} from "@/lib/discount-validation.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;

// Sanity bound for the purchase-basis list (a contact's catalog-matched
// purchases, not a free-form cart).
const MAX_SELECTION = 100;

/** The card-facing payload: draft + resolved products + attached bundle.
 * recommendedProductIds may be variant-pinned refs; the id round-trips the
 * full ref while name/url show the chosen variant. */
async function draftResponsePayload(contactId: number, draft: CampaignDraftRow) {
  const selections = await resolveProductSelections(draft.recommendedProductIds);
  const byRef = new Map(selections.map((s) => [s.ref, s]));
  const bundle = await getActiveBundleForCampaignContact(contactId);
  return {
    draft,
    recommendations: draft.recommendedProductIds.map((id) => {
      const s = byRef.get(id);
      return {
        id,
        name: s?.display?.name ?? s?.product.name ?? id,
        url: s?.display?.shopifyUrl ?? s?.product.shopifyUrl ?? null,
      };
    }),
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
  };
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let contactId: number;
  let discountPercent: number;
  let regenerate: boolean;
  let refreshRecommendations: boolean;
  let purchaseSelection: string[] | null | undefined;
  try {
    const body = (await req.json()) as {
      contactId?: unknown;
      discountPercent?: unknown;
      regenerate?: unknown;
      refreshRecommendations?: unknown;
      purchaseSelection?: unknown;
    };
    contactId = Number(body.contactId);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return adminJsonError("bad_request", "contactId required", 400);
    }
    const parsedPercent = parseDiscountPercent(body.discountPercent ?? 0);
    if (parsedPercent === null) {
      return adminJsonError(
        "bad_request",
        `discountPercent must be a whole number between 0 and ${DISCOUNT_PERCENT_MAX}.`,
        400
      );
    }
    discountPercent = parsedPercent;
    regenerate = body.regenerate === true;
    refreshRecommendations = body.refreshRecommendations === true;
    if (body.purchaseSelection === undefined) {
      purchaseSelection = undefined; // keep the draft's stored selection
    } else if (body.purchaseSelection === null) {
      purchaseSelection = null; // back to "all purchases"
    } else if (Array.isArray(body.purchaseSelection)) {
      purchaseSelection = [
        ...new Set(body.purchaseSelection.map((p) => String(p ?? "").trim())),
      ].filter(Boolean);
      if (
        purchaseSelection.length === 0 ||
        purchaseSelection.length > MAX_SELECTION
      ) {
        return adminJsonError(
          "bad_request",
          `purchaseSelection must be null or contain 1–${MAX_SELECTION} product ids.`,
          400
        );
      }
    } else {
      return adminJsonError(
        "bad_request",
        "purchaseSelection must be an array of product ids or null.",
        400
      );
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const contact = await getContactById(contactId);
    if (!contact) return adminJsonError("not_found", "Contact not found.", 404);
    if (contact.status === "sent" || contact.status === "sending") {
      return adminJsonError("already_sent", "Contact has already been sent.", 409);
    }
    if (contact.status === "suppressed" || (await isSuppressed(contact.email))) {
      return adminJsonError(
        "not_eligible",
        "Contact is suppressed/unsubscribed — no draft is generated.",
        409
      );
    }

    // A selection/refresh request always regenerates — reuse would return a
    // draft that ignores the new basis.
    const wantsFresh = regenerate || refreshRecommendations || purchaseSelection !== undefined;
    const existing = await getDraftForContact(contactId);
    if (shouldReuseCampaignDraft(existing, discountPercent, wantsFresh) && existing) {
      return adminJson({ ...(await draftResponsePayload(contactId, existing)), reused: true });
    }

    const draft = await prepareDraftForContact(contact, discountPercent, {
      refreshRecommendations,
      purchaseSelection,
    });
    if (!draft) {
      return adminJsonError("internal_error", "Could not persist the draft.", 500);
    }
    return adminJson({
      ...(await draftResponsePayload(contactId, draft)),
      regenerated: Boolean(existing),
    });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/draft" });
    return adminJsonError("internal_error", "Draft generation failed.", 500);
  }
}
