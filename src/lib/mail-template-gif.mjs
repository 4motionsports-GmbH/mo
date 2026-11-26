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
// Still over 2 MB at its narrowest (owner report 26.11.2026: a 384-px phone
// GIF came out at 3.1 MB and could not get narrower), it is compressed harder,
// gentlest first (GIF_COMPACT_STEPS): a pixel that changed less than the
// tolerance from the frame before is kept from that frame (16, then 32 —
// measured on video GIFs: −40 to −85 % at a barely visible cost), then only
// every second or third frame of a video-like GIF is kept, each showing as
// long as the frames it stands for (same duration). Pauses and slides — a
// frame of 150 ms or more — always stay (gifKeptFrames), a slideshow loses
// nothing.
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
/** Encodes at narrower widths at most (the first, then narrower). */
export const GIF_MAX_WIDTH_ATTEMPTS = 3;
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
/**
 * A GIF still over 2 MB at its narrowest is compressed harder, gentlest step
 * first: a higher frame-to-frame tolerance (sharp `interFrameMaxError`, 0–32),
 * then only every second / third frame of a video-like GIF (gifKeptFrames).
 * Measured 26.11.2026 on 384 × 682 video GIFs with 70 frames: tolerance 16 =
 * −43 to −73 % (PSNR −2 to −3 dB), 32 = −63 to −85 %; every second frame
 * on top another −30 %.
 */
export const GIF_COMPACT_STEPS = Object.freeze([
  Object.freeze({ interFrameMaxError: 16, frameStep: 1 }),
  Object.freeze({ interFrameMaxError: 32, frameStep: 1 }),
  Object.freeze({ interFrameMaxError: 32, frameStep: 2 }),
  Object.freeze({ interFrameMaxError: 32, frameStep: 3 }),
]);
/** Encodes of one upload at most: the narrower widths, then the compact steps. */
export const GIF_MAX_ATTEMPTS = GIF_MAX_WIDTH_ATTEMPTS + GIF_COMPACT_STEPS.length;
/** A frame shown this long or longer is a pause or a slide — it is never left out. */
export const GIF_HOLD_FRAME_MS = 150;
/** At least this many frames stay when frames are left out. */
export const GIF_MIN_KEPT_FRAMES = 4;
/** Leaving frames out decodes every frame at once (RGBA): at most this many bytes. */
export const GIF_RAW_MAX_BYTES = 300_000_000;
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
 * @typedef {{ width: number, height: number, frames: number, delays?: ReadonlyArray<number> }} GifShape
 *   width / height of ONE frame (the GIF's canvas), frames = sharp's `pages`,
 *   delays = each frame's delay in ms (sharp's `delay`)
 */
/**
 * @typedef {{ width: number, interFrameMaxError: number, frameStep: number }} GifVariant
 *   one encode: the width, the frame-to-frame tolerance, every n-th frame (1 = all)
 */

/** „1,7 MB“ / „640 KB“. @param {number} bytes */
export function sizeLabel(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n >= 1_000_000) return `${(Math.round(n / 100_000) / 10).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(n / 1000))} KB`;
}

/**
 * Seconds one encode at `outWidth` is planned with: every frame decoded and
 * resized, then every frame — or every `frameStep`-th — encoded at its new size.
 * @param {GifShape} gif
 * @param {number} outWidth
 * @param {number} [frameStep]
 */
export function gifEncodeSeconds(gif, outWidth, frameStep = 1) {
  const outHeight = Math.max(1, Math.round((gif.height * outWidth) / gif.width));
  const encoded = Math.ceil(gif.frames / Math.max(1, frameStep));
  return (
    (gif.frames * gif.width * gif.height) / GIF_DECODE_PIXELS_PER_SECOND +
    (encoded * outWidth * outHeight) / GIF_ENCODE_PIXELS_PER_SECOND
  );
}

/** A frame's delay as browsers show it (0 / 10 ms play as 100 ms). @param {unknown} ms */
const shownDelay = (ms) => (Number(ms) > 10 ? Number(ms) : 100);

