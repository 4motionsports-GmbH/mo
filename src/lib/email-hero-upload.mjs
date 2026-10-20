// The rules for an UPLOADED hero picture — the „Kampagnenbild“ an operator
// puts on a campaign (Kampagnen-Editor → Gestaltung). docs/EMAIL_DESIGNS.md.
//
// Pure and free of sharp, so the browser checks a file with the SAME rules
// before it uploads anything (a too-small picture fails without a round trip)
// and the server checks it again from the sniffed bytes
// (email-hero-variants.mjs buildUploadedHeroVariants) — the client is never
// trusted. The I/O is lib/campaign-hero-upload.ts and the route
// /api/admin/campaigns/hero-image.
//
// Limits:
//   * 4 MB per request — under Vercel's 4.5 MB request-body cap, which
//     answers with a non-JSON 413 before the handler runs; the client
//     re-encodes larger files (planClientDownscale) first.
//   * 40 megapixels — decoding cost and memory (a decompression bomb is a
//     small file with a huge header); sharp's limitInputPixels backs it up.
//   * At least 1280×600 AFTER the 2.133:1 crop (2× the 640×300 desktop hero),
//     recommended 1536×720 — the size the AI heroes are rendered at.
//   * JPEG, PNG, WebP only, by the sniffed format: SVG (script), GIF
//     (animation), TIFF and HEIF/AVIF are refused. iPhone HEIC is not
//     readable by the prebuilt sharp — the file picker's `accept` makes iOS
//     convert to JPEG; the message says what to do otherwise.

import { HERO_ASPECT, heroAspectCrop } from "./email-hero-geometry.mjs";

/** Request Content-Types the upload route accepts — none CORS-safelisted. */
export const HERO_UPLOAD_CONTENT_TYPES = /** @type {const} */ (["image/jpeg", "image/png", "image/webp"]);
/** sharp `metadata().format` values accepted (sniffed from the bytes). */
export const HERO_UPLOAD_FORMATS = /** @type {const} */ (["jpeg", "png", "webp"]);
/** Largest request body (bytes). */
export const HERO_UPLOAD_MAX_BYTES = 4_000_000;
/** Largest picture (width × height after EXIF orientation). */
export const HERO_UPLOAD_MAX_PIXELS = 40_000_000;
/** Smallest crop (2× the 640×300 desktop hero). */
export const HERO_UPLOAD_MIN = Object.freeze({ width: 1280, height: 600 });
/** The size the processed hero is stored at — smaller crops are upscaled. */
export const HERO_UPLOAD_RECOMMENDED = Object.freeze({ width: 1536, height: 720 });

/** Client: re-encode files above this size … */
export const CLIENT_REENCODE_BYTES = 2_500_000;
/** … or with a longer side than this (px) … */
export const CLIENT_MAX_LONG_SIDE = 3072;
/** … as JPEG of this quality (canvas.toBlob). */
export const CLIENT_JPEG_QUALITY = 0.92;

/** How far the source ratio may differ from the hero's 2.133:1 before the
 * operator is told it was cropped (relative difference). */
const CROP_WARN_TOLERANCE = 0.1;

/** Longest original file name kept (display only). */
export const HERO_UPLOAD_NAME_MAX = 120;

/** German texts of the upload — errors by code, warnings by code. */
export const HERO_UPLOAD_MESSAGES = Object.freeze({
  format: "Format nicht unterstützt — bitte JPG, PNG oder WebP (iPhone-HEIC vorher als JPG exportieren).",
  too_small: "Bild zu klein: nach dem Zuschnitt mindestens 1280 × 600 px (dieses: {w} × {h}).",
  too_large: "Datei zu groß (max. 4 MB).",
  too_many_pixels: "Bild zu groß (über 40 Megapixel) — bitte verkleinern.",
  animated: "Animierte Bilder werden nicht unterstützt.",
  empty: "Die Datei ist leer — bitte ein Bild wählen.",
  unreadable: "Bild konnte nicht gelesen werden (beschädigt oder kein Bild).",
  origin_required: "Bitte angeben, ob das Bild KI-generiert ist.",
  not_configured: "Bild-Upload ist nicht eingerichtet (BLOB_READ_WRITE_TOKEN fehlt).",
  storage_failed: "Bild konnte nicht gespeichert werden — bitte erneut versuchen.",
  upscaled: "Kleiner als 1536 × 720 px — wird leicht hochskaliert, auf hochauflösenden Displays etwas weicher.",
  cropped: "Seitenverhältnis weicht ab — auf 2,1 : 1 zugeschnitten, Vorschau prüfen.",
});

/** HTTP status per error code (the route answers with it). */
const STATUS = {
  format: 415,
  too_large: 413,
  too_many_pixels: 413,
  too_small: 400,
  animated: 400,
  empty: 400,
  unreadable: 400,
  origin_required: 400,
  not_configured: 503,
  storage_failed: 502,
};

/**
 * @typedef {{ ok: false, code: string, status: number, message: string }} HeroUploadError
 */

/**
 * @param {keyof typeof HERO_UPLOAD_MESSAGES} code
 * @param {Record<string, string | number>} [vars]
 * @returns {HeroUploadError}
 */
export function heroUploadError(code, vars = {}) {
  let message = HERO_UPLOAD_MESSAGES[code] ?? HERO_UPLOAD_MESSAGES.unreadable;
  for (const [k, v] of Object.entries(vars)) message = message.replace(`{${k}}`, String(v));
  return { ok: false, code, status: STATUS[/** @type {keyof typeof STATUS} */ (code)] ?? 400, message };
}

