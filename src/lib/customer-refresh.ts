// Refresh a customer's cached Shopify-sourced data — order history (→ owned
// items) AND the lawful postal address. ONE
// shared path used by both the on-demand admin button (/api/admin/customers/
// purchases) and the scheduled cron (/api/cron/refresh-customers), so they can't
// drift.
//
// Tier-3 (signed-in) is PREFERRED when a live Customer-Account token exists
// (richer + consented, needs no Protected-Customer-Data grant; also caches name
// + address). On any miss — no token, storefront login, token expired, or never
// used the chat — it FALLS BACK to the operator's Admin API by email, which now
// reads orders + the saved/shipping address (read_customers + PCD granted).
//
// Deliberately does NOT touch the paid AI profile (profile_summary) — that stays
// a manual, explicit regeneration. Best-effort and fail-soft.

import {
  saveCustomerPurchaseSummary,
  saveCustomerPostalAddress,
  markPostalAddressChecked,
  type Customer,
} from "./customer-store";
import { refreshSignedInCustomerCache } from "./customer-account-cache";
import { getValidAccessToken } from "./customer-oauth-store";
import { fetchOrderHistoryByEmail, fetchLawfulAddressByEmail } from "./shopify-orders";
import { isShopifyConfigured } from "./shopify";
import { isPhysicalMailSendsApproved } from "./pingen-flag.mjs";
import type { OrderHistory } from "./shopify-orders";
import { reportError } from "./observability";

export type RefreshCustomerResult =
  | { ok: true; purchaseSummary: OrderHistory; source: "customer_account" | "admin_api" }
  | { ok: false; reason: "no_shopify" | "upstream_unavailable" | "store_failed" };

/**
 * Refresh one customer's order history + lawful address. Never throws.
 */
export async function refreshCustomerData(
  customer: Pick<Customer, "id" | "email" | "shopifyCustomerId">
): Promise<RefreshCustomerResult> {
  try {
    // PREFERRED: the customer's own Customer-Account token (also caches the
    // address via refreshSignedInCustomerCache).
    if (customer.shopifyCustomerId) {
      const token = await getValidAccessToken(customer.id);
      if (token) {
        const data = await refreshSignedInCustomerCache(customer.id);
        if (data?.orderHistory) {
          return { ok: true, purchaseSummary: data.orderHistory, source: "customer_account" };
        }
        // Token present but CA read empty → fall through to the Admin API.
      }
    }

    if (!isShopifyConfigured()) return { ok: false, reason: "no_shopify" };

    const history = await fetchOrderHistoryByEmail(customer.email);
    if (!history) return { ok: false, reason: "upstream_unavailable" };
    const saved = await saveCustomerPurchaseSummary(customer.id, history);
    if (!saved) return { ok: false, reason: "store_failed" };

    // Lawful postal address — collected ONLY when the physical-mail channel is
    // live AND the address is PURCHASE-derived (a completed order's shipping
    // address, obtained in connection with the sale). The saved account default
    // ('consented_capture') is deliberately not auto-stored here — no postal-use
    // consent was verified. See LEGAL_READINESS_REPORT §8 OQ-01.
    if (isPhysicalMailSendsApproved()) {
      const lawful = await fetchLawfulAddressByEmail(customer.email);
      if (lawful && lawful.source === "purchase") {
        await saveCustomerPostalAddress(customer.id, lawful.address, lawful.source);
      }
    }
    await markPostalAddressChecked(customer.id);

    return { ok: true, purchaseSummary: history, source: "admin_api" };
  } catch (err) {
    reportError(err, { route: "lib/customer-refresh", phase: "refreshCustomerData" });
    return { ok: false, reason: "upstream_unavailable" };
  }
}