/**
 * Which frames stay when only every `step`-th is kept, and how long each
 * kept frame shows: the first, every `step`-th, every pause or slide (a
 * frame of GIF_HOLD_FRAME_MS or more) and the last (a GIF that plays once
 * ends on it); each kept frame shows as long as itself and the frames left
 * out after it — the animation lasts exactly as long as before.
 * @param {ReadonlyArray<number>} delays  each frame's delay in ms
 * @param {number} step
 * @returns {{ keep: number[], delays: number[] }}
 */
export function gifKeptFrames(delays, step) {
  const n = delays.length;
  /** @type {number[]} */
  const keep = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1 || step <= 1 || i % step === 0 || shownDelay(delays[i]) >= GIF_HOLD_FRAME_MS) keep.push(i);
  }
  const out = keep.map((from, k) => {
    const to = k + 1 < keep.length ? keep[k + 1] : n;
    let ms = 0;
    for (let i = from; i < to; i++) ms += shownDelay(delays[i]);
    return ms;
  });
  return { keep, delays: out };
}

/** The bytes of every frame decoded at `width` (RGBA). @param {GifShape} gif @param {number} width */
export function gifRawBytes(gif, width) {
  return width * Math.max(1, Math.round((gif.height * width) / gif.width)) * 4 * gif.frames;
}

/**
 * The next compact step after `afterIndex` (−1: the first) that is worth an
 * encode at `width`: leaving frames out only when it leaves out at least one
 * and keeps GIF_MIN_KEPT_FRAMES, and every frame fits GIF_RAW_MAX_BYTES; the
 * encode planned within `secondsLeft`. Null when there is none.
 * @param {GifShape} gif
 * @param {number} width
 * @param {number} afterIndex
 * @param {number} secondsLeft
 * @returns {(GifVariant & { index: number }) | null}
 */
