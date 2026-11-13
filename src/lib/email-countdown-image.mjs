// The LIVE countdown image: composed on the server at every e-mail open
// (api/email-countdown/<token>) from pre-rendered glyphs
// (generated/countdown-sprite.mjs) on SVG-drawn shapes — no fonts needed at
// runtime. Same visual language as the Performance design's white product
// cards: white background, dark heading, red numbers on light-grey tiles with
// a hairline edge, small grey unit labels — so the image sits inside the
// design's bordered card (and on the classic white card) without a seam.
//
// The image is an ANIMATED GIF that keeps counting after it was fetched: one
// frame per minute for the next hour (COUNTDOWN_FRAMES × COUNTDOWN_FRAME_MS),
// played once, the last frame held. E-mail cannot run scripts, and the big
// clients fetch an image ONCE per open (Apple Mail's privacy proxy even once
// per delivery) and then show that copy — a still image therefore looked
// frozen at the moment it was fetched. With the animation the minutes tick
// for an hour after every fetch, and a frame never promises more time than
// there is: it holds at the LAST minute of the hour, so a stale copy only ever
// understates the remaining time. After the deadline the frames show
// "Angebot abgelaufen" and the animation stops there.
//
// Layout maths is pure and tested; glyph decoding and the GIF encode need
// sharp. Frames are blended in plain JS on a raw RGB buffer (a few glyph blits
// per frame), so sixty frames cost tens of milliseconds — the GIF encode is
// the only real work (~0.7 s for a full hour, ~32 KB).
//
// Template colours (format 2 of the block templates, docs/EMAIL_TEMPLATES.md):
// the URL may carry `bg`, `tile`, `digit` and `label` (6 hex digits each,
// signed by `cs`, email-countdown-token.mjs) — the ground, the tiles (their
// hairline a shade of them), the digits and the words (heading, units,
// "expired"). The glyphs are tinted by their alpha; every colour left out
// keeps the light look, and without any the image is byte for byte the one
// above.
//
// The label (2026-11-13, „Text im Bild“ of a template's countdown): the line
// above the tiles may be the template's own text — `text` in the URL, the
// canonical upper-case spelling of countdown-label.mjs, set glyph by glyph
// from the sprite's label alphabet (advance widths from the sprite, centred,
// scaled down to fit the width) — or none at all (`notext=1`: the tiles move
// to the middle, the image keeps its size). Both ride with the colours under
// the same signature `cs` (countdownLookQuery); without them the image is the
// one above, byte for byte.

import { DIGIT_CELL, GLYPHS, LABEL_CAP_HEIGHT, LABEL_GLYPHS, LABEL_SPACING, SPRITE_SCALE } from "./generated/countdown-sprite.mjs";
import { countdownLabelText } from "./countdown-label.mjs";

/** Image width at 1× (the card's inner width in the 640px mail); height follows. */
export const COUNTDOWN_WIDTH = 564;
export const COUNTDOWN_HEIGHT = 116;
/** The phone variant: the card's inner width on a 390px screen. Same glyph
 * sizes, narrower canvas — scaling the desktop image down would shrink the
 * digits to 11px. */
export const COUNTDOWN_MOBILE_WIDTH = 350;

const S = SPRITE_SCALE;
const BG = "#ffffff";
const TILE = "#f5f5f5";
/** 1px (at 1×) hairline around each tile — the product cards' border colour. */
const TILE_EDGE = "#e5e5e5";

/** The colour parameters of the image URL, in the order countdownColorQuery writes them. */
export const COUNTDOWN_COLOR_PARAMS = Object.freeze(/** @type {const} */ (["bg", "tile", "digit", "label"]));

/**
 * @typedef {{ bg: string | null, tile: string | null, digit: string | null, label: string | null }} CountdownColors
 *   each "#rrggbb" or null (= the light look's colour)
 */

/** "#rrggbb" of a value that is exactly six hex digits (an optional "#" in front), else null. */
function hex6(v) {
  const m = /^#?([0-9a-f]{6})$/i.exec(typeof v === "string" ? v : "");
  return m ? `#${m[1].toLowerCase()}` : null;
}

