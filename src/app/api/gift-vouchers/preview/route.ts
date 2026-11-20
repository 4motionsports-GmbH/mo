// POST /api/gift-vouchers/preview — the voucher exactly as it will be printed,
// for the „Prüfen & kaufen“ step of the voucher page (spec §8.5).
//   body: { designKey, amountCents, recipientName, senderName, message, photoId?,
//           locale, layout: "landscape" | "square" }
//   → { ok: true, front: "data:image/jpeg;base64,…", inside: "data:image/jpeg;base64,…",
//       textRemoved }
//
// Rendered by the same code as the PDF and the print files
// (lib/gift-voucher-render.ts) as a SAMPLE: diagonal „MUSTER“ watermark,
// placeholder code „XXXX XXXX XXXX XXXX“, no number — nothing a preview shows
// can be redeemed. The texts go through the same validation as the draft
// (gift-voucher-core.mjs: printable characters only; `textRemoved` tells the
// page that e.g. emoji were dropped). Layout: landscape for the PDF, square for
// the Premium-Karte. ~1000 px wide JPEGs, never cached.
//
// guardRequest (origin + x-ms-chat-key), buckets `gift-voucher-render`
// (session) and `gift-voucher-ip`. 409 while the shop does not sell vouchers.

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, checkRateLimitKeyed, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { resolveLocale } from "@/lib/locale";
import { giftVoucherExpiryDate, giftVoucherPhotoPathname, giftVoucherPreviewInput } from "@/lib/gift-voucher-core.mjs";
import { giftVoucherValidityYears } from "@/lib/gift-voucher-flags.mjs";
import { giftVoucherApiText, withGiftVoucherLocale } from "@/lib/gift-voucher-storefront.mjs";
import {
  giftVoucherBodyErrorResponse,
  giftVoucherErrorResponse,
  giftVoucherJsonResponse,
  giftVoucherUnavailableResponse,
  loadGiftVoucherStorefrontState,
  readGiftVoucherJson,
} from "@/lib/gift-voucher-storefront-io";
import { loadGiftVoucherPhoto, renderGiftVoucherPreview } from "@/lib/gift-voucher-render";

// Two panels rendered (fonts as paths, SVG → JPEG), plus a photo from the Blob store.
export const maxDuration = 30;

const METHODS = "POST, OPTIONS";
const PREVIEW_WIDTH = 1000;

function jpegDataUri(bytes: Buffer): string {
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

export async function POST(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, METHODS);

  try {
    const rl = await checkRateLimit(req, "gift-voucher-render");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);
    const ipRl = await checkRateLimitKeyed("gift-voucher-ip", `ip:${clientIp(req)}`);
    if (!ipRl.ok) return rateLimitResponse(ipRl.retryAfter, cors);

    const read = await readGiftVoucherJson(req);
    if (!read.ok) return giftVoucherBodyErrorResponse(read.reason, resolveLocale(req), cors);
    const body = withGiftVoucherLocale(read.body, resolveLocale(req));
    const locale = resolveLocale(req, (body as { locale?: unknown } | null)?.locale);

    const state = await loadGiftVoucherStorefrontState();
    if (!state.available) return giftVoucherUnavailableResponse(locale, cors);

    const input = giftVoucherPreviewInput(body, { allowPhoto: state.features.photo });
    if (!input.ok) return giftVoucherErrorResponse("bad_request", input.message, 400, cors, input.field);
    const v = input.value;
    if (v.amountCents == null) {
      return giftVoucherErrorResponse("bad_request", giftVoucherApiText("amount_missing", v.locale), 400, cors, "amountCents");
    }

    let photo: Buffer | null = null;
    if (v.designKey === "photo") {
      photo = await loadGiftVoucherPhoto(giftVoucherPhotoPathname(v.photoId));
      if (!photo) {
        return giftVoucherErrorResponse("bad_request", giftVoucherApiText("photo_missing", v.locale), 400, cors, "photoId");
      }
    }

    let images: { front: Buffer; inside: Buffer } | null = null;
    try {
      images = await renderGiftVoucherPreview(
        {
          designKey: v.designKey,
          amountCents: v.amountCents,
          recipientName: v.recipientName,
          senderName: v.senderName,
          message: v.message,
          photo,
          code: null,
          number: null,
          // „Gültig bis …“ as it would read for a voucher bought today.
          expiresOn: giftVoucherExpiryDate(new Date(), giftVoucherValidityYears()),
          sample: true,
          locale: v.locale,
        },
        { layout: v.layout, width: PREVIEW_WIDTH }
      );
    } catch (err) {
      reportError(err, { route: "api/gift-vouchers/preview", phase: "render", design: v.designKey, layout: v.layout });
    }
    if (!images || images.front.length === 0 || images.inside.length === 0) {
      return giftVoucherErrorResponse("upstream_unavailable", giftVoucherApiText("preview_failed", v.locale), 503, cors);
    }

    return giftVoucherJsonResponse(
      { ok: true, front: jpegDataUri(images.front), inside: jpegDataUri(images.inside), textRemoved: v.textRemoved },
      200,
      cors
    );
  } catch (err) {
    reportError(err, { route: "api/gift-vouchers/preview" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
