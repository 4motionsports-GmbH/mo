import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  COUNTDOWN_COLOR_PARAMS,
  COUNTDOWN_FRAMES,
  COUNTDOWN_FRAME_MS,
  COUNTDOWN_HEIGHT,
  COUNTDOWN_LABEL_MARGIN,
  COUNTDOWN_LABEL_PARAMS,
  COUNTDOWN_MOBILE_WIDTH,
  COUNTDOWN_WIDTH,
  COUNTDOWN_CACHE_WINDOW_MS,
  countdownCacheSeconds,
  countdownCacheWindow,
  countdownColorQuery,
  countdownEdgeColor,
  countdownFrameTimes,
  countdownLabelLayout,
  countdownLabelQuery,
  countdownLayout,
  countdownLookQuery,
  countdownRemaining,
  parseCountdownColors,
  parseCountdownLabel,
  renderCountdownImage,
} from "./email-countdown-image.mjs";
import { GLYPHS, LABEL_CAP_HEIGHT, SPRITE_SCALE } from "./generated/countdown-sprite.mjs";

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

// ── the label: a free text in the picture, or none (2026-11-13) ──────────────

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * GIFs captured right before the label existed (sharp 0.34.5, the sprite of
 * 2026-11-12): without a label — and with every way of saying „no label“ —
 * the image stays byte for byte what every mail already carries. After an
 * intended change of the glyphs or of the encoder, capture them again.
 */
const BEFORE_LABEL = [
  ["light, de, desktop", { expiresAt: "2026-09-11T23:59:00Z", language: "de", now, frames: 2 }, "62990b3f8fb3c796cbd90647c4e72f64d2868c99ed4f0cc091e15a17348b61b6"],
  ["light, en, phone", { expiresAt: "2026-09-11T23:59:00Z", language: "en", now, frames: 2, width: COUNTDOWN_MOBILE_WIDTH }, "ab54c0a48ab957b63e36177f977b729c66081e8827cf9c0be58907d278728eb6"],
  [
    "colours, de, desktop",
    { expiresAt: "2026-09-11T23:59:00Z", language: "de", now, frames: 3, colors: { bg: "#111111", tile: "#292929", digit: "#ffd400", label: "#a1a1a1" } },
    "ab09d310bfc511a9e7c1910b749262017c5dd8498e232e261b3df94eb52735cd",
  ],
  [
    "colours, de, phone, 100+ days",
    { expiresAt: "2026-12-31T23:59:00Z", language: "de", now, frames: 1, width: COUNTDOWN_MOBILE_WIDTH, colors: { bg: "#111111", tile: "#292929", digit: "#ffd400", label: "#a1a1a1" } },
    "78f0087cdae00f7834b99bc9cc8df95e62ff289a5668ef9293ef9e4befec5b58",
  ],
  [
    "expired, en, colours",
    { expiresAt: "2026-09-01T00:00:00Z", language: "en", now, frames: 1, colors: { bg: "#111111", tile: "#292929", digit: "#ffd400", label: "#a1a1a1" } },
    "976d33bc2630594f9a17289e15ca31b9b570929c787cbefe555ae7c0efe3ebab",
  ],
  ["ends within the hour, en", { expiresAt: "2026-09-08T10:02:30Z", language: "en", now }, "17e3cda7ddfb659eb934fb2ce7ba01c9dc3bc3006d71d345d5dbb2f5c5374a50"],
];

test("without a label the GIF is byte for byte the one of before (also with an empty, undrawable or default label)", async () => {
  for (const [name, input, hash] of BEFORE_LABEL) {
    assert.equal(sha256(await renderCountdownImage(input)), hash, name);
    for (const label of [null, {}, { text: null }, { text: "" }, { text: "€€€ 😀" }, { hidden: false }]) {
      assert.equal(sha256(await renderCountdownImage({ ...input, label })), hash, `${name} — ${JSON.stringify(label)}`);
    }
  }
});

