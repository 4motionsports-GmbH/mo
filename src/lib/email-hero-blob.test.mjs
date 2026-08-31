// Unit tests for the hero-image blob keys + the public route's validation,
// which is the boundary keeping the PRIVATE catalog blobs unreachable.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HERO_BLOB_PREFIX,
  heroBlobFileFromPathname,
  heroBlobKey,
  heroBlobPathname,
  heroImagePublicUrl,
  parseHeroBlobFile,
} from "./email-hero-blob.mjs";

test("heroBlobKey stays under the hero prefix and is a png", () => {
  const key = heroBlobKey("campaign", 42);
  assert.ok(key.startsWith(HERO_BLOB_PREFIX));
  assert.match(key, /^email-heroes\/campaign-42-\d+\.png$/);
});

test("parseHeroBlobFile accepts plain hero filenames", () => {
  assert.equal(parseHeroBlobFile("campaign-42-123.png"), "campaign-42-123.png");
  assert.equal(parseHeroBlobFile("marketing-7-9-abc123.png"), "marketing-7-9-abc123.png");
  assert.equal(parseHeroBlobFile("a.png"), "a.png");
});

test("parseHeroBlobFile refuses traversal, separators and other blobs", () => {
  for (const bad of [
    "../product-catalog.json",
    "..%2Fproduct-catalog.json",
    "%2e%2e%2fproduct-catalog.json",
    "sub/dir.png",
    "back\\slash.png",
    "..png.png/../x.png",
    "product-catalog.json",
    "hero.png.json",
    "",
    "   ",
    ".png",
    "-leading.png",
    null,
    42,
  ]) {
    assert.equal(parseHeroBlobFile(bad), null, `rejects ${String(bad)}`);
  }
});

test("parseHeroBlobFile bounds the length", () => {
  assert.equal(parseHeroBlobFile(`${"a".repeat(200)}.png`), null);
  assert.ok(parseHeroBlobFile(`${"a".repeat(100)}.png`));
});

test("pathname is always prefixed, never escapable", () => {
  const file = parseHeroBlobFile("campaign-1-2.png");
  assert.equal(heroBlobPathname(file), "email-heroes/campaign-1-2.png");
  assert.ok(heroBlobPathname(file).startsWith(HERO_BLOB_PREFIX));
});

test("file is recovered from the stored pathname", () => {
  assert.equal(heroBlobFileFromPathname("email-heroes/x-1-2-abc.png"), "x-1-2-abc.png");
  assert.equal(heroBlobFileFromPathname("x.png"), "x.png");
});

test("public URL points at the serving route and round-trips", () => {
  const url = heroImagePublicUrl("https://chat.example.de", "campaign-1-2.png");
  assert.equal(url, "https://chat.example.de/api/email-hero-image/campaign-1-2.png");
  const file = url.slice(url.lastIndexOf("/") + 1);
  assert.equal(parseHeroBlobFile(file), "campaign-1-2.png");
});
