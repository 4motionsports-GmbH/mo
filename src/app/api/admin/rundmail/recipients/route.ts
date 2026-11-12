// GET /api/admin/rundmail/recipients?campaignId=<id>&window=&filter=&reason=&q=&sort=&dir=&page=
//   → { rows, total, page, pageSize }
//
// The recipient list of a Rundmail's „Versand“ tab: every recipient (sent,
// not sent with the reason, still pending), 50 per page, searched by name or
// e-mail, filtered (all | sent | delivered | clicked | ordered | bounced |
// complained | unsubscribed | not_sent, with `reason`), sorted on the server
// (sent | clicks | revenue, asc | desc), with clicks and the orders counted
// for the Rundmail in the window. Pure DB, read-only.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";
import { getCampaign } from "@/lib/campaigns-store";
import { listRundmailRecipients } from "@/lib/rundmail-analytics-store";
import {
  parseNotSentReason,
  parsePositiveId,
  parseRecipientFilter,
  parseRecipientPage,
  parseRecipientQuery,
  parseRecipientSort,
  parseRundmailWindow,
} from "@/lib/rundmail-analytics.mjs";

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
    const filter = parseRecipientFilter(sp.get("filter"));
    const { sort, dir } = parseRecipientSort(sp.get("sort"), sp.get("dir"));
    const page = await listRundmailRecipients(campaignId, {
      window: parseRundmailWindow(sp.get("window")),
      filter,
      reason: filter === "not_sent" ? parseNotSentReason(sp.get("reason")) : null,
      q: parseRecipientQuery(sp.get("q")),
      sort,
      dir,
      page: parseRecipientPage(sp.get("page")),
    });
    if (page.failed) return adminJsonError("internal_error", "Die Empfänger konnten nicht geladen werden.", 500);
    return adminJson({ rows: page.rows, total: page.total, page: page.page, pageSize: page.pageSize });
  } catch (err) {
    reportError(err, { route: "api/admin/rundmail/recipients" });
    return adminJsonError("internal_error", "Die Empfänger konnten nicht geladen werden.", 500);
  }
}
