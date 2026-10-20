import { test } from "node:test";
import assert from "node:assert/strict";
import {
  campaignHeroFileOk,
  campaignHeroUrls,
  heroAiLabel,
  heroVariantForSnapshot,
  normalizeCampaignHeroImage,
  parseCampaignHeroFile,
  resolveCampaignHero,
} from "./campaign-hero.mjs";
import { HERO_MODES } from "./campaign-def.mjs";
import { CAMPAIGN_DEFAULT_HERO_KIND, heroBlobFileFromPathname, heroBlobKey, parseHeroBlobFile } from "./email-hero-blob.mjs";

// The blob SDK appends "-<random>" before the extension (addRandomSuffix):
// Vercel's documented shape is 30 alphanumerics, e.g.
// "user-12345-NoOVGDVcqSPc7VYCUAGnTzLTG2qEM2.txt".
const RND = "NoOVGDVcqSPc7VYCUAGnTzLTG2qEM2";
const STAMP = 1729000000000;

/** What the SDK makes of heroBlobKey(...) — the file part of blob.pathname. */
function stored(owner, variant) {
  const key = heroBlobKey(CAMPAIGN_DEFAULT_HERO_KIND, owner, { ext: "jpg", stamp: STAMP, ...(variant ? { variant } : {}) });
  return heroBlobFileFromPathname(key.replace(/\.jpg$/, `-${RND}.jpg`));
}

const DESKTOP = stored(7);
const MOBILE = stored(7, "mobile");
const VALID = {
  v: 1,
  file: DESKTOP,
  mobileFile: MOBILE,
  ai: false,
  name: "Sommer.jpg",
  width: 4032,
  height: 3024,
  uploadedAt: "2026-10-20T08:15:00.000Z",
};

test("file names: the upload's own names pass, with and without the random suffix", () => {
  assert.equal(DESKTOP, `campaign-default-7-${STAMP}-${RND}.jpg`);
  assert.equal(MOBILE, `campaign-default-7-${STAMP}-mobile-${RND}.jpg`);
  assert.equal(parseHeroBlobFile(DESKTOP), DESKTOP, "servable by /api/email-hero-image");
  assert.equal(campaignHeroFileOk(DESKTOP, "desktop"), true);
  assert.equal(campaignHeroFileOk(MOBILE, "mobile"), true);
  assert.equal(campaignHeroFileOk(MOBILE, "desktop"), false, "desktop must not carry -mobile");
  assert.equal(campaignHeroFileOk(DESKTOP, "mobile"), false, "mobile must carry -mobile");
  assert.equal(campaignHeroFileOk(stored("new"), "desktop"), true, "uploaded before the first save");
  assert.equal(campaignHeroFileOk(`campaign-default-7-${STAMP}.jpg`, "desktop"), true, "no suffix");
  assert.deepEqual(parseCampaignHeroFile(MOBILE), { owner: "7", stamp: String(STAMP), mobile: true });
});

test("file names: everything that is not a Kampagnenbild is refused", () => {
  for (const bad of [
    `campaign-7-${STAMP}-${RND}.jpg`, // per-draft hero of contact 7
    `marketing-7-${STAMP}.jpg`,
    `campaign-default-7-${STAMP}-${RND}.png`,
    `campaign-default-7-${STAMP}-${RND}.jpeg`,
    `campaign-default-x-${STAMP}.jpg`,
    `campaign-default-7-172900000000.jpg`, // 12-digit stamp
    `campaign-default-7-${STAMP}-a_b.jpg`,
    `campaign-default-7-${STAMP}-${"a".repeat(65)}.jpg`,
    `../campaign-default-7-${STAMP}.jpg`,
    `campaign-default-7-${STAMP}%2F.jpg`,
    `campaign%2Ddefault-7-${STAMP}.jpg`,
    `https://evil.example/campaign-default-7-${STAMP}.jpg`,
    `/api/email-hero-image/campaign-default-7-${STAMP}.jpg`,
    "",
    null,
    42,
  ]) {
    assert.equal(campaignHeroFileOk(bad, "desktop"), false, String(bad));
    assert.equal(campaignHeroFileOk(bad, "mobile"), false, String(bad));
  }
});

test("normalize: a valid value passes and is returned clean", () => {
  assert.deepEqual(normalizeCampaignHeroImage(VALID), VALID);
  assert.deepEqual(normalizeCampaignHeroImage({ ...VALID, ai: true }).ai, true);
  // v may be absent (it is always written as 1).
  const { v: _v, ...noV } = VALID;
  void _v;
  assert.deepEqual(normalizeCampaignHeroImage(noV), VALID);
  // Unknown keys are dropped.
  const extra = normalizeCampaignHeroImage({ ...VALID, url: "https://evil.example/x.jpg", admin: true });
  assert.deepEqual(Object.keys(extra).sort(), Object.keys(VALID).sort());
});

