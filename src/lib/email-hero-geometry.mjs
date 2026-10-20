// The hero's picture geometry — its native format and the two crops every
// hero file is cut with. Split out of email-hero-variants.mjs (which
// re-exports everything here, so existing importers are unchanged) because
// that module imports the gradient and the marking, which load sharp: the
// upload rules (email-hero-upload.mjs) need the crop maths in the BROWSER
// too, and a sharp import must never reach a client chunk.
//
// Pure, no imports; tested through email-hero-variants.test.mjs.

/**
 * The hero's native picture format. The desktop hero is 640×300 (2.133:1);
 * rendering EXACTLY that ratio means the model composes for the frame the
 * reader sees — nothing is cropped away afterwards — and no tokens are spent
 * on rows that background-size:cover would discard. Both dimensions are
 * multiples of 16, as gpt-image-2's free-form sizes require.
 */
export const HERO_IMAGE_WIDTH = 1536;
export const HERO_IMAGE_HEIGHT = 720;
export const HERO_ASPECT = HERO_IMAGE_WIDTH / HERO_IMAGE_HEIGHT;

/**
 * Where the mobile crop starts (fraction of the width). The prompt keeps the
 * left 45% calm and the scene lives in the right 55%; starting at 40% keeps
 * a little breathing room before the first product.
 */
export const HERO_MOBILE_CROP_START = 0.4;

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
