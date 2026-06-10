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
//      (MO-XXXX) plus the projected expiry, so the admin previews exactly how
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
  formatGermanExpiryDate,
} from "@/lib/shopify-discounts";
import { buildPrefilledCartUrlForIds, chooseCartProductIds } from "@/lib/cart";
import { generateMarketingDraft } from "@/lib/marketing-draft";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

/** Projected expiry the real code will get, for the preview. The REAL code is
 * minted at send time with its own now+N-days endsAt; if the dates drift apart
 * (draft sat for a while), the send step swaps the date in the prose — see
 * approveAndSend in lib/marketing-email. */
function projectedExpiry(): Date {
  return new Date(Date.now() + discountExpiryDaysPublic() * 86_400_000);
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
    // The products the email is written around AND the ones in its cart link:
    // the user's selection when they made one, otherwise everything discussed.
    // Stored on the draft row, so the send step ships exactly this set.
    const productIds = chooseCartProductIds(conversation);
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
      discountExpiresLabel: expiry ? formatGermanExpiryDate(expiry) : null,
      discountValidityDays: hasDiscount ? discountExpiryDaysPublic() : null,
    });

    const expiresAtIso = expiry ? expiry.toISOString() : null;

    // Persist the generated draft. The draft was expensive to produce (the
    // Anthropic call), so a DB write failure here must be reported with its real
    // reason — a column/type mismatch, a NOT-NULL violation, etc. — rather than
    // collapsing into a reasonless 500 the client can't act on.
    try {
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
          // The write itself succeeded structurally but matched no open draft —
          // it was sent (now immutable) or removed between read and write.
          return adminJsonError(
            "draft_gone",
            "The open draft to overwrite no longer exists (it may have been sent).",
            409
          );
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
    } catch (dbErr) {
      reportError(dbErr, {
        route: "api/admin/marketing/draft",
        phase: "persistDraft",
      });
      const reason = dbErr instanceof Error ? dbErr.message : String(dbErr);
      return adminJsonError(
        "draft_persist_failed",
        `Could not save the generated draft to the database: ${reason}`,
        500
      );
    }
  } catch (err) {
    reportError(err, { route: "api/admin/marketing/draft" });
    return adminJsonError("internal_error", "Draft generation failed.", 500);
  }
}
