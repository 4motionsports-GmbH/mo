// GET /api/admin/rundmail/analytics?campaignId=<id>&window=1|3|7|14|heute
//   → { summary, series }
//
// The figures of a Rundmail's „Versand“ tab (docs/CAMPAIGNS.md §9.6): every
// figure of the workspace plus the orders, buyers and revenue counted for it
// in the window (rundmail-analytics.mjs — the attribution rule), the rates,
// and the time series (mails per bucket during the send; clicks, orders and
// revenue per hour or day after it). Pure DB, read-only.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";
import { getCampaign } from "@/lib/campaigns-store";
import { getRundmailAnalytics } from "@/lib/rundmail-analytics-store";
import { parsePositiveId, parseRundmailWindow } from "@/lib/rundmail-analytics.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  if (!isDbConfigured()) return adminJsonError("no_database", "Keine Datenbank konfiguriert.", 503);
  const sp = new URL(req.url).searchParams;
  const campaignId = parsePositiveId(sp.get("campaignId"));
  if (!campaignId) return adminJsonError("bad_request", "campaignId fehlt.", 400);
  try {
    const campaign = await getCampaign(campaignId);
    if (!campaign || campaign.kind !== "rundmail") return adminJsonError("not_found", "Rundmail nicht gefunden.", 404);
    const result = await getRundmailAnalytics(campaignId, parseRundmailWindow(sp.get("window")));
    if (!result) return adminJsonError("internal_error", "Die Auswertung konnte nicht geladen werden.", 500);
    return adminJson(result);
  } catch (err) {
    reportError(err, { route: "api/admin/rundmail/analytics" });
    return adminJsonError("internal_error", "Die Auswertung konnte nicht geladen werden.", 500);
  }
}
