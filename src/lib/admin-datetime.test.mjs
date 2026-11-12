import { strict as assert } from "node:assert";
import test from "node:test";
import {
  ADMIN_DATE,
  ADMIN_DATE_MEDIUM,
  ADMIN_DATE_PADDED,
  ADMIN_DATE_TIME_FULL,
  ADMIN_DATE_TIME_MEDIUM,
  ADMIN_DATE_TIME_PADDED,
  ADMIN_DATE_TIME_SHORT,
  ADMIN_DAY_MONTH,
  ADMIN_EMPTY,
  ADMIN_TIME,
  ADMIN_TIME_ZONE,
  ADMIN_WEEKDAY_DATE_TIME,
  formatAdmin,
  fromBerlinInputValue,
  toAdminDate,
  toBerlinInputValue,
} from "./admin-datetime.mjs";

const PRESETS = [
  ADMIN_DATE,
  ADMIN_DATE_PADDED,
  ADMIN_DATE_MEDIUM,
  ADMIN_DAY_MONTH,
  ADMIN_DATE_TIME_PADDED,
  ADMIN_DATE_TIME_MEDIUM,
  ADMIN_DATE_TIME_SHORT,
  ADMIN_TIME,
  ADMIN_DATE_TIME_FULL,
];

// Instants chosen to break a timezone-naive formatter: two that fall on a
// different CALENDAR DAY in Berlin than in UTC (incl. a year rollover) and
// both 2026 DST transitions.
const SAMPLES = [
  "2026-08-31T22:40:00.000Z",
  "2025-12-31T23:59:00.000Z",
  "2026-03-29T00:30:00.000Z",
  "2026-10-25T00:30:00.000Z",
  "2026-06-15T12:00:00.000Z",
];

test("formats in the store timezone, not UTC", () => {
  // 22:40 UTC is already the next day in Berlin — the case that produced the
  // server/browser hydration mismatch (React #418).
  assert.equal(formatAdmin("2026-08-31T22:40:00.000Z", ADMIN_DATE), "1.9.2026");
  assert.equal(
    formatAdmin("2026-08-31T22:40:00.000Z", ADMIN_DATE_TIME_PADDED),
    "01.09.2026, 00:40"
  );
});

test("every preset renders its documented shape", () => {
  const iso = "2026-06-15T12:00:00.000Z"; // 14:00 Berlin (CEST)
  assert.equal(formatAdmin(iso, ADMIN_DATE), "15.6.2026");
  assert.equal(formatAdmin(iso, ADMIN_DATE_PADDED), "15.06.2026");
  assert.equal(formatAdmin(iso, ADMIN_DATE_MEDIUM), "15.06.2026");
  assert.equal(formatAdmin(iso, ADMIN_DAY_MONTH), "15.06.");
  assert.equal(formatAdmin(iso, ADMIN_DATE_TIME_PADDED), "15.06.2026, 14:00");
  assert.equal(formatAdmin(iso, ADMIN_DATE_TIME_MEDIUM), "15.06.2026, 14:00");
  assert.equal(formatAdmin(iso, ADMIN_DATE_TIME_SHORT), "15.06.26, 14:00");
  assert.equal(formatAdmin(iso, ADMIN_TIME), "14:00");
  assert.equal(formatAdmin(iso, ADMIN_DATE_TIME_FULL), "15.6.2026, 14:00:00");
});

test("honours both sides of the DST switch", () => {
  // 2026-03-29: CET→CEST at 01:00 UTC · 2026-10-25: CEST→CET at 01:00 UTC.
  assert.equal(formatAdmin("2026-03-29T00:30:00.000Z", ADMIN_TIME), "01:30"); // CET  (+1)
  assert.equal(formatAdmin("2026-03-29T01:30:00.000Z", ADMIN_TIME), "03:30"); // CEST (+2)
  assert.equal(formatAdmin("2026-10-25T00:30:00.000Z", ADMIN_TIME), "02:30"); // CEST (+2)
  assert.equal(formatAdmin("2026-10-25T01:30:00.000Z", ADMIN_TIME), "02:30"); // CET  (+1)
});

