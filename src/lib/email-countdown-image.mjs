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

import { DIGIT_CELL, GLYPHS, SPRITE_SCALE } from "./generated/countdown-sprite.mjs";

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

/**
 * Where everything goes, in 2× pixels. Three tiles of equal width centred
 * under the heading; each tile shows two (or three, for ≥100 days) digits
 * and its unit label.
 * @param {{ days: number, hours: number, minutes: number }} r
 * @param {"de" | "en"} language
 */
export function countdownLayout(r, language, width = COUNTDOWN_WIDTH) {
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
  const tilesY = headingY + heading.height + 14 * S;
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
  return { width: W, height: H, heading, headingX: Math.round((W - heading.width) / 2), headingY, tiles };
}

/** Frames in the animation (one per minute) and the delay between them. */
export const COUNTDOWN_FRAMES = 60;
export const COUNTDOWN_FRAME_MS = 60_000;

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
 * The static part of a frame — white card plus the tiles' grey shapes —
 * rasterised from SVG. Keyed by the tile geometry (it only changes when the
 * digit count changes, e.g. from 100 to 99 days), so an hour of frames
 * usually shares one raster.
 */
async function baseRaster(sharp, W, H, tiles, cache) {
  const key = tiles.map((t) => `${t.x},${t.y},${t.width},${t.height}`).join("|");
  let base = cache.get(key);
  if (!base) {
    let shapes = rect(0, 0, W, H, BG, 14);
    for (const t of tiles) {
      // Stroke inset by half its width so the hairline stays inside the tile.
      shapes += rect(t.x + S / 2, t.y + S / 2, t.width - S, t.height - S, TILE, 12, TILE_EDGE);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${shapes}</svg>`;
    base = await sharp(Buffer.from(svg)).flatten({ background: BG }).raw().toBuffer();
    cache.set(key, base);
  }
  return base;
}

/**
 * Render the animated countdown GIF (2×) for a deadline: one frame per
 * minute from `now` on (see the header), `frames` at most.
 * @param {{ expiresAt: string | Date, language?: "de" | "en", now?: Date, width?: number, frames?: number }} input
 * @returns {Promise<Buffer>}
 */
export async function renderCountdownImage(input) {
  const { default: sharp } = await import("sharp");
  const lang = input.language === "en" ? "en" : "de";
  const now = input.now ?? new Date();
  const width = input.width === COUNTDOWN_MOBILE_WIDTH ? COUNTDOWN_MOBILE_WIDTH : COUNTDOWN_WIDTH;
  const W = width * S;
  const H = COUNTDOWN_HEIGHT * S;
  const times = countdownFrameTimes(input.expiresAt, now, input.frames ?? COUNTDOWN_FRAMES);
  const bases = new Map();
  const frames = [];
  for (const at of times) {
    const r = countdownRemaining(input.expiresAt, at);
    if (r.expired) {
      const frame = Buffer.from(await baseRaster(sharp, W, H, [], bases));
      const g = await decodedGlyph(sharp, `${lang}_expired`);
      blit(frame, W, H, g, Math.round((W - g.width) / 2), Math.round((H - g.height) / 2));
      frames.push(frame);
      continue;
    }
    const L = countdownLayout(r, lang, width);
    const frame = Buffer.from(await baseRaster(sharp, W, H, L.tiles, bases));
    blit(frame, W, H, await decodedGlyph(sharp, `${lang}_heading`), L.headingX, L.headingY);
    for (const t of L.tiles) {
      for (let i = 0; i < t.value.length; i++) {
        const g = await decodedGlyph(sharp, `d${t.value[i]}`);
        blit(
          frame, W, H, g,
          t.digitsX + i * DIGIT_CELL.width + Math.round((DIGIT_CELL.width - g.width) / 2),
          t.digitsY + (DIGIT_CELL.height - g.height)
        );
      }
      blit(frame, W, H, await decodedGlyph(sharp, t.unitKey), t.unitX, t.unitY);
    }
    frames.push(frame);
  }
  // A vertical strip of frames → animated GIF: 64 colours are plenty for the
  // flat card, `loop: 1` plays the hour once and holds the last frame.
  return sharp(Buffer.concat(frames), { raw: { width: W, height: H * frames.length, channels: 3, pageHeight: H } })
    .gif({ delay: frames.map(() => COUNTDOWN_FRAME_MS), loop: 1, colours: 64, effort: 1 })
    .toBuffer();
}
