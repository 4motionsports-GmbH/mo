// GET /api/admin/rundmail/recipient?campaignId=<id>&contactId=<id>&window=
//   → { recipient }
//
// One recipient of a Rundmail for the detail sheet of the „Versand“ tab: the
// send (delivered, bounce, complaint, unsubscribe), every click with its link
// and time, the orders after the mail inside the window with items, totals,
// codes and whether each one counts (and why not), and the timeline.
// Pure DB, read-only.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";
import { getRundmailRecipientDetail } from "@/lib/rundmail-analytics-store";
import { parsePositiveId, parseRundmailWindow } from "@/lib/rundmail-analytics.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  if (!isDbConfigured()) return adminJsonError("no_database", "Keine Datenbank konfiguriert.", 503);
  const sp = new URL(req.url).searchParams;
  const campaignId = parsePositiveId(sp.get("campaignId"));
  const contactId = parsePositiveId(sp.get("contactId"));
  if (!campaignId || !contactId) return adminJsonError("bad_request", "campaignId und contactId erforderlich.", 400);
  try {
    const recipient = await getRundmailRecipientDetail(campaignId, contactId, parseRundmailWindow(sp.get("window")));
    if (!recipient) return adminJsonError("not_found", "Empfänger:in nicht gefunden.", 404);
    return adminJson({ recipient });
  } catch (err) {
    reportError(err, { route: "api/admin/rundmail/recipient" });
    return adminJsonError("internal_error", "Die Angaben konnten nicht geladen werden.", 500);
  }
}
