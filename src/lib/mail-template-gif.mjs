// Animated GIFs for e-mail templates — the decisions behind storeTemplateImage
// (mail-template-image.ts; pure — the sharp encoder is injected, so node:test
// covers every branch). docs/EMAIL_TEMPLATES.md §7.
//
// An animated GIF that fits (≤ 1,200 px wide, ≤ 2 MB) is stored byte for byte.
// One that does not is shrunk instead of refused: every frame resized and
// encoded again — the frames, their timing and the loop stay — at most
// 1,200 px wide (2× the 600-px mail) and, while the result is still over 2 MB,
// narrower: a GIF's size grows with its area, so the next width follows from
// the last result. Never narrower than the mail itself (600 px) unless the GIF
// already is. Encoding is the slow part (≈ 0.25 s per 1,200 × 1,200 frame on
// one core, measured 24.11.2026), so every attempt is planned to fit the time
// budget of its caller — the upload route's or the KI-Gestalter's.
//
// Why the frames are never read up front: sharp's pixel limit counts an
// animated image as all its frames stacked, so a 1,440-px GIF with 20 frames
// already passed 40 megapixels and was refused as „nicht lesbar“ (owner
// report 24.11.2026). The caller reads the first frame only; the limit holds
// per frame.

/** The widest a template picture is stored (2× the 600-px mail). */
export const GIF_MAX_WIDTH = 1200;
/** An animated GIF is stored at most this large. */
export const GIF_MAX_BYTES = 2_000_000;
/** A GIF that has to shrink never gets narrower than the mail (unless it already is). */
export const GIF_MIN_WIDTH = 600;
/** Encodes of one upload at most (the first, then narrower). */
export const GIF_MAX_ATTEMPTS = 3;
/** Pixels per second decoded and resized (all frames) — planned with headroom (measured ≈ 50 M on one 2.1-GHz core). */
export const GIF_DECODE_PIXELS_PER_SECOND = 25_000_000;
/** Pixels per second encoded (all frames) — planned with headroom (measured ≈ 4.5 M on one 2.1-GHz core). */
export const GIF_ENCODE_PIXELS_PER_SECOND = 3_000_000;
/** Seconds an upload may spend encoding (the route has 300). */
export const GIF_UPLOAD_BUDGET_SECONDS = 150;
/**
 * sharp's GIF options for a re-encode: the fastest palette search and small
 * frame-to-frame differences stored as transparency. 2.7× faster than the
 * defaults at 44.9 instead of 46.4 dB PSNR (measured on a 1,440-px, 40-frame
 * photo GIF) — no visible difference, a smaller file.
 */
export const GIF_ENCODE_OPTIONS = Object.freeze({ effort: 1, interFrameMaxError: 8 });
/** A result is aimed this far below the limit (the size follows the width only roughly). */
const SIZE_HEADROOM = 0.9;
/**
 * How a GIF's size follows its width: size ∝ width^k. Measured k ≈ 1.6 on a
 * photo GIF (1,200 → 900 → 600 px: 1,741 → 1,086 → 568 KB) — less than the
 * area's 2, since palette and frame overhead stay. After two attempts the
 * GIF's own k is used (clamped to this range).
 */
const SIZE_EXPONENT = 1.6;
const SIZE_EXPONENT_RANGE = /** @type {const} */ ([1, 2.5]);

/**
 * @typedef {{ width: number, height: number, frames: number }} GifShape
 *   width / height of ONE frame (the GIF's canvas), frames = sharp's `pages`
 */

/** „1,7 MB“ / „640 KB“. @param {number} bytes */
export function sizeLabel(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n >= 1_000_000) return `${(Math.round(n / 100_000) / 10).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(n / 1000))} KB`;
}

/**
 * Seconds one encode at `outWidth` is planned with: every frame decoded and
 * resized, then every frame encoded at its new size.
 * @param {GifShape} gif
 * @param {number} outWidth
 */
export function gifEncodeSeconds(gif, outWidth) {
  const outHeight = Math.max(1, Math.round((gif.height * outWidth) / gif.width));
  return gif.frames * ((gif.width * gif.height) / GIF_DECODE_PIXELS_PER_SECOND + (outWidth * outHeight) / GIF_ENCODE_PIXELS_PER_SECOND);
}

/**
 * The widest width up to `cap` (in steps of 10 px, or `cap` itself) whose
 * encode is planned to fit `seconds`; 0 when not even decoding fits.
 * @param {GifShape} gif
 * @param {number} seconds
 * @param {number} cap
 */
export function gifWidthForSeconds(gif, seconds, cap) {
  if (!(seconds > 0) || !(cap > 0)) return 0;
  if (gifEncodeSeconds(gif, cap) <= seconds) return cap;
  const perFrame = seconds / gif.frames - (gif.width * gif.height) / GIF_DECODE_PIXELS_PER_SECOND;
  if (perFrame <= 0) return 0;
  // frames × (decode + w² · height/width / encodeRate) ≤ seconds
  const w = Math.sqrt((perFrame * GIF_ENCODE_PIXELS_PER_SECOND * gif.width) / gif.height);
  return Math.max(0, Math.min(cap, Math.floor(w / 10) * 10));
}

/**
 * What to do with an animated GIF: keep it as it is, encode it at a width,
 * or refuse it with a German message (only when not even the narrowest
 * version fits the time budget).
 * @param {GifShape & { bytes: number, budgetSeconds?: number }} gif
 * @returns {{ action: "keep" } | { action: "encode", width: number } | { action: "refuse", code: string, message: string }}
 */
