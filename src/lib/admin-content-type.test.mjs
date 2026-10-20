import { test } from "node:test";
import assert from "node:assert/strict";
import { CORS_SAFELISTED_CONTENT_TYPES, isAcceptedAdminContentType, mediaTypeOf } from "./admin-content-type.mjs";

const IMAGES = ["image/jpeg", "image/png", "image/webp"];

test("default: exactly application/json (parameters allowed)", () => {
  assert.equal(isAcceptedAdminContentType("application/json"), true);
  assert.equal(isAcceptedAdminContentType("application/json; charset=utf-8"), true);
  assert.equal(isAcceptedAdminContentType("Application/JSON"), true);
  assert.equal(isAcceptedAdminContentType(""), false);
  assert.equal(isAcceptedAdminContentType(null), false);
  assert.equal(isAcceptedAdminContentType(undefined), false);
  assert.equal(isAcceptedAdminContentType("image/jpeg"), false);
  assert.equal(isAcceptedAdminContentType("multipart/form-data; boundary=x"), false);
  assert.equal(isAcceptedAdminContentType("application/x-www-form-urlencoded"), false);
  assert.equal(isAcceptedAdminContentType("text/plain"), false);
  // The old "contains application/json" rule let these through — all are
  // CORS-safelisted or not JSON, so a storefront script could send them
  // without a preflight (20.10.2026).
  assert.equal(isAcceptedAdminContentType("text/plain; charset=application/json"), false);
  assert.equal(isAcceptedAdminContentType("text/plain; x=application/json"), false);
  assert.equal(isAcceptedAdminContentType("application/jsonx"), false);
  assert.equal(isAcceptedAdminContentType("application/json-patch+json"), false);
  // An explicit null/undefined list is the default, not "accept nothing".
  assert.equal(isAcceptedAdminContentType("application/json", null), true);
});

test("accept: the media type must match an entry exactly, parameters allowed", () => {
  assert.equal(isAcceptedAdminContentType("image/jpeg", IMAGES), true);
  assert.equal(isAcceptedAdminContentType("image/png", IMAGES), true);
  assert.equal(isAcceptedAdminContentType("IMAGE/WEBP", IMAGES), true);
  assert.equal(isAcceptedAdminContentType("image/jpeg; x=y", IMAGES), true);
  assert.equal(isAcceptedAdminContentType(" image/jpeg ;q=1", IMAGES), true);
  for (const bad of ["image/jpegx", "image/jpe", "ximage/jpeg", "image/svg+xml", "image/gif", "image/heic",
    "image/jpeg, text/plain", "application/json", "", null]) {
    assert.equal(isAcceptedAdminContentType(bad, IMAGES), false, String(bad));
  }
});

test("accept: CORS-safelisted types are refused even when a caller lists them", () => {
  assert.deepEqual([...CORS_SAFELISTED_CONTENT_TYPES].sort(), [
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "text/plain",
  ]);
  const careless = [...IMAGES, ...CORS_SAFELISTED_CONTENT_TYPES];
  for (const t of [
    "text/plain",
    "text/plain; charset=utf-8",
    "multipart/form-data; boundary=----x",
    "application/x-www-form-urlencoded",
    "TEXT/PLAIN",
  ]) {
    assert.equal(isAcceptedAdminContentType(t, careless), false, t);
  }
  assert.equal(isAcceptedAdminContentType("image/png", careless), true);
  // An empty list accepts nothing.
  assert.equal(isAcceptedAdminContentType("image/png", []), false);
});

test("mediaTypeOf strips parameters and case", () => {
  assert.equal(mediaTypeOf("Image/JPEG; foo=bar"), "image/jpeg");
  assert.equal(mediaTypeOf(null), "");
  assert.equal(mediaTypeOf("  text/plain  "), "text/plain");
});
