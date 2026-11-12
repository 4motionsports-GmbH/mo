// GET /api/admin/rundmail/export?campaignId=<id>&window=&filter=&reason=&q=
//   → text/csv (attachment)
//
// „Als CSV exportieren“ of a Rundmail's recipient list — every recipient of
// the current filter and search (not just one page), one row each: name,
// e-mail, customer id, status, reason, sent / delivered / first click,
// clicks, bounce, complaint, unsubscribe, the orders counted in the window,
// revenue, orders with the code, order numbers. UTF-8 with BOM, „;“ as the
// separator, German headers, dates in Europe/Berlin — opens as-is in a German
// Excel (rundmail-analytics.mjs: csvCell, recipientCsvCells).
//
// Streamed in chunks of RECIPIENT_EXPORT_CHUNK rows (keyset over the recipient
// id, so a send still running cannot shift rows between chunks). The first
// chunk is read before the response starts (a database error is a clean
// JSON 500); a later failure aborts the download instead of ending it as if
// complete. Customer data leaves the system: audit-logged (rundmail.export,
// counts only — never the search text).

import { guardAdminGet, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import { getCampaign } from "@/lib/campaigns-store";
import { listRundmailRecipients, type RundmailRecipientQuery, type RundmailRecipientRow } from "@/lib/rundmail-analytics-store";
import {
  CSV_BOM,
  RECIPIENT_CSV_HEADERS,
  RECIPIENT_EXPORT_CHUNK,
  csvLine,
  parseNotSentReason,
  parsePositiveId,
  parseRecipientFilter,
  parseRecipientQuery,
  parseRundmailWindow,
  recipientCsvCells,
  recipientCsvFilename,
} from "@/lib/rundmail-analytics.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    const window = parseRundmailWindow(sp.get("window"));
    const q = parseRecipientQuery(sp.get("q"));
    const query: RundmailRecipientQuery = {
      window,
      filter,
      reason: filter === "not_sent" ? parseNotSentReason(sp.get("reason")) : null,
      q,
      pageSize: RECIPIENT_EXPORT_CHUNK,
    };
    const first = await listRundmailRecipients(campaignId, { ...query, afterId: 0 });
    if (first.failed) return adminJsonError("internal_error", "Der Export ist fehlgeschlagen.", 500);

    await recordAdminAccess(
      { action: "rundmail.export", detail: { campaignId, rows: first.total, window, filter, reason: query.reason, search: q !== "" } },
      req
    );

    const encoder = new TextEncoder();
    const lines = (rows: RundmailRecipientRow[]) => rows.map((r) => csvLine(recipientCsvCells(r))).join("");
    let pending: RundmailRecipientRow[] | null = first.rows;
    let afterId = first.rows.length > 0 ? first.rows[first.rows.length - 1].contactId : 0;
    let more = first.rows.length === RECIPIENT_EXPORT_CHUNK;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(CSV_BOM + csvLine(RECIPIENT_CSV_HEADERS)));
      },
      async pull(controller) {
        if (pending) {
          controller.enqueue(encoder.encode(lines(pending)));
          pending = null;
          if (!more) controller.close();
          return;
        }
        const next = await listRundmailRecipients(campaignId, { ...query, afterId });
        if (next.failed) {
          controller.error(new Error("rundmail export: a chunk failed"));
          return;
        }
        if (next.rows.length > 0) {
          controller.enqueue(encoder.encode(lines(next.rows)));
          afterId = next.rows[next.rows.length - 1].contactId;
        }
        more = next.rows.length === RECIPIENT_EXPORT_CHUNK;
        if (!more) controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${recipientCsvFilename(campaign.slug, window)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/rundmail/export" });
    return adminJsonError("internal_error", "Der Export ist fehlgeschlagen.", 500);
  }
}
