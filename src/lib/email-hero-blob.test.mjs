// Unit tests for the hero-image blob keys + the public route's validation,
// which is the boundary keeping the PRIVATE catalog blobs unreachable.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAMPAIGN_DEFAULT_HERO_KIND,
  erasableHeroPathnames,
  isCampaignDefaultHeroFile,
  heroBlobContentType,
  HERO_BLOB_PREFIX,
  heroBlobFileFromPathname,
  heroBlobKey,
  heroBlobPathname,
  heroImagePublicUrl,
  parseHeroBlobFile,
} from "./email-hero-blob.mjs";

test("heroBlobKey carries variant and jpg extension when asked", () => {
  assert.match(heroBlobKey("campaign", 42, { ext: "jpg" }), /^email-heroes\/campaign-42-\d+\.jpg$/);
  assert.match(
    heroBlobKey("marketing", 7, { variant: "mobile", ext: "jpg" }),
    /^email-heroes\/marketing-7-\d+-mobile\.jpg$/
  );
  // Only the two known encodings — anything else falls back to png.
  assert.match(heroBlobKey("campaign", 1, { ext: "svg" }), /\.png$/);
});

test("jpeg hero files pass validation and get the right content type", () => {
  assert.equal(parseHeroBlobFile("campaign-42-123-mobile.jpg"), "campaign-42-123-mobile.jpg");
  assert.equal(parseHeroBlobFile("a.jpeg"), "a.jpeg");
  assert.equal(heroBlobContentType("campaign-42-123-mobile.jpg"), "image/jpeg");
  assert.equal(heroBlobContentType("campaign-42-123.png"), "image/png");
  assert.equal(parseHeroBlobFile("hero.jpg.json"), null);
});

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

test("heroBlobKey: a shared stamp keeps the files of one render a pair", () => {
  const stamp = 1729000000000;
  assert.equal(
    heroBlobKey(CAMPAIGN_DEFAULT_HERO_KIND, 12, { ext: "jpg", stamp }),
    "email-heroes/campaign-default-12-1729000000000.jpg"
  );
  assert.equal(
    heroBlobKey(CAMPAIGN_DEFAULT_HERO_KIND, "new", { variant: "mobile", ext: "jpg", stamp }),
    "email-heroes/campaign-default-new-1729000000000-mobile.jpg"
  );
  // Without (or with a nonsense) stamp: now.
  const before = Date.now();
  for (const opts of [{}, { stamp: -1 }, { stamp: 1.5 }, { stamp: "x" }]) {
    const t = Number(/-(\d+)\.png$/.exec(heroBlobKey("campaign", 1, opts))?.[1]);
    assert.ok(t >= before && t <= Date.now(), JSON.stringify(opts));
  }
});

test("the campaign default picture is recognised and never erased with one person", () => {
  assert.equal(CAMPAIGN_DEFAULT_HERO_KIND, "campaign-default");
  assert.equal(isCampaignDefaultHeroFile("campaign-default-12-1729000000000-AbC.jpg"), true);
  assert.equal(isCampaignDefaultHeroFile("email-heroes/campaign-default-new-1729000000000-mobile.jpg"), true);
  assert.equal(isCampaignDefaultHeroFile("campaign-12-1729000000000.jpg"), false, "per-draft hero");
  assert.equal(isCampaignDefaultHeroFile("marketing-7-1729000000000.jpg"), false);
  assert.equal(isCampaignDefaultHeroFile(null), false);

  const base = "https://mo.example";
  const perDraft = heroImagePublicUrl(base, "campaign-41-1729000000000-x1.jpg");
  const perDraftMobile = heroImagePublicUrl(base, "campaign-41-1729000000000-mobile-x2.jpg");
  const shared = heroImagePublicUrl(base, "campaign-default-3-1729000000000-y1.jpg");
  const sharedMobile = heroImagePublicUrl(base, "campaign-default-3-1729000000000-mobile-y2.jpg");
  assert.deepEqual(
    erasableHeroPathnames([perDraft, perDraftMobile, shared, sharedMobile, perDraft, null, "", `${base}/email-hero-default.jpg`]),
    ["email-heroes/campaign-41-1729000000000-x1.jpg", "email-heroes/campaign-41-1729000000000-mobile-x2.jpg"]
  );
  assert.deepEqual(erasableHeroPathnames([]), []);
});

test("heroBlobPathnameFromUrl inverts the public URL and rejects everything else", async () => {
  const { heroBlobPathnameFromUrl, heroImagePublicUrl } = await import("./email-hero-blob.mjs");
  const url = heroImagePublicUrl("https://mo.example", "marketing-12-abc.jpg");
  assert.equal(heroBlobPathnameFromUrl(url), "email-heroes/marketing-12-abc.jpg");
  assert.equal(heroBlobPathnameFromUrl(url + "?v=2"), "email-heroes/marketing-12-abc.jpg");
  assert.equal(heroBlobPathnameFromUrl("https://mo.example/email-hero-default.jpg"), null);
  assert.equal(heroBlobPathnameFromUrl("https://mo.example/api/email-hero-image/..%2Fcatalog.json"), null);
  assert.equal(heroBlobPathnameFromUrl(null), null);
});
