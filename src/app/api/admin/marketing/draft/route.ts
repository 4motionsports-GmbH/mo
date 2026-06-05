// POST /api/admin/marketing/draft  { captureId, discountPercent, regenerate? }
//
// Generate (or re-generate) the draft marketing email for an eligible contact.
// The admin picks the discount depth BEFORE generating so the body is written
// AROUND it. NO real Shopify code is minted here — that would waste single-use
// codes on discarded drafts; the unique code is minted at APPROVE & SEND time
// (see lib/marketing-email). On a fresh / re-generated draft this:
//   1. re-verifies the contact is marketing-eligible (confirmed, not suppressed),
//   2. validates the selected discount depth (None / 5 / 10 / 15),
//   3. writes an AI-drafted personalised German email; when a discount is
//      selected the body is woven around a clearly-marked PLACEHOLDER code
//      (MOIA-XXXX) plus the projected expiry, so the admin previews exactly how
//      it will read,
//   4. persists the draft (status 'draft') with the selected depth.
//
// Idempotency: if an open draft already exists AND the requested depth matches
// it, that draft is returned untouched. If the depth changed (or regenerate is
// set), the open draft is overwritten so the text and the eventual real code can
// never disagree.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  loadEligibleCapture,
  getOpenDraftForCapture,
  createDraft,
  saveRegeneratedDraft,
} from "@/lib/marketing-store";
import { loadConversationForSummary } from "@/lib/conversation-store";
import { getProductsByIds } from "@/lib/product-catalog";
import {
  PLACEHOLDER_DISCOUNT_CODE,
  isAllowedDiscountPercent,
  discountExpiryDaysPublic,
} from "@/lib/shopify-discounts";
import { buildPrefilledCartUrlForIds } from "@/lib/cart";
import { generateMarketingDraft } from "@/lib/marketing-draft";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

/** Projected expiry the real code will get, for the preview. */
function projectedExpiry(): Date {
  return new Date(Date.now() + discountExpiryDaysPublic() * 86_400_000);
}

function germanDate(d: Date): string {
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let captureId: number;
  let discountPercent: number;
  let regenerate: boolean;
  try {
    const body = (await req.json()) as {
      captureId?: unknown;
      discountPercent?: unknown;
      regenerate?: unknown;
    };
    captureId = Number(body.captureId);
    if (!Number.isInteger(captureId) || captureId <= 0) {
      return adminJsonError("bad_request", "captureId required", 400);
    }
    discountPercent = Number(body.discountPercent ?? 0);
    if (!isAllowedDiscountPercent(discountPercent)) {
      return adminJsonError(
        "bad_request",
        "discountPercent must be one of 0, 5, 10, 15.",
        400
      );
    }
    regenerate = body.regenerate === true;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    // Only operate on still-eligible contacts.
    const capture = await loadEligibleCapture(captureId);
    if (!capture) {
      return adminJsonError(
        "not_eligible",
        "Contact is not marketing-eligible (must be DOI-confirmed and not suppressed).",
        409
      );
    }

    const existing = await getOpenDraftForCapture(captureId);
    // Reuse only when nothing about the offer changed — otherwise re-generate so
    // the prose always matches the selected depth.
    if (existing && !regenerate && existing.discountPercent === discountPercent) {
      return adminJson({ send: existing, reused: true });
    }

    // Conversation context (Cluster A) via the pseudonymous session bridge.
    const conversation = capture.sessionId
      ? await loadConversationForSummary(capture.sessionId)
      : null;
    const productIds = conversation?.recommendedProductIds ?? [];
    const products = productIds.length ? await getProductsByIds(productIds) : [];
    const personaLabel = conversation?.personaLabel ?? null;

    const hasDiscount = discountPercent > 0;
    // Placeholder code + projected expiry for the PREVIEW only. The real unique
    // code is minted at send time and swapped in 1:1.
    const placeholderCode = hasDiscount ? PLACEHOLDER_DISCOUNT_CODE : null;
    const expiry = hasDiscount ? projectedExpiry() : null;

    // Preview cart: no ?discount= param at draft time (the real code rides the
    // link only at send). The body still references the cart button.
    const cart = productIds.length
      ? await buildPrefilledCartUrlForIds(productIds)
      : { url: null };

    const draft = await generateMarketingDraft({
      personaLabel,
      products: products.map((p) => ({ name: p.name })),
      transcript: conversation?.messages ?? [],
      discountCode: placeholderCode,
      discountPercent,
      discountExpiresLabel: expiry ? germanDate(expiry) : null,
    });

    const expiresAtIso = expiry ? expiry.toISOString() : null;

    if (existing) {
      // Depth changed or explicit regenerate — overwrite the open draft.
      const updated = await saveRegeneratedDraft(existing.id, {
        subject: draft.subject,
        draftedText: draft.body,
        discountPercent,
        discountExpiresAt: expiresAtIso,
        cartUrl: cart.url,
        productIds,
        personaLabel,
      });
      if (!updated) {
        return adminJsonError("internal_error", "Could not update the draft.", 500);
      }
      return adminJson({ send: updated, regenerated: true });
    }

    const send = await createDraft({
      captureId,
      subject: draft.subject,
      draftedText: draft.body,
      discountPercent,
      discountCode: null, // minted at send time
      discountCodeGid: null,
      discountExpiresAt: expiresAtIso,
      cartUrl: cart.url,
      productIds,
      personaLabel,
    });

    if (!send) {
      return adminJsonError("internal_error", "Could not persist the draft.", 500);
    }
    return adminJson({ send });
  } catch (err) {
    reportError(err, { route: "api/admin/marketing/draft" });
    return adminJsonError("internal_error", "Draft generation failed.", 500);
  }
}
