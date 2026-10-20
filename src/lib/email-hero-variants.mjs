// What ONE hero render turns into before it is stored: the model output in
// the hero's native format, then two files derived from it —
//
//   desktop  the full picture with the legibility gradient over its left part
//            (email-hero-gradient.mjs), the background of the desktop hero;
//   mobile   a right-side crop of the SAME scene without the gradient: on
//            phones the design shows the picture under the text, where the
//            calm left part would only be empty wall.
//
// Both are JPEG: a 1536-px PNG weighs 1–2 MB, which mail clients load slowly
// or not at all; a quality-88 JPEG of the same picture is a fraction of that
// and visually identical for a photograph.
//
// Also here: which image model to call, in which order, and the processing of
// an operator-UPLOADED picture (buildUploadedHeroVariants — the per-campaign
// „Kampagnenbild“). Everything that is not the sharp compositing is pure and
// unit-tested.

import { applyHeroGradient } from "./email-hero-gradient.mjs";
import { markAsAiGenerated } from "./email-hero-marking.mjs";
import {
  HERO_IMAGE_HEIGHT,
  HERO_IMAGE_WIDTH,
  heroAspectCrop,
  heroMobileCrop,
} from "./email-hero-geometry.mjs";
import { checkHeroUploadImage, heroUploadError, HERO_UPLOAD_MAX_PIXELS } from "./email-hero-upload.mjs";

// The geometry (native format, aspect and mobile crops) lives in the
// sharp-free email-hero-geometry.mjs so the browser can use it; re-exported
// here for every existing importer.
export {
  HERO_ASPECT,
  HERO_IMAGE_HEIGHT,
  HERO_IMAGE_WIDTH,
  HERO_MOBILE_CROP_START,
  heroAspectCrop,
  heroMobileCrop,
} from "./email-hero-geometry.mjs";

export const HERO_IMAGE_SIZE = `${HERO_IMAGE_WIDTH}x${HERO_IMAGE_HEIGHT}`;

/** The classic 3:2 size every GPT image model accepts — the fallback format. */
export const HERO_FALLBACK_SIZE = "1536x1024";

const HERO_JPEG_QUALITY = 88;

/**
 * `input_fidelity` is a gpt-image-1 / gpt-image-1.5 parameter; gpt-image-2
 * rejects it with a 400 ("does not support the 'input_fidelity' parameter" —
 * seen on the first live run, which turned every reference attempt into a
 * plain generation). It only goes to the models that take it.
 */
export function inputFidelityFor(model) {
  return /^gpt-image-1(\.|-|$)/.test(String(model)) ? "high" : undefined;
}

/** The image model the hero uses by default, and the order of fallbacks. */
export const HERO_PRIMARY_IMAGE_MODEL = "gpt-image-2";
export const HERO_FALLBACK_IMAGE_MODEL = "gpt-image-1.5";
const HERO_IMAGE_QUALITIES = ["low", "medium", "high"];
const HERO_DEFAULT_IMAGE_QUALITY = "high";

/**
 * The generation attempts, in order. The first that succeeds wins:
 *   0. (with reference photos) the primary model EDITING the references
 *      into the scene, native format, then 3:2 — the true-to-product path,
 *   1. the primary model generating in the hero's native format,
 *   2. the primary model in 3:2 (in case the free-form size is refused),
 *   3. the previous-generation model in 3:2 (in case the primary is down).
 * EMAIL_HERO_IMAGE_MODEL overrides the primary model; EMAIL_HERO_IMAGE_QUALITY
 * the quality (low | medium | high, default high).
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {{ withReferences?: boolean }} [opts]
 * @returns {{ mode: "generate" | "edit", model: string, size: string, quality: string, inputFidelity?: "high" }[]}
 */
export function heroImageAttempts(env = process.env, opts = {}) {
  const primary = (env.EMAIL_HERO_IMAGE_MODEL ?? "").trim() || HERO_PRIMARY_IMAGE_MODEL;
  const q = (env.EMAIL_HERO_IMAGE_QUALITY ?? "").trim().toLowerCase();
  const quality = HERO_IMAGE_QUALITIES.includes(q) ? q : HERO_DEFAULT_IMAGE_QUALITY;
  const attempts = [];
  if (opts.withReferences) {
    const fidelity = inputFidelityFor(primary);
    const edit = (size) => ({
      mode: "edit",
      model: primary,
      size,
      quality,
      ...(fidelity ? { inputFidelity: fidelity } : {}),
    });
    attempts.push(edit(HERO_IMAGE_SIZE), edit(HERO_FALLBACK_SIZE));
  }
  attempts.push(
    { mode: "generate", model: primary, size: HERO_IMAGE_SIZE, quality },
    { mode: "generate", model: primary, size: HERO_FALLBACK_SIZE, quality }
  );
  if (primary !== HERO_FALLBACK_IMAGE_MODEL) {
    attempts.push({ mode: "generate", model: HERO_FALLBACK_IMAGE_MODEL, size: HERO_FALLBACK_SIZE, quality });
  }
  return attempts;
}

