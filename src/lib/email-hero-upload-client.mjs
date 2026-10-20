// The BROWSER half of the Kampagnenbild upload rules (Kampagnen-Editor →
// Gestaltung → „Kampagnenbild“): what src/app/admin/lib/prepare-hero-upload.ts
// decides before a single byte leaves the browser. Pure — the decoding and
// the canvas live in that file; the rules themselves are the shared ones in
// email-hero-upload.mjs, and the server checks everything again from the
// sniffed bytes (the client is never trusted).
//
// Why a client step at all: Vercel refuses request bodies over 4.5 MB with a
// non-JSON 413 before the route runs, and phone photos are often 5–12 MB or
// over 40 megapixels. The browser therefore shrinks such a picture to what
// the hero can use (planClientDownscale — never below the stored 1536 px crop
// width) and re-encodes it as JPEG; the rules below are checked on THAT size,
// so a 50-MP photo is uploaded downscaled instead of being refused as „zu
// groß“, while a picture that is simply too small fails at once, without a
// round trip.

import {
  CLIENT_JPEG_QUALITY,
  HERO_UPLOAD_CONTENT_TYPES,
  HERO_UPLOAD_MAX_BYTES,
  checkHeroUploadImage,
  heroUploadError,
  planClientDownscale,
} from "./email-hero-upload.mjs";

/** JPEG qualities tried in turn when a re-encoded picture is still over the
 *  request limit (a very detailed photo) — the first one that fits wins. */
export const CLIENT_JPEG_QUALITIES = Object.freeze([CLIENT_JPEG_QUALITY, 0.85, 0.75]);

/** `accept` of the file picker — iOS converts HEIC photos to JPEG for it. */
export const HERO_UPLOAD_ACCEPT = HERO_UPLOAD_CONTENT_TYPES.join(",");

const TYPE_ALIASES = Object.freeze({
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/png": "image/png",
  "image/x-png": "image/png",
  "image/webp": "image/webp",
});

const EXTENSION_TYPES = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
});

/**
 * The upload Content-Type of a picked file: the browser's type (with the
 * common aliases), or — when the browser reports none, as some drag sources
 * do — the file extension. Null for anything else (HEIC, GIF, SVG, PDF …).
 * @param {unknown} type  File.type
 * @param {unknown} name  File.name
 * @returns {"image/jpeg" | "image/png" | "image/webp" | null}
 */
export function heroUploadContentType(type, name) {
  const t = typeof type === "string" ? type.split(";")[0].trim().toLowerCase() : "";
  if (t) return /** @type {any} */ (TYPE_ALIASES[/** @type {keyof typeof TYPE_ALIASES} */ (t)] ?? null);
  const ext = typeof name === "string" ? (/\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1] ?? "").toLowerCase() : "";
  return /** @type {any} */ (EXTENSION_TYPES[/** @type {keyof typeof EXTENSION_TYPES} */ (ext)] ?? null);
}

/** sharp-style format name of an accepted Content-Type. */
const formatOf = (contentType) => String(contentType).replace(/^image\//, "");

/**
 * What the browser does with a decoded picture: refuse it (the shared German
 * error), send it as it is, or re-encode it at the planned size. The rules
 * are checked on the size that will actually be UPLOADED.
 * @param {{ contentType: string | null, bytes: number, width: number, height: number }} f
 *   `width`/`height` are the ORIENTED size (EXIF rotation applied).
 * @returns {{ ok: true, reencode: boolean, width: number, height: number, warnings: string[] }
 *   | { ok: false, code: string, status: number, message: string }}
 */
export function planHeroUpload(f) {
  if (!f?.contentType || !HERO_UPLOAD_CONTENT_TYPES.includes(/** @type {any} */ (f.contentType))) {
    return heroUploadError("format");
  }
  const bytes = Number(f.bytes) || 0;
  if (bytes <= 0) return heroUploadError("empty");
  const width = Number(f.width);
  const height = Number(f.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return heroUploadError("unreadable");
  }
  const plan = planClientDownscale({ bytes, width, height });
  const check = checkHeroUploadImage({ format: formatOf(f.contentType), width: plan.width, height: plan.height, pages: 1 });
  if (!check.ok) return check;
  if (!plan.reencode && bytes > HERO_UPLOAD_MAX_BYTES) return heroUploadError("too_large");
  return { ok: true, reencode: plan.reencode, width: plan.width, height: plan.height, warnings: check.warnings };
}

/**
 * The sizes a picture is drawn through on the way down: halving while the
 * half is still larger than the target (one big drawImage jump aliases fine
 * detail in browsers without a high-quality filter), then the target itself —
 * so no single step shrinks by more than 2×. Empty when nothing shrinks.
 * @param {number} fromW
 * @param {number} fromH
 * @param {number} toW
 * @param {number} toH
 * @returns {Array<[number, number]>}
 */
export function downscaleSteps(fromW, fromH, toW, toH) {
  /** @type {Array<[number, number]>} */
  const steps = [];
  if (toW >= fromW && toH >= fromH) return steps;
  let w = fromW;
  let h = fromH;
  while (w / 2 > toW && h / 2 > toH) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    steps.push([w, h]);
  }
  steps.push([toW, toH]);
  return steps;
}
