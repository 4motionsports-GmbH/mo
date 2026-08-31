import { strict as assert } from "node:assert";
import test from "node:test";
import {
  STORE_DATE,
  STORE_TIME_ZONE,
  formatStoreDate,
  toStoreDate,
} from "./store-datetime.mjs";

// THE BUG this module exists to fix: an order placed just after midnight in
// Berlin is still the PREVIOUS day in UTC. Formatting it on a UTC backend
// without pinning the zone told the customer the wrong calendar day.
test("an instant just after midnight in Berlin is that day, not the UTC day", () => {
  // 2026-08-31T22:30:00Z === 2026-09-01 00:30 in Berlin (CEST, +2).
  assert.equal(formatStoreDate("2026-08-31T22:30:00.000Z"), "1.9.2026");
  // Winter: CET is +1, so the window is 23:00–00:00 UTC.
  assert.equal(formatStoreDate("2026-01-14T23:30:00.000Z"), "15.1.2026");
  // A year rollover lands in the next YEAR, not just the next day.
  assert.equal(formatStoreDate("2025-12-31T23:10:00.000Z"), "1.1.2026");
});

test("daytime instants are unaffected — only the wrong days move", () => {
  assert.equal(formatStoreDate("2026-08-31T12:00:00.000Z"), "31.8.2026");
  assert.equal(formatStoreDate("2026-01-14T09:00:00.000Z"), "14.1.2026");
});

test("keeps each locale's numeric shape", () => {
  const iso = "2026-08-31T22:30:00.000Z";
  assert.equal(formatStoreDate(iso, "de-DE"), "1.9.2026");
  assert.equal(formatStoreDate(iso, "en-GB"), "01/09/2026");
});

// The prompt builders run on UTC backends but must not depend on that: the
// same instant has to render as the same German calendar day everywhere.
test("output is independent of the host timezone", () => {
  const original = process.env.TZ;
  const samples = [
    "2026-08-31T22:30:00.000Z",
    "2025-12-31T23:10:00.000Z",
    "2026-03-29T00:30:00.000Z",
    "2026-10-25T00:30:00.000Z",
    "2026-06-15T12:00:00.000Z",
  ];
  try {
    let reference = null;
    for (const tz of ["UTC", "Europe/Berlin", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      const rendered = samples.flatMap((iso) => [
        formatStoreDate(iso, "de-DE"),
        formatStoreDate(iso, "en-GB"),
      ]);
      if (reference === null) reference = rendered;
      else assert.deepEqual(rendered, reference, `TZ=${tz} rendered differently`);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test("absent and unparseable values yield the caller's wording, never 'Invalid Date'", () => {
  for (const bad of [null, undefined, "", "not-a-date", NaN, new Date("nope")]) {
    assert.equal(formatStoreDate(bad, "de-DE", "Datum unbekannt"), "Datum unbekannt");
    assert.equal(toStoreDate(bad), null);
  }
  assert.equal(formatStoreDate(null), "");
});

test("accepts ISO strings, Date objects and epoch milliseconds alike", () => {
  const iso = "2026-08-31T22:30:00.000Z";
  assert.equal(formatStoreDate(iso), "1.9.2026");
  assert.equal(formatStoreDate(new Date(iso)), "1.9.2026");
  assert.equal(formatStoreDate(Date.parse(iso)), "1.9.2026");
});

test("epoch zero is a valid timestamp, not an empty value", () => {
  assert.equal(formatStoreDate(0, "de-DE", "unbekannt"), "1.1.1970");
});

test("the pinned zone and date shape are the store's", () => {
  assert.equal(STORE_TIME_ZONE, "Europe/Berlin");
  assert.deepEqual(STORE_DATE, { day: "numeric", month: "numeric", year: "numeric" });
});
