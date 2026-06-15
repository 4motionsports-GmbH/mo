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
import {
  getCustomerById,
  saveCustomerPurchaseSummary,
  saveCustomerPostalAddress,
} from "@/lib/customer-store";
import { refreshSignedInCustomerCache } from "@/lib/customer-account-cache";
import { getValidAccessToken } from "@/lib/customer-oauth-store";
import { fetchOrderHistoryByEmail, fetchLawfulAddressByEmail } from "@/lib/shopify-orders";
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

    // Tier 3 (signed-in) is PREFERRED but NOT required: when the customer has a
    // live Customer-Account token we use it (richer + consented, and it needs no
    // Protected-Customer-Data grant). But operator-driven refresh must ALSO work
    // for a customer who logged in via the Shopify storefront, whose token
    // expired, or who never used the chat at all — so on any miss we FALL BACK to
    // the operator's Admin API by email below instead of failing.
    if (customer.shopifyCustomerId) {
      const token = await getValidAccessToken(customerId);
      if (token) {
        const data = await refreshSignedInCustomerCache(customerId);
        if (data && data.orderHistory) {
          return adminJson({ purchaseSummary: data.orderHistory });
        }
        // Token present but the CA read came back empty (unreachable / permission /
        // schema) → don't fail; fall through to the Admin API by email.
      }
      // No token (e.g. signed in via Shopify storefront, not our widget) → fall
      // through to the Admin API by email.
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

    // Address acquisition (§4): in the SAME refresh, capture the lawful postal
    // address from a completed order's shipping address (basis 'purchase') so
    // physical mail becomes available. Best-effort — never fails the refresh, and
    // a missing/incomplete address leaves any previously-held one intact.
    const lawful = await fetchLawfulAddressByEmail(customer.email);
    if (lawful) {
      await saveCustomerPostalAddress(customerId, lawful.address, lawful.source);
    }

    return adminJson({ purchaseSummary: history });
  } catch (err) {
    reportError(err, { route: "api/admin/customers/purchases" });
    return adminJsonError("internal_error", "Purchase refresh failed.", 500);
  }
}
