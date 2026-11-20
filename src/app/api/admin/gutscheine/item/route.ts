// GET /api/admin/gutscheine/item?id=<voucher id>  → { voucher, printJob, orderUrl, designName }
//
// One Geschenkgutschein for the detail pane: the voucher (never its code —
// only the last four characters and whether a code is stored), its print job
// (address, status, cost; never the asset token or file paths), the order in
// the Shopify admin when derivable, and the design's name. Audit-logged
// (gift_voucher.view: voucher id, the buyer's customer id). 404 for an unknown
// id; 503 without a database or before migration 0083.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import { loadGutscheinDetail } from "@/app/admin/gutscheine/gutscheine-server";
import { giftVoucherTablesGate, idFromQuery } from "../route-helpers";

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  const id = idFromQuery(req);
  if (id === null) return adminJsonError("bad_request", "Gutschein fehlt.", 400);
  const gate = await giftVoucherTablesGate();
  if (gate) return gate;
  try {
    const detail = await loadGutscheinDetail(id);
    if (!detail) return adminJsonError("not_found", "Gutschein nicht gefunden.", 404);
    await recordAdminAccess(
      { action: "gift_voucher.view", targetCustomerId: detail.voucher.customerId, detail: { voucherId: id } },
      req
    );
    return adminJson(detail);
  } catch (err) {
    reportError(err, { route: "api/admin/gutscheine/item" });
    return adminJsonError("internal_error", "Der Gutschein konnte nicht geladen werden.", 500);
  }
}
