// Geschenkgutscheine — the customer photo of the design „Eigenes Foto“ (spec
// §8.3, POST /api/gift-vouchers/photo).
//
// The photo is checked from its sniffed bytes (gift-voucher-storefront.mjs:
// still JPEG / PNG / WebP, ≤ 40 megapixels, ≥ 500 px on the shorter side),
// turned upright (EXIF orientation), converted to sRGB, scaled down to at most
// 2400 px on the longer side, flattened onto white and stored as JPEG (q 88,
// mozjpeg) WITHOUT any metadata — EXIF with its GPS position, camera and date
// never leaves this function. It lands privately in the Blob store under
// gift-voucher-photos/<photoId>.jpg (lib/gift-voucher-blob.ts); the random,
// unguessable photo id is the only handle the page gets. Drafts and vouchers
// keep the pathname; the retention deletes unused photos with their drafts.
//
// Never throws: a picture that cannot be read is the customer's problem (400
// with a German/English text), a store failure ours (502).

import sharp from "sharp";
import { giftVoucherPhotoPathname, newOpaqueToken } from "./gift-voucher-core.mjs";
import { isGiftVoucherBlobConfigured, putGiftVoucherBlob } from "./gift-voucher-blob";
import { reportError } from "./observability";
import {
  GIFT_VOUCHER_PHOTO_MAX_PIXELS,
  GIFT_VOUCHER_PHOTO_MAX_SIDE,
  checkGiftVoucherPhotoImage,
  giftVoucherPhotoError,
  type GiftVoucherPhotoErrorCode,
} from "./gift-voucher-storefront.mjs";

const ROUTE = "lib/gift-voucher-photo";
const JPEG_QUALITY = 88;

export type GiftVoucherPhotoResult =
  | { ok: true; photoId: string; width: number; height: number }
  | { ok: false; code: GiftVoucherPhotoErrorCode; status: number; message: string };

export type ProcessedGiftVoucherPhoto =
  | { ok: true; jpeg: Buffer; width: number; height: number }
  | { ok: false; code: GiftVoucherPhotoErrorCode };

/** Check and normalise an uploaded photo (no I/O besides sharp). Never throws. */
export async function processGiftVoucherPhoto(bytes: Buffer): Promise<ProcessedGiftVoucherPhoto> {
  if (bytes.length === 0) return { ok: false, code: "empty" };
  // The header is read without the pixel cap (metadata decodes no pixels;
  // with the cap sharp would THROW and a 50-MP photo would read as
  // "unreadable" instead of "too many pixels"); the decode below keeps the
  // cap as the backstop behind checkGiftVoucherPhotoImage.
  let meta: sharp.Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    return { ok: false, code: "unreadable" };
  }
  const check = checkGiftVoucherPhotoImage({
    format: meta.format,
    width: meta.autoOrient?.width ?? meta.width,
    height: meta.autoOrient?.height ?? meta.height,
    pages: meta.pages ?? 1,
  });
  if (!check.ok) return check;
  try {
    let pipeline = sharp(bytes, { limitInputPixels: GIFT_VOUCHER_PHOTO_MAX_PIXELS }).rotate();
    // 16-bit input with a wide-gamut profile (Display P3) is processed in
    // sRGB, else toColourspace("srgb") would only drop the bit depth and the
    // colours would come out washed out (as in email-hero-variants.mjs).
    if (meta.depth === "ushort") pipeline = pipeline.pipelineColourspace("srgb");
    const { data, info } = await pipeline
      .resize({
        width: GIFT_VOUCHER_PHOTO_MAX_SIDE,
        height: GIFT_VOUCHER_PHOTO_MAX_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, jpeg: data, width: info.width, height: info.height };
  } catch {
    // A truncated or corrupt body, a decoder limit: "this is not a readable
    // picture", not a server error.
    return { ok: false, code: "unreadable" };
  }
}

/** Process an uploaded photo and store it privately → its photo id. Never throws. */
export async function storeGiftVoucherPhoto(bytes: Buffer, locale: "de" | "en" = "de"): Promise<GiftVoucherPhotoResult> {
  if (!isGiftVoucherBlobConfigured()) return giftVoucherPhotoError("not_configured", locale);
  try {
    const processed = await processGiftVoucherPhoto(bytes);
    if (!processed.ok) return giftVoucherPhotoError(processed.code, locale);
    const photoId = newOpaqueToken(16);
    const pathname = giftVoucherPhotoPathname(photoId);
    // putGiftVoucherBlob reports its own failures.
    if (!pathname || !(await putGiftVoucherBlob(pathname, processed.jpeg, "image/jpeg"))) {
      return giftVoucherPhotoError("storage_failed", locale);
    }
    return { ok: true, photoId, width: processed.width, height: processed.height };
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "store" });
    return giftVoucherPhotoError("storage_failed", locale);
  }
}
