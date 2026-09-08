// The LIVE countdown image: composed on the server at every e-mail open
// (api/email-countdown/<token>) from pre-rendered glyphs
// (generated/countdown-sprite.mjs) on SVG-drawn shapes — no fonts needed at
// runtime. Same visual language as the Performance design's black cards:
// dark background, red numbers in dark tiles, small grey unit labels.
//
// Layout maths is pure and tested; the compositing needs sharp.

import { DIGIT_CELL, GLYPHS, SPRITE_SCALE } from "./generated/countdown-sprite.mjs";

/** Image width at 1× (the card's inner width in the 640px mail); height follows. */
export const COUNTDOWN_WIDTH = 564;
export const COUNTDOWN_HEIGHT = 132;
/** The phone variant: the card's inner width on a 390px screen. Same glyph
 * sizes, narrower canvas — scaling the desktop image down would shrink the
 * digits to 11px. */
export const COUNTDOWN_MOBILE_WIDTH = 350;

const S = SPRITE_SCALE;
const BG = "#111111";
const TILE = "#1f1f1f";

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
  const units = ["days", "hours", "minutes"].map((u) => GLYPHS[`${lang}_${u}`]);
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
      unitX: Math.round(x + (tileW - units[i].width) / 2),
      unitY: tilesY + 12 * S + DIGIT_CELL.height + 6 * S,
    };
  });
  return { width: W, height: H, heading, headingX: Math.round((W - heading.width) / 2), headingY, tiles };
}

const rect = (x, y, w, h, fill, r) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"/>`;

/**
 * Render the image for a deadline as a PNG buffer (2×).
 * @param {{ expiresAt: string | Date, language?: "de" | "en", now?: Date, width?: number }} input
 * @returns {Promise<Buffer>}
 */
export async function renderCountdownImage(input) {
  const { default: sharp } = await import("sharp");
  const lang = input.language === "en" ? "en" : "de";
  const r = countdownRemaining(input.expiresAt, input.now);
  const width = input.width === COUNTDOWN_MOBILE_WIDTH ? COUNTDOWN_MOBILE_WIDTH : COUNTDOWN_WIDTH;
  const W = width * S;
  const H = COUNTDOWN_HEIGHT * S;
  const composites = [];
  let shapes = rect(0, 0, W, H, BG, 14);
  if (r.expired) {
    const g = GLYPHS[`${lang}_expired`];
    composites.push({ input: Buffer.from(g.png, "base64"), left: Math.round((W - g.width) / 2), top: Math.round((H - g.height) / 2) });
  } else {
    const L = countdownLayout(r, lang, width);
    composites.push({ input: Buffer.from(L.heading.png, "base64"), left: L.headingX, top: L.headingY });
    for (const t of L.tiles) {
      shapes += rect(t.x, t.y, t.width, t.height, TILE, 12);
      [...t.value].forEach((ch, i) => {
        const g = GLYPHS[`d${ch}`];
        composites.push({
          input: Buffer.from(g.png, "base64"),
          left: t.digitsX + i * DIGIT_CELL.width + Math.round((DIGIT_CELL.width - g.width) / 2),
          top: t.digitsY + (DIGIT_CELL.height - g.height),
        });
      });
      composites.push({ input: Buffer.from(t.unit.png, "base64"), left: t.unitX, top: t.unitY });
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${shapes}</svg>`;
  return sharp(Buffer.from(svg)).composite(composites).png({ compressionLevel: 9, palette: true }).toBuffer();
}