test("label parameters: `text` in the canonical spelling (strictly encoded) or `notext=1` — after the colours, under one signature", () => {
  assert.deepEqual(COUNTDOWN_LABEL_PARAMS, ["text", "notext"]);
  assert.equal(countdownLabelQuery({ text: "Nur noch kurz!" }), "text=NUR%20NOCH%20KURZ%21");
  assert.equal(countdownLabelQuery({ text: "It’s „Schnäppchen“-Zeit (50 %)" }), "text=IT%27S%20%E2%80%9ESCHN%C3%84PPCHEN%E2%80%9C-ZEIT%2050%20%25");
  assert.equal(countdownLabelQuery({ text: "x", hidden: true }), "notext=1", "hidden wins");
  assert.equal(countdownLabelQuery({ text: "€" }), "");
  assert.equal(countdownLabelQuery(null), "");
  // the colours keep their query (and so their URLs and signatures); the label follows them
  const colors = { bg: "#111111", tile: "#292929", digit: "#ffd400", label: "#a1a1a1" };
  assert.equal(countdownLookQuery(colors), countdownColorQuery(colors));
  assert.equal(countdownLookQuery(colors, { text: "Black Week" }), "bg=111111&tile=292929&digit=ffd400&label=a1a1a1&text=BLACK%20WEEK");
  assert.equal(countdownLookQuery(colors, { hidden: true }), "bg=111111&tile=292929&digit=ffd400&label=a1a1a1&notext=1");
  assert.equal(countdownLookQuery(null, { text: "ok" }), "text=OK");
  assert.equal(countdownLookQuery(null, null), "");
  // parse: read in the canonical form; parse ∘ query is stable
  assert.deepEqual(parseCountdownLabel(new URLSearchParams("text=nur+noch%20kurz%21&w=m")), { text: "NUR NOCH KURZ!", hidden: false });
  assert.deepEqual(parseCountdownLabel(new URLSearchParams("text=abc&notext=1")), { text: null, hidden: true });
  assert.deepEqual(parseCountdownLabel(new URLSearchParams("notext=yes")), { text: null, hidden: false });
  assert.deepEqual(parseCountdownLabel(new URLSearchParams("text=%E2%82%AC")), { text: null, hidden: false });
  assert.deepEqual(parseCountdownLabel({ text: "Ä" }), { text: "Ä", hidden: false });
  assert.deepEqual(parseCountdownLabel(null), { text: null, hidden: false });
  for (const q of ["text=NUR%20NOCH%20KURZ%21", "notext=1", "text=%E2%80%9EBLACK%20WEEK%E2%80%9C"]) {
    assert.equal(countdownLabelQuery(parseCountdownLabel(new URLSearchParams(q))), q);
  }
  const full = `${countdownColorQuery(colors)}&text=BLACK%20WEEK`;
  const params = new URLSearchParams(`${full}&w=m&cs=x`);
  assert.equal(countdownLookQuery(parseCountdownColors(params), parseCountdownLabel(params)), full);
});

test("countdownLabelLayout: the glyphs of the sprite at their advances, centred by its caller, scaled down only when too wide", () => {
  const L = countdownLabelLayout("NUR NOCH KURZ!");
  assert.ok(L);
  assert.equal(L.glyphs.length, 12, "the spaces have no ink");
  assert.deepEqual(L.glyphs.map((g) => g.char).join(""), "NURNOCHKURZ!");
  assert.equal(L.glyphs[0].x, 0, "the ink starts at 0");
  for (let i = 1; i < L.glyphs.length; i++) assert.ok(L.glyphs[i].x > L.glyphs[i - 1].x, "left to right");
  assert.equal(L.scale, 1);
  assert.equal(L.top, 0, "capitals only: the ink starts at the cap height");
  const umlaut = countdownLabelLayout("ÄRGER");
  assert.ok(umlaut.top < 0, "the umlaut's dots reach above the cap height");
  assert.equal(umlaut.glyphs[0].y, 0, "they are the top of the ink");
  assert.ok(umlaut.glyphs[1].y > 0, "the R starts at the cap height below them");
  // composed like the pre-rendered words: the same width within a pixel or two
  const words = countdownLabelLayout("DEIN ANGEBOT GILT NOCH");
  assert.ok(Math.abs(words.width - GLYPHS.de_heading.width) <= 3, `${words.width} vs ${GLYPHS.de_heading.width}`);
  // too wide for the phone variant: scaled to fit the width minus the margins
  const long = countdownLabelLayout("W".repeat(32), COUNTDOWN_MOBILE_WIDTH);
  const room = (COUNTDOWN_MOBILE_WIDTH - 2 * COUNTDOWN_LABEL_MARGIN) * SPRITE_SCALE;
  assert.ok(long.scale < 1 && Math.round(long.width * long.scale) <= room);
  assert.equal(countdownLabelLayout("W".repeat(32)).scale, 1, "the desktop has room");
  assert.equal(countdownLabelLayout(""), null);
  assert.equal(countdownLabelLayout("€{}"), null, "nothing drawable");
});

