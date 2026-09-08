import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNTDOWN_HEIGHT,
  COUNTDOWN_MOBILE_WIDTH,
  COUNTDOWN_WIDTH,
  countdownLayout,
  countdownRemaining,
  renderCountdownImage,
} from "./email-countdown-image.mjs";
import { GLYPHS, SPRITE_SCALE } from "./generated/countdown-sprite.mjs";

const now = new Date("2026-09-08T10:00:00Z");

test("the sprite carries every glyph the image needs", () => {
  for (const k of ["d0", "d9", "de_heading", "en_heading", "de_days", "de_hours", "de_minutes", "en_days", "en_hours", "en_minutes", "de_expired", "en_expired"]) {
    assert.ok(GLYPHS[k]?.png && GLYPHS[k].width > 0 && GLYPHS[k].height > 0, k);
  }
  assert.equal(SPRITE_SCALE, 2);
});

test("countdownRemaining splits into days/hours/minutes and flags expiry", () => {
  assert.deepEqual(countdownRemaining("2026-09-11T23:59:00Z", now), { expired: false, days: 3, hours: 13, minutes: 59 });
  assert.deepEqual(countdownRemaining("2026-09-08T10:00:30Z", now), { expired: false, days: 0, hours: 0, minutes: 0 });
  assert.equal(countdownRemaining("2026-09-08T09:59:59Z", now).expired, true);
});

test("layout centres three equal tiles inside the image", () => {
  const L = countdownLayout({ days: 3, hours: 13, minutes: 59 }, "de");
  assert.equal(L.tiles.length, 3);
  assert.deepEqual(L.tiles.map((t) => t.value), ["03", "13", "59"]);
  const widths = new Set(L.tiles.map((t) => t.width));
  assert.equal(widths.size, 1, "equal tile widths");
  const leftMargin = L.tiles[0].x;
  const rightMargin = L.width - (L.tiles[2].x + L.tiles[2].width);
  assert.ok(Math.abs(leftMargin - rightMargin) <= 1, "centred");
  assert.ok(L.tiles[2].y + L.tiles[2].height <= L.height, "fits vertically");
  assert.deepEqual(countdownLayout({ days: 120, hours: 0, minutes: 5 }, "en").tiles.map((t) => t.value), ["120", "00", "05"]);
  // The phone variant keeps the glyphs and still fits three tiles.
  const M = countdownLayout({ days: 3, hours: 13, minutes: 59 }, "de", COUNTDOWN_MOBILE_WIDTH);
  assert.equal(M.width, COUNTDOWN_MOBILE_WIDTH * 2);
  assert.equal(M.tiles[0].width, L.tiles[0].width, "same tile size as desktop");
  assert.ok(M.tiles[0].x >= 0 && M.tiles[2].x + M.tiles[2].width <= M.width, "fits horizontally");
});

test("the phone variant renders at its own width", async () => {
  const { default: sharp } = await import("sharp");
  const m = await renderCountdownImage({ expiresAt: "2026-09-11T23:59:00Z", language: "de", now, width: COUNTDOWN_MOBILE_WIDTH });
  assert.equal((await sharp(m).metadata()).width, COUNTDOWN_MOBILE_WIDTH * 2);
  const other = await renderCountdownImage({ expiresAt: "2026-09-11T23:59:00Z", language: "de", now, width: 123 });
  assert.equal((await sharp(other).metadata()).width, COUNTDOWN_WIDTH * 2, "unknown widths fall back to desktop");
});

test("renderCountdownImage yields a 2× PNG of the card size, for live and expired", async () => {
  const { default: sharp } = await import("sharp");
  const live = await renderCountdownImage({ expiresAt: "2026-09-11T23:59:00Z", language: "de", now });
  const m = await sharp(live).metadata();
  assert.equal(m.format, "png");
  assert.equal(m.width, COUNTDOWN_WIDTH * 2);
  assert.equal(m.height, COUNTDOWN_HEIGHT * 2);
  // A red digit pixel exists inside the first tile; the background is dark.
  const raw = await sharp(live).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * raw.info.width + x) * raw.info.channels; return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]; };
  assert.deepEqual(px(4, 4).map((v) => v < 30), [true, true, true], "dark background");
  let red = 0;
  for (let y = 0; y < raw.info.height; y += 3) for (let x = 0; x < raw.info.width; x += 3) { const [r, g, b] = px(x, y); if (r > 180 && g < 60 && b < 60) red++; }
  assert.ok(red > 200, `red digits present (${red})`);
  const expired = await renderCountdownImage({ expiresAt: "2026-09-01T00:00:00Z", language: "en", now });
  assert.equal((await sharp(expired).metadata()).width, COUNTDOWN_WIDTH * 2);
  assert.ok(expired.length < live.length + 20000);
});