/**
 * The colours of a request: `bg`, `tile`, `digit` and `label` from the query
 * (URLSearchParams or a plain object) — each exactly six hex digits, anything
 * else is null (= the light look's colour).
 * @param {URLSearchParams | Record<string, unknown> | null | undefined} params
 * @returns {CountdownColors}
 */
export function parseCountdownColors(params) {
  const get = (/** @type {string} */ k) =>
    params == null ? null : typeof (/** @type {any} */ (params).get) === "function" ? /** @type {URLSearchParams} */ (params).get(k) : /** @type {any} */ (params)[k];
  /** @type {any} */
  const out = {};
  for (const k of COUNTDOWN_COLOR_PARAMS) {
    const v = get(k);
    out[k] = typeof v === "string" && /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null;
  }
  return out;
}

/**
 * The query of a set of colours — "bg=111111&tile=262626&digit=f5c400&label=bdbdbd",
 * only the valid ones, always in this order (the canonical form the
 * signature covers); "" without any.
 * @param {Partial<Record<"bg" | "tile" | "digit" | "label", unknown>> | null | undefined} colors
 */
export function countdownColorQuery(colors) {
  if (!colors || typeof colors !== "object") return "";
  return COUNTDOWN_COLOR_PARAMS.map((k) => {
    const c = hex6(colors[k]);
    return c ? `${k}=${c.slice(1)}` : null;
  })
    .filter(Boolean)
    .join("&");
}

/**
 * The label of an image: `text` — the canonical label (countdownLabelText) or
 * null for the sprite's own words („DEIN ANGEBOT GILT NOCH“ / „YOUR OFFER ENDS
 * IN“); `hidden` — no label at all (the tiles stand in the middle).
 * @typedef {{ text: string | null, hidden: boolean }} CountdownLabel
 */

/** The label parameters of the image URL, in the order countdownLabelQuery writes them (`text` or `notext`). */
export const COUNTDOWN_LABEL_PARAMS = Object.freeze(/** @type {const} */ (["text", "notext"]));

/** A query value, strictly percent-encoded (also ! ' ( ) *, which encodeURIComponent leaves). @param {string} s */
const encodeValue = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The label of a request: `notext=1` hides it, `text` is read in its
 * canonical form (countdownLabelText — anything the alphabet cannot draw
 * dropped); without either, or with nothing drawable left, the sprite's words.
 * @param {URLSearchParams | Record<string, unknown> | null | undefined} params
 * @returns {CountdownLabel}
 */
export function parseCountdownLabel(params) {
  const get = (/** @type {string} */ k) =>
    params == null ? null : typeof (/** @type {any} */ (params).get) === "function" ? /** @type {URLSearchParams} */ (params).get(k) : /** @type {any} */ (params)[k];
  if (get("notext") === "1") return { text: null, hidden: true };
  const raw = get("text");
  const text = typeof raw === "string" ? countdownLabelText(raw) : "";
  return { text: text || null, hidden: false };
}

/**
 * The query of a label — "notext=1", "text=NUR%20NOCH%20KURZ" (canonical,
 * strictly encoded) or "" for the sprite's words.
 * @param {Partial<CountdownLabel> | null | undefined} label
 */
export function countdownLabelQuery(label) {
  if (!label || typeof label !== "object") return "";
  if (label.hidden === true) return "notext=1";
  const text = countdownLabelText(label.text);
  return text ? `text=${encodeValue(text)}` : "";
}

/**
 * The canonical query of an image's look — its colours (countdownColorQuery),
 * then its label (countdownLabelQuery): what the signature `cs` covers
 * (email-countdown-token.mjs). Without a label it is the colour query, so the
 * URLs and signatures of the colours alone stay as they were.
 * @param {Partial<Record<"bg" | "tile" | "digit" | "label", unknown>> | null | undefined} colors
 * @param {Partial<CountdownLabel> | null | undefined} [label]
 */
export function countdownLookQuery(colors, label) {
  return [countdownColorQuery(colors), countdownLabelQuery(label)].filter(Boolean).join("&");
}

