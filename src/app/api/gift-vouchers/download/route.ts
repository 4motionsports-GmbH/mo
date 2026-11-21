// GET /api/gift-vouchers/download?t=<token> — the voucher PDF behind the
// download button of the voucher mail (spec §8.8).
//
// The token is a bearer secret (24 random bytes, base64url) that only the mail
// carries; the database keeps its sha256 hash (download_token_hash) and the
// lookup goes by that hash. A resend rotates it (the old link stops working),
// the retention clears it. Only an issued voucher downloads — deactivated,
// cancelled or not (yet) issued ones answer the same plain 404 as an unknown
// token, without any detail. The PDF is rendered on demand with the
// decrypted code (lib/gift-voucher-render.ts renderGiftVoucherPdf) and is
// never cached (no-store, private) or indexed. 503 when the code cannot be
// decrypted or the photo of an „Eigenes Foto“ voucher cannot be read (never
// the „Klassisch“ look in its place).
//
// No origin guard and no secret: the link is opened from a mail client. The
// IP-keyed bucket `gift-voucher-ip` caps guessing and rendering; without the
// limiter (no KV) the route fails closed. Answers in plain text (the browser
// shows them), German unless ?locale=en.

import { corsHeaders, preflightResponse } from "@/lib/security";
import { checkRateLimitKeyed, clientIp } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import { resolveLocale } from "@/lib/locale";
import { hashOpaqueToken } from "@/lib/gift-voucher-core.mjs";
import {
  giftVoucherApiText,
  giftVoucherPdfFilename,
  isValidGiftVoucherDownloadToken,
  type GiftVoucherApiTextKey,
} from "@/lib/gift-voucher-storefront.mjs";
import { getGiftVoucherByDownloadTokenHash, getGiftVoucherCode } from "@/lib/gift-voucher-store";
import {
  giftVoucherRenderInputFromVoucher,
  loadGiftVoucherPhoto,
  renderGiftVoucherPdf,
} from "@/lib/gift-voucher-render";

// Decrypting the code, loading a photo and rendering one A4 page.
export const maxDuration = 30;

const METHODS = "GET, OPTIONS";

// The token sits in the URL: never cache, never index, never pass it on as a referrer.
const PRIVATE_HEADERS = {
  "Cache-Control": "no-store, private",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
} as const;

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

export async function GET(req: Request) {
  const cors = corsHeaders(req.headers.get("origin"), METHODS);
  const locale = resolveLocale(req);
  const text = (status: number, key: GiftVoucherApiTextKey, extra: Record<string, string> = {}) =>
    new Response(giftVoucherApiText(key, locale), {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...PRIVATE_HEADERS, ...extra, ...cors },
    });

  try {
    const rl = await checkRateLimitKeyed("gift-voucher-ip", `ip:${clientIp(req)}`);
    if (!rl.ok) return text(429, "rate_limited", { "Retry-After": String(rl.retryAfter) });

    const token = new URL(req.url).searchParams.get("t");
    if (!isValidGiftVoucherDownloadToken(token)) return text(404, "download_not_found");
    const voucher = await getGiftVoucherByDownloadTokenHash(hashOpaqueToken(token));
    if (!voucher || voucher.status !== "issued") return text(404, "download_not_found");

    // getGiftVoucherCode never throws (no key, a tampered value → null, reported by the store).
    const code = await getGiftVoucherCode(voucher.id);
    if (!code) return text(503, "download_unavailable");
    const photo = voucher.photoPathname ? await loadGiftVoucherPhoto(voucher.photoPathname) : null;
    // A photo voucher is never served in the „Klassisch“ look: no photo, no PDF (try again later).
    if (voucher.designKey === "photo" && voucher.photoPathname && !photo) {
      reportError(new Error("gift voucher photo unavailable"), { route: "api/gift-vouchers/download", phase: "photo", voucherId: voucher.id });
      return text(503, "download_unavailable");
    }

    let pdf: Buffer | null = null;
    try {
      pdf = await renderGiftVoucherPdf(giftVoucherRenderInputFromVoucher(voucher, code, photo));
    } catch (err) {
      reportError(err, { route: "api/gift-vouchers/download", phase: "render", voucherId: voucher.id });
    }
    if (!pdf || pdf.length === 0) return text(503, "download_unavailable");

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${giftVoucherPdfFilename(voucher.number)}"`,
        "Content-Length": String(pdf.length),
        ...PRIVATE_HEADERS,
        ...cors,
      },
    });
  } catch (err) {
    reportError(err, { route: "api/gift-vouchers/download" });
    return text(500, "server_error");
  }
}
