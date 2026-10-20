import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_JPEG_QUALITIES,
  HERO_UPLOAD_ACCEPT,
  downscaleSteps,
  heroUploadContentType,
  planHeroUpload,
} from "./email-hero-upload-client.mjs";
import {
  CLIENT_JPEG_QUALITY,
  CLIENT_MAX_LONG_SIDE,
  HERO_UPLOAD_CONTENT_TYPES,
  HERO_UPLOAD_MAX_BYTES,
  HERO_UPLOAD_MESSAGES,
  HERO_UPLOAD_RECOMMENDED,
} from "./email-hero-upload.mjs";
import { heroAspectCrop } from "./email-hero-geometry.mjs";

test("the picker accepts exactly the upload route's types", () => {
  assert.equal(HERO_UPLOAD_ACCEPT, "image/jpeg,image/png,image/webp");
  assert.deepEqual(HERO_UPLOAD_ACCEPT.split(","), [...HERO_UPLOAD_CONTENT_TYPES]);
  assert.equal(CLIENT_JPEG_QUALITIES[0], CLIENT_JPEG_QUALITY);
  for (let i = 1; i < CLIENT_JPEG_QUALITIES.length; i++) {
    assert.ok(CLIENT_JPEG_QUALITIES[i] < CLIENT_JPEG_QUALITIES[i - 1], "falling qualities");
  }
});

test("content type: browser type with aliases, else the extension, else null", () => {
  assert.equal(heroUploadContentType("image/jpeg", "a.jpg"), "image/jpeg");
  assert.equal(heroUploadContentType("IMAGE/JPG", "a"), "image/jpeg");
  assert.equal(heroUploadContentType("image/pjpeg", "a"), "image/jpeg");
  assert.equal(heroUploadContentType("image/png", "a.png"), "image/png");
  assert.equal(heroUploadContentType("image/webp; q=1", "a"), "image/webp");
  // The browser's type wins over a misleading name.
  assert.equal(heroUploadContentType("image/heic", "IMG_0001.jpg"), null);
  for (const t of ["image/heic", "image/heif", "image/gif", "image/svg+xml", "image/tiff", "application/pdf", "text/plain"]) {
    assert.equal(heroUploadContentType(t, "x.jpg"), null, t);
  }
  // No type from the browser: the extension decides.
  assert.equal(heroUploadContentType("", "Foto.JPEG"), "image/jpeg");
  assert.equal(heroUploadContentType("", "foto.jfif"), "image/jpeg");
  assert.equal(heroUploadContentType(undefined, "bild.png"), "image/png");
  assert.equal(heroUploadContentType("", "bild.webp"), "image/webp");
  assert.equal(heroUploadContentType("", "IMG_0001.HEIC"), null);
  assert.equal(heroUploadContentType("", "bild"), null);
  assert.equal(heroUploadContentType("", null), null);
});

test("plan: refuses what the route would refuse, with the same German texts", () => {
  const fmt = planHeroUpload({ contentType: null, bytes: 1000, width: 3000, height: 1500 });
  assert.equal(fmt.ok, false);
  assert.equal(fmt.code, "format");
  assert.equal(fmt.message, HERO_UPLOAD_MESSAGES.format);
  assert.equal(planHeroUpload({ contentType: "image/gif", bytes: 1000, width: 3000, height: 1500 }).code, "format");
  assert.equal(planHeroUpload({ contentType: "image/jpeg", bytes: 0, width: 3000, height: 1500 }).code, "empty");
  assert.equal(planHeroUpload({ contentType: "image/jpeg", bytes: 10, width: 0, height: 1500 }).code, "unreadable");
  assert.equal(planHeroUpload({ contentType: "image/jpeg", bytes: 10, width: 12.5, height: 1500 }).code, "unreadable");

  const small = planHeroUpload({ contentType: "image/png", bytes: 300_000, width: 1000, height: 800 });
  assert.equal(small.ok, false);
  assert.equal(small.code, "too_small");
  assert.match(small.message, /mindestens 1280 × 600 px \(dieses: 1000 × 469\)/);
});

test("plan: a small, light file is sent as it is", () => {
  const r = planHeroUpload({ contentType: "image/jpeg", bytes: 900_000, width: 2400, height: 1125 });
  assert.deepEqual(r, { ok: true, reencode: false, width: 2400, height: 1125, warnings: [] });
});

test("plan: a 50-MP phone photo is downscaled and uploaded, not refused as too big", () => {
  const r = planHeroUpload({ contentType: "image/jpeg", bytes: 12_000_000, width: 8640, height: 5760 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.reencode, true);
  assert.equal(Math.max(r.width, r.height), CLIENT_MAX_LONG_SIDE);
  assert.ok(heroAspectCrop(r.width, r.height).width >= HERO_UPLOAD_RECOMMENDED.width);
  // 3:2 differs from 2.13:1 by more than 10 % → the crop warning, no upscale warning.
  assert.deepEqual(r.warnings, [HERO_UPLOAD_MESSAGES.cropped]);
});

test("plan: warnings come from the shared rules on the uploaded size", () => {
  const r = planHeroUpload({ contentType: "image/webp", bytes: 400_000, width: 1400, height: 656 });
  assert.equal(r.ok, true);
  assert.equal(r.reencode, false);
  assert.deepEqual(r.warnings, [HERO_UPLOAD_MESSAGES.upscaled]);
});

test("plan: a heavy file at a small size is re-encoded at the same size", () => {
  const r = planHeroUpload({ contentType: "image/png", bytes: 3_200_000, width: 2000, height: 940 });
  assert.equal(r.ok, true);
  assert.equal(r.reencode, true);
  assert.deepEqual([r.width, r.height], [2000, 940]);
});

test("plan: never sends a file over the request limit unchanged", () => {
  // planClientDownscale re-encodes anything over 2.5 MB, so this is a
  // backstop: the plan never says „send as is“ for more than 4 MB.
  for (const bytes of [HERO_UPLOAD_MAX_BYTES, HERO_UPLOAD_MAX_BYTES + 1, 9_000_000]) {
    const r = planHeroUpload({ contentType: "image/jpeg", bytes, width: 2000, height: 940 });
    assert.equal(r.ok, true);
    assert.equal(r.reencode, true, String(bytes));
  }
});

test("downscale steps: halve while above the target, never more than 2× per step", () => {
  assert.deepEqual(downscaleSteps(3000, 1500, 3000, 1500), []);
  assert.deepEqual(downscaleSteps(2000, 1000, 2400, 1200), [], "no upscaling");
  assert.deepEqual(downscaleSteps(4000, 2000, 3072, 1536), [[3072, 1536]]);
  assert.deepEqual(downscaleSteps(8640, 5760, 3072, 2048), [
    [4320, 2880],
    [3072, 2048],
  ]);
  const steps = downscaleSteps(20000, 10000, 1000, 500);
  assert.deepEqual(steps.at(-1), [1000, 500]);
  let [w, h] = [20000, 10000];
  for (const [sw, sh] of steps) {
    assert.ok(w / sw <= 2 + 1e-9 && h / sh <= 2 + 1e-9, JSON.stringify(steps));
    [w, h] = [sw, sh];
  }
  // An exact half is one step, not two.
  assert.deepEqual(downscaleSteps(6144, 4096, 3072, 2048), [[3072, 2048]]);
});
