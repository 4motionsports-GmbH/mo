// POST /api/admin/customers/marketing-draft
//   { customerId, discountPercent, adminInstructions?, regenerate? }
//
// Generate (or re-generate) the PER-CUSTOMER marketing draft — the
// full-context upgrade of /api/admin/marketing/draft. Instead of one
// session's transcript, the model gets EVERYTHING we know about the person:
// every linked conversation, the cached "current understanding" profile, the
// Shopify purchase history (owned items are excluded from the recommendations
// and flagged "never re-recommend"), and the admin's free-text special
// instructions, passed as clearly-separated operator guidance.
//
// The draft lands in the SAME marketing_sends lifecycle as the per-capture
// flow — resolved via the customer's (unique-email) capture row — so the
// edit / approve / send path with all its safeguards is reused unchanged:
// human review, eligibility re-checks, mandatory unsubscribe, code minted at
// send (MS5-, 7-day expiry stated in the prose), tracked link, logging. The
// one-time welcome code (WELCOME-) is a separate flow (feature-flagged off by
// default via WELCOME_DISCOUNT_ENABLED) and is never re-issued here.
//
// Audit trail: the instructions are stored twice — the editable CURRENT value
// on the customer row, and the SNAPSHOT that went into this draft on the
// marketing_sends row (with customer_id linking the draft to its source).
//
// NO real Shopify code is minted here; like the per-capture draft, the body is
// written around the MO-XXXX placeholder and the real unique code is minted at
// APPROVE & SEND time (lib/marketing-email).
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  loadEligibleCaptureByEmail,
  getOpenDraftForCapture,
  createDraft,
  saveRegeneratedDraft,
} from "@/lib/marketing-store";
import {
  getCustomerById,
  loadCustomerSessions,
  loadCustomerProductSelections,
  saveCustomerAdminInstructions,
} from "@/lib/customer-store";
import { getProductsByIds } from "@/lib/product-catalog";
import {
  PLACEHOLDER_DISCOUNT_CODE,
  isAllowedDiscountPercent,
  discountExpiryDaysPublic,
  formatGermanExpiryDate,
} from "@/lib/shopify-discounts";
import { buildPrefilledCartUrlForIds, chooseCustomerProductIds } from "@/lib/cart";
import { generateCustomerMarketingDraft } from "@/lib/marketing-draft";
import { reportError } from "@/lib/observability";

// The Anthropic pass over several transcripts can take a while.
export const maxDuration = 60;

// Bound the operator free-text so it stays a set of pointers, not a second
// email body (and the prompt stays bounded).
const MAX_ADMIN_INSTRUCTIONS_CHARS = 2000;

/** Projected expiry the real code will get, for the preview — same contract as
 * the per-capture draft route (the send step swaps a drifted date). */
