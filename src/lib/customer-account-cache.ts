// Refresh + cache the signed-in (tier-3) customer's Shopify data into the
// EXISTING customer-memory mechanism, keyed by the customer row (which carries
// shopify_customer_id). For tier 3 the Customer Account API REPLACES the
// email-keyed Admin-API fetch (fetchOrderHistoryByEmail) as the purchase-history
// source:
//   * order history → customers.purchase_summary (migration 0008), the same
//     blob the live-chat memory, profile generation, marketing draft and bundle
//     suggestion already read;
//   * name + data-minimised address context → customers.shopify_account_summary
//     (migration 0015), for the greeting + the marketing profile.
//
// Best-effort and fail-closed: a missing/expired token or any upstream failure
// returns null and leaves the previous cache intact (we never overwrite a good
// cache with a result we couldn't obtain).

import { getValidAccessToken } from "./customer-oauth-store";
import {
  fetchSignedInCustomerData,
  type SignedInCustomerData,
} from "./shopify-customer-account";
import {
  saveCustomerAccountSummary,
  saveCustomerPurchaseSummary,
} from "./customer-store";
import { reportError } from "./observability";

/**
 * Pull the signed-in customer's data with their server-held access token and
 * cache it. Returns the fetched data (so callers can use it inline) or null when
 * no valid token / nothing usable came back. Never throws.
 */
export async function refreshSignedInCustomerCache(
  customerId: number
): Promise<SignedInCustomerData | null> {
  try {
    const token = await getValidAccessToken(customerId);
    if (!token) return null; // logged out / expired → fail closed

    const data = await fetchSignedInCustomerData(token);

    // Cache only what we actually got — don't clobber a previous good cache with
    // a null we couldn't back up (the order read can fail-soft independently).
    if (data.accountSummary) {
      await saveCustomerAccountSummary(customerId, data.accountSummary);
    }
    if (data.orderHistory) {
      await saveCustomerPurchaseSummary(customerId, data.orderHistory);
    }
    return data;
  } catch (err) {
    reportError(err, { route: "lib/customer-account-cache", phase: "refreshSignedInCustomerCache" });
    return null;
  }
}
