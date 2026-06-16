// POST /api/admin/customers/purchases  { customerId }
//
// Refresh ONE customer's cached Shopify data on demand (the dashboard's "Käufe
// aktualisieren" button): order history (→ owned items) and the lawful postal
// address. The actual work lives in the
// shared lib/customer-refresh.refreshCustomerData (also used by the scheduled
// /api/cron/refresh-customers job), so on-demand and scheduled refresh behave
// identically: Customer Account API when a live token exists, else the operator's
// Admin API by email.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getCustomerById } from "@/lib/customer-store";
import { refreshCustomerData } from "@/lib/customer-refresh";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

const STATUS_BY_REASON: Record<string, number> = {
  no_shopify: 503,
  upstream_unavailable: 502,
  store_failed: 500,
};

const MESSAGE_BY_REASON: Record<string, string> = {
  no_shopify: "Shopify ist nicht konfiguriert — Bestellhistorie kann nicht geladen werden.",
  upstream_unavailable: "Shopify-Bestellhistorie konnte nicht geladen werden.",
  store_failed: "Bestellhistorie konnte nicht gespeichert werden.",
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
    if (!customer) {
      return adminJsonError("not_found", "Customer not found.", 404);
    }

    const result = await refreshCustomerData(customer);
    if (result.ok) {
      return adminJson({ purchaseSummary: result.purchaseSummary });
    }
    return adminJsonError(
      result.reason,
      MESSAGE_BY_REASON[result.reason] ?? "Aktualisierung fehlgeschlagen.",
      STATUS_BY_REASON[result.reason] ?? 502
    );
  } catch (err) {
    reportError(err, { route: "api/admin/customers/purchases" });
    return adminJsonError("internal_error", "Purchase refresh failed.", 500);
  }
}
