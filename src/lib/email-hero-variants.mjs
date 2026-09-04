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
// Also here: which image model to call, in which order. Everything that is
// not the sharp compositing is pure and unit-tested.

import { applyHeroGradient } from "./email-hero-gradient.mjs";

/**
 * The hero's native picture format. The desktop hero is 640×300 (2.133:1);
 * rendering EXACTLY that ratio means the model composes for the frame the
 * reader sees — nothing is cropped away afterwards — and no tokens are spent
 * on rows that background-size:cover would discard. Both dimensions are
 * multiples of 16, as gpt-image-2's free-form sizes require.
 */
export const HERO_IMAGE_WIDTH = 1536;
export const HERO_IMAGE_HEIGHT = 720;
export const HERO_IMAGE_SIZE = `${HERO_IMAGE_WIDTH}x${HERO_IMAGE_HEIGHT}`;
export const HERO_ASPECT = HERO_IMAGE_WIDTH / HERO_IMAGE_HEIGHT;

/** The classic 3:2 size every GPT image model accepts — the fallback format. */
export const HERO_FALLBACK_SIZE = "1536x1024";

/**
 * Where the mobile crop starts (fraction of the width). The prompt keeps the
 * left 45% calm and the scene lives in the right 55%; starting at 40% keeps
 * a little breathing room before the first product.
 */
export const HERO_MOBILE_CROP_START = 0.4;

export const HERO_JPEG_QUALITY = 88;

/** The image model the hero uses by default, and the order of fallbacks. */
export const HERO_PRIMARY_IMAGE_MODEL = "gpt-image-2";
export const HERO_FALLBACK_IMAGE_MODEL = "gpt-image-1.5";
export const HERO_IMAGE_QUALITIES = ["low", "medium", "high"];
export const HERO_DEFAULT_IMAGE_QUALITY = "high";

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
 * @returns {{ mode: "generate" | "edit", model: string, size: string, quality: string, inputFidelity?: "high" | "low" }[]}
 */
export function heroImageAttempts(env = process.env, opts = {}) {
  const primary = (env.EMAIL_HERO_IMAGE_MODEL ?? "").trim() || HERO_PRIMARY_IMAGE_MODEL;
  const q = (env.EMAIL_HERO_IMAGE_QUALITY ?? "").trim().toLowerCase();
  const quality = HERO_IMAGE_QUALITIES.includes(q) ? q : HERO_DEFAULT_IMAGE_QUALITY;
  const attempts = [];
  if (opts.withReferences) {
    attempts.push(
      { mode: "edit", model: primary, size: HERO_IMAGE_SIZE, quality, inputFidelity: "high" },
      { mode: "edit", model: primary, size: HERO_FALLBACK_SIZE, quality, inputFidelity: "high" }
    );
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
 * The cover-crop that brings a picture of `width`×`height` to the hero's
 * aspect — the same region background-size:cover / position:center right
 * would show, so desktop and mobile files always come from the same pixels.
 * A picture already in the hero's ratio is returned whole.
 * @param {number} width
 * @param {number} height
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function heroAspectCrop(width, height) {
  const targetHeight = Math.round(width / HERO_ASPECT);
  if (targetHeight <= height) {
    // Too tall (e.g. 3:2): keep the full width, take a vertically centred band.
    return { left: 0, top: Math.floor((height - targetHeight) / 2), width, height: targetHeight };
  }
  // Too wide: keep the full height, take the right-anchored band (the scene
  // lives on the right; the left is calm wall that can go).
  const targetWidth = Math.round(height * HERO_ASPECT);
  return { left: width - targetWidth, top: 0, width: targetWidth, height };
}

/**
 * The mobile crop of a hero-aspect picture: everything from
 * HERO_MOBILE_CROP_START to the right edge, full height.
 * @param {number} width
 * @param {number} height
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function heroMobileCrop(width, height) {
  const left = Math.round(width * HERO_MOBILE_CROP_START);
  return { left, top: 0, width: width - left, height };
}

/**
 * Turn the model's output into the two stored files. `master` is the
 * hero-aspect picture BEFORE the gradient — what the quality check looks at.
 * @param {Buffer | Uint8Array} image PNG/JPEG/WebP bytes from the image model
 * @returns {Promise<{ desktop: Buffer, mobile: Buffer, master: Buffer, width: number, height: number }>}
 */
export async function buildHeroVariants(image) {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(image).metadata();
  if (!meta.width || !meta.height) throw new Error("hero image has no dimensions");
  const crop = heroAspectCrop(meta.width, meta.height);
  // The hero-aspect master, lossless — both variants derive from it.
  const master = await sharp(image).extract(crop).png().toBuffer();
  const desktopPng = await applyHeroGradient(master);
  const desktop = await sharp(desktopPng)
    .jpeg({ quality: HERO_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  const mobile = await sharp(master)
    .extract(heroMobileCrop(crop.width, crop.height))
    .jpeg({ quality: HERO_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  const masterJpeg = await sharp(master).jpeg({ quality: HERO_JPEG_QUALITY, mozjpeg: true }).toBuffer();
  return { desktop, mobile, master: masterJpeg, width: crop.width, height: crop.height };
}