/**
 * The request size before (Content-Length header) or after (bytes actually
 * read — a chunked body has no header) reading the body. An absent or
 * unparsable header passes; the read length is checked again.
 * @param {{ contentLength?: number | string | null }} r
 * @returns {{ ok: true } | HeroUploadError}
 */
export function checkHeroUploadRequest(r) {
  const raw = r?.contentLength;
  if (raw == null || raw === "") return { ok: true };
  const n = typeof raw === "number" ? raw : /^\d+$/.test(String(raw).trim()) ? Number(String(raw).trim()) : NaN;
  if (!Number.isFinite(n)) return { ok: true };
  if (n <= 0) return heroUploadError("empty");
  if (n > HERO_UPLOAD_MAX_BYTES) return heroUploadError("too_large");
  return { ok: true };
}

/**
 * Check a decoded picture's header. `width`/`height` are the ORIENTED size
 * (EXIF rotation applied — a portrait phone photo is taller than wide).
 * Returns the crop to cut (heroAspectCrop) and German warnings, or an error.
 * @param {{ format?: string | null, width?: number | null, height?: number | null, pages?: number | null }} img
 * @returns {{ ok: true, crop: { left: number, top: number, width: number, height: number },
 *   warnings: string[], warningCodes: Array<"upscaled" | "cropped"> } | HeroUploadError}
 */
export function checkHeroUploadImage(img) {
  const format = String(img?.format ?? "").toLowerCase();
  if (!HERO_UPLOAD_FORMATS.includes(/** @type {any} */ (format))) return heroUploadError("format");
  if (Number(img?.pages ?? 1) > 1) return heroUploadError("animated");
  const w = Number(img?.width);
  const h = Number(img?.height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return heroUploadError("unreadable");
  if (w * h > HERO_UPLOAD_MAX_PIXELS) return heroUploadError("too_many_pixels");
  const crop = heroAspectCrop(w, h);
  // The crop has the hero's ratio, so width ≥ 1280 ⇔ height ≥ 600.
  if (crop.width < HERO_UPLOAD_MIN.width) {
    return heroUploadError("too_small", { w: crop.width, h: crop.height });
  }
  /** @type {Array<"upscaled" | "cropped">} */
  const warningCodes = [];
  if (crop.width < HERO_UPLOAD_RECOMMENDED.width) warningCodes.push("upscaled");
  if (Math.abs(w / h - HERO_ASPECT) / HERO_ASPECT > CROP_WARN_TOLERANCE) warningCodes.push("cropped");
  return { ok: true, crop, warnings: warningCodes.map((c) => HERO_UPLOAD_MESSAGES[c]), warningCodes };
}

/**
 * Whether (and to what size) the browser re-encodes a picture before the
 * upload: above CLIENT_REENCODE_BYTES or with a side longer than
 * CLIENT_MAX_LONG_SIDE. The scale never brings the hero crop under the
 * stored width (1536), so a panorama keeps enough height.
 * @param {{ bytes: number, width: number, height: number }} f  oriented size
 * @returns {{ reencode: boolean, width: number, height: number }}
 */
export function planClientDownscale(f) {
  const w = Math.max(1, Math.round(Number(f?.width) || 0));
  const h = Math.max(1, Math.round(Number(f?.height) || 0));
  const bytes = Number(f?.bytes) || 0;
  const longSide = Math.max(w, h);
  const crop = heroAspectCrop(w, h);
  const scale = Math.min(1, Math.max(CLIENT_MAX_LONG_SIDE / longSide, HERO_UPLOAD_RECOMMENDED.width / crop.width));
  const reencode = bytes > CLIENT_REENCODE_BYTES || longSide > CLIENT_MAX_LONG_SIDE;
  if (!reencode || scale >= 1) return { reencode, width: w, height: h };
  // Round UP (minus float noise): a pixel more never matters, a pixel less
  // could drop the crop under the stored width.
  const up = (n) => Math.max(1, Math.ceil(n * scale - 1e-6));
  return { reencode, width: up(w), height: up(h) };
}

/**
 * The operator's statement where the picture comes from (`?ai=`): true = AI
 * generated (EU label + machine-readable marking), false = photo or own
 * graphic, null = not stated (the upload is refused — no silent default).
 * @param {unknown} v
 * @returns {boolean | null}
 */
export function parseHeroOrigin(v) {
  if (v === true || v === false) return v;
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "1" || s === "true" || s === "ai") return true;
  if (s === "0" || s === "false" || s === "photo") return false;
  return null;
}

/**
 * The original file name, for display only: the last path segment, without
 * control characters or separators, at most HERO_UPLOAD_NAME_MAX characters.
 * Null when nothing is left.
 * @param {unknown} v
 * @returns {string | null}
 */
/** A UTF-16 half of an emoji without its other half — invalid in jsonb. */
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function sanitizeUploadName(v) {
  if (typeof v !== "string") return null;
  const base = v.split(/[/\\]/).pop() ?? "";
  const tidy = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(LONE_SURROGATE_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  // Cut by code point, not UTF-16 unit: a cut through an emoji would leave a
  // lone surrogate, which Postgres rejects in jsonb — and every later save of
  // the campaign would fail.
  const clean = Array.from(tidy).slice(0, HERO_UPLOAD_NAME_MAX).join("").trim();
  return clean || null;
}
