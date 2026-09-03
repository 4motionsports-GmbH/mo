// Deterministic legibility for the Performance hero: after gpt-image-1 has
// rendered the scene, a pale gradient is composited over the LEFT part of the
// picture — the part the design prints the headline, subline and button on —
// before the PNG is stored.
//
// Why this exists: the prompt (HERO_PROMPT_STYLE_TAIL) asks the image model
// to keep the left 55 % empty and bright, and it makes that LIKELIER — but
// image models do not reliably honour area instructions. Legibility of the
// headline must not depend on the model's mood, so the overlay guarantees it
// regardless of what the model delivers. The prompt rule stays: an overlay
// can wash equipment out, it cannot move it, and a ghosted rack under the
// headline still looks worse than an empty wall.
//
// The overlay is built as an SVG gradient (resolution-independent, exactly
// reproducible) and composited with sharp. Everything but the compositing is
// pure and unit-tested, including the alpha curve at the text column's edge.

/** Width of the hero's text column (performance.ts, `hero-text width="55%"`). */
export const HERO_TEXT_COLUMN_FRACTION = 0.55;

/**
 * How far the TEXT actually reaches, measured on the rendered desktop hero
 * with a long two-line headline ("Dein Rack. Komplett." at 40px): headline
 * glyphs end at ~50% of the width, the subline at ~47%, the button at ~35%.
 * The column is wider than its content, so the fade is anchored to the
 * glyphs, not to the column — every percent of protection beyond the text
 * is picture the scene cannot use.
 */
export const HERO_TEXT_REACH_FRACTION = 0.5;

/** The overlay colour — the "warm white" of the design's pale walls, so the
 * faded region reads as part of the room rather than as a white box. */
export const HERO_GRADIENT_COLOR = "#f6f6f6";

/** Opacity over the fully protected zone (0 → GRADIENT_FADE_START). Not 1:
 * a hint of the scene keeps showing through, so the region looks like an
 * over-exposed wall instead of a flat cut-out. */
export const HERO_GRADIENT_MAX_ALPHA = 0.93;

/** Where the fade starts and where it has fully vanished (fractions of the
 * width). The fade brackets the text's reach (0.5): the subline (to ~47%)
 * still sits on ≥60% overlay, the headline's last glyphs (~50%) on ≥45% —
 * bold 40px type over that stays far above the contrast threshold even on
 * a black object — while past the column edge (55%) the scene is nearly
 * untouched. The prompt asks for a calm left 45%, so the model's own scene
 * normally starts where the fade is already well underway. */
export const HERO_GRADIENT_FADE_START = 0.36;
export const HERO_GRADIENT_FADE_END = 0.64;

/** Number of gradient stops used to approximate the smooth fade. */
const FADE_STOPS = 14;

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smoothstep = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/**
 * Overlay opacity at horizontal position `x` (0 = left edge, 1 = right edge).
 * Flat at HERO_GRADIENT_MAX_ALPHA up to the fade start, then a smoothstep
 * down to 0 at the fade end.
 * @param {number} x
 * @returns {number}
 */
export function heroGradientAlphaAt(x) {
  const t = (clamp01(x) - HERO_GRADIENT_FADE_START) /
    (HERO_GRADIENT_FADE_END - HERO_GRADIENT_FADE_START);
  return HERO_GRADIENT_MAX_ALPHA * (1 - smoothstep(t));
}

/**
 * The gradient stops as `{ offset, alpha }` pairs (offset 0..1, ascending).
 * @returns {{ offset: number, alpha: number }[]}
 */
export function heroGradientStops() {
  const stops = [{ offset: 0, alpha: HERO_GRADIENT_MAX_ALPHA }];
  for (let i = 0; i <= FADE_STOPS; i++) {
    const offset =
      HERO_GRADIENT_FADE_START +
      ((HERO_GRADIENT_FADE_END - HERO_GRADIENT_FADE_START) * i) / FADE_STOPS;
    stops.push({ offset, alpha: heroGradientAlphaAt(offset) });
  }
  stops.push({ offset: 1, alpha: 0 });
  return stops;
}

const pct = (n) => `${(n * 100).toFixed(2)}%`;

/**
 * The overlay as an SVG document of exactly the picture's size: a rectangle
 * filled with the horizontal gradient. sharp rasterises it at 1:1, so the
 * fade lands on the same fractions of the width whatever the resolution.
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function heroGradientOverlaySvg(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const stops = heroGradientStops()
    .map(
      (s) =>
        `<stop offset="${pct(s.offset)}" stop-color="${HERO_GRADIENT_COLOR}" ` +
        `stop-opacity="${s.alpha.toFixed(4)}"/>`
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs>` +
    `<rect x="0" y="0" width="${w}" height="${h}" fill="url(#g)"/></svg>`
  );
}

/**
 * Composite the legibility gradient over a rendered hero (PNG/JPEG/WebP
 * bytes in, PNG bytes out, same dimensions). sharp is loaded lazily so the
 * pure helpers above stay importable without the native module.
 * @param {Buffer | Uint8Array} image
 * @returns {Promise<Buffer>}
 */
export async function applyHeroGradient(image) {
  const { default: sharp } = await import("sharp");
  const base = sharp(image);
  const { width, height } = await base.metadata();
  if (!width || !height) throw new Error("hero image has no dimensions");
  return base
    .composite([{ input: Buffer.from(heroGradientOverlaySvg(width, height)), blend: "over" }])
    .png()
    .toBuffer();
}
