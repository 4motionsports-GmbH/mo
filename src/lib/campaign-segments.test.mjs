import { strict as assert } from "node:assert";
import test from "node:test";
import {
  CAMPAIGN_SEGMENTS,
  CAMPAIGN_SEGMENT_KEYS,
  CONTENT_TIERS,
  RECOMMENDATION_STRATEGIES,
  campaignQueuePriority,
  campaignSegmentByKey,
  contentTierForAnchor,
  daysSince,
  resolveCampaignSegment,
} from "./campaign-segments.mjs";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const seg = (days, anchorEur) =>
  resolveCampaignSegment({ lastOrderAt: daysAgo(days), anchorEur, now: NOW });

test("the two content tiers split at the measured 150 € boundary", () => {
  assert.equal(contentTierForAnchor(149.99), CONTENT_TIERS.KLEIN);
  assert.equal(contentTierForAnchor(150), CONTENT_TIERS.GROSS);
  // The analysis' komponente and grossgeraet MERGE into one content tier.
  assert.equal(contentTierForAnchor(700), CONTENT_TIERS.GROSS);
  assert.equal(contentTierForAnchor(5000), CONTENT_TIERS.GROSS);
});

test("an unknown anchor value yields no tier — never a guessed one", () => {
  for (const bad of [null, undefined, NaN, -1, "150"]) {
    assert.equal(contentTierForAnchor(bad), null);
  }
});

test("segments map days-since-purchase to the measured windows", () => {
  assert.equal(seg(2, 700).key, "frisch");
  assert.equal(seg(14, 700).key, "ausbauen_frueh");
  assert.equal(seg(60, 700).key, "ausbauen");
  assert.equal(seg(200, 700).key, "weiterentwickeln");
  assert.equal(seg(500, 700).key, "zurueckholen");
  assert.equal(seg(900, 700).key, "ruhen");
});

test("boundaries are exclusive at the top, so no day falls in two segments", () => {
  assert.equal(seg(6.9, 700).key, "frisch");
  assert.equal(seg(7, 700).key, "ausbauen_frueh");
  assert.equal(seg(29.9, 700).key, "ausbauen_frueh");
  assert.equal(seg(30, 700).key, "ausbauen");
  assert.equal(seg(89.9, 700).key, "ausbauen");
  assert.equal(seg(90, 700).key, "weiterentwickeln");
  assert.equal(seg(364.9, 700).key, "weiterentwickeln");
  assert.equal(seg(365, 700).key, "zurueckholen");
  assert.equal(seg(729.9, 700).key, "zurueckholen");
  assert.equal(seg(730, 700).key, "ruhen");
});

// THE finding that shapes the whole feature: timing is identical across value
// tiers, only the CONTENT differs.
test("the same day count yields the same segment regardless of purchase value", () => {
  for (const days of [14, 60, 200, 500, 900]) {
    assert.equal(
      seg(days, 40).key,
      seg(days, 5000).key,
      `day ${days} must not depend on value`
    );
  }
});

test("above 150 € accessories stay the pick for a full year; below they do not", () => {
  const C = RECOMMENDATION_STRATEGIES.COMPLEMENT;
  const S = RECOMMENDATION_STRATEGIES.SIMILARITY;
  // Early and mid windows: both tiers get accessories.
  assert.equal(seg(14, 40).strategy, C);
  assert.equal(seg(14, 700).strategy, C);
  assert.equal(seg(60, 40).strategy, C);
  assert.equal(seg(60, 700).strategy, C);
  // 3–12 months is where they diverge — measured 10,0 % vs 23,3 %.
  assert.equal(seg(200, 40).strategy, S, "unter 150 € ist Zubehör abgefallen");
  assert.equal(seg(200, 700).strategy, C, "ab 150 € trägt Zubehör weiter");
});

test("the win-back window offers accessories only where they still convert", () => {
  assert.equal(seg(500, 700).strategy, RECOMMENDATION_STRATEGIES.COMPLEMENT);
  assert.equal(seg(500, 40).strategy, RECOMMENDATION_STRATEGIES.WINBACK);
});

