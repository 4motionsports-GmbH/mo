// POST /api/admin/campaign/discount  { contactId, discountPercent }
//
// Review-time manual control over a draft's discount WITHOUT regenerating the
// prose (mirrors how a bundle can be attached after generation): the code +
// deadline ship DETERMINISTICALLY outside the editable prose at send time, so
// changing the depth here is always safe to deliver. The response reports
// whether the CURRENT prose clearly states a different percentage
// (detectDiscountTextMismatch — the same conservative check the send route
// enforces as a hard block), so the UI can advise a regenerate instead of the
// admin discovering the refusal at send time.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  getContactById,
  getDraftForContact,
  updateCampaignDraftDiscount,
} from "@/lib/campaign-store";
import {
  discountExpiryDaysPublic,
} from "@/lib/shopify-discounts";
import {
  parseDiscountPercent,
  detectDiscountTextMismatch,
  DISCOUNT_PERCENT_MAX,
} from "@/lib/discount-validation.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let contactId: number;
  let discountPercent: number;
  try {
    const body = (await req.json()) as { contactId?: unknown; discountPercent?: unknown };
    contactId = Number(body.contactId);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return adminJsonError("bad_request", "contactId required", 400);
    }
    const parsed = parseDiscountPercent(body.discountPercent ?? 0);
    if (parsed === null) {
      return adminJsonError(
        "bad_request",
        `discountPercent must be a whole number between 0 and ${DISCOUNT_PERCENT_MAX}.`,
        400
      );
    }
    discountPercent = parsed;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const contact = await getContactById(contactId);
    if (!contact) return adminJsonError("not_found", "Contact not found.", 404);
    if (contact.status !== "drafted") {
      return adminJsonError("not_editable", "Contact is not in review.", 409);
    }
    const existing = await getDraftForContact(contactId);
    if (!existing) {
      return adminJsonError("not_editable", "No draft exists for this contact.", 409);
    }

    // Projected expiry for the preview; the real MK- code gets its own at send
    // (the send step swaps a stale date label — same rule as generation).
    const expiresAt =
      discountPercent > 0
        ? new Date(Date.now() + discountExpiryDaysPublic() * 86_400_000).toISOString()
        : null;

    const draft = await updateCampaignDraftDiscount(contactId, discountPercent, expiresAt);
    if (!draft) {
      return adminJsonError("not_editable", "Draft not found or no longer editable.", 409);
    }

    // Advisory: does the CURRENT prose contradict the new depth? (The send
    // route hard-blocks this; here it's a heads-up so the admin regenerates.)
    const { mismatch, found } = detectDiscountTextMismatch(discountPercent, draft.body);

    return adminJson({
      ok: true,
      discountPercent: draft.discountPercent,
      discountExpiresAt: draft.discountExpiresAt,
      proseMismatch: mismatch,
      prosePercents: found,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/discount" });
    return adminJsonError("internal_error", "Could not update the discount.", 500);
  }
}
