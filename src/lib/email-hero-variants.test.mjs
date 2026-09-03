import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildHeroVariants,
  HERO_ASPECT,
  HERO_FALLBACK_IMAGE_MODEL,
  HERO_FALLBACK_SIZE,
  HERO_IMAGE_HEIGHT,
  HERO_IMAGE_SIZE,
  HERO_IMAGE_WIDTH,
  HERO_MOBILE_CROP_START,
  HERO_PRIMARY_IMAGE_MODEL,
  heroAspectCrop,
  heroImageAttempts,
  heroMobileCrop,
} from "./email-hero-variants.mjs";
import { HERO_GRADIENT_FADE_START } from "./email-hero-gradient.mjs";

test("the native size is the desktop hero's ratio and gpt-image-2-legal", () => {
  // performance.ts: the hero cell is 640 wide and 300 tall.
  assert.ok(Math.abs(HERO_ASPECT - 640 / 300) < 0.01, String(HERO_ASPECT));
  assert.equal(HERO_IMAGE_WIDTH % 16, 0);
  assert.equal(HERO_IMAGE_HEIGHT % 16, 0);
  assert.ok(HERO_ASPECT <= 3, "gpt-image-2 allows at most 3:1");
  assert.equal(HERO_IMAGE_SIZE, "1536x720");
});

test("attempts go native → 3:2 → previous model, with env overrides", () => {
  const def = heroImageAttempts({});
  assert.deepEqual(def, [
    { model: HERO_PRIMARY_IMAGE_MODEL, size: HERO_IMAGE_SIZE, quality: "high" },
    { model: HERO_PRIMARY_IMAGE_MODEL, size: HERO_FALLBACK_SIZE, quality: "high" },
    { model: HERO_FALLBACK_IMAGE_MODEL, size: HERO_FALLBACK_SIZE, quality: "high" },
  ]);
  const custom = heroImageAttempts({
    EMAIL_HERO_IMAGE_MODEL: "gpt-image-3",
    EMAIL_HERO_IMAGE_QUALITY: "Medium",
  });
  assert.equal(custom[0].model, "gpt-image-3");
  assert.equal(custom[0].quality, "medium");
  assert.equal(custom.at(-1).model, HERO_FALLBACK_IMAGE_MODEL);
  // An unknown quality falls back to high; the fallback model as primary is
  // not repeated.
  assert.equal(heroImageAttempts({ EMAIL_HERO_IMAGE_QUALITY: "ultra" })[0].quality, "high");
  assert.equal(heroImageAttempts({ EMAIL_HERO_IMAGE_MODEL: HERO_FALLBACK_IMAGE_MODEL }).length, 2);
});

test("aspect crop: 3:2 keeps the width and takes a centred band", () => {
  const c = heroAspectCrop(1536, 1024);
  assert.equal(c.width, 1536);
  assert.equal(c.height, 720);
  assert.equal(c.left, 0);
  assert.equal(c.top, 152);
});

test("aspect crop: the native format is returned whole", () => {
  assert.deepEqual(heroAspectCrop(1536, 720), { left: 0, top: 0, width: 1536, height: 720 });
});

test("aspect crop: a too-wide picture keeps its right side", () => {
  const c = heroAspectCrop(3000, 720);
  assert.equal(c.height, 720);
  assert.equal(c.width, 1536);
  assert.equal(c.left, 3000 - 1536, "anchored right, where the scene is");
});

test("mobile crop starts where the calm zone ends and runs to the right edge", () => {
  const c = heroMobileCrop(1536, 720);
  assert.equal(c.left, Math.round(1536 * HERO_MOBILE_CROP_START));
  assert.equal(c.width, 1536 - c.left);
  assert.equal(c.height, 720);
  // The crop starts inside the gradient's flat zone's neighbourhood but the
  // mobile file carries NO gradient — the assertion is about the prompt:
  // the scene may begin at 45%, so the crop must begin before that.
  assert.ok(HERO_MOBILE_CROP_START < 0.45);
  assert.ok(HERO_MOBILE_CROP_START >= HERO_GRADIENT_FADE_START);
});

test("buildHeroVariants: gradient on desktop only, mobile is the right crop, both JPEG", async () => {
  const { default: sharp } = await import("sharp");
  // A 3:2 picture: left half black, right half red — so the crops are visible.
  const W = 300;
  const H = 200;
  const left = await sharp({ create: { width: W / 2, height: H, channels: 3, background: "#000000" } }).png().toBuffer();
  const src = await sharp({ create: { width: W, height: H, channels: 3, background: "#ff0000" } })
    .composite([{ input: left, left: 0, top: 0 }])
    .png()
    .toBuffer();
  const out = await buildHeroVariants(src);
  // Aspect normalised to the hero ratio.
  assert.equal(out.width, W);
  assert.equal(out.height, Math.round(W / HERO_ASPECT));
  const d = await sharp(out.desktop).metadata();
  const m = await sharp(out.mobile).metadata();
  assert.equal(d.format, "jpeg");
  assert.equal(m.format, "jpeg");
  assert.equal(d.width, W);
  assert.equal(m.width, W - Math.round(W * HERO_MOBILE_CROP_START));
  // Desktop: the black left is whitened by the gradient; the far right is still red.
  const dRaw = await sharp(out.desktop).raw().toBuffer({ resolveWithObject: true });
  const px = (raw, x, y) => {
    const i = (y * raw.info.width + x) * raw.info.channels;
    return [raw.data[i], raw.data[i + 1], raw.data[i + 2]];
  };
  const midY = Math.floor(out.height / 2);
  assert.ok(px(dRaw, 10, midY)[0] > 200, "desktop left whitened");
  const dr = px(dRaw, W - 10, midY);
  assert.ok(dr[0] > 200 && dr[1] < 60, "desktop right still red");
  // Mobile: no gradient — its left edge (40% of the source, still in the black
  // half) is black, its right is red.
  const mRaw = await sharp(out.mobile).raw().toBuffer({ resolveWithObject: true });
  const ml = px(mRaw, 5, midY);
  assert.ok(ml[0] < 40 && ml[1] < 40, `mobile left is untouched black: ${ml}`);
  const mr = px(mRaw, mRaw.info.width - 5, midY);
  assert.ok(mr[0] > 200 && mr[1] < 60, "mobile right red");
});
