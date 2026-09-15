import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNTDOWN_FRAMES,
  COUNTDOWN_FRAME_MS,
  COUNTDOWN_HEIGHT,
  COUNTDOWN_MOBILE_WIDTH,
  COUNTDOWN_WIDTH,
  countdownFrameTimes,
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

test("frame times: one per minute for an hour, stopping right after the deadline", () => {
  const hour = countdownFrameTimes("2026-09-11T23:59:00Z", now);
  assert.equal(hour.length, COUNTDOWN_FRAMES);
  assert.equal(hour[0].getTime(), now.getTime());
  assert.equal(hour[1].getTime() - hour[0].getTime(), COUNTDOWN_FRAME_MS);
  assert.equal(hour[59].getTime(), now.getTime() + 59 * COUNTDOWN_FRAME_MS);
  // Ends in 2½ minutes: 10:00, 10:01, 10:02 still live, 10:03 expired — and stop.
  const soon = countdownFrameTimes("2026-09-08T10:02:30Z", now);
  assert.equal(soon.length, 4);
  assert.equal(countdownRemaining("2026-09-08T10:02:30Z", soon[2]).expired, false);
  assert.equal(countdownRemaining("2026-09-08T10:02:30Z", soon[3]).expired, true);
  // Already expired: a single frame. Fewer frames on request, never more than an hour.
  assert.equal(countdownFrameTimes("2026-09-01T00:00:00Z", now).length, 1);
  assert.equal(countdownFrameTimes("2026-09-11T23:59:00Z", now, 5).length, 5);
  assert.equal(countdownFrameTimes("2026-09-11T23:59:00Z", now, 500).length, COUNTDOWN_FRAMES);
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
  const m = await renderCountdownImage({ expiresAt: "2026-09-11T23:59:00Z", language: "de", now, width: COUNTDOWN_MOBILE_WIDTH, frames: 1 });
  assert.equal((await sharp(m).metadata()).width, COUNTDOWN_MOBILE_WIDTH * 2);
  const other = await renderCountdownImage({ expiresAt: "2026-09-11T23:59:00Z", language: "de", now, width: 123, frames: 1 });
  assert.equal((await sharp(other).metadata()).width, COUNTDOWN_WIDTH * 2, "unknown widths fall back to desktop");
});

test("the full image is an hour-long GIF that ticks once a minute and plays once", async () => {
  const { default: sharp } = await import("sharp");
  const gif = await renderCountdownImage({ expiresAt: "2026-09-08T11:30:00Z", language: "de", now });
  const m = await sharp(gif, { animated: true }).metadata();
  assert.equal(m.format, "gif");
  assert.equal(m.pages, COUNTDOWN_FRAMES);
  assert.equal(m.loop, 1, "plays once, then holds the last frame");
  assert.ok(m.delay.every((d) => d === COUNTDOWN_FRAME_MS), "one frame per minute");
  assert.ok(gif.length < 120_000, `stays small (${gif.length} bytes)`);
  // Frame 0 shows 01:30, frame 59 shows 00:31 — the digits differ.
  const first = await sharp(gif, { page: 0 }).raw().toBuffer();
  const last = await sharp(gif, { page: 59 }).raw().toBuffer();
  assert.notDeepEqual(first, last);
  // An offer ending within the hour counts down to "expired" and stops there.
  const short = await renderCountdownImage({ expiresAt: "2026-09-08T10:02:30Z", language: "en", now });
  assert.equal((await sharp(short, { animated: true }).metadata()).pages, 4);
});

test("renderCountdownImage yields a 2× frame of the card size, for live and expired", async () => {
  const { default: sharp } = await import("sharp");
  const live = await renderCountdownImage({ expiresAt: "2026-09-11T23:59:00Z", language: "de", now, frames: 1 });
  const m = await sharp(live).metadata();
  assert.equal(m.format, "gif");
  assert.equal(m.width, COUNTDOWN_WIDTH * 2);
  assert.equal(m.height, COUNTDOWN_HEIGHT * 2);
  // The light card look: white background (sampled inside the rounded rect,
  // above the heading), a dark heading, red digits inside the tiles.
  const raw = await sharp(live).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * raw.info.width + x) * raw.info.channels; return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]; };
  assert.deepEqual(px(30, 30).map((v) => v > 245), [true, true, true], "white background");
  let red = 0;
  let dark = 0;
  for (let y = 0; y < raw.info.height; y += 3) for (let x = 0; x < raw.info.width; x += 3) { const [r, g, b] = px(x, y); if (r > 180 && g < 60 && b < 60) red++; if (r < 60 && g < 60 && b < 60) dark++; }
  assert.ok(red > 200, `red digits present (${red})`);
  assert.ok(dark > 30, `dark heading present (${dark})`);
  const expired = await renderCountdownImage({ expiresAt: "2026-09-01T00:00:00Z", language: "en", now, frames: 1 });
  assert.equal((await sharp(expired).metadata()).width, COUNTDOWN_WIDTH * 2);
  assert.ok(expired.length < live.length + 20000);
});
