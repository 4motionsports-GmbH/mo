import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REVIEW_PER_DAY,
  SAMPLE_COUNT,
  campaignPlanEstimate,
  pickSampleRecipients,
  sampleConfigFingerprint,
} from "./campaign-sample-core.mjs";

const m = (customerId, over = {}) => ({
  customerId,
  email: `p${customerId}@example.com`,
  language: "de",
  hasMoContact: false,
  lifecycleSegment: "ausbauen",
  ordersCount: 1,
  ...over,
});

test("pickSampleRecipients: covers language and Mo contact before taking similar people", () => {
  const members = [
    m(1),
    m(2),
    m(3),
    m(4, { language: "en" }),
    m(5, { hasMoContact: true }),
  ];
  const picked = pickSampleRecipients(members).map((p) => p.customerId);
  assert.equal(picked.length, SAMPLE_COUNT);
  assert.equal(picked[0], 1, "the newest member comes first");
  assert.ok(picked.includes(4), "an English recipient is included");
  assert.ok(picked.includes(5), "a recipient with Mo contact is included");
});

test("pickSampleRecipients: segment and order count break the tie", () => {
  const members = [m(1), m(2), m(3, { lifecycleSegment: "zurueckholen", ordersCount: 4 }), m(4)];
  const picked = pickSampleRecipients(members, 2).map((p) => p.customerId);
  assert.deepEqual(picked, [1, 3]);
});

test("pickSampleRecipients: keeps input order on full ties, never repeats, skips missing e-mails", () => {
  const members = [m(1), m(1), m(2, { email: "" }), m(3), m(4)];
  const picked = pickSampleRecipients(members).map((p) => p.customerId);
  assert.deepEqual(picked, [1, 3, 4]);
});

test("pickSampleRecipients: fewer members than wanted, empty and bad input", () => {
  assert.equal(pickSampleRecipients([m(1)]).length, 1);
  assert.deepEqual(pickSampleRecipients([]), []);
  assert.deepEqual(pickSampleRecipients(/** @type {any} */ (null)), []);
  assert.deepEqual(pickSampleRecipients([m(1), m(2)], 0), []);
});

const NOW = new Date("2026-11-01T10:00:00Z");

test("campaignPlanEstimate: costs per hero mode", () => {
  const base = { recipients: 1000, draftEur: 0.01, heroEur: 0.2, now: NOW };
  const none = campaignPlanEstimate({ ...base, heroMode: "none" });
  assert.equal(none.heroImages, 0);
  assert.equal(none.heroCostEur, 0);
  assert.ok(Math.abs(none.draftCostEur - 10) < 1e-9);
  assert.ok(Math.abs(none.totalCostEur - 10) < 1e-9);
  assert.equal(campaignPlanEstimate({ ...base, heroMode: "default" }).heroImages, 0);
  const ab = campaignPlanEstimate({ ...base, heroMode: "ai_ab" });
  assert.equal(ab.heroImages, 500);
  assert.ok(Math.abs(ab.heroCostEur - 100) < 1e-9);
  const all = campaignPlanEstimate({ ...base, heroMode: "ai_all", recipients: 3 });
  assert.equal(all.heroImages, 3);
  assert.equal(campaignPlanEstimate({ ...base, heroMode: "ai_ab", recipients: 3 }).heroImages, 2);
});

test("campaignPlanEstimate: no recorded averages → null costs and a warning", () => {
  const e = campaignPlanEstimate({ recipients: 50, heroMode: "ai_all", draftEur: null, heroEur: null, now: NOW });
  assert.equal(e.draftCostEur, null);
  assert.equal(e.heroCostEur, null);
  assert.equal(e.totalCostEur, null);
  assert.ok(e.warnings.includes("no_cost_data"));
  // Without hero images a missing hero average does not matter.
  const t = campaignPlanEstimate({ recipients: 50, heroMode: "none", draftEur: 0.02, heroEur: null, now: NOW });
  assert.ok(Math.abs(t.totalCostEur - 1) < 1e-9);
  assert.ok(!t.warnings.includes("no_cost_data"));
});

