// GET /api/admin/gutscheine/photo?id=<voucher id> — the customer's photo of a
// voucher with the design „Eigenes Foto“ (thumbnail in the detail), from the
// private Blob store (gift-voucher-photos/…). Only a voucher's own photo —
// the stored pathname must be one of ours; 404 when there is none (or the
// retention already deleted it). Not cached. Viewing the voucher is audited
// by the detail (gift_voucher.view).

import { guardAdminGet, adminJsonError } from "@/lib/admin-api";
import { reportError } from "@/lib/observability";
import { getGiftVoucher } from "@/lib/gift-voucher-store";
import { getGiftVoucherBlob } from "@/lib/gift-voucher-blob";
import { giftVoucherPhotoIdFromPathname } from "@/lib/gift-voucher-core.mjs";
import { giftVoucherTablesGate, idFromQuery } from "../route-helpers";

export const runtime = "nodejs";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  const id = idFromQuery(req);
  if (id === null) return adminJsonError("bad_request", "Gutschein fehlt.", 400);
  const gate = await giftVoucherTablesGate();
  if (gate) return gate;
  try {
    const voucher = await getGiftVoucher(id);
    const pathname = voucher?.photoPathname ?? null;
    if (!voucher || !pathname || !giftVoucherPhotoIdFromPathname(pathname)) {
      return adminJsonError("not_found", "Kein Foto vorhanden.", 404);
    }
    const file = await getGiftVoucherBlob(pathname);
    if (!file) return adminJsonError("not_found", "Kein Foto vorhanden.", 404);
    const type = file.contentType.split(";")[0].trim().toLowerCase();
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": IMAGE_TYPES.has(type) ? type : "image/jpeg",
        "Content-Length": String(file.bytes.length),
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/gutscheine/photo" });
    return adminJsonError("internal_error", "Das Foto konnte nicht geladen werden.", 500);
  }
}
