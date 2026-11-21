// GET /api/admin/gutscheine/print-file?id=<voucher id>&side=outside|inside
//   — „Druckdateien herunterladen“
//
// A print spread of the voucher's Premium-Karte for printing by hand (the
// manual provider's jobs under „Druck offen“, or a print.one job that failed): JPEG 3378 × 1724 px,
// 300 dpi, 14 × 14 cm folded card incl. 3 mm bleed (lib/gift-voucher-print.ts
// giftVoucherPrintFiles → the renderer). `outside` = back | front, `inside` =
// message | code. Only for an issued voucher with a print job that is not
// cancelled (409); 503 when the files cannot be made. Attachment
// „Gutschein-G-2026-00042-aussen.jpg“ / „…-innen.jpg“, never cached.
// Audit-logged (gift_voucher.print_file, voucher + job id) — the inside
// carries the code.

import { guardAdminGet, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import { getGiftVoucher, getGiftVoucherPrintJobForVoucher } from "@/lib/gift-voucher-store";
import { giftVoucherPrintFiles } from "@/lib/gift-voucher-print";
import { fileSafe, giftVoucherTablesGate, idFromQuery } from "../route-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  const id = idFromQuery(req);
  if (id === null) return adminJsonError("bad_request", "Gutschein fehlt.", 400);
  const side = new URL(req.url).searchParams.get("side");
  if (side !== "outside" && side !== "inside") {
    return adminJsonError("bad_request", "Seite fehlt (outside oder inside).", 400);
  }
  const gate = await giftVoucherTablesGate();
  if (gate) return gate;
  try {
    const voucher = await getGiftVoucher(id);
    if (!voucher) return adminJsonError("not_found", "Gutschein nicht gefunden.", 404);
    const job = await getGiftVoucherPrintJobForVoucher(id);
    if (!job) return adminJsonError("not_found", "Dieser Gutschein hat keinen Druckauftrag.", 404);
    if (voucher.status !== "issued" || job.status === "cancelled") {
      return adminJsonError("not_ready", "Druckdateien gibt es nur für ausgestellte Gutscheine mit offenem Druckauftrag.", 409);
    }
    const files = await giftVoucherPrintFiles(job.id);
    const bytes = files ? (side === "outside" ? files.outside : files.inside) : null;
    if (!bytes || bytes.length === 0) {
      return adminJsonError("not_ready", "Die Druckdateien konnten nicht erstellt werden.", 503);
    }
    await recordAdminAccess(
      { action: "gift_voucher.print_file", targetCustomerId: voucher.customerId, detail: { voucherId: id, jobId: job.id } },
      req
    );
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Disposition": `attachment; filename="Gutschein-${fileSafe(voucher.number)}-${side === "outside" ? "aussen" : "innen"}.jpg"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store, private",
      },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/gutscheine/print-file" });
    return adminJsonError("internal_error", "Die Druckdatei konnte nicht erstellt werden.", 500);
  }
}
