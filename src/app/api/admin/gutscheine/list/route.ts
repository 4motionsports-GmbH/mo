// GET /api/admin/gutscheine/list?status=&quelle=&q=&page=  → { rows, total, page, pageSize }
//
// One page of the Geschenkgutscheine (newest first, 25 per page) with the
// filter of the screen (gutscheine-core.mjs): status = a voucher status,
// „achtung“ (attention flag) or „druck“ („Druck offen“: a Premium-Karte waits
// for an operator), quelle = shop | hand, q = number, order, name,
// e-mail or the last four characters of the code; `page` (or `seite`) is
// 1-based. The rows carry only what the table shows. Read-only, no audit (the
// detail is audited: gift_voucher.view). 503 without a database or before
// migration 0083.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { listGiftVouchers } from "@/lib/gift-voucher-store";
import { reportError } from "@/lib/observability";
import { GUTSCHEINE_PAGE_SIZE, gutscheineStoreFilter, parseGutscheineFilter } from "@/app/admin/gutscheine/gutscheine-core.mjs";
import { gutscheinRow, gutscheineEnv, isPrintOneHeld } from "@/app/admin/gutscheine/gutscheine-server";
import { giftVoucherTablesGate } from "../route-helpers";

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  const gate = await giftVoucherTablesGate();
  if (gate) return gate;
  const sp = new URL(req.url).searchParams;
  const filter = parseGutscheineFilter({
    status: sp.get("status") ?? undefined,
    quelle: sp.get("quelle") ?? undefined,
    q: sp.get("q") ?? undefined,
    seite: sp.get("page") ?? sp.get("seite") ?? undefined,
  });
  try {
    const { rows, total } = await listGiftVouchers(gutscheineStoreFilter(filter, { printOneHeld: isPrintOneHeld(gutscheineEnv()) }));
    return adminJson({ rows: rows.map(gutscheinRow), total, page: filter.page, pageSize: GUTSCHEINE_PAGE_SIZE });
  } catch (err) {
    reportError(err, { route: "api/admin/gutscheine/list" });
    return adminJsonError("internal_error", "Die Gutscheine konnten nicht geladen werden.", 500);
  }
}
