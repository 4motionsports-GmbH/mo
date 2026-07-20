import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCampaignSendGates,
  GATE_REASONS,
} from "./campaign-gates.mjs";
import {
  isCampaignSendsApproved,
  isSingleOptInAllowed,
  campaignMoDeeplinkUrl,
} from "./campaign-flags.mjs";

// A gate input where every gate PASSES — tests below break one gate at a time.
function openInput(overrides = {}) {
  return {
    sendsApproved: true,
    allowSingleOptIn: false,
    optInLevel: "CONFIRMED_OPT_IN",
    suppressed: false,
    lastSendAt: null,
    minIntervalDays: 0,
    ...overrides,
  };
}

test("all gates open → allowed", () => {
  assert.deepEqual(evaluateCampaignSendGates(openInput()), { allowed: true });
});

test("master flag off → refused, regardless of everything else", () => {
  const r = evaluateCampaignSendGates(openInput({ sendsApproved: false }));
  assert.equal(r.allowed, false);
  assert.equal(r.reason, GATE_REASONS.NOT_APPROVED);
});

test("SINGLE_OPT_IN / UNKNOWN blocked while the allow-flag is off", () => {
  for (const level of ["SINGLE_OPT_IN", "UNKNOWN", null, "weird"]) {
    const r = evaluateCampaignSendGates(openInput({ optInLevel: level }));
    assert.equal(r.allowed, false, `level ${level} must be blocked`);
    assert.equal(r.reason, GATE_REASONS.OPT_IN_LEVEL);
  }
});

test("SINGLE_OPT_IN allowed only when the lawyer's flag is explicitly on", () => {
  const r = evaluateCampaignSendGates(
    openInput({ optInLevel: "SINGLE_OPT_IN", allowSingleOptIn: true })
  );
  assert.deepEqual(r, { allowed: true });
});

test("suppressed → refused; anything but an explicit false counts as suppressed", () => {
  for (const suppressed of [true, undefined, null]) {
    const r = evaluateCampaignSendGates(openInput({ suppressed }));
    assert.equal(r.allowed, false);
    assert.equal(r.reason, GATE_REASONS.SUPPRESSED);
  }
});

test("frequency cap: a recent cross-channel send inside the window → too_soon", () => {
  const now = Date.parse("2026-07-20T12:00:00Z");
  const r = evaluateCampaignSendGates(
    openInput({
      minIntervalDays: 14,
      lastSendAt: "2026-07-10T12:00:00Z", // 10 days ago < 14
      nowMs: now,
    })
  );
  assert.equal(r.allowed, false);
  assert.equal(r.reason, GATE_REASONS.TOO_SOON);
});

test("frequency cap: a send outside the window passes; 0 disables the cap", () => {
  const now = Date.parse("2026-07-20T12:00:00Z");
  assert.deepEqual(
    evaluateCampaignSendGates(
      openInput({ minIntervalDays: 14, lastSendAt: "2026-07-01T12:00:00Z", nowMs: now })
    ),
    { allowed: true }
  );
  assert.deepEqual(
    evaluateCampaignSendGates(
      openInput({ minIntervalDays: 0, lastSendAt: "2026-07-19T12:00:00Z", nowMs: now })
    ),
    { allowed: true }
  );
});

test("gate order: the master flag is reported before per-contact reasons", () => {
  const r = evaluateCampaignSendGates(
    openInput({ sendsApproved: false, optInLevel: "SINGLE_OPT_IN", suppressed: true })
  );
  assert.equal(r.reason, GATE_REASONS.NOT_APPROVED);
});

test("flags: fail-closed parsing (default FALSE for absent/garbage values)", () => {
  assert.equal(isCampaignSendsApproved({}), false);
  assert.equal(isCampaignSendsApproved({ CAMPAIGN_SENDS_APPROVED: "" }), false);
  assert.equal(isCampaignSendsApproved({ CAMPAIGN_SENDS_APPROVED: "maybe" }), false);
  assert.equal(isCampaignSendsApproved({ CAMPAIGN_SENDS_APPROVED: "true" }), true);
  assert.equal(isCampaignSendsApproved({ CAMPAIGN_SENDS_APPROVED: "1" }), true);
  assert.equal(isSingleOptInAllowed({}), false);
  assert.equal(isSingleOptInAllowed({ CAMPAIGN_ALLOW_SINGLE_OPT_IN: "yes" }), true);
});

test("deeplink: env override wins, documented default otherwise", () => {
  assert.equal(
    campaignMoDeeplinkUrl({}),
    "https://motionsports.de/?mo=open&mo_new=1&mo_view=fullscreen&utm_source=campaign&utm_medium=email"
  );
  assert.equal(
    campaignMoDeeplinkUrl({ CAMPAIGN_MO_DEEPLINK_URL: "https://example.com/?mo=open" }),
    "https://example.com/?mo=open"
  );
});