test("segments the data says not to mail are marked non-sendable", () => {
  assert.equal(seg(2, 700).sendable, false, "frisch");
  assert.equal(seg(900, 700).sendable, false, "ruhen");
  assert.equal(seg(2, 700).strategy, null);
  assert.equal(seg(900, 700).strategy, null);
  for (const days of [14, 60, 200, 500]) {
    assert.equal(seg(days, 700).sendable, true);
  }
});

// Fail-soft: a segmentation gap must never stop a campaign going out.
test("a missing or unusable purchase date falls back to today's behaviour", () => {
  for (const bad of [null, undefined, "", "not-a-date"]) {
    const r = resolveCampaignSegment({ lastOrderAt: bad, anchorEur: 700, now: NOW });
    assert.equal(r.key, "unbekannt");
    assert.equal(r.sendable, true);
    assert.equal(r.strategy, RECOMMENDATION_STRATEGIES.SIMILARITY);
    assert.equal(r.days, null);
  }
});

test("a future purchase date (clock skew) does not fall through to 'frisch'", () => {
  const r = resolveCampaignSegment({
    lastOrderAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
    anchorEur: 700,
    now: NOW,
  });
  assert.equal(r.key, "unbekannt");
  assert.equal(r.sendable, true);
});

test("a known date with an unknown value still sends, using similarity", () => {
  const r = resolveCampaignSegment({ lastOrderAt: daysAgo(200), anchorEur: null, now: NOW });
  assert.equal(r.key, "weiterentwickeln");
  assert.equal(r.contentTier, null);
  assert.equal(r.strategy, RECOMMENDATION_STRATEGIES.SIMILARITY);
  assert.equal(r.sendable, true);
});

test("an unknown value in a non-sendable segment stays non-sendable", () => {
  const r = resolveCampaignSegment({ lastOrderAt: daysAgo(900), anchorEur: null, now: NOW });
  assert.equal(r.key, "ruhen");
  assert.equal(r.sendable, false);
  assert.equal(r.strategy, null);
});

test("queue priority favours high-value contacts and the early window", () => {
  const early = seg(14, 700);
  const earlySmall = seg(14, 40);
  const mid = seg(200, 700);
  const dormant = seg(900, 700);
  assert.ok(campaignQueuePriority(early) > campaignQueuePriority(earlySmall));
  assert.ok(campaignQueuePriority(early) > campaignQueuePriority(mid));
  assert.equal(campaignQueuePriority(dormant), 0, "nicht sendbar sortiert zuletzt");
  // The measured ratio: >= 150 € is ~3x as likely to become a repeat accessory buyer.
  assert.equal(campaignQueuePriority(mid) / campaignQueuePriority(seg(200, 40)), 3);
});

test("every segment key round-trips through the lookup", () => {
  for (const key of CAMPAIGN_SEGMENT_KEYS) {
    const found = campaignSegmentByKey(key);
    assert.ok(found, `${key} muss auffindbar sein`);
    assert.equal(found.key, key);
  }
  assert.equal(campaignSegmentByKey("gibt-es-nicht"), null);
});

test("segment windows are contiguous and ascending, with an open end", () => {
  let prev = 0;
  for (const s of CAMPAIGN_SEGMENTS) {
    assert.ok(s.maxDays > prev, `${s.key} muss über ${prev} liegen`);
    prev = s.maxDays;
  }
  assert.equal(CAMPAIGN_SEGMENTS[CAMPAIGN_SEGMENTS.length - 1].maxDays, Infinity);
  assert.equal(CAMPAIGN_SEGMENT_KEYS.length, CAMPAIGN_SEGMENTS.length + 1);
});

test("daysSince handles both Date and ISO inputs", () => {
  assert.equal(daysSince(daysAgo(10), NOW), 10);
  assert.equal(daysSince(daysAgo(10), NOW.toISOString()), 10);
  assert.equal(daysSince("nope", NOW), null);
});
