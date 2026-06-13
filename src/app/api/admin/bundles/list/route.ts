// POST /api/admin/bundles/list  { customerId }
//
// List a customer's bundle offers for the admin UI (S11). Read-only.
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { listBundleOffersForCustomer } from "@/lib/bundle-offers";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

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
    const offers = await listBundleOffersForCustomer(customerId);
    return adminJson({ offers });
  } catch (err) {
    reportError(err, { route: "api/admin/bundles/list" });
    return adminJsonError("internal_error", "Could not list bundle offers.", 500);
  }
}
