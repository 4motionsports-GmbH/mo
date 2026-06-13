// POST /api/admin/bundles/suggest  { customerId }
//
// AI bundle SUGGESTION (S11) — proposes ONE personalized bundle for a customer
// using the SAME context the personalized-email path already has: the "current
// understanding" profile, the full conversation history, and the purchase
// history. Returns 2–5 in-stock, NOT-owned catalog products (sold-out is never
// proposed — S10 refuses it anyway), each with a one-sentence rationale, plus
// the component sum (the default bundle price). The admin then edits the
// composition and creates the offer via /api/admin/bundles/create.
//
// Read-only (no offer is created here). Token usage is recorded per S6 cost
// tracking inside suggestBundle (call site bundle_suggestions).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getCustomerById, loadCustomerSessions } from "@/lib/customer-store";
import { loadProductCatalog } from "@/lib/catalog-store";
import { suggestBundle } from "@/lib/bundle-suggestion";
import { reportError } from "@/lib/observability";

// An Anthropic pass over the catalog + transcripts can take a while.
export const maxDuration = 60;

const STATUS_BY_REASON: Record<string, number> = {
  no_candidates: 409,
  empty: 422,
  ai_unavailable: 503,
};

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let customerId: number;
  try {
    const body = (await req.json()) as { customerId?: unknown };
    customerId = Number(body.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return adminJsonError("bad_request", "customerId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const customer = await getCustomerById(customerId);
    if (!customer) return adminJsonError("not_found", "Customer not found.", 404);

    const [sessions, catalog] = await Promise.all([
      loadCustomerSessions(customerId),
      loadProductCatalog(),
    ]);

    // Owned products: catalog ids ARE Shopify handles, so the purchase history's
    // handles exclude owned items directly (never re-bundle what's already owned).
    const purchases = customer.purchaseSummary;
    const ownedHandles =
      purchases?.orders.flatMap((o) =>
        o.items.map((i) => i.handle).filter((h): h is string => h != null)
      ) ?? [];
    const ownedItems =
      purchases?.orders.flatMap((o) =>
        o.items.map((i) => ({ title: i.title, quantity: i.quantity }))
      ) ?? [];

    const result = await suggestBundle({
      catalog,
      ownedHandles,
      profileSummary: customer.profileSummary,
      ownedItems,
      purchasesKnown: purchases != null,
      sessions: sessions.map((s) => ({
        createdAt: s.createdAt,
        personaLabel: s.personaLabel,
        transcript: s.transcript,
      })),
    });

    if (result.ok) {
      return adminJson({
        title: result.title,
        components: result.components,
        componentsSum: result.componentsSum,
      });
    }
    const status = STATUS_BY_REASON[result.reason] ?? 400;
    return adminJson({ error: { code: result.reason, message: result.message } }, status);
  } catch (err) {
    reportError(err, { route: "api/admin/bundles/suggest" });
    return adminJsonError("internal_error", "Bundle suggestion failed.", 500);
  }
}