// THE hydration invariant: /admin is server-rendered in UTC and hydrated in the
// operator's timezone. Output must not depend on the host timezone at all, or
// React discards the server HTML with a mismatch.
test("output is independent of the host timezone", () => {
  const original = process.env.TZ;
  const hosts = ["UTC", "Europe/Berlin", "America/Los_Angeles", "Pacific/Kiritimati"];
  try {
    let reference = null;
    for (const tz of hosts) {
      process.env.TZ = tz;
      const rendered = SAMPLES.flatMap((iso) => PRESETS.map((p) => formatAdmin(iso, p)));
      if (reference === null) reference = rendered;
      else assert.deepEqual(rendered, reference, `TZ=${tz} rendered differently than TZ=${hosts[0]}`);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("absent and unparseable timestamps render the empty dash", () => {
  for (const bad of [null, undefined, "", "not-a-date", NaN, new Date("nope")]) {
    assert.equal(formatAdmin(bad, ADMIN_DATE), ADMIN_EMPTY);
    assert.equal(toAdminDate(bad), null);
  }
  assert.equal(formatAdmin(null, ADMIN_DATE, "keine"), "keine");
});

test("accepts ISO strings, Date objects and epoch milliseconds alike", () => {
  const iso = "2026-06-15T12:00:00.000Z";
  const expected = "15.06.2026, 14:00";
  assert.equal(formatAdmin(iso, ADMIN_DATE_TIME_PADDED), expected);
  assert.equal(formatAdmin(new Date(iso), ADMIN_DATE_TIME_PADDED), expected);
  assert.equal(formatAdmin(Date.parse(iso), ADMIN_DATE_TIME_PADDED), expected);
});

test("epoch zero is a valid timestamp, not an empty value", () => {
  assert.notEqual(formatAdmin(0, ADMIN_DATE), ADMIN_EMPTY);
  assert.equal(formatAdmin(0, ADMIN_DATE), "1.1.1970");
});

test("the pinned timezone is the store's", () => {
  assert.equal(ADMIN_TIME_ZONE, "Europe/Berlin");
});

test("a planned moment reads with its weekday", () => {
  assert.equal(formatAdmin("2026-11-28T07:00:00.000Z", ADMIN_WEEKDAY_DATE_TIME), "Samstag, 28.11.2026, 08:00");
  assert.equal(formatAdmin("2026-08-31T22:40:00.000Z", ADMIN_WEEKDAY_DATE_TIME), "Dienstag, 01.09.2026, 00:40");
});

test("datetime-local values are Berlin wall time, both ways", () => {
  // winter (CET, +1) and summer (CEST, +2)
  assert.equal(fromBerlinInputValue("2026-11-28T08:00"), "2026-11-28T07:00:00.000Z");
  assert.equal(fromBerlinInputValue("2026-06-15T14:00"), "2026-06-15T12:00:00.000Z");
  assert.equal(toBerlinInputValue("2026-11-28T07:00:00.000Z"), "2026-11-28T08:00");
  assert.equal(toBerlinInputValue("2026-08-31T22:40:00.000Z"), "2026-09-01T00:40");
  // seconds are accepted (some browsers send them) and ignored
  assert.equal(fromBerlinInputValue("2026-11-28T08:00:00"), "2026-11-28T07:00:00.000Z");
  // the round trip is stable
  for (const v of ["2026-01-01T00:00", "2026-03-29T03:00", "2026-10-25T03:00", "2026-12-31T23:59"]) {
    assert.equal(toBerlinInputValue(fromBerlinInputValue(v)), v);
  }
});

test("the DST switches: a skipped time moves on, a doubled one is winter time", () => {
  // 2026-03-29 02:30 does not exist in Berlin → 03:30 CEST
  assert.equal(fromBerlinInputValue("2026-03-29T02:30"), "2026-03-29T01:30:00.000Z");
  assert.equal(toBerlinInputValue(fromBerlinInputValue("2026-03-29T02:30")), "2026-03-29T03:30");
  // 2026-10-25 02:30 exists twice → the second (CET)
  assert.equal(fromBerlinInputValue("2026-10-25T02:30"), "2026-10-25T01:30:00.000Z");
  assert.equal(fromBerlinInputValue("2026-10-25T01:59"), "2026-10-24T23:59:00.000Z");
});

test("datetime-local conversion does not depend on the browser's timezone", () => {
  const original = process.env.TZ;
  try {
    for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      assert.equal(fromBerlinInputValue("2026-11-28T08:00"), "2026-11-28T07:00:00.000Z", tz);
      assert.equal(toBerlinInputValue("2026-11-28T07:00:00.000Z"), "2026-11-28T08:00", tz);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("anything that is not a real date and time is null / empty", () => {
  for (const bad of ["", null, undefined, "morgen", "2026-02-31T10:00", "2026-11-28T24:00", "2026-13-01T10:00", "2026-11-28", "28.11.2026 08:00"]) {
    assert.equal(fromBerlinInputValue(bad), null, String(bad));
  }
  assert.equal(toBerlinInputValue(null), "");
  assert.equal(toBerlinInputValue("nope"), "");
});
