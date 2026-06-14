// POST /api/admin/customers/purchases  { customerId }
//
// Refresh a customer's purchase memory on demand and cache it on the customer
// row (customers.purchase_summary). Two sources, by identity tier:
//   * SIGNED-IN (tier 3): the Customer Account API with the customer's own
//     access token (REPLACES the email-keyed Admin fetch as the tier-3
//     purchase-history source — see lib/customer-account-cache.ts). Also
//     refreshes the cached name + address context.
//   * EMAIL-only (tier 2): the Admin GraphQL orders query by email
//     (read_orders; full history additionally needs read_all_orders — see
//     lib/shopify-orders.fetchOrderHistoryByEmail).
// The dashboard's "Käufe aktualisieren" button calls this.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getCustomerById, saveCustomerPurchaseSummary } from "@/lib/customer-store";
import { refreshSignedInCustomerCache } from "@/lib/customer-account-cache";
import { fetchOrderHistoryByEmail } from "@/lib/shopify-orders";
import { isShopifyConfigured } from "@/lib/shopify";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

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
    if (!customer) {
      return adminJsonError("not_found", "Customer not found.", 404);
    }

    // Tier 3 (signed-in): pull from the Customer Account API with the customer's
    // own token — this REPLACES the email-keyed Admin fetch for tier-3 and also
    // refreshes the cached name + address context.
    if (customer.shopifyCustomerId) {
      const data = await refreshSignedInCustomerCache(customerId);
      if (!data || !data.orderHistory) {
        return adminJsonError(
          "upstream_unavailable",
          "Customer-Account-Daten konnten nicht geladen werden — möglicherweise ist der Kunde ausgeloggt und muss sich erneut anmelden.",
          502
        );
      }
      return adminJson({ purchaseSummary: data.orderHistory });
    }

    if (!isShopifyConfigured()) {
      return adminJsonError(
        "shopify_unconfigured",
        "Shopify ist nicht konfiguriert — Bestellhistorie kann nicht geladen werden.",
        503
      );
    }

    const history = await fetchOrderHistoryByEmail(customer.email);
    if (!history) {
      // "We don't know" — keep the previous cache rather than overwriting it
      // with an empty result we can't back up.
      return adminJsonError(
        "upstream_unavailable",
        "Shopify-Bestellhistorie konnte nicht geladen werden.",
        502
      );
    }

    const saved = await saveCustomerPurchaseSummary(customerId, history);
    if (!saved) {
      return adminJsonError("internal_error", "Could not cache the purchase summary.", 500);
    }

    return adminJson({ purchaseSummary: history });
  } catch (err) {
    reportError(err, { route: "api/admin/customers/purchases" });
    return adminJsonError("internal_error", "Purchase refresh failed.", 500);
  }
}