/** [r, g, b] of "#rrggbb". */
const rgbOf = (/** @type {string} */ hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * The hairline around a tile of colour `tile`: a shade of it — darker on a
 * light tile (#f5f5f5 → #e5e5e5, the light look's edge), lighter on a dark one.
 * @param {string} tile  "#rrggbb"
 */
export function countdownEdgeColor(tile) {
  const rgb = rgbOf(hex6(tile) ?? TILE);
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const toward = lum > 0.45 ? 0 : 255;
  const t = toward === 0 ? 0.065 : 0.12;
  return `#${rgb.map((c) => Math.round(c + (toward - c) * t).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * What a render draws with: the light look (no colours — its glyphs keep the
 * colours they were drawn in), or the given colours over it.
 * @param {Partial<CountdownColors> | null | undefined} colors
 */
function paletteOf(colors) {
  const c = {
    bg: hex6(colors?.bg),
    tile: hex6(colors?.tile),
    digit: hex6(colors?.digit),
    label: hex6(colors?.label),
  };
  return {
    /** any colour of its own — the GIF is then encoded without dithering (flat grounds stay flat) */
    custom: Boolean(c.bg || c.tile || c.digit || c.label),
    bg: c.bg ?? BG,
    tile: c.tile ?? TILE,
    edge: c.tile ? countdownEdgeColor(c.tile) : TILE_EDGE,
    /** null: the glyph's own colour (the light look's red digits, dark heading, grey units) */
    digit: c.digit ? rgbOf(c.digit) : null,
    label: c.label ? rgbOf(c.label) : null,
  };
}

/**
 * Days / hours / minutes until the deadline, rounded down; `expired` once it
 * has passed.
 * @param {string | Date} expiresAt
 * @param {Date} [now]
 */
export function countdownRemaining(expiresAt, now = new Date()) {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return { expired: true, days: 0, hours: 0, minutes: 0 };
  const totalMinutes = Math.floor(ms / 60_000);
  return {
    expired: false,
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  };
}

/** A free label keeps at least this much room to the image's left and right edge (1×); a longer one is scaled down. */
export const COUNTDOWN_LABEL_MARGIN = 16;

/**
 * A free label set as one line from the sprite's label alphabet, in 2×
 * pixels: each glyph at its pen position (advance widths and the letter
 * spacing of the sprite, rounded to whole pixels) plus its own bearing, `y`
 * from the label's ink top; `top` = where that ink top lies from the cap top
 * (negative above: Ä Ö Ü), `scale` ≤ 1 = how far the line shrinks to fit the
 * image's width minus COUNTDOWN_LABEL_MARGIN on each side. Characters outside
 * the alphabet are skipped (countdownLabelText drops them before); null when
 * nothing is left to draw.
 * @param {string} text  the canonical label
 * @param {number} [width]  the image width at 1×
 * @returns {{ glyphs: Array<{ char: string, x: number, y: number }>, width: number, height: number, top: number, scale: number } | null}
 */
export function countdownLabelLayout(text, width = COUNTDOWN_WIDTH) {
  /** @type {Array<{ char: string, x: number, y: number }>} */
  const glyphs = [];
  let pen = 0;
  let started = false;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const ch of String(text ?? "")) {
    const g = /** @type {Record<string, any>} */ (LABEL_GLYPHS)[ch];
    if (!g) continue;
    if (started) pen += LABEL_SPACING;
    started = true;
    if (g.png) {
      const x = Math.round(pen) + g.x;
      glyphs.push({ char: ch, x, y: g.y });
      left = Math.min(left, x);
      right = Math.max(right, x + g.width);
      top = Math.min(top, g.y);
      bottom = Math.max(bottom, g.y + g.height);
    }
    pen += g.advance;
  }
  if (glyphs.length === 0) return null;
  for (const g of glyphs) {
    g.x -= left;
    g.y -= top;
  }
  const inkWidth = right - left;
  const room = width * S - 2 * COUNTDOWN_LABEL_MARGIN * S;
  return { glyphs, width: inkWidth, height: bottom - top, top, scale: inkWidth > room ? room / inkWidth : 1 };
}

/**
 * Where everything goes, in 2× pixels. Three tiles of equal width centred
 * under the heading; each tile shows two (or three, for ≥100 days) digits
 * and its unit label. `label`: the sprite's words (unset, or without a
 * text), a free text (`placed`: its line, centred, its cap height where the
 * words' is — the tiles stay where they are), or none (`hidden`: the tiles
 * in the middle of the image, which keeps its size).
 * @param {{ days: number, hours: number, minutes: number }} r
 * @param {"de" | "en"} language
 * @param {number} [width]
 * @param {Partial<CountdownLabel> | null} [label]
 */
export function countdownLayout(r, language, width = COUNTDOWN_WIDTH, label = null) {
  const W = width * S;
  const H = COUNTDOWN_HEIGHT * S;
  const lang = language === "en" ? "en" : "de";
  const heading = GLYPHS[`${lang}_heading`];
  const unitKeys = ["days", "hours", "minutes"].map((u) => `${lang}_${u}`);
  const units = unitKeys.map((k) => GLYPHS[k]);
  const values = [r.days, r.hours, r.minutes].map((v, i) => String(Math.max(0, v)).padStart(i === 0 && v >= 100 ? 3 : 2, "0"));
  const digitsW = Math.max(...values.map((v) => v.length)) * DIGIT_CELL.width;
  const tileW = Math.max(digitsW, ...units.map((u) => u.width)) + 44 * S;
  const tileH = 12 * S + DIGIT_CELL.height + 6 * S + units[0].height + 12 * S;
  const gap = 12 * S;
  const totalW = tileW * 3 + gap * 2;
  const headingY = 20 * S;
  const hidden = label?.hidden === true;
  const tilesY = hidden ? Math.round((H - tileH) / 2) : headingY + heading.height + 14 * S;
  const free = hidden ? null : countdownLabelLayout(countdownLabelText(label?.text), width);
  /** @type {{ x: number, y: number, width: number, height: number } | null} */
  let placed = null;
  if (free) {
    // drawn size, centred; the cap height of the line centred where the words' cap height is
    const w = Math.max(1, Math.round(free.width * free.scale));
    const h = Math.max(1, Math.round(free.height * free.scale));
    const capTop = headingY + (LABEL_CAP_HEIGHT * (1 - free.scale)) / 2;
    placed = { x: Math.round((W - w) / 2), y: Math.round(capTop + free.top * free.scale), width: w, height: h };
  }
  const left = Math.round((W - totalW) / 2);
  const tiles = values.map((value, i) => {
    const x = left + i * (tileW + gap);
    const dw = value.length * DIGIT_CELL.width;
    return {
      x,
      y: tilesY,
      width: tileW,
      height: tileH,
      value,
      digitsX: Math.round(x + (tileW - dw) / 2),
      digitsY: tilesY + 12 * S,
      unit: units[i],
      unitKey: unitKeys[i],
      unitX: Math.round(x + (tileW - units[i].width) / 2),
      unitY: tilesY + 12 * S + DIGIT_CELL.height + 6 * S,
    };
  });
  return {
    width: W,
    height: H,
    /** the sprite's words — null when a free label (`label`) or none is drawn */
    heading: hidden || free ? null : heading,
    headingX: Math.round((W - heading.width) / 2),
    headingY,
    /** a free label: its glyphs at full size (lineWidth × lineHeight, countdownLabelLayout), scaled by `scale` to width × height at (x, y) */
    label:
      free && placed
        ? { glyphs: free.glyphs, scale: free.scale, lineWidth: free.width, lineHeight: free.height, x: placed.x, y: placed.y, width: placed.width, height: placed.height }
        : null,
    tiles,
  };
}

/** Frames in the animation (one per minute) and the delay between them. */
export const COUNTDOWN_FRAMES = 60;
export const COUNTDOWN_FRAME_MS = 60_000;

/**
 * One image per minute, shared by every fetch in that minute. A Rundmail
 * sends the SAME countdown URL to every recipient, and Apple Mail's privacy
 * proxy fetches it for every delivered mail — rendering each fetch anew
 * (~0.7 s of CPU) would make the countdown the hot spot of a big send. So
 * time is cut into fixed windows; every fetch in a window gets the image drawn
 * for the window's END (a copy served at any moment of the window therefore
 * only ever understates the time left, by less than a minute), and the server
 * instance and Vercel's CDN keep it until the window ends — never longer.
 */
export const COUNTDOWN_CACHE_WINDOW_MS = 60_000;

/**
 * The cache window a fetch at `nowMs` belongs to.
 * @param {number} nowMs
 * @param {number} [windowMs]
 * @returns {{ index: number, endsAt: number }} `endsAt` — also the moment the
 *   window's image is drawn for
 */
export function countdownCacheWindow(nowMs, windowMs = COUNTDOWN_CACHE_WINDOW_MS) {
  const size = Math.max(1, Math.floor(windowMs) || COUNTDOWN_CACHE_WINDOW_MS);
  const index = Math.floor(nowMs / size);
  return { index, endsAt: (index + 1) * size };
}

/**
 * Whole seconds a shared cache may still keep an image of a window that ends
 * at `endsAtMs`, asked at `nowMs` — rounded DOWN, so a cached copy is never
 * served past the window; 0 means: do not cache.
 * @param {number} endsAtMs
 * @param {number} nowMs
 */
export function countdownCacheSeconds(endsAtMs, nowMs) {
  const s = Math.floor((endsAtMs - nowMs) / 1000);
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/**
 * The moments the frames show: `now`, then one per minute, at most `frames`
 * of them. Stops right after the first frame past the deadline, so an offer
 * that ends within the hour counts down to "expired" and holds there.
 * @param {string | Date} expiresAt
 * @param {Date} now
 * @param {number} [frames]
 * @returns {Date[]}
 */
export function countdownFrameTimes(expiresAt, now, frames = COUNTDOWN_FRAMES) {
  const end = new Date(expiresAt).getTime();
  const count = Math.max(1, Math.min(COUNTDOWN_FRAMES, Math.floor(frames) || 1));
  const times = [];
  for (let i = 0; i < count; i++) {
    const t = new Date(now.getTime() + i * COUNTDOWN_FRAME_MS);
    times.push(t);
    if (!Number.isFinite(end) || t.getTime() >= end) break;
  }
  return times;
}

const rect = (x, y, w, h, fill, r, stroke = null) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${S}"` : ""}/>`;

/** Decoded glyphs (RGBA raw + size), decoded once per process. */
const glyphCache = new Map();

async function decodedGlyph(sharp, key) {
  let g = glyphCache.get(key);
  if (!g) {
    const { data, info } = await sharp(Buffer.from(GLYPHS[key].png, "base64"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    g = { data, width: info.width, height: info.height };
    glyphCache.set(key, g);
  }
  return g;
}

/**
 * Alpha-blend one glyph onto the RGB frame at (left, top): in its own colour,
 * or with `tint` ([r, g, b]) in that colour — only the glyph's alpha counts
 * (the sprite draws every glyph in one flat colour, so its antialiasing is
 * all in the alpha).
 * @param {number[] | null} [tint]
 */
function paint(frame, frameWidth, frameHeight, g, left, top, tint = null) {
  if (!tint) {
    blit(frame, frameWidth, frameHeight, g, left, top);
    return;
  }
  const [tr, tg, tb] = tint;
  for (let y = 0; y < g.height; y++) {
    const dy = top + y;
    if (dy < 0 || dy >= frameHeight) continue;
    for (let x = 0; x < g.width; x++) {
      const dx = left + x;
      if (dx < 0 || dx >= frameWidth) continue;
      const a = g.data[(y * g.width + x) * 4 + 3];
      if (a === 0) continue;
      const di = (dy * frameWidth + dx) * 3;
      if (a === 255) {
        frame[di] = tr;
        frame[di + 1] = tg;
        frame[di + 2] = tb;
      } else {
        const ia = 255 - a;
        frame[di] = ((tr * a + frame[di] * ia + 127) / 255) | 0;
        frame[di + 1] = ((tg * a + frame[di + 1] * ia + 127) / 255) | 0;
        frame[di + 2] = ((tb * a + frame[di + 2] * ia + 127) / 255) | 0;
      }
    }
  }
}

/** Decoded glyphs of the label alphabet, decoded once per process. */
const labelGlyphCache = new Map();

async function decodedLabelGlyph(sharp, ch) {
  let g = labelGlyphCache.get(ch);
  if (!g) {
    const { data, info } = await sharp(Buffer.from(/** @type {Record<string, any>} */ (LABEL_GLYPHS)[ch].png, "base64"))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    g = { data, width: info.width, height: info.height };
    labelGlyphCache.set(ch, g);
  }
  return g;
}

/** Composed label lines per text and width (bounded — a label is the same in every frame and every minute). */
const LABEL_BITMAPS_MAX = 50;
const labelBitmaps = new Map();

/**
 * The free label of a layout as ONE glyph-like RGBA bitmap (countdownLayout's
 * `label`): its glyphs set on a transparent line in the sprite's ink, then —
 * when the line is too wide — scaled down to its drawn size. Painted like any
 * glyph (tinted by its alpha in a template's label colour).
 * @param {any} sharp
 * @param {string} key  text and width — the cache key
 * @param {NonNullable<ReturnType<typeof countdownLayout>["label"]>} label
 */
async function labelBitmap(sharp, key, label) {
  let b = labelBitmaps.get(key);
  if (b) return b;
  const w = label.lineWidth;
  const h = label.lineHeight;
  const data = Buffer.alloc(w * h * 4);
  for (const pos of label.glyphs) {
    const g = await decodedLabelGlyph(sharp, pos.char);
    for (let y = 0; y < g.height; y++) {
      const dy = pos.y + y;
      if (dy < 0 || dy >= h) continue;
      for (let x = 0; x < g.width; x++) {
        const dx = pos.x + x;
        if (dx < 0 || dx >= w) continue;
        const si = (y * g.width + x) * 4;
        const di = (dy * w + dx) * 4;
        // neighbouring glyphs never overlap much (letter spacing): the stronger ink wins
        if (g.data[si + 3] > data[di + 3]) g.data.copy(data, di, si, si + 4);
      }
    }
  }
  b = { data, width: w, height: h };
  if (label.width !== w || label.height !== h) {
    const r = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .resize(label.width, label.height, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    b = { data: r.data, width: r.info.width, height: r.info.height };
  }
  labelBitmaps.set(key, b);
  if (labelBitmaps.size > LABEL_BITMAPS_MAX) labelBitmaps.delete(labelBitmaps.keys().next().value);
  return b;
}

/** Alpha-blend one RGBA glyph onto the RGB frame at (left, top). */
function blit(frame, frameWidth, frameHeight, g, left, top) {
  for (let y = 0; y < g.height; y++) {
    const dy = top + y;
    if (dy < 0 || dy >= frameHeight) continue;
    for (let x = 0; x < g.width; x++) {
      const dx = left + x;
      if (dx < 0 || dx >= frameWidth) continue;
      const si = (y * g.width + x) * 4;
      const a = g.data[si + 3];
      if (a === 0) continue;
      const di = (dy * frameWidth + dx) * 3;
      if (a === 255) {
        frame[di] = g.data[si];
        frame[di + 1] = g.data[si + 1];
        frame[di + 2] = g.data[si + 2];
      } else {
        const ia = 255 - a;
        frame[di] = ((g.data[si] * a + frame[di] * ia + 127) / 255) | 0;
        frame[di + 1] = ((g.data[si + 1] * a + frame[di + 1] * ia + 127) / 255) | 0;
        frame[di + 2] = ((g.data[si + 2] * a + frame[di + 2] * ia + 127) / 255) | 0;
      }
    }
  }
}

/**
 * The static part of a frame — the ground plus the tiles' shapes, in the
 * palette's colours (the light look: white card, light-grey tiles) —
 * rasterised from SVG. Keyed by the tile geometry (it only changes when the
 * digit count changes, e.g. from 100 to 99 days), so an hour of frames
 * usually shares one raster.
 * @param {{ bg: string, tile: string, edge: string }} palette
 */
async function baseRaster(sharp, W, H, tiles, cache, palette) {
  const key = tiles.map((t) => `${t.x},${t.y},${t.width},${t.height}`).join("|");
  let base = cache.get(key);
  if (!base) {
    let shapes = rect(0, 0, W, H, palette.bg, 14);
    for (const t of tiles) {
      // Stroke inset by half its width so the hairline stays inside the tile.
      shapes += rect(t.x + S / 2, t.y + S / 2, t.width - S, t.height - S, palette.tile, 12, palette.edge);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${shapes}</svg>`;
    base = await sharp(Buffer.from(svg)).flatten({ background: palette.bg }).raw().toBuffer();
    cache.set(key, base);
  }
  return base;
}

