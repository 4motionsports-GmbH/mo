import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkHeroUploadImage,
  checkHeroUploadRequest,
  CLIENT_MAX_LONG_SIDE,
  HERO_UPLOAD_CONTENT_TYPES,
  HERO_UPLOAD_FORMATS,
  HERO_UPLOAD_MAX_BYTES,
  HERO_UPLOAD_MAX_PIXELS,
  HERO_UPLOAD_MESSAGES,
  HERO_UPLOAD_MIN,
  HERO_UPLOAD_RECOMMENDED,
  heroUploadError,
  parseHeroOrigin,
  planClientDownscale,
  sanitizeUploadName,
} from "./email-hero-upload.mjs";
import { HERO_IMAGE_HEIGHT, HERO_IMAGE_WIDTH, heroAspectCrop } from "./email-hero-geometry.mjs";
import { CORS_SAFELISTED_CONTENT_TYPES } from "./admin-content-type.mjs";

test("limits fit the platform and the hero", () => {
  assert.ok(HERO_UPLOAD_MAX_BYTES < 4.5 * 1024 * 1024, "under Vercel's 4.5 MB request cap");
  assert.equal(HERO_UPLOAD_MIN.width, 2 * 640, "2× the desktop hero width");
  assert.equal(HERO_UPLOAD_MIN.height, 2 * 300);
  assert.deepEqual({ ...HERO_UPLOAD_RECOMMENDED }, { width: HERO_IMAGE_WIDTH, height: HERO_IMAGE_HEIGHT });
  // The accepted request types must all need a CORS preflight (CSRF).
  for (const t of HERO_UPLOAD_CONTENT_TYPES) assert.ok(!CORS_SAFELISTED_CONTENT_TYPES.includes(t), t);
  assert.deepEqual([...HERO_UPLOAD_FORMATS], ["jpeg", "png", "webp"]);
});

test("request check: absent length passes, empty and oversized are refused", () => {
  assert.deepEqual(checkHeroUploadRequest({ contentLength: null }), { ok: true });
  assert.deepEqual(checkHeroUploadRequest({}), { ok: true });
  assert.deepEqual(checkHeroUploadRequest({ contentLength: "abc" }), { ok: true }, "unparsable: checked after reading");
  assert.deepEqual(checkHeroUploadRequest({ contentLength: "1200000" }), { ok: true });
  assert.deepEqual(checkHeroUploadRequest({ contentLength: HERO_UPLOAD_MAX_BYTES }), { ok: true });
  const big = checkHeroUploadRequest({ contentLength: String(HERO_UPLOAD_MAX_BYTES + 1) });
  assert.equal(big.ok, false);
  assert.equal(big.code, "too_large");
  assert.equal(big.status, 413);
  assert.equal(big.message, "Datei zu groß (max. 4 MB).");
  const empty = checkHeroUploadRequest({ contentLength: 0 });
  assert.equal(empty.code, "empty");
  assert.equal(empty.status, 400);
});

test("image check: only JPEG, PNG and WebP — SVG, GIF, HEIF, TIFF are refused", () => {
  for (const format of ["svg", "gif", "heif", "tiff", "avif", "raw", "", null, undefined]) {
    const r = checkHeroUploadImage({ format, width: 3000, height: 1500, pages: 1 });
    assert.equal(r.ok, false, String(format));
    assert.equal(r.code, "format");
    assert.equal(r.status, 415);
    assert.match(r.message, /JPG, PNG oder WebP/);
    assert.match(r.message, /HEIC/);
  }
  for (const format of ["jpeg", "png", "webp", "JPEG"]) {
    assert.equal(checkHeroUploadImage({ format, width: 3000, height: 1500 }).ok, true, format);
  }
});

test("image check: animated pictures and pixel bombs are refused", () => {
  const anim = checkHeroUploadImage({ format: "webp", width: 3000, height: 1500, pages: 12 });
  assert.equal(anim.code, "animated");
  const bomb = checkHeroUploadImage({ format: "png", width: 10000, height: 4001 });
  assert.equal(bomb.code, "too_many_pixels");
  assert.equal(bomb.status, 413);
  assert.ok(10000 * 4000 <= HERO_UPLOAD_MAX_PIXELS);
  assert.equal(checkHeroUploadImage({ format: "png", width: 10000, height: 4000 }).ok, true);
  assert.equal(checkHeroUploadImage({ format: "png", width: 0, height: 100 }).code, "unreadable");
});

test("image check: the minimum applies to the CROP — tall, wide and panorama", () => {
  // Exactly the minimum in the hero ratio.
  const exact = checkHeroUploadImage({ format: "jpeg", width: 1280, height: 600 });
  assert.equal(exact.ok, true);
  assert.deepEqual(exact.crop, { left: 0, top: 0, width: 1280, height: 600 });
  // Tall (portrait phone photo, oriented): the full width is the crop width.
  const tallOk = checkHeroUploadImage({ format: "jpeg", width: 1280, height: 4000 });
  assert.equal(tallOk.ok, true);
  const tallSmall = checkHeroUploadImage({ format: "jpeg", width: 1279, height: 4000 });
  assert.equal(tallSmall.code, "too_small");
  assert.equal(tallSmall.message, "Bild zu klein: nach dem Zuschnitt mindestens 1280 × 600 px (dieses: 1279 × 600).");
  // Wide: the height decides — 599 high gives a 1278-wide crop.
  const wideSmall = checkHeroUploadImage({ format: "png", width: 5000, height: 599 });
  assert.equal(wideSmall.code, "too_small");
  assert.equal(checkHeroUploadImage({ format: "png", width: 5000, height: 600 }).ok, true);
  // A 6:1 panorama keeps its right-hand band.
  const pano = checkHeroUploadImage({ format: "jpeg", width: 6000, height: 1000 });
  assert.equal(pano.ok, true);
  assert.equal(pano.crop.height, 1000);
  assert.equal(pano.crop.left + pano.crop.width, 6000, "right-anchored");
  // A typical 3:2 phone photo.
  const small32 = checkHeroUploadImage({ format: "jpeg", width: 1200, height: 800 });
  assert.equal(small32.code, "too_small");
  assert.match(small32.message, /dieses: 1200 × 563/);
});

