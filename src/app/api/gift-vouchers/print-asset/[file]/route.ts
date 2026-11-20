// GET /api/gift-vouchers/print-asset/<assetToken>-<outside|inside>.jpg — the
// Premium-Karte print spreads for print.one's renderer (spec §10,
// docs/GIFT_VOUCHERS.md).
//
// PUBLIC BY NECESSITY: print.one's template is an <img> of {{outside_url}} /
// {{inside_url}} and its renderer (UA "Print.one-Renderer/2.0", IP 34.147.66.4)
// loads them anonymously — any non-2xx fails the order. No IP / user-agent
// allowlist (both may change; the token is the protection). It is safe because
// of what it CANNOT do:
//   - the file name is parsed strictly (parseGiftVoucherPrintAssetFile:
//     <22–64 base64url chars>-<outside|inside>.jpg, no separators, no
//     encodings), so only gift-voucher-print/<token>-<side>.jpg can be read;
//   - the token (192 bits, one per print job) must belong to an existing job
//     that is open — queued (a retry), submitting, submitted or printing — and
//     whose recorded pathname is exactly this file. A finished job (sent,
//     cancelled, failed, done) or one whose files were cleaned up answers 404;
//   - the files carry the gift-card code, so: Cache-Control no-store, never on
//     a CDN, noindex, no referrer.
// Every miss is the same plain 404 (no hint whether a token exists).

import { getGiftVoucherBlob, isGiftVoucherBlobConfigured } from "@/lib/gift-voucher-blob";
import { getGiftVoucherPrintJobByAssetToken } from "@/lib/gift-voucher-store";
import { giftVoucherPrintAssetPathname, parseGiftVoucherPrintAssetFile } from "@/lib/printone-core.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

/** Job statuses during which print.one may still load the files. */
const SERVABLE_STATUSES = new Set(["queued", "submitting", "submitted", "printing"]);

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const parsed = parseGiftVoucherPrintAssetFile(file);
  if (!parsed || !isGiftVoucherBlobConfigured()) return notFound();

  try {
    const job = await getGiftVoucherPrintJobByAssetToken(parsed.token);
    if (!job || job.assetToken !== parsed.token || !SERVABLE_STATUSES.has(job.status)) return notFound();
    const pathname = parsed.side === "outside" ? job.assetOutsidePathname : job.assetInsidePathname;
    if (!pathname || pathname !== giftVoucherPrintAssetPathname(parsed.token, parsed.side)) return notFound();

    const blob = await getGiftVoucherBlob(pathname);
    if (!blob || blob.bytes.length === 0) return notFound();
    return new Response(new Uint8Array(blob.bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(blob.bytes.length),
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (err) {
    reportError(err, { route: "api/gift-vouchers/print-asset" });
    return notFound();
  }
}
