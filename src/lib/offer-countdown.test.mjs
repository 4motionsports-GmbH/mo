import { test } from "node:test";
import assert from "node:assert/strict";
import { countdownText, deadlineLabel, earliestDeadline, remainingParts } from "./offer-countdown.mjs";

const now = new Date("2026-09-08T10:00:00Z");

test("earliestDeadline picks the soonest valid date and ignores nulls/garbage", () => {
  assert.equal(earliestDeadline(null, "2026-09-12T21:59:00Z", undefined, "2026-09-10T21:59:00Z", "nope"), "2026-09-10T21:59:00.000Z");
  assert.equal(earliestDeadline(null, undefined), null);
  assert.equal(earliestDeadline(new Date("2026-09-09T00:00:00Z")), "2026-09-09T00:00:00.000Z");
});

test("remainingParts rounds down to whole hours and flags expiry", () => {
  assert.deepEqual(remainingParts("2026-09-11T23:59:00Z", now), { expired: false, days: 3, hours: 13, totalHours: 85 });
  assert.deepEqual(remainingParts("2026-09-08T10:30:00Z", now), { expired: false, days: 0, hours: 0, totalHours: 0 });
  assert.equal(remainingParts("2026-09-08T09:59:00Z", now).expired, true);
  assert.equal(remainingParts("garbage", now).expired, true);
});

test("deadlineLabel prints the shop's time zone (Europe/Berlin)", () => {
  // 21:59 UTC on 12.09.2026 is 23:59 CEST.
  assert.equal(deadlineLabel("2026-09-12T21:59:00Z", "de"), "Sa., 12.09.2026, 23:59 Uhr");
  assert.equal(deadlineLabel("2026-09-12T21:59:00Z", "en"), "Sat, 12 Sept 2026, 23:59");
  assert.equal(deadlineLabel("garbage", "de"), "");
});

test("countdownText reads naturally in both languages and is empty once expired", () => {
  assert.equal(
    countdownText("2026-09-11T23:59:00Z", "de", now),
    "Dein Angebot gilt noch 3 Tage und 13 Stunden – bis Sa., 12.09.2026, 01:59 Uhr"
  );
  assert.equal(countdownText("2026-09-09T10:00:00Z", "en", now), "Your offer ends in 1 day – until Wed, 9 Sept 2026, 12:00");
  assert.equal(countdownText("2026-09-08T11:30:00Z", "de", now), "Dein Angebot gilt noch 1 Stunde – bis Di., 08.09.2026, 13:30 Uhr");
  assert.equal(countdownText("2026-09-08T10:20:00Z", "de", now), "Dein Angebot gilt noch 0 Stunden – bis Di., 08.09.2026, 12:20 Uhr");
  assert.equal(countdownText("2026-09-01T00:00:00Z", "de", now), "");
});
