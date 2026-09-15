import { test } from "node:test";
import assert from "node:assert/strict";
import {
  campaignAutoPrepareConfig,
  marketingMinSendIntervalDays,
} from "./campaign-flags.mjs";

test("the cadence cap parses non-negative integers and falls back to 0", () => {
  assert.equal(marketingMinSendIntervalDays({}), 0);
  assert.equal(marketingMinSendIntervalDays({ MARKETING_MIN_SEND_INTERVAL_DAYS: "14" }), 14);
  assert.equal(marketingMinSendIntervalDays({ MARKETING_MIN_SEND_INTERVAL_DAYS: "0" }), 0);
  assert.equal(marketingMinSendIntervalDays({ MARKETING_MIN_SEND_INTERVAL_DAYS: "-3" }), 0);
  assert.equal(marketingMinSendIntervalDays({ MARKETING_MIN_SEND_INTERVAL_DAYS: "abc" }), 0);
  assert.equal(marketingMinSendIntervalDays({ MARKETING_MIN_SEND_INTERVAL_DAYS: "" }), 0);
});

test("nightly prepare ships off and reads count, depth and text mode defensively", () => {
  assert.deepEqual(campaignAutoPrepareConfig({}), {
    count: 0,
    discountPercent: 0,
    discountScope: "all",
    textMode: "compact",
  });
  assert.deepEqual(
    campaignAutoPrepareConfig({
      CAMPAIGN_AUTO_PREPARE_COUNT: "200",
      CAMPAIGN_AUTO_PREPARE_DISCOUNT: "10",
      CAMPAIGN_AUTO_PREPARE_TEXT_MODE: "minimal",
      CAMPAIGN_AUTO_PREPARE_DISCOUNT_SCOPE: "recommendations",
    }),
    { count: 200, discountPercent: 10, discountScope: "recommendations", textMode: "minimal" }
  );
  // Out-of-range depth and an unknown mode fall back, an invalid count disables.
  assert.deepEqual(
    campaignAutoPrepareConfig({
      CAMPAIGN_AUTO_PREPARE_COUNT: "-5",
      CAMPAIGN_AUTO_PREPARE_DISCOUNT: "80",
      CAMPAIGN_AUTO_PREPARE_TEXT_MODE: "loud",
      CAMPAIGN_AUTO_PREPARE_DISCOUNT_SCOPE: "everything",
    }),
    { count: 0, discountPercent: 0, discountScope: "all", textMode: "compact" }
  );
});
