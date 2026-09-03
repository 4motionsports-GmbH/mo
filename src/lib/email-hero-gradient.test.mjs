import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyHeroGradient,
  HERO_GRADIENT_COLOR,
  HERO_GRADIENT_FADE_END,
  HERO_GRADIENT_FADE_START,
  HERO_GRADIENT_MAX_ALPHA,
  HERO_TEXT_COLUMN_FRACTION,
  HERO_TEXT_REACH_FRACTION,
  heroGradientAlphaAt,
  heroGradientOverlaySvg,
  heroGradientStops,
} from "./email-hero-gradient.mjs";

test("the text column is 55% wide, matching performance.ts hero-text", () => {
  assert.equal(HERO_TEXT_COLUMN_FRACTION, 0.55);
});

test("the text reach lies inside the column and the fade brackets it", () => {
  assert.ok(HERO_TEXT_REACH_FRACTION < HERO_TEXT_COLUMN_FRACTION);
  assert.ok(HERO_GRADIENT_FADE_START < HERO_TEXT_REACH_FRACTION);
  assert.ok(HERO_GRADIENT_FADE_END > HERO_TEXT_REACH_FRACTION);
});

test("alpha is flat at max over the protected zone and zero past the fade", () => {
  assert.equal(heroGradientAlphaAt(0), HERO_GRADIENT_MAX_ALPHA);
  assert.equal(heroGradientAlphaAt(HERO_GRADIENT_FADE_START), HERO_GRADIENT_MAX_ALPHA);
  assert.equal(heroGradientAlphaAt(HERO_GRADIENT_FADE_END), 0);
  assert.equal(heroGradientAlphaAt(1), 0);
});

test("the text sits on enough overlay, the column edge is nearly clear", () => {
  // Measured on the rendered hero: subline to ~47%, headline to ~50%.
  assert.ok(heroGradientAlphaAt(0.47) >= 0.6, String(heroGradientAlphaAt(0.47)));
  assert.ok(
    heroGradientAlphaAt(HERO_TEXT_REACH_FRACTION) >= 0.45,
    String(heroGradientAlphaAt(HERO_TEXT_REACH_FRACTION))
  );
  // Past the column the scene must show: the whole point of shrinking the zone.
  assert.ok(heroGradientAlphaAt(HERO_TEXT_COLUMN_FRACTION) <= 0.25);
});

test("the prompt's calm-left zone (45%) is already under strong overlay", () => {
  // Whatever the model puts right at 45% is faded to at most a ghost.
  assert.ok(heroGradientAlphaAt(0.45) >= 0.65);
});

test("alpha decreases monotonically with no hard edge", () => {
  let prev = Infinity;
  let maxStep = 0;
  for (let x = 0; x <= 1.0001; x += 0.01) {
    const a = heroGradientAlphaAt(x);
    assert.ok(a <= prev + 1e-12, `alpha rose at ${x}`);
    maxStep = Math.max(maxStep, prev === Infinity ? 0 : prev - a);
    prev = a;
  }
  // Per 1% of width the overlay never drops more than 6 percentage points.
  assert.ok(maxStep < 0.06, String(maxStep));
});

test("stops are ascending, start at 0 with max alpha and end at 1 with 0", () => {
  const stops = heroGradientStops();
  assert.equal(stops[0].offset, 0);
  assert.equal(stops[0].alpha, HERO_GRADIENT_MAX_ALPHA);
  assert.equal(stops.at(-1).offset, 1);
  assert.equal(stops.at(-1).alpha, 0);
  for (let i = 1; i < stops.length; i++) {
    assert.ok(stops[i].offset >= stops[i - 1].offset);
    assert.ok(stops[i].alpha <= stops[i - 1].alpha);
  }
});

test("the overlay SVG is sized like the picture and carries the gradient", () => {
  const svg = heroGradientOverlaySvg(1536, 1024);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"'));
  assert.ok(svg.includes(`stop-color="${HERO_GRADIENT_COLOR}"`));
  assert.ok(svg.includes('x1="0" y1="0" x2="1" y2="0"'), "horizontal gradient");
  assert.ok(svg.includes('offset="0.00%"') && svg.includes('offset="100.00%"'));
  assert.ok(svg.includes('fill="url(#g)"'));
});

test("applyHeroGradient whitens the left, leaves the right untouched, keeps size", async () => {
  const { default: sharp } = await import("sharp");
  const W = 300;
  const H = 100;
  // A pure black 3:1 picture: any brightness afterwards is the overlay.
  const black = await sharp({
    create: { width: W, height: H, channels: 3, background: "#000000" },
  })
    .png()
    .toBuffer();
  const out = await applyHeroGradient(black);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, W);
  assert.equal(meta.height, H);
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const red = (xFrac) => data[(Math.round(W * xFrac) + Math.floor(H / 2) * W) * info.channels];
  // #f6f6f6 at 93% over black ≈ 246 * 0.93 ≈ 229.
  assert.ok(red(0.05) >= 220, `left edge: ${red(0.05)}`);
  assert.ok(red(0.35) >= 220, `protected zone: ${red(0.35)}`);
  assert.ok(red(0.5) > 80 && red(0.5) < 160, `text reach: ${red(0.5)}`);
  assert.ok(red(0.6) < 40, `past the column: ${red(0.6)}`);
  assert.equal(red(0.9), 0, "right side untouched");
  assert.equal(red(0.99), 0);
});