function projectedExpiry(): Date {
  return new Date(Date.now() + discountExpiryDaysPublic() * 86_400_000);
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let customerId: number;
  let discountPercent: number;
  let adminInstructions: string | null;
  let regenerate: boolean;
  try {
    const body = (await req.json()) as {
      customerId?: unknown;
      discountPercent?: unknown;
      adminInstructions?: unknown;
      regenerate?: unknown;
    };
    customerId = Number(body.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return adminJsonError("bad_request", "customerId required", 400);
    }
    discountPercent = Number(body.discountPercent ?? 0);
    if (!isAllowedDiscountPercent(discountPercent)) {
      return adminJsonError("bad_request", "discountPercent must be one of 0, 5, 10, 15.", 400);
    }
    if (body.adminInstructions != null && typeof body.adminInstructions !== "string") {
      return adminJsonError("bad_request", "adminInstructions must be a string.", 400);
    }
    adminInstructions = (body.adminInstructions as string | undefined)?.trim() || null;
    if (adminInstructions && adminInstructions.length > MAX_ADMIN_INSTRUCTIONS_CHARS) {
      return adminJsonError(
        "bad_request",
        `adminInstructions must be at most ${MAX_ADMIN_INSTRUCTIONS_CHARS} characters.`,
        400
      );
    }
    regenerate = body.regenerate === true;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const customer = await getCustomerById(customerId);
    if (!customer) {
      return adminJsonError("not_found", "Customer not found.", 404);
    }

    // Same eligibility bar as every marketing path, resolved via the
    // customer's (unique-email) capture row. Not eligible ⇒ no draft.
    const capture = await loadEligibleCaptureByEmail(customer.email);
    if (!capture) {
      return adminJsonError(
        "not_eligible",
        "Customer is not marketing-eligible (must be DOI-confirmed and not suppressed).",
        409
      );
    }

    // Persist the CURRENT editable instructions on the customer up front, so
    // they survive even if generation fails and pre-fill the next attempt.
    await saveCustomerAdminInstructions(customerId, adminInstructions);

    const existing = await getOpenDraftForCapture(capture.id);
    // Reuse only when nothing about the request changed — depth AND
    // instructions; otherwise re-generate so prose, code depth and the audit
    // snapshot always agree.
    if (
      existing &&
      !regenerate &&
      existing.discountPercent === discountPercent &&
      (existing.adminInstructions ?? "") === (adminInstructions ?? "")
    ) {
      return adminJson({ send: existing, reused: true });
    }

    // Full customer context: every linked conversation (oldest first), the
    // cached profile + purchase summary, and the per-conversation product sets.
    const [sessions, selections] = await Promise.all([
      loadCustomerSessions(customerId),
      loadCustomerProductSelections(customerId),
    ]);

    // Owned items: catalog product ids ARE Shopify handles, so the purchase
    // history's handles directly exclude owned products from the cart set.
    const purchases = customer.purchaseSummary;
    const ownedHandles =
      purchases?.orders.flatMap((o) =>
        o.items.map((i) => i.handle).filter((h): h is string => h != null)
      ) ?? [];
    const ownedItems =
      purchases?.orders.flatMap((o) =>
        o.items.map((i) => ({ title: i.title, quantity: i.quantity }))
      ) ?? [];

    const productIds = chooseCustomerProductIds(selections, ownedHandles);
    const products = productIds.length ? await getProductsByIds(productIds) : [];
    // Snapshot persona: the newest session's, the freshest signal.
    const personaLabel = sessions.at(-1)?.personaLabel ?? null;

    const hasDiscount = discountPercent > 0;
    const placeholderCode = hasDiscount ? PLACEHOLDER_DISCOUNT_CODE : null;
    const expiry = hasDiscount ? projectedExpiry() : null;

    // Preview cart: no ?discount= param at draft time (the real code rides the
    // link only at send). Sold-out products re-checked again at send time.
    const cart = productIds.length
      ? await buildPrefilledCartUrlForIds(productIds, { excludeSoldOut: true })
      : { url: null };

    const draft = await generateCustomerMarketingDraft({
      sessions,
      profileSummary: customer.profileSummary,
      ownedItems,
      purchasesKnown: purchases != null,
      products: products.map((p) => ({ name: p.name })),
      adminInstructions,
      discountCode: placeholderCode,
      discountPercent,
      discountExpiresLabel: expiry ? formatGermanExpiryDate(expiry) : null,
      discountValidityDays: hasDiscount ? discountExpiryDaysPublic() : null,
    });

    const expiresAtIso = expiry ? expiry.toISOString() : null;

    // Persist the generated draft — same failure surfacing as the per-capture
    // route: the Anthropic call was expensive, so a DB write failure must
    // report its real reason.
    try {
      if (existing) {
        const updated = await saveRegeneratedDraft(existing.id, {
          subject: draft.subject,
          draftedText: draft.body,
          discountPercent,
          discountExpiresAt: expiresAtIso,
          cartUrl: cart.url,
          productIds,
          personaLabel,
          customerId,
          adminInstructions,
        });
        if (!updated) {
          return adminJsonError(
            "draft_gone",
            "The open draft to overwrite no longer exists (it may have been sent).",
            409
          );
        }
        return adminJson({ send: updated, regenerated: true });
      }

      const send = await createDraft({
        captureId: capture.id,
        customerId,
        adminInstructions,
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
        route: "api/admin/customers/marketing-draft",
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
    reportError(err, { route: "api/admin/customers/marketing-draft" });
    return adminJsonError("internal_error", "Draft generation failed.", 500);
  }
}