export function nextCompactStep(gif, width, afterIndex, secondsLeft) {
  const delays = gif.delays?.length === gif.frames ? gif.delays : Array.from({ length: gif.frames }, () => 100);
  for (let index = afterIndex + 1; index < GIF_COMPACT_STEPS.length; index++) {
    const step = GIF_COMPACT_STEPS[index];
    if (step.frameStep > 1) {
      const kept = gifKeptFrames(delays, step.frameStep).keep.length;
      if (kept >= gif.frames || kept < GIF_MIN_KEPT_FRAMES || gifRawBytes(gif, width) > GIF_RAW_MAX_BYTES) continue;
    }
    if (gifEncodeSeconds(gif, width, step.frameStep) > secondsLeft) continue;
    return { index, width, interFrameMaxError: step.interFrameMaxError, frameStep: step.frameStep };
  }
  return null;
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
 * then narrower (nextGifWidth, at most GIF_MAX_WIDTH_ATTEMPTS encodes), then —
 * at the narrowest width — compressed harder (nextCompactStep), all within
 * `budgetSeconds`. `encode(variant)` resizes every frame to the variant's
 * width and encodes the GIF with its tolerance and frames (sharp,
 * mail-template-gif-encode.mjs); its errors propagate.
 * @param {{
 *   gif: GifShape,
 *   firstWidth: number,
 *   budgetSeconds?: number,
 *   encode: (variant: GifVariant) => Promise<Uint8Array>,
 *   now?: () => number,
 * }} p
 * @returns {Promise<
 *   | ({ ok: true, data: Uint8Array, attempts: number, keptFrames: number } & GifVariant)
 *   | { ok: false, code: string, message: string }
 * >}
 */
export async function shrinkAnimatedGif({ gif, firstWidth, budgetSeconds = GIF_UPLOAD_BUDGET_SECONDS, encode, now = () => Date.now() }) {
  const started = now();
  /** @type {GifVariant} */
  let variant = { width: firstWidth, interFrameMaxError: GIF_ENCODE_OPTIONS.interFrameMaxError, frameStep: 1 };
  /** @type {GifVariant & { bytes: number }} */
  let last = { ...variant, bytes: 0 };
  /** @type {{ width: number, bytes: number } | null} */
  let previous = null;
  let compact = -1;
  let widthAttempts = 0;
  const delays = gif.delays?.length === gif.frames ? gif.delays : Array.from({ length: gif.frames }, () => 100);
  for (let attempt = 1; attempt <= GIF_MAX_ATTEMPTS; attempt++) {
    const data = await encode(variant);
    const keptFrames = variant.frameStep > 1 ? gifKeptFrames(delays, variant.frameStep).keep.length : gif.frames;
    if (data.length <= GIF_MAX_BYTES) return { ok: true, data, attempts: attempt, keptFrames, ...variant };
    last = { ...variant, bytes: data.length };
    const secondsLeft = budgetSeconds - (now() - started) / 1000;
    if (compact < 0 && ++widthAttempts < GIF_MAX_WIDTH_ATTEMPTS) {
      const next = nextGifWidth({ gif, triedWidth: variant.width, outBytes: data.length, secondsLeft, previous });
      if (next != null) {
        previous = { width: variant.width, bytes: data.length };
        variant = { ...variant, width: next };
        continue;
      }
    }
    // As narrow as it gets: compressed harder, the gentlest step first.
    const step = nextCompactStep(gif, variant.width, compact, secondsLeft);
    if (!step) break;
    compact = step.index;
    variant = { width: step.width, interFrameMaxError: step.interFrameMaxError, frameStep: step.frameStep };
  }
  return { ok: false, code: "gif_too_large", message: gifTooLargeMessage(gif, last) };
}

/** „a, b und c“. @param {string[]} parts */
const germanList = (parts) => (parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} und ${parts.at(-1)}`);

/** „zweiten“ / „dritten“ / „4.“ (after „mit nur jedem“). @param {number} step */
const everyNth = (step) => (step === 2 ? "zweiten" : step === 3 ? "dritten" : `${step}.`);

/**
 * What was tried, in the refusal: „auf 600 px verkleinert, stärker
 * komprimiert und mit nur jedem zweiten Einzelbild“ — „verkleinert“ only
 * when the width really changed.
 * @param {GifShape} gif
 * @param {GifVariant & { bytes: number }} last
 */
function gifTooLargeMessage(gif, last) {
  /** @type {string[]} */
  const tried = [];
  if (last.width < gif.width) tried.push(`auf ${last.width} px verkleinert`);
  if (last.interFrameMaxError > GIF_ENCODE_OPTIONS.interFrameMaxError) tried.push("stärker komprimiert");
  if (last.frameStep > 1) tried.push(`mit nur jedem ${everyNth(last.frameStep)} Einzelbild`);
  const what = tried.length ? germanList(tried) : "neu gespeichert";
  return `Das animierte GIF ist auch ${what} noch ${sizeLabel(last.bytes)} groß (höchstens 2 MB) — bitte kürzer, schmaler oder mit weniger Einzelbildern exportieren.`;
}

/**
 * The operator's note on a GIF that was encoded again — narrower, compressed
 * harder, with fewer frames: „Animiertes GIF für die Mail verkleinert: 1440 →
 * 1200 px breit, 1,9 MB → 1,7 MB (alle 40 Einzelbilder bleiben).“
 * @param {{ fromWidth: number, toWidth: number, fromBytes: number, toBytes: number, frames: number, keptFrames?: number, compressed?: boolean }} r
 */
export function gifShrunkWarning({ fromWidth, toWidth, fromBytes, toBytes, frames, keptFrames = frames, compressed = false }) {
  const narrower = toWidth < fromWidth;
  const what = narrower && compressed ? "verkleinert und stärker komprimiert" : narrower ? "verkleinert" : compressed ? "stärker komprimiert" : "neu gespeichert";
  const parts = [...(narrower ? [`${fromWidth} → ${toWidth} px breit`] : []), `${sizeLabel(fromBytes)} → ${sizeLabel(toBytes)}`];
  const kept =
    keptFrames < frames
      ? ` — ${frames} → ${keptFrames} Einzelbilder, gleiche Dauer; bitte die Animation in der Vorschau prüfen.`
      : ` (alle ${frames} Einzelbilder bleiben).`;
  return `Animiertes GIF für die Mail ${what}: ${parts.join(", ")}${kept}`;
}
