// POST /api/admin/customers/profile  { customerId }
//
// Regenerate the customer's profile NOW (the "Kundenverständnis generieren"
// button): the same regenerateCustomerProfile the nightly upkeep runs — every
// linked chat, the purchase history, correspondence and the Kampagne
// relationship → readable summary + structured fields, stored on the customer.
// The response carries the token usage so the dashboard can show the cost.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { regenerateCustomerProfile } from "@/lib/customer-profile";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

// The Opus pass over several transcripts (it thinks before it writes) can
// take a while.
export const maxDuration = 300;

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
    // Audit: this pass reads all of the customer's transcripts + correspondence.
    await recordAdminAccess({ action: "customer.profile.generate", targetCustomerId: customerId }, req);

    const result = await regenerateCustomerProfile(customerId);
    if (!result.ok) {
      const status =
        result.reason === "not_found"
          ? 404
          : result.reason === "unconfigured"
            ? 503
            : result.reason === "no_data"
              ? 409
              : 502;
      return adminJsonError(`profile_${result.reason}`, result.message, status);
    }

    if (!result.saved) {
      // The summary was expensive — surface the cache failure but still return
      // the text so the operator's tokens weren't spent for nothing.
      return adminJson(
        {
          profileSummary: result.summary,
          profileData: result.data,
          usage: result.usage,
          cached: false,
          warning: "Profil generiert, konnte aber nicht gespeichert werden.",
        },
        200
      );
    }

    return adminJson({
      profileSummary: result.summary,
      profileData: result.data,
      usage: result.usage,
      cached: true,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/customers/profile" });
    return adminJsonError("internal_error", "Profile generation failed.", 500);
  }
}
