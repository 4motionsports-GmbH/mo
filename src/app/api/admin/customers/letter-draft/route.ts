// POST /api/admin/customers/letter-draft  { customerId, adminInstructions? }
//
// Generate (and store) the per-customer PHYSICAL LETTER draft — a SEPARATE
// generation from the email draft (/api/admin/customers/marketing-draft). It
// uses the same customer context (all conversations + profile + purchase history
// + correspondence + operator instructions) but produces letter-optimised prose
// (no cart button, no discount/unsubscribe machinery — see
// generateCustomerLetterDraft). The result is stored as the customer's editable
// letter draft (migration 0023); "Brief senden" renders it to a PDF + submits it
// to Pingen.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  getCustomerById,
  loadCustomerSessions,
  loadCustomerProductSelections,
  saveCustomerLetterDraft,
} from "@/lib/customer-store";
import { loadCustomerCorrespondence } from "@/lib/email-messages-store";
import { getProductsByIds } from "@/lib/product-catalog";
import { chooseCustomerProductIds } from "@/lib/cart";
import { generateCustomerLetterDraft } from "@/lib/marketing-draft";
import { reportError } from "@/lib/observability";

// The Anthropic pass over several transcripts can take a while.
export const maxDuration = 60;

const MAX_ADMIN_INSTRUCTIONS_CHARS = 2000;
// The shop named (as plain text) in the letter — it's print, so no clickable link.
const SHOP_URL = "www.motionsports.de";

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let customerId: number;
  let adminInstructions: string | null;
  // SAVE mode: persist operator edits to the existing draft without regenerating.
  let save = false;
  let editSubject = "";
  let editBody = "";
  try {
    const body = (await req.json()) as {
      customerId?: unknown;
      adminInstructions?: unknown;
      save?: unknown;
      subject?: unknown;
      body?: unknown;
    };
    customerId = Number(body.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return adminJsonError("bad_request", "customerId required", 400);
    }
    save = body.save === true;
    editSubject = typeof body.subject === "string" ? body.subject.trim() : "";
    editBody = typeof body.body === "string" ? body.body : "";
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
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const customer = await getCustomerById(customerId);
    if (!customer) return adminJsonError("not_found", "Customer not found.", 404);

    // SAVE mode — just persist the edited subject/body (the operator's review).
    if (save) {
      if (!editBody.trim()) {
        return adminJsonError("bad_request", "Brieftext darf nicht leer sein.", 400);
      }
      const ok = await saveCustomerLetterDraft(customerId, editSubject, editBody.slice(0, 20000));
      if (!ok) return adminJsonError("internal_error", "Could not save the letter draft.", 500);
      return adminJson({ letterDraft: { subject: editSubject, body: editBody } });
    }

    const [sessions, selections, correspondence] = await Promise.all([
      loadCustomerSessions(customerId),
      loadCustomerProductSelections(customerId),
      loadCustomerCorrespondence(customerId),
    ]);

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

    // Salutation name from the lawfully-held postal address, when present.
    const recipientName =
      typeof customer.postalAddress?.name === "string"
        ? (customer.postalAddress.name as string)
        : null;

    const draft = await generateCustomerLetterDraft({
      recipientName,
      sessions,
      profileSummary: customer.profileSummary,
      correspondence,
      ownedItems,
      purchasesKnown: purchases != null,
      products: products.map((p) => ({ name: p.name })),
      adminInstructions,
      shopUrl: SHOP_URL,
    });

    const saved = await saveCustomerLetterDraft(customerId, draft.subject, draft.body);
    if (!saved) {
      return adminJsonError("internal_error", "Could not save the letter draft.", 500);
    }

    return adminJson({ letterDraft: { subject: draft.subject, body: draft.body } });
  } catch (err) {
    reportError(err, { route: "api/admin/customers/letter-draft" });
    return adminJsonError("internal_error", "Letter draft generation failed.", 500);
  }
}
