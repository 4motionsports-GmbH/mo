// POST /api/gift-vouchers/photo — the customer's own photo for the design
// „Eigenes Foto“ (spec §8.3).
//   body: the picture's raw bytes, Content-Type image/jpeg | image/png | image/webp, ≤ 4 MB
//   → { ok: true, photoId, width, height }
//
// Transport: ONE raw binary body (no multipart, no base64 — Vercel caps a
// request at 4.5 MB and answers a larger one with a non-JSON 413 before the
// handler runs, so the page scales photos down to ≤ 2400 px first). The size
// is checked from Content-Length before reading and again while reading (a
// chunked body has no header). lib/gift-voucher-photo.ts sniffs the format,
// normalises the picture (upright, sRGB, ≤ 2400 px, JPEG, no metadata) and
// stores it privately; the returned photo id goes into the draft.
//
// guardRequest (origin + x-ms-chat-key), buckets `gift-voucher` (session) and
// `gift-voucher-ip`. 409 while the shop does not sell vouchers, 503 while
// photos are switched off (admin) or the Blob store is not configured, 413
// too large, 415 not JPEG/PNG/WebP.

import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, checkRateLimitKeyed, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError, type ErrorCode } from "@/lib/observability";
import { resolveLocale } from "@/lib/locale";
import {
  GIFT_VOUCHER_PHOTO_MAX_BYTES,
  checkGiftVoucherPhotoRequest,
  giftVoucherPhotoError,
} from "@/lib/gift-voucher-storefront.mjs";
import {
  giftVoucherErrorResponse,
  giftVoucherJsonResponse,
  giftVoucherUnavailableResponse,
  loadGiftVoucherStorefrontState,
  readGiftVoucherBody,
} from "@/lib/gift-voucher-storefront-io";
import { storeGiftVoucherPhoto } from "@/lib/gift-voucher-photo";

// Decoding a large photo, one resize, the JPEG encode and the Blob write.
export const maxDuration = 30;

const METHODS = "POST, OPTIONS";

/** The envelope code for a photo error's HTTP status. */
function photoErrorCode(status: number): ErrorCode {
  if (status === 413) return "payload_too_large";
  if (status >= 500) return "upstream_unavailable";
  return "bad_request";
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

export async function POST(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, METHODS);
  const locale = resolveLocale(req);
  const fail = (e: { status: number; message: string }) =>
    giftVoucherErrorResponse(photoErrorCode(e.status), e.message, e.status, cors, "photo");

  try {
    const rl = await checkRateLimit(req, "gift-voucher");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);
    const ipRl = await checkRateLimitKeyed("gift-voucher-ip", `ip:${clientIp(req)}`);
    if (!ipRl.ok) return rateLimitResponse(ipRl.retryAfter, cors);

    const state = await loadGiftVoucherStorefrontState();
    if (!state.available) return giftVoucherUnavailableResponse(locale, cors);
    if (!state.features.photo) return fail(giftVoucherPhotoError("not_configured", locale));

    const pre = checkGiftVoucherPhotoRequest({
      contentType: req.headers.get("content-type"),
      contentLength: req.headers.get("content-length"),
    });
    if (!pre.ok) return fail(giftVoucherPhotoError(pre.code, locale));

    const bytes = await readGiftVoucherBody(req, GIFT_VOUCHER_PHOTO_MAX_BYTES);
    if (!bytes) return fail(giftVoucherPhotoError("too_large", locale));

    const result = await storeGiftVoucherPhoto(bytes, locale);
    if (!result.ok) return fail(result);

    return giftVoucherJsonResponse(
      { ok: true, photoId: result.photoId, width: result.width, height: result.height },
      200,
      cors
    );
  } catch (err) {
    reportError(err, { route: "api/gift-vouchers/photo" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