test("normalize: display fields are bounded, never fatal", () => {
  const n = normalizeCampaignHeroImage({
    ...VALID,
    name: "C:\\Users\\me\\Bilder\\" + "x".repeat(200),
    width: 0,
    height: 1.5,
    uploadedAt: "gestern",
  });
  assert.equal(n.name.length, 120);
  assert.ok(!/[/\\]/.test(n.name));
  assert.equal(n.width, null);
  assert.equal(n.height, null);
  assert.equal(n.uploadedAt, null);
  assert.equal(normalizeCampaignHeroImage({ ...VALID, width: 20_001 }).width, null);
  assert.equal(normalizeCampaignHeroImage({ ...VALID, name: 7 }).name, null);
  assert.equal(normalizeCampaignHeroImage({ ...VALID, uploadedAt: "2026-10-20T10:15:00+02:00" }).uploadedAt, "2026-10-20T08:15:00.000Z");
});

test("normalize: foreign URLs, traversal, per-draft files, mixed pairs and a missing AI statement are refused", () => {
  const refused = [
    { ...VALID, file: `https://evil.example/${DESKTOP}` },
    { ...VALID, file: `../../catalog/${DESKTOP}` },
    { ...VALID, file: `campaign-123-${STAMP}-${RND}.jpg`, mobileFile: `campaign-123-${STAMP}-mobile-${RND}.jpg` },
    { ...VALID, file: MOBILE },
    { ...VALID, mobileFile: DESKTOP },
    { ...VALID, mobileFile: stored(8, "mobile") }, // another campaign's phone crop
    { ...VALID, mobileFile: `campaign-default-7-${STAMP + 1}-mobile-${RND}.jpg` }, // another upload
    { ...VALID, mobileFile: undefined },
    { ...VALID, ai: undefined },
    { ...VALID, ai: "false" },
    { ...VALID, ai: 0 },
    { ...VALID, v: 2 },
    null,
    undefined,
    "campaign-default-7.jpg",
    [VALID],
    42,
  ];
  for (const r of refused) assert.equal(normalizeCampaignHeroImage(r), null, JSON.stringify(r));
});

test("URLs: built on the given host from the file names; relative for the admin", () => {
  assert.deepEqual(campaignHeroUrls(VALID, "https://mo.example"), {
    desktop: `https://mo.example/api/email-hero-image/${DESKTOP}`,
    mobile: `https://mo.example/api/email-hero-image/${MOBILE}`,
  });
  assert.deepEqual(campaignHeroUrls(VALID, "https://mo.example/"), campaignHeroUrls(VALID, "https://mo.example"));
  assert.deepEqual(campaignHeroUrls(VALID, ""), {
    desktop: `/api/email-hero-image/${DESKTOP}`,
    mobile: `/api/email-hero-image/${MOBILE}`,
  });
  assert.equal(campaignHeroUrls(null, "https://mo.example"), null);
  assert.equal(campaignHeroUrls({ ...VALID, file: "https://evil.example/x.jpg" }, "https://mo.example"), null);
});

// ── Precedence matrix ─────────────────────────────────────────────────────────

const BASE = "https://mo.example";
const DRAFTS = {
  none: null,
  full: { heroImageUrl: `${BASE}/api/email-hero-image/campaign-41-1-a.jpg`, heroImageMobileUrl: `${BASE}/api/email-hero-image/campaign-41-1-mobile-b.jpg`, heroHeadline: "Dein Rack." },
  noMobile: { heroImageUrl: `${BASE}/api/email-hero-image/campaign-41-0.png`, heroImageMobileUrl: null, heroHeadline: "Alt." },
  headlineOnly: { heroImageUrl: null, heroImageMobileUrl: null, heroHeadline: "Nur Text." },
};
const CAMPAIGN = { yes: { ...VALID, ai: false }, no: null };
const urls = campaignHeroUrls(VALID, BASE);

