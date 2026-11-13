// Pre-render the glyphs the live countdown image is built from — digits,
// unit labels, headings and the label alphabet — into
// src/lib/generated/countdown-sprite.mjs.
//
// Why pre-rendered: the countdown image is composed on Vercel at every
// e-mail open (api/email-countdown), and serverless functions have no system
// fonts, so text cannot be rasterised there. Rendering the fixed vocabulary
// ONCE here (Liberation Sans Bold — metric-compatible with the Arial the
// mail uses) and shipping the PNGs as base64 makes the runtime font-free:
// it only composites bitmaps onto SVG shapes.
//
// The label alphabet (2026-11-13, the free „Text im Bild“ of a template's
// countdown — countdown-label.mjs): every character a label may use, one
// glyph each in the heading's type (11 px bold, 1 px letter spacing), with
// what the runtime needs to set them as a line (email-countdown-image.mjs
// countdownLabelLayout): where its ink starts from the pen (x) and from the
// cap top (y), and its advance to the next character — fractional, measured
// over 20 copies between two H, because the text engine places glyphs at
// sub-pixel positions. The fixed glyphs above stay byte for byte as before
// (the light look's image must not change).
//
//   node scripts/build-countdown-sprite.mjs
//
// Re-run after changing colours, sizes or wording below, then commit the
// generated module.

import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { COUNTDOWN_LABEL_CHARS } from "../src/lib/countdown-label.mjs";

const SCALE = 2; // the image is delivered at 2× for retina mail clients
const FONT = "Liberation Sans, Arial, Helvetica, sans-serif";
// The Performance design's light card palette (email-designs/performance.ts):
// red numbers, near-black heading, the muted grey of the small print.
const RED = "#e30613";
const INK = "#111111";
const GREY = "#555555";

/** [key, text, px (1×), weight, colour, letterSpacing (1×)] */
const GLYPHS = [
  ...Array.from({ length: 10 }, (_, d) => [`d${d}`, String(d), 34, 800, RED, -1]),
  ["de_heading", "DEIN ANGEBOT GILT NOCH", 11, 700, INK, 1],
  ["en_heading", "YOUR OFFER ENDS IN", 11, 700, INK, 1],
  ["de_days", "TAGE", 10, 400, GREY, 1],
  ["de_hours", "STUNDEN", 10, 400, GREY, 1],
  ["de_minutes", "MINUTEN", 10, 400, GREY, 1],
  ["en_days", "DAYS", 10, 400, GREY, 1],
  ["en_hours", "HOURS", 10, 400, GREY, 1],
  ["en_minutes", "MINUTES", 10, 400, GREY, 1],
  ["de_expired", "ANGEBOT ABGELAUFEN", 16, 700, INK, 1],
  ["en_expired", "OFFER EXPIRED", 16, 700, INK, 1],
];

/** The label alphabet's type — the heading's (de_heading above). */
const LABEL = { px: 11, weight: 700, colour: INK, spacing: 1 };

const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function renderGlyph(text, px, weight, colour, spacing) {
  const size = px * SCALE;
  // Generous canvas, then trim to the ink; height is the font's line box so
  // digits of different widths share a baseline when laid out side by side.
  const w = Math.ceil(text.length * size * 0.9 + 40);
  const h = Math.ceil(size * 1.4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="20" y="${Math.round(size * 1.05)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${colour}" letter-spacing="${spacing * SCALE}">${escapeXml(text)}</text></svg>`;
  const buf = await sharp(Buffer.from(svg)).png().trim().toBuffer();
  const meta = await sharp(buf).metadata();
  return { png: buf.toString("base64"), width: meta.width, height: meta.height };
}

// ── the label alphabet ───────────────────────────────────────────────────────

/** Where the pen starts on the measuring canvas (2× px). */
const PEN_X = 20;

/**
 * `text` in the label's type, drawn from (PEN_X, baseline) on a canvas that
 * is not trimmed — so positions can be compared between renders. Spaces kept.
 */
async function labelSvg(text) {
  const size = LABEL.px * SCALE;
  const w = Math.ceil([...text].length * size * 0.9 + 4 * PEN_X);
  const h = Math.ceil(size * 1.6);
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="${PEN_X}" y="${Math.round(size * 1.05)}" font-family="${FONT}" font-size="${size}" font-weight="${LABEL.weight}" fill="${LABEL.colour}" xml:space="preserve">${escapeXml(text)}</text></svg>`,
    width: w,
    height: h,
  };
}

/** The ink box (alpha > 0) of `text` in the label's type, or null for no ink (a space). */
async function labelInk(text) {
  const { svg } = await labelSvg(text);
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = Infinity;
  let right = -1;
  let top = Infinity;
  let bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, right, top, bottom, svg };
}

const reference = await labelInk("HH");
const cap = await labelInk("H");
const COPIES = 20;
/** The advance of `ch` (2× px): how far the last H moves when COPIES of it stand between two H, per copy. */
async function labelAdvance(ch) {
  const sandwich = await labelInk(`H${ch.repeat(COPIES)}H`);
  return Math.round(((sandwich.right - reference.right) / COPIES) * 100) / 100;
}

const label = {};
for (const ch of COUNTDOWN_LABEL_CHARS) {
  const advance = await labelAdvance(ch);
  const ink = await labelInk(ch);
  if (!ink) {
    label[ch] = { advance };
    continue;
  }
  const width = ink.right - ink.left + 1;
  const height = ink.bottom - ink.top + 1;
  const buf = await sharp(Buffer.from(ink.svg)).extract({ left: ink.left, top: ink.top, width, height }).png().toBuffer();
  label[ch] = { png: buf.toString("base64"), x: ink.left - PEN_X, y: ink.top - cap.top, width, height, advance };
}

const out = {};
for (const [key, text, px, weight, colour, spacing] of GLYPHS) {
  out[key] = await renderGlyph(text, px, weight, colour, spacing);
}
// Digits share one cell size so "03" and "11" align and the tiles keep a
// fixed width — the widest digit decides.
const digitW = Math.max(...Array.from({ length: 10 }, (_, d) => out[`d${d}`].width));
const digitH = Math.max(...Array.from({ length: 10 }, (_, d) => out[`d${d}`].height));

const file =
  `// GENERATED by scripts/build-countdown-sprite.mjs — do not edit by hand.\n` +
  `// Pre-rendered glyphs (PNG, base64, ${SCALE}×) for the live countdown image.\n` +
  `export const SPRITE_SCALE = ${SCALE};\n` +
  `export const DIGIT_CELL = { width: ${digitW}, height: ${digitH} };\n` +
  `export const GLYPHS = ${JSON.stringify(out)};\n` +
  `// The label alphabet (countdown-label.mjs): ink from the pen (x) and the cap top (y), advance per character.\n` +
  `export const LABEL_SPACING = ${LABEL.spacing * SCALE};\n` +
  `export const LABEL_CAP_HEIGHT = ${cap.bottom - cap.top + 1};\n` +
  `export const LABEL_GLYPHS = ${JSON.stringify(label)};\n`;
writeFileSync("src/lib/generated/countdown-sprite.mjs", file);
console.log(
  `sprite: ${Object.keys(out).length} glyphs + ${Object.keys(label).length} label characters, digit cell ${digitW}×${digitH}, ${(file.length / 1024).toFixed(0)} KB`
);
