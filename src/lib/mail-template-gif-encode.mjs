// Animated GIFs for e-mail templates — the sharp encoder behind
// shrinkAnimatedGif (mail-template-gif.mjs, which decides what to try): ONE
// variant of a GIF — every frame resized to a width, encoded with a
// frame-to-frame tolerance, all frames or only the ones gifKeptFrames keeps
// (each showing as long as the frames it stands for). Shared by the upload
// (mail-template-image.ts) and `npm run gif:shrink` (scripts/shrink-gif.mjs);
// tested on small real GIFs (mail-template-gif-encode.test.mjs).

import sharp from "sharp";
import { GIF_ENCODE_OPTIONS, gifKeptFrames } from "./mail-template-gif.mjs";

/**
 * Encode one variant of an animated GIF. Frames are left out on the decoded
 * frames (every frame RGBA at the new width — mail-template-gif.mjs keeps
 * that under GIF_RAW_MAX_BYTES); the loop count stays.
 * @param {Buffer | Uint8Array} bytes  the GIF as uploaded
 * @param {{ width: number, interFrameMaxError: number, frameStep: number }} variant
 * @param {{ frames: number, delays?: ReadonlyArray<number> | null, loop?: number | null, limitInputPixels: number }} gif
 *   `limitInputPixels`: all frames stacked (sharp counts an animated image so)
 * @returns {Promise<Buffer>}
 */
export async function encodeAnimatedGifVariant(bytes, variant, gif) {
  const options = { ...GIF_ENCODE_OPTIONS, interFrameMaxError: variant.interFrameMaxError };
  const frames = () =>
    sharp(bytes, { animated: true, limitInputPixels: gif.limitInputPixels }).resize({ width: variant.width, withoutEnlargement: true });
  if (!(variant.frameStep > 1)) return frames().gif(options).toBuffer();

  const delays = gif.delays?.length === gif.frames ? gif.delays : Array.from({ length: gif.frames }, () => 100);
  const kept = gifKeptFrames(delays, variant.frameStep);
  const { data, info } = await frames().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const frameHeight = info.height / gif.frames;
  if (!Number.isInteger(frameHeight) || info.channels !== 4) {
    throw new Error(`gif: ${info.width}×${info.height}×${info.channels} does not split into ${gif.frames} frames`);
  }
  const frameBytes = info.width * frameHeight * 4;
  const strip = Buffer.concat(kept.keep.map((i) => data.subarray(i * frameBytes, (i + 1) * frameBytes)));
  return sharp(strip, {
    raw: { width: info.width, height: frameHeight * kept.keep.length, channels: 4, pageHeight: frameHeight },
    limitInputPixels: false,
  })
    .gif({ ...options, delay: kept.delays, loop: gif.loop ?? 0 })
    .toBuffer();
}