/**
 * Turn the model's output into the two stored files. `master` is the
 * hero-aspect picture BEFORE the gradient — what the quality check looks at.
 * Every file is written with the machine-readable AI marking
 * (email-hero-marking.mjs) naming `tool`, the model that rendered it.
 * @param {Buffer | Uint8Array} image PNG/JPEG/WebP bytes from the image model
 * @param {{ tool?: string }} [opts]
 * @returns {Promise<{ desktop: Buffer, mobile: Buffer, master: Buffer, width: number, height: number }>}
 */
export async function buildHeroVariants(image, opts = {}) {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(image).metadata();
  if (!meta.width || !meta.height) throw new Error("hero image has no dimensions");
  const crop = heroAspectCrop(meta.width, meta.height);
  const marking = { tool: opts.tool ?? "generative AI" };
  const encode = (pipeline) =>
    markAsAiGenerated(pipeline, marking).jpeg({ quality: HERO_JPEG_QUALITY, mozjpeg: true }).toBuffer();
  // The hero-aspect master, lossless — both variants derive from it.
  const master = await sharp(image).extract(crop).png().toBuffer();
  const desktopPng = await applyHeroGradient(master);
  const desktop = await encode(sharp(desktopPng));
  const mobile = await encode(sharp(master).extract(heroMobileCrop(crop.width, crop.height)));
  const masterJpeg = await encode(sharp(master));
  return { desktop, mobile, master: masterJpeg, width: crop.width, height: crop.height };
}

/**
 * Turn an operator-UPLOADED picture (the „Kampagnenbild“, Kampagnen-Editor →
 * Gestaltung) into the same two stored files an AI render becomes — but
 * from an arbitrary photo, so unlike buildHeroVariants it
 *   * checks the sniffed format, animation, pixel count and minimum size
 *     (email-hero-upload.mjs — the declared Content-Type is ignored),
 *   * applies the EXIF orientation first (a portrait phone photo would
 *     otherwise be cropped from its unrotated pixels and stored sideways),
 *   * scales the hero crop to exactly 1536×720 (a camera photo would stay
 *     several MB per mail otherwise),
 *   * flattens transparency onto white and converts CMYK / wide-gamut
 *     sources to sRGB,
 *   * writes the AI marking ONLY when the operator declared the picture AI
 *     generated — a real photo carries no metadata at all (the PNG master
 *     drops every input tag, so no camera EXIF or GPS leaves the server).
 * Never throws: a picture sharp cannot read becomes `unreadable`.
 * @param {Buffer | Uint8Array} image the uploaded bytes
 * @param {{ aiGenerated: boolean, tool?: string }} opts
 * @returns {Promise<{ ok: true, desktop: Buffer, mobile: Buffer, sourceWidth: number, sourceHeight: number,
 *   warnings: string[] } | { ok: false, code: string, status: number, message: string }>}
 */
export async function buildUploadedHeroVariants(image, opts) {
  try {
    const { default: sharp } = await import("sharp");
    // The header is read without the pixel cap (metadata decodes no pixels;
    // with the cap sharp would THROW and a 50-MP photo would read as
    // "unreadable" instead of "too big"); the decode below keeps it as the
    // backstop behind checkHeroUploadImage.
    const meta = await sharp(image, { limitInputPixels: false }).metadata();
    const limits = { limitInputPixels: HERO_UPLOAD_MAX_PIXELS };
    const w = meta.autoOrient?.width ?? meta.width;
    const h = meta.autoOrient?.height ?? meta.height;
    const check = checkHeroUploadImage({ format: meta.format, width: w, height: h, pages: meta.pages ?? 1 });
    if (!check.ok) return check;
    // One pass: rotate upright, cut the hero crop, scale it to the stored size.
    const master = await sharp(image, { ...limits, autoOrient: true })
      .extract(check.crop)
      .resize(HERO_IMAGE_WIDTH, HERO_IMAGE_HEIGHT, { fit: "cover", position: "right" })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .png()
      .toBuffer();
    const marking = { tool: opts?.tool ?? "generative AI (hochgeladen)" };
    const encode = (pipeline) =>
      (opts?.aiGenerated === true ? markAsAiGenerated(pipeline, marking) : pipeline)
        .jpeg({ quality: HERO_JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    const desktop = await encode(sharp(await applyHeroGradient(master)));
    const mobile = await encode(sharp(master).extract(heroMobileCrop(HERO_IMAGE_WIDTH, HERO_IMAGE_HEIGHT)));
    return { ok: true, desktop, mobile, sourceWidth: Number(w), sourceHeight: Number(h), warnings: check.warnings };
  } catch {
    // Junk bytes, a truncated file, a decoder limit — the operator's problem
    // is "this is not a readable picture", not a server error.
    return heroUploadError("unreadable");
  }
}
