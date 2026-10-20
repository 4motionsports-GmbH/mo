import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildHeroVariants,
  buildUploadedHeroVariants,
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
  inputFidelityFor,
} from "./email-hero-variants.mjs";
import { HERO_GRADIENT_FADE_START } from "./email-hero-gradient.mjs";
import { readAiMarking } from "./email-hero-marking.mjs";
import { HERO_UPLOAD_MESSAGES } from "./email-hero-upload.mjs";

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
    { mode: "generate", model: HERO_PRIMARY_IMAGE_MODEL, size: HERO_IMAGE_SIZE, quality: "high" },
    { mode: "generate", model: HERO_PRIMARY_IMAGE_MODEL, size: HERO_FALLBACK_SIZE, quality: "high" },
    { mode: "generate", model: HERO_FALLBACK_IMAGE_MODEL, size: HERO_FALLBACK_SIZE, quality: "high" },
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

test("with reference photos the edit attempts lead, then the generate chain", () => {
  const withRefs = heroImageAttempts({}, { withReferences: true });
  assert.equal(withRefs.length, 5);
  // gpt-image-2 rejects input_fidelity (400 on the first live run) — the
  // edit attempts for it must NOT carry the parameter.
  assert.deepEqual(withRefs.slice(0, 2), [
    { mode: "edit", model: HERO_PRIMARY_IMAGE_MODEL, size: HERO_IMAGE_SIZE, quality: "high" },
    { mode: "edit", model: HERO_PRIMARY_IMAGE_MODEL, size: HERO_FALLBACK_SIZE, quality: "high" },
  ]);
  assert.deepEqual(withRefs.slice(2), heroImageAttempts({}));
});

