import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RELEASE_AHEAD_DAYS,
  approvalFingerprint,
  berlinToUtc,
  parseReleaseAt,
  releaseBlockers,
  releaseTimeOptions,
} from "./campaign-release-core.mjs";
import { campaignReleaseConfig, isCampaignReleaseEnabled } from "./campaign-flags.mjs";

test("the fingerprint changes with the draft, the language or what the campaign renders", () => {
  const campaign = { designKey: "classic", heroMode: "default", ctaKind: "shop", ctaUrl: null, moPromo: false, discountValidUntil: null };
  const base = { draftUpdatedAt: "2026-10-03T10:00:00.000Z", language: "de", campaign };
  const fp = approvalFingerprint(base);
  assert.equal(approvalFingerprint({ ...base, campaign: { ...campaign } }), fp);
  assert.notEqual(approvalFingerprint({ ...base, draftUpdatedAt: "2026-10-03T10:00:01.000Z" }), fp);
  assert.notEqual(approvalFingerprint({ ...base, language: "en" }), fp);
  assert.notEqual(approvalFingerprint({ ...base, campaign: { ...campaign, designKey: "bold" } }), fp);
  assert.notEqual(approvalFingerprint({ ...base, campaign: { ...campaign, ctaKind: "mo_chat" } }), fp);
  assert.notEqual(approvalFingerprint({ ...base, campaign: { ...campaign, discountValidUntil: "2026-11-30" } }), fp);
});

test("release blockers: a placeholder code without discount, an expired set", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  assert.deepEqual(releaseBlockers({ body: "Hallo", discountPercent: 0, now }), []);
  assert.equal(releaseBlockers({ body: "Code MO-XXXX", discountPercent: 0, now })[0].key, "placeholder_without_discount");
  assert.deepEqual(releaseBlockers({ body: "Code MO-XXXX", discountPercent: 10, now }), []);
  assert.equal(releaseBlockers({ body: "x", discountPercent: 0, bundleExpiresAt: "2026-10-03T11:59:00Z", now })[0].key, "bundle_expired");
  assert.deepEqual(releaseBlockers({ body: "x", discountPercent: 0, bundleExpiresAt: "2026-10-04T00:00:00Z", now }), []);
});

test("parseReleaseAt: empty → now, past → now, too far ahead → refused", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  assert.equal(parseReleaseAt(null, now), "2026-10-03T12:00:00.000Z");
  assert.equal(parseReleaseAt("nonsense", now), "2026-10-03T12:00:00.000Z");
  assert.equal(parseReleaseAt("2026-10-01T00:00:00Z", now), "2026-10-03T12:00:00.000Z");
  assert.equal(parseReleaseAt("2026-10-04T07:00:00Z", now), "2026-10-04T07:00:00.000Z");
  assert.equal(parseReleaseAt(new Date(now + (MAX_RELEASE_AHEAD_DAYS + 1) * 86_400_000).toISOString(), now), null);
});

test("Berlin wall time → UTC across summer and winter time", () => {
  assert.equal(berlinToUtc(2026, 10, 3, 9).toISOString(), "2026-10-03T07:00:00.000Z"); // CEST
  assert.equal(berlinToUtc(2026, 11, 27, 9).toISOString(), "2026-11-27T08:00:00.000Z"); // CET
  assert.equal(berlinToUtc(2026, 10, 25, 18).toISOString(), "2026-10-25T17:00:00.000Z"); // switch day, after
});

test("release time options: today 18:00 only while ahead, tomorrow in Berlin", () => {
  const morning = releaseTimeOptions(Date.parse("2026-10-03T07:30:00Z")); // 09:30 Berlin
  assert.deepEqual(morning.map((o) => o.key), ["now", "today18", "tomorrow9", "tomorrow18"]);
  assert.equal(morning.find((o) => o.key === "today18").releaseAt, "2026-10-03T16:00:00.000Z");
  assert.equal(morning.find((o) => o.key === "tomorrow9").releaseAt, "2026-10-04T07:00:00.000Z");
  const evening = releaseTimeOptions(Date.parse("2026-10-03T16:50:00Z")); // 18:50 Berlin
  assert.deepEqual(evening.map((o) => o.key), ["now", "tomorrow9", "tomorrow18"]);
  // Late night UTC is already the next day in Berlin.
  const night = releaseTimeOptions(Date.parse("2026-10-03T22:30:00Z")); // 00:30 Berlin on the 4th
  assert.equal(night.find((o) => o.key === "tomorrow9").releaseAt, "2026-10-05T07:00:00.000Z");
});

test("release flags: off by default, pace clamped", () => {
  assert.equal(isCampaignReleaseEnabled({}), false);
  assert.equal(isCampaignReleaseEnabled({ CAMPAIGN_RELEASE_ENABLED: "true" }), true);
  assert.deepEqual(campaignReleaseConfig({}), { maxPerRun: 30, spacingMs: 1500 });
  assert.deepEqual(campaignReleaseConfig({ CAMPAIGN_RELEASE_MAX_PER_RUN: "999", CAMPAIGN_RELEASE_SPACING_MS: "10" }), { maxPerRun: 200, spacingMs: 500 });
  assert.deepEqual(campaignReleaseConfig({ CAMPAIGN_RELEASE_MAX_PER_RUN: "0" }), { maxPerRun: 30, spacingMs: 1500 });
});
