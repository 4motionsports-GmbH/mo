// POST /api/admin/campaign/sync — trigger a campaign audience sync (Task A).
//
// Pages through Shopify's SUBSCRIBED marketing contacts, upserts them into
// campaign_contacts, cross-checks OUR suppression store, and marks Shopify-side
// unsubscribes as suppressed. Returns the counts the dashboard header shows.
// The daily cron (/api/cron/sync-campaign-audience) runs the same sync.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { syncCampaignAudience } from "@/lib/campaign-sync";
import { reportError } from "@/lib/observability";

// Paging a few thousand customers + per-row upserts over HTTP can take a while.
export const maxDuration = 300;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  try {
    const result = await syncCampaignAudience();
    if (!result.ok) {
      return adminJsonError(result.reason, result.message, 503);
    }
    return adminJson(result);
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/sync" });
    return adminJsonError("internal_error", "Audience sync failed.", 500);
  }
}