test("input_fidelity goes only to the gpt-image-1 family", () => {
  assert.equal(inputFidelityFor("gpt-image-2"), undefined);
  assert.equal(inputFidelityFor("gpt-image-2-2026-04-21"), undefined);
  assert.equal(inputFidelityFor("gpt-image-1"), "high");
  assert.equal(inputFidelityFor("gpt-image-1.5"), "high");
  assert.equal(inputFidelityFor("gpt-image-1-mini"), "high");
  const legacy = heroImageAttempts({ EMAIL_HERO_IMAGE_MODEL: "gpt-image-1.5" }, { withReferences: true });
  assert.equal(legacy[0].inputFidelity, "high");
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
  const out = await buildHeroVariants(src, { tool: "gpt-image-2" });
  // Every stored file carries the machine-readable AI marking.
  for (const file of [out.desktop, out.mobile, out.master]) {
    assert.deepEqual(await readAiMarking(file), { digitalSourceType: true, xmpDescription: true, exifDescription: true });
  }
  const xmp = Buffer.from((await sharp(out.desktop).metadata()).xmp).toString("utf8");
  assert.match(xmp, /xmp:CreatorTool="gpt-image-2"/);
  // Aspect normalised to the hero ratio; the master is the un-graded scene.
  assert.equal(out.width, W);
  const masterMeta = await sharp(out.master).metadata();
  assert.equal(masterMeta.format, "jpeg");
  assert.equal(masterMeta.width, W);
  const mRawMaster = await sharp(out.master).raw().toBuffer({ resolveWithObject: true });
  assert.ok(mRawMaster.data[(Math.floor(out.height / 2) * W + 10) * mRawMaster.info.channels] < 40, "master left still black (no gradient)");
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

// ── Uploaded pictures (the Kampagnenbild) ────────────────────────────────────

async function pixel(sharp, file, x, y) {
  const raw = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const i = (y * raw.info.width + x) * raw.info.channels;
  return [raw.data[i], raw.data[i + 1], raw.data[i + 2]];
}

test("upload: an EXIF-rotated phone photo comes out upright, desktop 1536×720, mobile 922×720", async () => {
  const { default: sharp } = await import("sharp");
  // Stored pixels 3000×2000, left half black / right half red, tagged
  // orientation 6 (rotate 90° clockwise to view): upright it is 2000×3000
  // with the black half ON TOP. Read without the rotation, top and bottom of
  // the crop would be the same colour.
  const leftHalf = await sharp({ create: { width: 1500, height: 2000, channels: 3, background: "#000000" } })
    .png()
    .toBuffer();
  const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#ff0000" } })
    .composite([{ input: leftHalf, left: 0, top: 0 }])
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const out = await buildUploadedHeroVariants(photo, { aiGenerated: false });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.sourceWidth, 2000, "oriented width");
  assert.equal(out.sourceHeight, 3000, "oriented height");
  const d = await sharp(out.desktop).metadata();
  const m = await sharp(out.mobile).metadata();
  assert.deepEqual([d.format, d.width, d.height], ["jpeg", HERO_IMAGE_WIDTH, HERO_IMAGE_HEIGHT]);
  assert.deepEqual([m.format, m.width, m.height], ["jpeg", 922, 720]);
  assert.equal(d.orientation, undefined, "no orientation tag left to re-rotate it");
  const top = await pixel(sharp, out.mobile, 461, 20);
  const bottom = await pixel(sharp, out.mobile, 461, 700);
  assert.ok(top[0] < 40 && top[1] < 40, `top is black: ${top}`);
  assert.ok(bottom[0] > 200 && bottom[1] < 60, `bottom is red: ${bottom}`);
  // The photo was 2:3 → "cropped" warning; 2000 wide → no upscaling.
  assert.deepEqual(out.warnings, [HERO_UPLOAD_MESSAGES.cropped]);
});

test("upload: no AI marking for a photo, the full marking when declared AI", async () => {
  const { default: sharp } = await import("sharp");
  const src = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#336699" } })
    .jpeg()
    .withExif({ IFD0: { Make: "Phone", Model: "Camera" } })
    .toBuffer();
  assert.ok((await sharp(src).metadata()).exif, "fixture carries camera EXIF");
  const photo = await buildUploadedHeroVariants(src, { aiGenerated: false });
  assert.equal(photo.ok, true);
  for (const file of [photo.desktop, photo.mobile]) {
    assert.deepEqual(await readAiMarking(file), { digitalSourceType: false, xmpDescription: false, exifDescription: false });
    const meta = await sharp(file).metadata();
    assert.equal(meta.xmp, undefined, "no XMP");
    assert.equal(meta.exif, undefined, "no EXIF (camera data, GPS) leaves the server");
  }
  const ai = await buildUploadedHeroVariants(src, { aiGenerated: true });
  assert.equal(ai.ok, true);
  for (const file of [ai.desktop, ai.mobile]) {
    assert.deepEqual(await readAiMarking(file), { digitalSourceType: true, xmpDescription: true, exifDescription: true });
  }
  const xmp = Buffer.from((await sharp(ai.desktop).metadata()).xmp).toString("utf8");
  assert.match(xmp, /xmp:CreatorTool="generative AI \(hochgeladen\)"/);
  const exif = Buffer.from((await sharp(ai.desktop).metadata()).exif).toString("latin1");
  assert.ok(!exif.includes("Camera"), "the camera's own EXIF does not ride along on the AI path either");
});

test("upload: a transparent PNG is flattened onto white, no alpha channel", async () => {
  const { default: sharp } = await import("sharp");
  const png = await sharp({
    create: { width: 2000, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  const out = await buildUploadedHeroVariants(png, { aiGenerated: false });
  assert.equal(out.ok, true);
  for (const file of [out.desktop, out.mobile]) {
    const meta = await sharp(file).metadata();
    assert.equal(meta.channels, 3);
    assert.equal(meta.hasAlpha, false);
  }
  const corner = await pixel(sharp, out.mobile, 900, 700);
  assert.ok(corner.every((c) => c > 245), `white, not black: ${corner}`);
});

test("upload: a CMYK JPEG becomes 3-channel sRGB", async () => {
  const { default: sharp } = await import("sharp");
  const cmyk = await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#3366cc" } })
    .toColourspace("cmyk")
    .jpeg()
    .toBuffer();
  assert.equal((await sharp(cmyk).metadata()).space, "cmyk", "fixture is CMYK");
  const out = await buildUploadedHeroVariants(cmyk, { aiGenerated: false });
  assert.equal(out.ok, true);
  for (const file of [out.desktop, out.mobile]) {
    const meta = await sharp(file).metadata();
    assert.equal(meta.space, "srgb");
    assert.equal(meta.channels, 3);
  }
  // A 1600×750 crop (no upscaling); 2:1 is within 10 % of the hero ratio.
  assert.deepEqual(out.warnings, []);
});

test("upload: a 16-bit PNG with an ICC profile keeps its colours (no P3 values written as sRGB)", async () => {
  const { default: sharp } = await import("sharp");
  const png16 = await sharp({ create: { width: 1600, height: 750, channels: 3, background: { r: 224, g: 16, b: 16 } } })
    .toColourspace("rgb16")
    .withIccProfile("srgb")
    .png()
    .toBuffer();
  assert.equal((await sharp(png16).metadata()).depth, "ushort", "fixture is 16-bit");
  const out = await buildUploadedHeroVariants(png16, { aiGenerated: false });
  assert.equal(out.ok, true);
  // The phone file has no gradient: its pixels are the source colour.
  const { data } = await sharp(out.mobile).extract({ left: 400, top: 300, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  for (const [got, want] of [[data[0], 224], [data[1], 16], [data[2], 16]]) {
    assert.ok(Math.abs(got - want) <= 3, `channel ${got} vs ${want}`);
  }
});

test("upload: between the minimum and 1536×720 it is upscaled to the stored size, with a warning", async () => {
  const { default: sharp } = await import("sharp");
  const src = await sharp({ create: { width: 1400, height: 656, channels: 3, background: "#808080" } }).webp().toBuffer();
  const out = await buildUploadedHeroVariants(src, { aiGenerated: false });
  assert.equal(out.ok, true);
  const d = await sharp(out.desktop).metadata();
  assert.deepEqual([d.width, d.height], [HERO_IMAGE_WIDTH, HERO_IMAGE_HEIGHT]);
  assert.deepEqual(out.warnings, [HERO_UPLOAD_MESSAGES.upscaled]);
});

test("upload: too small, SVG, GIF and junk are refused with the German message", async () => {
  const { default: sharp } = await import("sharp");
  const small = await sharp({ create: { width: 1000, height: 500, channels: 3, background: "#00ff00" } }).jpeg().toBuffer();
  const tooSmall = await buildUploadedHeroVariants(small, { aiGenerated: false });
  assert.equal(tooSmall.ok, false);
  assert.equal(tooSmall.code, "too_small");
  assert.match(tooSmall.message, /dieses: 1000 × 469/);

  // An SVG can carry script — refused by the SNIFFED format, whatever the
  // request's Content-Type claimed.
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect width="2000" height="1000" fill="red"/></svg>'
  );
  const svgOut = await buildUploadedHeroVariants(svg, { aiGenerated: false });
  assert.equal(svgOut.ok, false);
  assert.equal(svgOut.code, "format");

  const gif = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#00ff00" } }).gif().toBuffer();
  assert.equal((await buildUploadedHeroVariants(gif, { aiGenerated: false })).code, "format");

  // 50 megapixels (a tiny file — a solid colour compresses to nothing):
  // "too big", not "unreadable".
  const huge = await sharp({ create: { width: 8000, height: 6250, channels: 3, background: "#123456" } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const tooBig = await buildUploadedHeroVariants(huge, { aiGenerated: false });
  assert.equal(tooBig.code, "too_many_pixels");
  assert.equal(tooBig.message, HERO_UPLOAD_MESSAGES.too_many_pixels);

  const junk = await buildUploadedHeroVariants(Buffer.from("definitely not a picture"), { aiGenerated: false });
  assert.equal(junk.ok, false);
  assert.equal(junk.code, "unreadable");
  assert.equal(junk.status, 400);
});
