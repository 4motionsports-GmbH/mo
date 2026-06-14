// POST /api/admin/customers/profile  { customerId }
//
// Regenerate the customer's "current understanding" summary on demand: one
// Anthropic pass over all linked conversation transcripts + the cached
// purchase history (see lib/customer-profile). The fresh summary replaces the
// cached one (with timestamp); the response carries the token usage so the
// dashboard can show what the regeneration cost. The dashboard's
// "Kundenverständnis generieren" button calls this.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  getCustomerById,
  loadCustomerSessions,
  saveCustomerProfileSummary,
} from "@/lib/customer-store";
import { generateCustomerProfile } from "@/lib/customer-profile";
import { reportError } from "@/lib/observability";

// The Anthropic pass over several transcripts can take a while.
export const maxDuration = 60;

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

    const sessions = await loadCustomerSessions(customerId);

    const result = await generateCustomerProfile({
      sessions,
      purchases: customer.purchaseSummary,
      // Tier-3 only: the cached, data-minimised location context.
      accountContext: customer.shopifyAccountSummary?.addressContext ?? null,
    });

    if (!result.ok) {
      const status =
        result.reason === "unconfigured" ? 503 : result.reason === "no_data" ? 409 : 502;
      return adminJsonError(`profile_${result.reason}`, result.message, status);
    }

    const saved = await saveCustomerProfileSummary(customerId, result.summary);
    if (!saved) {
      // The summary was expensive — surface the cache failure but still return
      // the text so the operator's tokens weren't spent for nothing.
      return adminJson(
        {
          profileSummary: result.summary,
          usage: result.usage,
          cached: false,
          warning: "Profil generiert, konnte aber nicht gespeichert werden.",
        },
        200
      );
    }

    return adminJson({ profileSummary: result.summary, usage: result.usage, cached: true });
  } catch (err) {
    reportError(err, { route: "api/admin/customers/profile" });
    return adminJsonError("internal_error", "Profile generation failed.", 500);
  }
}
