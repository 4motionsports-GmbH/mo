// GET /api/admin/gutscheine/pdf?id=<voucher id> — „PDF herunterladen“
//
// The voucher as the customer gets it (lib/gift-voucher-render.ts: one A4
// page, front and inside, the code printed and copyable), rendered on demand
// with the decrypted code — nothing is stored. Only for an issued voucher
// with a stored code (409 otherwise); 503 when the code cannot be decrypted
// (TOKEN_ENC_KEY), when the photo of an „Eigenes Foto“ voucher cannot be read
// (never the „Klassisch“ look in its place), without a database or before
// migration 0083. Attachment
// „Gutschein-G-2026-00042.pdf“, never cached. Audit-logged (gift_voucher.pdf,
// voucher id and the buyer's customer id) — the PDF carries the code.

import { guardAdminGet, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import { getGiftVoucher, getGiftVoucherCode } from "@/lib/gift-voucher-store";
import { giftVoucherRenderInputFromVoucher, loadGiftVoucherPhoto, renderGiftVoucherPdf } from "@/lib/gift-voucher-render";
import { fileSafe, giftVoucherTablesGate, idFromQuery } from "../route-helpers";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  const id = idFromQuery(req);
  if (id === null) return adminJsonError("bad_request", "Gutschein fehlt.", 400);
  const gate = await giftVoucherTablesGate();
  if (gate) return gate;
  try {
    const voucher = await getGiftVoucher(id);
    if (!voucher) return adminJsonError("not_found", "Gutschein nicht gefunden.", 404);
    if (voucher.status !== "issued" || !voucher.hasCode) {
      return adminJsonError("not_ready", "Ein PDF gibt es nur für ausgestellte Gutscheine.", 409);
    }
    const code = await getGiftVoucherCode(id);
    if (!code) return adminJsonError("not_configured", "Der Code lässt sich nicht entschlüsseln (TOKEN_ENC_KEY prüfen).", 503);
    const photo = await loadGiftVoucherPhoto(voucher.photoPathname);
    if (voucher.designKey === "photo" && voucher.photoPathname && !photo) {
      reportError(new Error("gift voucher photo unavailable"), { route: "api/admin/gutscheine/pdf", phase: "photo", voucherId: id });
      return adminJsonError("upstream_unavailable", "Das Kundenfoto ließ sich nicht laden (Vercel Blob) — bitte später noch einmal versuchen.", 503);
    }
    const pdf = await renderGiftVoucherPdf(giftVoucherRenderInputFromVoucher(voucher, code, photo));
    await recordAdminAccess(
      { action: "gift_voucher.pdf", targetCustomerId: voucher.customerId, detail: { voucherId: id } },
      req
    );
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Gutschein-${fileSafe(voucher.number)}.pdf"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store, private",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/gutscheine/pdf" });
    return adminJsonError("internal_error", "Das PDF konnte nicht erstellt werden.", 500);
  }
}
