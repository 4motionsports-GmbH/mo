import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LARGE_UPLOAD_FROM_BYTES,
  LARGE_UPLOAD_MAX_BYTES,
  LARGE_UPLOAD_STALE_MS,
  isLargeUploadPathname,
  largeUploadPathname,
  largeUploadRoute,
  staleLargeUploads,
} from "./large-upload.mjs";

const UUID = "3f2b8c1e-9d4a-4e7b-8f60-1a2b3c4d5e6f";

test("largeUploadPathname: the temporary name per type; nothing for other types or short ids", () => {
  assert.equal(largeUploadPathname(UUID, "image/gif"), `template-upload-tmp/${UUID}.gif`);
  assert.equal(largeUploadPathname(UUID, "image/jpeg"), `template-upload-tmp/${UUID}.jpg`);
  assert.equal(largeUploadPathname(UUID, "IMAGE/PNG"), `template-upload-tmp/${UUID}.png`);
  assert.equal(largeUploadPathname(UUID, "image/webp"), `template-upload-tmp/${UUID}.webp`);
  assert.equal(largeUploadPathname(UUID, "image/svg+xml"), null);
  assert.equal(largeUploadPathname(UUID, "application/pdf"), null);
  assert.equal(largeUploadPathname("abc", "image/gif"), null);
  // anything but letters, digits and hyphens is dropped — no way out of the folder
  assert.equal(largeUploadPathname("../../email-heroes/x1234567", "image/gif"), "template-upload-tmp/email-heroesx1234567.gif");
});

test("isLargeUploadPathname: only temporary uploads — as asked for and as stored with the Blob suffix", () => {
  assert.equal(isLargeUploadPathname(`template-upload-tmp/${UUID}.gif`), true);
  assert.equal(isLargeUploadPathname(`template-upload-tmp/${UUID}-oYnXSVczoLDtW6cuKQWqXaS7DBeHyc.gif`), true);
  assert.equal(isLargeUploadPathname(largeUploadPathname(UUID, "image/png")), true);
  for (const bad of [
    "email-heroes/template-123-abc.gif",
    "gift-vouchers/abc.pdf",
    `template-upload-tmp/../email-heroes/${UUID}.gif`,
    `template-upload-tmp/sub/${UUID}.gif`,
    `template-upload-tmp/${UUID}.pdf`,
    `template-upload-tmp/${UUID}.gif?x=1`,
    "template-upload-tmp/short.gif",
    `/template-upload-tmp/${UUID}.gif`,
    `https://store.private.blob.vercel-storage.com/template-upload-tmp/${UUID}.gif`,
    null,
    42,
  ]) {
    assert.equal(isLargeUploadPathname(bad), false, String(bad));
  }
});

test("largeUploadRoute: up to 4 MB the normal upload, up to 25 MB straight to the Blob store, else a German refusal", () => {
  assert.deepEqual(largeUploadRoute(LARGE_UPLOAD_FROM_BYTES, "image/gif"), { route: "normal" });
  assert.deepEqual(largeUploadRoute(900_000, "image/jpeg"), { route: "normal" });
  assert.deepEqual(largeUploadRoute(11_500_000, "image/gif"), { route: "large" });
  assert.deepEqual(largeUploadRoute(LARGE_UPLOAD_MAX_BYTES, "image/jpeg"), { route: "large" });
  assert.deepEqual(largeUploadRoute(LARGE_UPLOAD_MAX_BYTES + 1, "image/gif"), {
    route: "refuse",
    message: "Höchstens 25 MB — das GIF bitte kürzer, schmaler oder mit weniger Einzelbildern exportieren.",
  });
  assert.deepEqual(largeUploadRoute(30_000_000, "image/png"), { route: "refuse", message: "Höchstens 25 MB — bitte verkleinern." });
  assert.deepEqual(largeUploadRoute(5_000_000, "image/heic"), { route: "refuse", message: "Höchstens 4 MB — bitte verkleinern." });
});

test("staleLargeUploads: temporary files older than an hour, nothing else", () => {
  const now = Date.parse("2026-11-26T18:00:00Z");
  const old = new Date(now - LARGE_UPLOAD_STALE_MS - 1000);
  const fresh = new Date(now - 60_000);
  const blobs = [
    { pathname: `template-upload-tmp/${UUID}-a1.gif`, url: "u1", uploadedAt: old },
    { pathname: `template-upload-tmp/${UUID}-a2.gif`, url: "u2", uploadedAt: fresh },
    { pathname: "email-heroes/template-1-x.gif", url: "u3", uploadedAt: old },
    { pathname: `template-upload-tmp/${UUID}-a4.jpg`, url: "u4", uploadedAt: old.toISOString() },
  ];
  assert.deepEqual(staleLargeUploads(blobs, now), ["u1", "u4"]);
  assert.deepEqual(staleLargeUploads([], now), []);
});
