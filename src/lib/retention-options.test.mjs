import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWindow, parseRetentionOptions, RETENTION_DEFAULTS } from "./retention-options.mjs";

test("parseWindow: defaults for absent/invalid/negative, 0 disables, n passes", () => {
  assert.equal(parseWindow(undefined, 180), 180);
  assert.equal(parseWindow("", 180), 180);
  assert.equal(parseWindow("abc", 180), 180);
  assert.equal(parseWindow("-5", 180), 180);
  assert.equal(parseWindow("12.5", 180), 180);
  assert.equal(parseWindow("0", 180), 0);
  assert.equal(parseWindow(" 7 ", 180), 7);
  assert.equal(parseWindow("365", 180), 365);
});

test("parseWindow: min 1 turns 0 into the default", () => {
  assert.equal(parseWindow("0", 30, { min: 1 }), 30);
  assert.equal(parseWindow("1", 30, { min: 1 }), 1);
});

test("parseRetentionOptions: defaults with an empty env", () => {
  const o = parseRetentionOptions({});
  assert.equal(o.retentionDays, RETENTION_DEFAULTS.RETENTION_DAYS);
  assert.equal(o.kpiRetentionDays, 180);
  assert.equal(o.abandonAfterMinutes, 30);
  assert.equal(o.suppressedPurgeDays, 30);
  assert.equal(o.correspondenceRetentionDays, 365);
  assert.equal(o.physicalLetterRetentionDays, 365);
  assert.equal(o.feedbackRetentionDays, 365);
  assert.equal(o.customerInactivityRetentionDays, 1095);
  assert.equal(o.adminAccessLogRetentionDays, 730);
  assert.equal(o.campaignContactRetentionDays, 365);
  assert.equal(o.analyticsReportRetentionDays, 365);
  assert.equal(o.attributionWindowDays, 30);
});

test("parseRetentionOptions: 0 disables every retention window, never the attribution window", () => {
  const env = Object.fromEntries(Object.keys(RETENTION_DEFAULTS).map((k) => [k, "0"]));
  const o = parseRetentionOptions(env);
  for (const [key, value] of Object.entries(o)) {
    if (key === "attributionWindowDays") assert.equal(value, 30, key);
    else assert.equal(value, 0, key);
  }
});

test("parseRetentionOptions: explicit values pass through", () => {
  const o = parseRetentionOptions({ RETENTION_DAYS: "90", ABANDON_AFTER_MINUTES: "15", MO_ATTRIBUTION_WINDOW_DAYS: "45" });
  assert.equal(o.retentionDays, 90);
  assert.equal(o.abandonAfterMinutes, 15);
  assert.equal(o.attributionWindowDays, 45);
});
