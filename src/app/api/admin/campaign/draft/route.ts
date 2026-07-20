// POST /api/admin/campaign/draft  { contactId, discountPercent, regenerate? }
//
// Generate (or re-generate) the draft for ONE campaign contact — the single-
// contact sibling of /prepare, used by the queue's "Regenerate" action and by
// discount-depth changes. Same idempotency rule as the marketing draft route
// (shouldReuseCampaignDraft): an open draft is reused only when the depth
// matches and no explicit regenerate was requested; otherwise it is
// OVERWRITTEN so the text and the eventual real MK- code can never disagree.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  getContactById,
  getDraftForContact,
} from "@/lib/campaign-store";
import { prepareDraftForContact } from "@/lib/campaign-prepare";
import { shouldReuseCampaignDraft } from "@/lib/campaign-draft-core.mjs";
import { isSuppressed } from "@/lib/email-capture-store";
import {
  parseDiscountPercent,
  DISCOUNT_PERCENT_MAX,
} from "@/lib/discount-validation.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let contactId: number;
  let discountPercent: number;
  let regenerate: boolean;
  try {
    const body = (await req.json()) as {
      contactId?: unknown;
      discountPercent?: unknown;
      regenerate?: unknown;
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

    const existing = await getDraftForContact(contactId);
    if (shouldReuseCampaignDraft(existing, discountPercent, regenerate)) {
      return adminJson({ draft: existing, reused: true });
    }

    const draft = await prepareDraftForContact(contact, discountPercent);
    if (!draft) {
      return adminJsonError("internal_error", "Could not persist the draft.", 500);
    }
    return adminJson({ draft, regenerated: Boolean(existing) });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/draft" });
    return adminJsonError("internal_error", "Draft generation failed.", 500);
  }
}