test("campaignPlanEstimate: review days against the window that is left", () => {
  const fits = campaignPlanEstimate({
    recipients: 900,
    dailyTarget: 300,
    endsAt: "2026-11-05T10:00:00Z",
    now: NOW,
  });
  assert.equal(fits.reviewDays, 3);
  assert.equal(fits.windowDays, 4);
  assert.equal(fits.reviewPerDayAssumed, false);
  assert.ok(!fits.warnings.includes("review_too_slow"));

  const tight = campaignPlanEstimate({ recipients: 900, endsAt: "2026-11-05T10:00:00Z", now: NOW });
  assert.equal(tight.reviewPerDay, DEFAULT_REVIEW_PER_DAY);
  assert.equal(tight.reviewPerDayAssumed, true);
  assert.equal(tight.reviewDays, 9);
  assert.ok(tight.warnings.includes("review_too_slow"));
});

test("campaignPlanEstimate: a future start shortens the window, an open end has none", () => {
  const later = campaignPlanEstimate({
    recipients: 10,
    startsAt: "2026-11-03T10:00:00Z",
    endsAt: "2026-11-05T10:00:00Z",
    now: NOW,
  });
  assert.equal(later.windowDays, 2);
  const open = campaignPlanEstimate({ recipients: 10, now: NOW });
  assert.equal(open.windowDays, null);
  assert.deepEqual(open.warnings.filter((w) => w !== "no_cost_data"), []);
});

test("campaignPlanEstimate: an ended campaign and an empty audience", () => {
  const ended = campaignPlanEstimate({ recipients: 10, endsAt: "2026-10-30T00:00:00Z", now: NOW });
  assert.ok(ended.warnings.includes("ended"));
  assert.equal(ended.windowDays, 0);
  assert.ok(!ended.warnings.includes("review_too_slow"));
  const empty = campaignPlanEstimate({ recipients: 0, now: NOW });
  assert.ok(empty.warnings.includes("empty_audience"));
  assert.equal(empty.draftCostEur, 0);
  assert.equal(empty.reviewDays, 0);
});

test("campaignPlanEstimate: nightly preparation is capped by the shared budget", () => {
  const e = campaignPlanEstimate({
    recipients: 1000,
    autoPreparePerDay: 300,
    autoPrepareBudget: 200,
    endsAt: "2026-11-04T10:00:00Z",
    now: NOW,
  });
  assert.equal(e.nightly, 200);
  assert.equal(e.prepareNights, 5);
  assert.ok(e.warnings.includes("prepare_too_slow"));
  const off = campaignPlanEstimate({ recipients: 1000, autoPreparePerDay: 0, now: NOW });
  assert.equal(off.prepareNights, null);
  const budgetOff = campaignPlanEstimate({ recipients: 1000, autoPreparePerDay: 50, autoPrepareBudget: 0, now: NOW });
  assert.equal(budgetOff.nightly, 0);
  assert.equal(budgetOff.prepareNights, null);
});

test("campaignPlanEstimate: tolerates junk input", () => {
  const e = campaignPlanEstimate({ recipients: /** @type {any} */ ("abc"), dailyTarget: 0, startsAt: "nope", now: NOW });
  assert.equal(e.recipients, 0);
  assert.equal(e.reviewPerDay, DEFAULT_REVIEW_PER_DAY);
  assert.equal(e.windowDays, null);
});

test("sampleConfigFingerprint: stable over formatting, changes with any sample-relevant field", () => {
  const base = {
    name: "Black Friday",
    kind: "aktion",
    brief: "Ton: locker",
    endsAt: "2026-11-30T23:00:00.000Z",
    discountPercent: 15,
    discountScope: "all",
    discountValidUntil: null,
    designKey: null,
    textMode: null,
    moPromo: true,
    ctaKind: "mo_chat",
    ctaUrl: null,
  };
  const fp = sampleConfigFingerprint(base);
  assert.match(fp, /^[0-9a-f]{8}$/);
  // Same instant in another notation, empty strings = null, ignored extra fields.
  assert.equal(
    sampleConfigFingerprint({ ...base, endsAt: "2026-12-01T00:00:00+01:00", designKey: "", priority: 90, audience: { v: 1 } }),
    fp
  );
  for (const [k, v] of Object.entries({
    name: "Black Friday 2026",
    brief: "Ton: förmlich",
    endsAt: "2026-11-29T23:00:00.000Z",
    discountPercent: 20,
    discountScope: "recommendations",
    discountValidUntil: "2026-12-02T00:00:00.000Z",
    designKey: "winter",
    textMode: "minimal",
    moPromo: false,
    ctaKind: "shop",
    ctaUrl: "https://example.com/bf",
  })) {
    assert.notEqual(sampleConfigFingerprint({ ...base, [k]: v }), fp, `${k} changes the fingerprint`);
  }
  assert.match(sampleConfigFingerprint(/** @type {any} */ (null)), /^[0-9a-f]{8}$/);
});
