import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNTDOWN_COLOR_PARAMS,
  COUNTDOWN_FRAMES,
  COUNTDOWN_FRAME_MS,
  COUNTDOWN_HEIGHT,
  COUNTDOWN_MOBILE_WIDTH,
  COUNTDOWN_WIDTH,
  COUNTDOWN_CACHE_WINDOW_MS,
  countdownCacheSeconds,
  countdownCacheWindow,
  countdownColorQuery,
  countdownEdgeColor,
  countdownFrameTimes,
  countdownLayout,
  countdownRemaining,
  parseCountdownColors,
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

test("cache window: every fetch of a minute shares one image drawn for the minute's end", () => {
  assert.equal(COUNTDOWN_CACHE_WINDOW_MS, 60_000);
  const t = Date.parse("2026-11-13T09:00:12.500Z");
  const w = countdownCacheWindow(t);
  assert.equal(w.endsAt, Date.parse("2026-11-13T09:01:00Z"));
  // Same window for the whole minute, a new one at the boundary.
  assert.equal(countdownCacheWindow(Date.parse("2026-11-13T09:00:00Z")).index, w.index);
  assert.equal(countdownCacheWindow(Date.parse("2026-11-13T09:00:59.999Z")).index, w.index);
  assert.equal(countdownCacheWindow(Date.parse("2026-11-13T09:01:00Z")).index, w.index + 1);
  // Drawn for the END: served anywhere in the window, it never shows more time than is left.
  const deadline = "2026-11-13T23:59:00Z";
  for (const at of ["2026-11-13T09:00:00Z", "2026-11-13T09:00:30Z", "2026-11-13T09:00:59.999Z"]) {
    const shown = countdownRemaining(deadline, new Date(w.endsAt));
    const actual = countdownRemaining(deadline, new Date(at));
    const minutes = (r) => r.days * 1440 + r.hours * 60 + r.minutes;
    assert.ok(minutes(shown) <= minutes(actual), at);
    assert.ok(minutes(actual) - minutes(shown) <= 1, at);
  }
  // A shared cache keeps it only until the window ends (whole seconds, rounded down).
  assert.equal(countdownCacheSeconds(w.endsAt, t), 47);
  assert.equal(countdownCacheSeconds(w.endsAt, w.endsAt - 999), 0);
  assert.equal(countdownCacheSeconds(w.endsAt, w.endsAt + 500), 0);
  assert.equal(countdownCacheSeconds(Number.NaN, t), 0);
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

test("colour parameters: exactly six hex digits each, anything else is the light look's colour", () => {
  assert.deepEqual(COUNTDOWN_COLOR_PARAMS, ["bg", "tile", "digit", "label"]);
  const q = new URLSearchParams("bg=111111&tile=292929&digit=F5C400&label=a1a1a1&w=m&cs=x");
  assert.deepEqual(parseCountdownColors(q), { bg: "#111111", tile: "#292929", digit: "#f5c400", label: "#a1a1a1" });
  const bad = new URLSearchParams("bg=%23111111&tile=fff&digit=ggg000&label=1111111");
  assert.deepEqual(parseCountdownColors(bad), { bg: null, tile: null, digit: null, label: null });
  assert.deepEqual(parseCountdownColors({ bg: "abcdef", label: 7 }), { bg: "#abcdef", tile: null, digit: null, label: null });
  assert.deepEqual(parseCountdownColors(null), { bg: null, tile: null, digit: null, label: null });
});

test("countdownColorQuery: the canonical query (fixed order, valid colours only) the signature covers", () => {
  assert.equal(countdownColorQuery({ label: "#A1A1A1", bg: "#111111", tile: "292929", digit: "#f5c400" }), "bg=111111&tile=292929&digit=f5c400&label=a1a1a1");
  assert.equal(countdownColorQuery({ bg: "#111111", tile: "red", digit: null }), "bg=111111");
  assert.equal(countdownColorQuery({}), "");
  assert.equal(countdownColorQuery(null), "");
  // parse ∘ query is stable
  const q = "bg=ffd400&tile=f5cc00&digit=111111&label=64550b";
  assert.equal(countdownColorQuery(parseCountdownColors(new URLSearchParams(q))), q);
});

test("countdownEdgeColor: a hairline a shade darker than a light tile, lighter than a dark one", () => {
  assert.equal(countdownEdgeColor("#f5f5f5"), "#e5e5e5", "the light look's own edge");
  assert.equal(countdownEdgeColor("#292929"), "#434343");
  assert.equal(countdownEdgeColor("#000000"), "#1f1f1f");
});

test("without colours the image is the light look, byte for byte; signed colours tint ground, tiles, digits and words", async () => {
  const { default: sharp } = await import("sharp");
  const base = { expiresAt: "2026-09-11T23:59:00Z", language: "de", now, frames: 2 };
  const plain = await renderCountdownImage(base);
  for (const colors of [undefined, null, {}, { bg: null, tile: null }, { bg: "nope", digit: "#12" }]) {
    assert.ok(plain.equals(await renderCountdownImage({ ...base, colors })), JSON.stringify(colors));
  }
  const colors = { bg: "#111111", tile: "#292929", digit: "#ffd400", label: "#a1a1a1" };
  const dark = await renderCountdownImage({ ...base, colors, frames: 1 });
  const m = await sharp(dark).metadata();
  assert.equal(m.width, COUNTDOWN_WIDTH * 2);
  const raw = await sharp(dark).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * raw.info.width + x) * raw.info.channels; return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]; };
  const near = (a, b, d = 3) => a.every((v, i) => Math.abs(v - b[i]) <= d);
  // the ground is the row's colour (within one step of the GIF palette) — flat, no dithering
  assert.ok(near(px(30, 30), [0x11, 0x11, 0x11]), `ground ${px(30, 30)}`);
  const L = countdownLayout({ days: 3, hours: 13, minutes: 59 }, "de");
  const t = L.tiles[0];
  assert.ok(near(px(t.x + 6, t.y + Math.round(t.height / 2)), [0x29, 0x29, 0x29]), `tile ${px(t.x + 6, t.y + 30)}`);
  let yellow = 0;
  let red = 0;
  let label = 0;
  for (let y = 0; y < raw.info.height; y += 2) {
    for (let x = 0; x < raw.info.width; x += 2) {
      const c = px(x, y);
      if (near(c, [0xff, 0xd4, 0x00], 8)) yellow++;
      if (c[0] > 180 && c[1] < 60 && c[2] < 60) red++;
      if (near(c, [0xa1, 0xa1, 0xa1], 8)) label++;
    }
  }
  assert.ok(yellow > 300, `digits in the digit colour (${yellow})`);
  assert.equal(red, 0, "no red of the light look left");
  assert.ok(label > 30, `heading and units in the label colour (${label})`);
  // the whole hour stays small (64 colours, flat grounds)
  const hour = await renderCountdownImage({ ...base, colors: { bg: "#ffd400", tile: "#f5cc00", digit: "#111111", label: "#64550b" }, frames: undefined });
  assert.ok(hour.length < 120_000, `${hour.length} bytes`);
  const expired = await renderCountdownImage({ expiresAt: "2026-09-01T00:00:00Z", language: "en", now, frames: 1, colors });
  const e = await sharp(expired).raw().toBuffer({ resolveWithObject: true });
  assert.ok(near([e.data[0], e.data[1], e.data[2]], [0x11, 0x11, 0x11]), "expired: the same ground");
});