/**
 * Render the animated countdown GIF (2×) for a deadline: one frame per
 * minute from `now` on (see the header), `frames` at most. `colors` (the
 * URL's, already checked) draws it in a template's colours; without them —
 * or with none valid — it is the light look, byte for byte. `label` (the
 * URL's, already checked): a free text over the tiles or none; without one
 * the sprite's words, byte for byte.
 * @param {{ expiresAt: string | Date, language?: "de" | "en", now?: Date, width?: number, frames?: number,
 *   colors?: Partial<CountdownColors> | null, label?: Partial<CountdownLabel> | null }} input
 * @returns {Promise<Buffer>}
 */
export async function renderCountdownImage(input) {
  const { default: sharp } = await import("sharp");
  const lang = input.language === "en" ? "en" : "de";
  const now = input.now ?? new Date();
  const width = input.width === COUNTDOWN_MOBILE_WIDTH ? COUNTDOWN_MOBILE_WIDTH : COUNTDOWN_WIDTH;
  const W = width * S;
  const H = COUNTDOWN_HEIGHT * S;
  const palette = paletteOf(input.colors);
  // the canonical label (what the URL carries), or none: the sprite's words
  const label = input.label?.hidden === true ? { text: null, hidden: true } : { text: countdownLabelText(input.label?.text) || null, hidden: false };
  const times = countdownFrameTimes(input.expiresAt, now, input.frames ?? COUNTDOWN_FRAMES);
  const bases = new Map();
  const frames = [];
  for (const at of times) {
    const r = countdownRemaining(input.expiresAt, at);
    if (r.expired) {
      const frame = Buffer.from(await baseRaster(sharp, W, H, [], bases, palette));
      const g = await decodedGlyph(sharp, `${lang}_expired`);
      paint(frame, W, H, g, Math.round((W - g.width) / 2), Math.round((H - g.height) / 2), palette.label);
      frames.push(frame);
      continue;
    }
    const L = countdownLayout(r, lang, width, label);
    const frame = Buffer.from(await baseRaster(sharp, W, H, L.tiles, bases, palette));
    if (L.heading) paint(frame, W, H, await decodedGlyph(sharp, `${lang}_heading`), L.headingX, L.headingY, palette.label);
    if (L.label) paint(frame, W, H, await labelBitmap(sharp, `${width}|${label.text}`, L.label), L.label.x, L.label.y, palette.label);
    for (const t of L.tiles) {
      for (let i = 0; i < t.value.length; i++) {
        const g = await decodedGlyph(sharp, `d${t.value[i]}`);
        paint(
          frame, W, H, g,
          t.digitsX + i * DIGIT_CELL.width + Math.round((DIGIT_CELL.width - g.width) / 2),
          t.digitsY + (DIGIT_CELL.height - g.height),
          palette.digit
        );
      }
      paint(frame, W, H, await decodedGlyph(sharp, t.unitKey), t.unitX, t.unitY, palette.label);
    }
    frames.push(frame);
  }
  // A vertical strip of frames → animated GIF: 64 colours are plenty for the
  // flat card, `loop: 1` plays the hour once and holds the last frame. In a
  // template's colours without dithering: the palette rarely holds a ground
  // like #ffd400 exactly, and dithering would sprinkle it — a visible texture
  // against the mail's flat row of that colour (and a GIF twice the size).
  return sharp(Buffer.concat(frames), { raw: { width: W, height: H * frames.length, channels: 3, pageHeight: H } })
    .gif({ delay: frames.map(() => COUNTDOWN_FRAME_MS), loop: 1, colours: 64, effort: 1, ...(palette.custom ? { dither: 0 } : {}) })
    .toBuffer();
}