test("countdownLayout with a label: a free text replaces the words, the tiles stay; none moves the tiles to the middle", () => {
  const r = { days: 3, hours: 13, minutes: 59 };
  const plain = countdownLayout(r, "de");
  assert.deepEqual(countdownLayout(r, "de", COUNTDOWN_WIDTH, null), plain);
  assert.deepEqual(countdownLayout(r, "de", COUNTDOWN_WIDTH, { text: null, hidden: false }), plain);
  assert.ok(plain.heading && plain.label === null);
  const free = countdownLayout(r, "de", COUNTDOWN_WIDTH, { text: "Nur noch kurz!" });
  assert.equal(free.heading, null);
  assert.deepEqual(free.tiles, plain.tiles, "the tiles stay where they are");
  assert.ok(free.label);
  assert.ok(Math.abs(free.label.x - (free.width - free.label.width - free.label.x)) <= 1, "centred");
  assert.equal(free.label.y, plain.headingY, "capitals start where the words start");
  assert.ok(free.label.y + free.label.height < plain.tiles[0].y, "above the tiles");
  // umlauts reach above the cap height; a scaled line keeps its cap height centred on the words'
  const umlaut = countdownLayout(r, "de", COUNTDOWN_WIDTH, { text: "ÄRGER" });
  assert.ok(umlaut.label.y < plain.headingY);
  const scaled = countdownLayout(r, "de", COUNTDOWN_MOBILE_WIDTH, { text: "W".repeat(32) });
  assert.ok(scaled.label.scale < 1);
  assert.ok(scaled.label.x >= COUNTDOWN_LABEL_MARGIN * SPRITE_SCALE - 1 && scaled.label.x + scaled.label.width <= scaled.width - COUNTDOWN_LABEL_MARGIN * SPRITE_SCALE + 1);
  const capMiddle = plain.headingY + LABEL_CAP_HEIGHT / 2;
  assert.ok(Math.abs(scaled.label.y + (LABEL_CAP_HEIGHT * scaled.label.scale) / 2 - capMiddle) <= 1, "cap height centred on the words' line");
  // none: no words, no label, the tiles in the middle of the unchanged image
  const none = countdownLayout(r, "de", COUNTDOWN_WIDTH, { text: "egal", hidden: true });
  assert.equal(none.heading, null);
  assert.equal(none.label, null);
  assert.equal(none.height, plain.height);
  const t = none.tiles[0];
  assert.ok(Math.abs(t.y - (none.height - t.y - t.height)) <= 1, "vertically centred");
  assert.deepEqual(
    none.tiles.map((x) => [x.x, x.width, x.value]),
    plain.tiles.map((x) => [x.x, x.width, x.value])
  );
});

test("a free label is drawn in the picture (in the label colour), centred; none leaves the band above the tiles empty", async () => {
  const { default: sharp } = await import("sharp");
  const base = { expiresAt: "2026-09-11T23:59:00Z", language: "de", now, frames: 1 };
  const raw = async (input) => sharp(await renderCountdownImage(input)).raw().toBuffer({ resolveWithObject: true });
  const ink = (img, y0, y1, isInk) => {
    let n = 0;
    let left = Infinity;
    let right = -1;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < img.info.width; x++) {
        const i = (y * img.info.width + x) * img.info.channels;
        if (isInk([img.data[i], img.data[i + 1], img.data[i + 2]])) {
          n++;
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
    }
    return { n, left, right };
  };
  const plainLayout = countdownLayout({ days: 3, hours: 13, minutes: 59 }, "de");
  const band = [plainLayout.headingY - 8, plainLayout.tiles[0].y - 4];
  const dark = (c) => c[0] < 90 && c[1] < 90 && c[2] < 90;
  const words = ink(await raw(base), ...band, dark);
  const free = ink(await raw({ ...base, label: { text: "Nur noch kurz!" } }), ...band, dark);
  assert.ok(free.n > 50 && free.n < words.n, `ink of the free label (${free.n} vs ${words.n})`);
  assert.ok(Math.abs(free.left - (COUNTDOWN_WIDTH * 2 - 1 - free.right)) <= 2, "centred");
  const same = await raw({ ...base, label: { text: "Dein Angebot gilt noch" } });
  const sameInk = ink(same, ...band, dark);
  assert.ok(Math.abs(sameInk.left - words.left) <= 2 && Math.abs(sameInk.right - words.right) <= 2, "composed like the pre-rendered words");
  // none: nothing above the tiles; the digits keep their colour
  const none = await raw({ ...base, label: { hidden: true } });
  assert.equal(ink(none, 0, 30, dark).n, 0, "no words at the top");
  // in a template's colours the label takes the label colour
  const colors = { bg: "#111111", tile: "#292929", digit: "#ffd400", label: "#a1a1a1" };
  const tinted = ink(await raw({ ...base, colors, label: { text: "Black Week" } }), ...band, (c) => Math.abs(c[0] - 0xa1) <= 10 && Math.abs(c[1] - 0xa1) <= 10);
  assert.ok(tinted.n > 50, `label colour (${tinted.n})`);
  // the phone variant: a long label stays inside the image
  const phone = await raw({ ...base, width: COUNTDOWN_MOBILE_WIDTH, label: { text: "W".repeat(32) } });
  assert.equal(phone.info.width, COUNTDOWN_MOBILE_WIDTH * 2);
  const wide = ink(phone, ...band, dark);
  assert.ok(wide.left >= COUNTDOWN_LABEL_MARGIN * 2 - 2 && wide.right <= COUNTDOWN_MOBILE_WIDTH * 2 - COUNTDOWN_LABEL_MARGIN * 2 + 2, `${wide.left}–${wide.right}`);
  // an hour of frames with a label stays small, and expired frames ignore it
  const hour = await renderCountdownImage({ ...base, frames: undefined, colors, label: { text: "Nur noch kurz!" } });
  assert.ok(hour.length < 120_000, `${hour.length} bytes`);
  const expired = { expiresAt: "2026-09-01T00:00:00Z", language: "en", now, frames: 1 };
  assert.ok((await renderCountdownImage(expired)).equals(await renderCountdownImage({ ...expired, label: { text: "Nur noch kurz!" } })));
});