export function planAnimatedGif({ width, height, frames, bytes, budgetSeconds = GIF_UPLOAD_BUDGET_SECONDS }) {
  if (!(width > 0 && height > 0 && frames > 1)) {
    return { action: "refuse", code: "unreadable", message: "Das GIF ist nicht lesbar — bitte neu exportieren." };
  }
  if (width <= GIF_MAX_WIDTH && bytes <= GIF_MAX_BYTES) return { action: "keep" };
  const shape = { width, height, frames };
  const floor = Math.min(width, GIF_MIN_WIDTH);
  const w = gifWidthForSeconds(shape, budgetSeconds, Math.min(width, GIF_MAX_WIDTH));
  if (w < floor) {
    return {
      action: "refuse",
      code: "gif_too_long",
      message: `Das animierte GIF (${width} px, ${frames} Einzelbilder, ${sizeLabel(bytes)}) lässt sich hier nicht schnell genug verkleinern — bitte höchstens ${GIF_MAX_WIDTH} px breit und 2 MB groß exportieren.`,
    };
  }
  return { action: "encode", width: w };
}

/**
 * The width of the next attempt after one that came out over the limit —
 * narrower by what the size has to lose (size ∝ width^k: k = 1.6, or the
 * GIF's own k measured from the attempt before), at least 10 px narrower,
 * never below the floor (600 px, or the GIF's own width when it is narrower)
 * and within the time left; null when there is none.
 * @param {{ gif: GifShape, triedWidth: number, outBytes: number, secondsLeft: number, previous?: { width: number, bytes: number } | null }} r
 * @returns {number | null}
 */
export function nextGifWidth({ gif, triedWidth, outBytes, secondsLeft, previous = null }) {
  const floor = Math.min(gif.width, GIF_MIN_WIDTH);
  if (triedWidth <= floor || !(outBytes > 0)) return null;
  let k = SIZE_EXPONENT;
  if (previous && previous.width > triedWidth && previous.bytes > outBytes) {
    const measured = Math.log(previous.bytes / outBytes) / Math.log(previous.width / triedWidth);
    k = Math.min(SIZE_EXPONENT_RANGE[1], Math.max(SIZE_EXPONENT_RANGE[0], measured));
  }
  let w = Math.floor((triedWidth * ((GIF_MAX_BYTES * SIZE_HEADROOM) / outBytes) ** (1 / k)) / 10) * 10;
  w = Math.max(floor, Math.min(w, triedWidth - 10));
  const byTime = gifWidthForSeconds(gif, secondsLeft, w);
  if (byTime < w) {
    if (byTime < floor) return null;
    w = byTime;
  }
  return w;
}

/**
 * Encode an animated GIF until it fits GIF_MAX_BYTES: first at `firstWidth`,
 * then narrower (nextGifWidth) — at most GIF_MAX_ATTEMPTS encodes, within
 * `budgetSeconds`. `encode(width)` resizes every frame to that width and
 * encodes the GIF (sharp, GIF_ENCODE_OPTIONS); its errors propagate.
 * @param {{
 *   gif: GifShape,
 *   firstWidth: number,
 *   budgetSeconds?: number,
 *   encode: (width: number) => Promise<Uint8Array>,
 *   now?: () => number,
 * }} p
 * @returns {Promise<{ ok: true, data: Uint8Array, width: number, attempts: number } | { ok: false, code: string, message: string }>}
 */
export async function shrinkAnimatedGif({ gif, firstWidth, budgetSeconds = GIF_UPLOAD_BUDGET_SECONDS, encode, now = () => Date.now() }) {
  const started = now();
  let width = firstWidth;
  /** @type {{ width: number, bytes: number }} */
  let last = { width, bytes: 0 };
  /** @type {{ width: number, bytes: number } | null} */
  let previous = null;
  for (let attempt = 1; attempt <= GIF_MAX_ATTEMPTS; attempt++) {
    const data = await encode(width);
    if (data.length <= GIF_MAX_BYTES) return { ok: true, data, width, attempts: attempt };
    last = { width, bytes: data.length };
    if (attempt === GIF_MAX_ATTEMPTS) break;
    const next = nextGifWidth({ gif, triedWidth: width, outBytes: data.length, secondsLeft: budgetSeconds - (now() - started) / 1000, previous });
    if (next == null) break;
    previous = last;
    width = next;
  }
  return {
    ok: false,
    code: "gif_too_large",
    message: `Das animierte GIF ist auch auf ${last.width} px verkleinert noch ${sizeLabel(last.bytes)} groß (höchstens 2 MB) — bitte mit weniger Einzelbildern oder kleiner exportieren.`,
  };
}

/**
 * The operator's note on a GIF that was encoded again.
 * @param {{ fromWidth: number, toWidth: number, fromBytes: number, toBytes: number, frames: number }} r
 */
export function gifShrunkWarning({ fromWidth, toWidth, fromBytes, toBytes, frames }) {
  const size = `${sizeLabel(fromBytes)} → ${sizeLabel(toBytes)}`;
  const kept = `alle ${frames} Einzelbilder bleiben`;
  return toWidth < fromWidth
    ? `Animiertes GIF für die Mail verkleinert: ${fromWidth} → ${toWidth} px breit, ${size} (${kept}).`
    : `Animiertes GIF für die Mail neu gespeichert: ${size} (${kept}).`;
}
