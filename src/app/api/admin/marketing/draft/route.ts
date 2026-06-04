// POST /api/admin/marketing/draft  { captureId }
//
// Generate (or return the existing) draft marketing email for an eligible
// contact. Idempotent: if an open draft already exists it is returned untouched
// — we do NOT mint a second discount code. On a fresh draft this:
//   1. re-verifies the contact is marketing-eligible (confirmed, not suppressed),
//   2. mints a UNIQUE single-use 5% discount code (Shopify write_discounts),
//   3. builds the prefilled-cart permalink (?discount=CODE) for the discussed
//      products (lib/cart.ts),
//   4. writes an AI-drafted personalised German email (status 'draft').
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  loadEligibleCapture,
  getOpenDraftForCapture,
  createDraft,
} from "@/lib/marketing-store";
import { loadConversationForSummary } from "@/lib/conversation-store";
import { getProductsByIds } from "@/lib/product-catalog";
import { createUniqueDiscountCode } from "@/lib/shopify-discounts";
import { buildPrefilledCartUrlForIds } from "@/lib/cart";
import { generateMarketingDraft } from "@/lib/marketing-draft";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

const DISCOUNT_PERCENT = 5;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let captureId: number;
  try {
    const body = (await req.json()) as { captureId?: unknown };
    captureId = Number(body.captureId);
    if (!Number.isInteger(captureId) || captureId <= 0) {
      return adminJsonError("bad_request", "captureId required", 400);
    }
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

    // Idempotent: reuse an existing open draft rather than minting a new code.
    const existing = await getOpenDraftForCapture(captureId);
    if (existing) return adminJson({ send: existing, reused: true });

    // Conversation context (Cluster A) via the pseudonymous session bridge.
    const conversation = capture.sessionId
      ? await loadConversationForSummary(capture.sessionId)
      : null;
    const productIds = conversation?.recommendedProductIds ?? [];
    const products = productIds.length ? await getProductsByIds(productIds) : [];
    const personaLabel = conversation?.personaLabel ?? null;

    // Mint the unique single-use discount (best-effort — null if Shopify is
    // unconfigured or the mutation fails; the draft still proceeds).
    const discount = await createUniqueDiscountCode({ percentage: DISCOUNT_PERCENT / 100 });

    // Prefilled cart for the discussed products, carrying the discount code.
    const cart = productIds.length
      ? await buildPrefilledCartUrlForIds(productIds, {
          discountCode: discount?.code,
        })
      : { url: null };

    const draft = await generateMarketingDraft({
      personaLabel,
      products: products.map((p) => ({ name: p.name })),
      transcript: conversation?.messages ?? [],
      discountCode: discount?.code ?? null,
      discountPercent: DISCOUNT_PERCENT,
    });

    const send = await createDraft({
      captureId,
      subject: draft.subject,
      draftedText: draft.body,
      discountCode: discount?.code ?? null,
      discountCodeGid: discount?.gid ?? null,
      discountExpiresAt: discount?.expiresAt ?? null,
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