for (const heroMode of HERO_MODES) {
  for (const [draftName, draft] of Object.entries(DRAFTS)) {
    for (const [campaignName, campaignHero] of Object.entries(CAMPAIGN)) {
      test(`resolve: mode ${heroMode} · draft ${draftName} · Kampagnenbild ${campaignName}`, () => {
        const r = resolveCampaignHero({ heroMode, draft, campaignHero, baseUrl: BASE });
        const usesDraft = heroMode !== "none" && draft;
        const { heroImageUrl, heroImageMobileUrl, heroHeadline, heroIsAiGenerated } = r.render;

        // The headline is the draft's unless the mode is 'none' — whatever the picture.
        assert.equal(heroHeadline, usesDraft ? draft.heroHeadline : null);

        if (usesDraft && draft.heroImageUrl) {
          assert.equal(r.source, "ai");
          assert.equal(heroImageUrl, draft.heroImageUrl);
          // The phone picture comes from the SAME source — a draft without a
          // phone crop falls back to its own desktop file, never the campaign's.
          assert.equal(heroImageMobileUrl, draft.heroImageMobileUrl || draft.heroImageUrl);
          assert.equal(heroIsAiGenerated, true);
          assert.equal(r.snapshotImageUrl, draft.heroImageUrl);
        } else if (campaignHero) {
          // 'none' drops the draft but keeps the Kampagnenbild.
          assert.equal(r.source, "campaign");
          assert.deepEqual([heroImageUrl, heroImageMobileUrl], [urls.desktop, urls.mobile]);
          assert.equal(heroIsAiGenerated, false);
          assert.equal(r.snapshotImageUrl, null, "the shared picture is never copied into per-person rows");
        } else {
          assert.equal(r.source, "default");
          assert.deepEqual([heroImageUrl, heroImageMobileUrl], [null, null]);
          assert.equal(r.snapshotImageUrl, null);
        }
        // A pair never mixes sources.
        const campaignFiles = [urls.desktop, urls.mobile];
        assert.equal(campaignFiles.includes(heroImageUrl), campaignFiles.includes(heroImageMobileUrl));
        if (r.source !== "ai") assert.notEqual(r.snapshotImageUrl, heroImageUrl ?? "x");
      });
    }
  }
}

test("resolve: the Kampagnenbild's AI statement reaches the render data", () => {
  const r = resolveCampaignHero({ heroMode: "ai_ab", draft: null, campaignHero: { ...VALID, ai: true }, baseUrl: BASE });
  assert.equal(r.render.heroIsAiGenerated, true);
  // An invalid stored value falls back to the default — never a foreign URL.
  const bad = resolveCampaignHero({ heroMode: "default", draft: null, campaignHero: { ...VALID, file: "https://evil.example/x.jpg" }, baseUrl: BASE });
  assert.equal(bad.source, "default");
  assert.equal(bad.render.heroImageUrl, null);
  // No arguments at all: the default, nothing thrown.
  assert.equal(resolveCampaignHero({}).source, "default");
  // The sample render (no draft, mode "default") shows the Kampagnenbild.
  assert.equal(resolveCampaignHero({ heroMode: "default", draft: null, campaignHero: VALID, baseUrl: BASE }).render.heroImageUrl, urls.desktop);
});

test("snapshot variant: what the reader saw", () => {
  const v = (source, designHasHero, hasDesign) => heroVariantForSnapshot({ source, designHasHero, hasDesign });
  assert.equal(v("ai", true, true), "ai");
  assert.equal(v("ai", false, false), "ai");
  assert.equal(v("campaign", true, true), "campaign");
  assert.equal(v("campaign", false, true), "default", "Studio: no hero, the picture was invisible");
  assert.equal(v("campaign", false, false), "none", "classic");
  assert.equal(v("default", true, true), "default");
  assert.equal(v("default", false, true), "default");
  assert.equal(v("default", false, false), "none");
});

test("EU label: fails toward the label; only an uploaded photo declared not AI drops it", () => {
  assert.equal(heroAiLabel({ heroImageUrl: "u" }, false), true, "absent → a per-draft AI hero");
  assert.equal(heroAiLabel({ heroImageUrl: "u", heroIsAiGenerated: null }, false), true);
  assert.equal(heroAiLabel({ heroImageUrl: "u", heroIsAiGenerated: undefined }, false), true);
  assert.equal(heroAiLabel({ heroImageUrl: "u", heroIsAiGenerated: true }, false), true);
  assert.equal(heroAiLabel({ heroImageUrl: "u", heroIsAiGenerated: false }, true), false);
  // No picture in the render data: the design's default asset decides.
  assert.equal(heroAiLabel({ heroImageUrl: null, heroIsAiGenerated: false }, true), true);
  assert.equal(heroAiLabel({}, true), true);
  assert.equal(heroAiLabel({}, false), false);
  assert.equal(heroAiLabel(undefined, true), true);
  assert.equal(heroAiLabel(null, false), false);
});