test("image check: warnings for upscaling and a cropped ratio, in German", () => {
  const native = checkHeroUploadImage({ format: "jpeg", width: 1536, height: 720 });
  assert.deepEqual(native.warnings, []);
  assert.deepEqual(native.warningCodes, []);
  const up = checkHeroUploadImage({ format: "jpeg", width: 1400, height: 656 });
  assert.deepEqual(up.warningCodes, ["upscaled"]);
  assert.deepEqual(up.warnings, [HERO_UPLOAD_MESSAGES.upscaled]);
  const photo = checkHeroUploadImage({ format: "jpeg", width: 4000, height: 3000 });
  assert.deepEqual(photo.warningCodes, ["cropped"]);
  assert.deepEqual(photo.warnings, [HERO_UPLOAD_MESSAGES.cropped]);
  const both = checkHeroUploadImage({ format: "jpeg", width: 1300, height: 975 });
  assert.deepEqual(both.warningCodes, ["upscaled", "cropped"]);
  // Within 10 % of 2.133:1 is not "cropped".
  assert.deepEqual(checkHeroUploadImage({ format: "jpeg", width: 2000, height: 1000 }).warningCodes, []);
  assert.deepEqual(checkHeroUploadImage({ format: "jpeg", width: 2000, height: 1150 }).warningCodes, ["cropped"]);
});

test("client downscale: small files untouched, big photos to 3072, panoramas keep the stored width", () => {
  assert.deepEqual(planClientDownscale({ bytes: 900_000, width: 2400, height: 1600 }), {
    reencode: false,
    width: 2400,
    height: 1600,
  });
  assert.deepEqual(planClientDownscale({ bytes: 6_000_000, width: 6000, height: 4000 }), {
    reencode: true,
    width: 3072,
    height: 2048,
  });
  // Re-encode for size alone keeps the dimensions.
  assert.deepEqual(planClientDownscale({ bytes: 3_000_000, width: 2000, height: 1000 }), {
    reencode: true,
    width: 2000,
    height: 1000,
  });
  // A 6:1 panorama: scaling the long side to 3072 would leave a 512-high crop;
  // the plan stops where the crop is still 1536 wide.
  const pano = planClientDownscale({ bytes: 5_000_000, width: 12000, height: 2000 });
  assert.equal(pano.reencode, true);
  assert.ok(Math.max(pano.width, pano.height) > CLIENT_MAX_LONG_SIDE, "the long-side cap yields to the crop");
  const crop = heroAspectCrop(pano.width, pano.height);
  assert.ok(crop.width >= HERO_UPLOAD_RECOMMENDED.width, JSON.stringify({ pano, crop }));
  assert.equal(checkHeroUploadImage({ format: "jpeg", ...pano }).ok, true);
  // A portrait phone photo (oriented 3000×4000).
  const portrait = planClientDownscale({ bytes: 4_500_000, width: 3000, height: 4000 });
  assert.deepEqual(portrait, { reencode: true, width: 2304, height: 3072 });
});

test("origin: only an explicit statement counts", () => {
  for (const v of ["1", "true", "ai", " AI ", true]) assert.equal(parseHeroOrigin(v), true, String(v));
  for (const v of ["0", "false", "photo", false]) assert.equal(parseHeroOrigin(v), false, String(v));
  for (const v of [null, undefined, "", "yes", "2", 1, 0]) assert.equal(parseHeroOrigin(v), null, String(v));
});

test("upload name: basename, no control characters, bounded", () => {
  assert.equal(sanitizeUploadName("Sommer-Rack.jpg"), "Sommer-Rack.jpg");
  assert.equal(sanitizeUploadName("C:\\fakepath\\bild.png"), "bild.png");
  assert.equal(sanitizeUploadName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeUploadName("a\u0000b\nc.jpg"), "abc.jpg");
  assert.equal(sanitizeUploadName("  viel   Platz  .jpg "), "viel Platz .jpg");
  assert.equal(sanitizeUploadName("x".repeat(300)).length, 120);
  for (const v of ["", "   ", "dir/", null, 42, {}]) assert.equal(sanitizeUploadName(v), null, String(v));
});

test("errors carry code, status and the German text", () => {
  assert.deepEqual(heroUploadError("not_configured"), {
    ok: false,
    code: "not_configured",
    status: 503,
    message: "Bild-Upload ist nicht eingerichtet (BLOB_READ_WRITE_TOKEN fehlt).",
  });
  assert.equal(heroUploadError("storage_failed").status, 502);
  assert.equal(heroUploadError("origin_required").message, "Bitte angeben, ob das Bild KI-generiert ist.");
  assert.equal(heroUploadError("unreadable").message, "Bild konnte nicht gelesen werden (beschädigt oder kein Bild).");
});
