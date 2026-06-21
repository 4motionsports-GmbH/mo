import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveKpiRange,
  parseYmd,
  shiftYmd,
  daysBetween,
  germanDate,
  toYmd,
  DEFAULT_KPI_PRESET,
  MAX_CUSTOM_RANGE_DAYS,
} from "./kpi-range.mjs";

// A fixed clock so "today" is deterministic across the suite.
const NOW = new Date("2026-06-21T10:00:00Z");

test("toYmd / parseYmd round-trip in UTC", () => {
  assert.equal(toYmd(new Date("2026-06-21T23:59:59Z")), "2026-06-21");
  assert.equal(parseYmd("2026-06-21"), Date.UTC(2026, 5, 21));
});

test("parseYmd rejects malformed and impossible dates", () => {
  assert.equal(parseYmd("2026-13-01"), null); // month 13
  assert.equal(parseYmd("2026-02-31"), null); // Feb 31 rolls over
  assert.equal(parseYmd("2026-6-1"), null); // not zero-padded
  assert.equal(parseYmd("not-a-date"), null);
  assert.equal(parseYmd(""), null);
  assert.equal(parseYmd(null), null);
  assert.equal(parseYmd(20260621), null);
});

test("shiftYmd / daysBetween / germanDate helpers", () => {
  assert.equal(shiftYmd("2026-06-21", -6), "2026-06-15");
  assert.equal(shiftYmd("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-06-15", "2026-06-21"), 7); // inclusive
  assert.equal(daysBetween("2026-06-21", "2026-06-21"), 1);
  assert.equal(germanDate("2026-06-21"), "21.06.2026");
});

test("preset 7d/30d/90d produce trailing inclusive windows ending today", () => {
  const r7 = resolveKpiRange({ kpiRange: "7d" }, NOW);
  assert.deepEqual(
    { preset: r7.preset, from: r7.from, to: r7.to, days: r7.days },
    { preset: "7d", from: "2026-06-15", to: "2026-06-21", days: 7 }
  );
  assert.equal(r7.label, "Letzte 7 Tage");

  const r30 = resolveKpiRange({ kpiRange: "30d" }, NOW);
  assert.deepEqual(
    { from: r30.from, to: r30.to, days: r30.days },
    { from: "2026-05-23", to: "2026-06-21", days: 30 }
  );

  const r90 = resolveKpiRange({ kpiRange: "90d" }, NOW);
  assert.equal(r90.days, 90);
  assert.equal(r90.to, "2026-06-21");
  assert.equal(r90.from, shiftYmd("2026-06-21", -89));
});

test("missing / unknown preset falls back to the default", () => {
  const fallback = resolveKpiRange({}, NOW);
  assert.equal(fallback.preset, DEFAULT_KPI_PRESET);
  assert.equal(fallback.days, 30);
  assert.deepEqual(resolveKpiRange({ kpiRange: "weird" }, NOW), fallback);
  assert.deepEqual(resolveKpiRange(null, NOW), fallback);
});

test("valid custom range is honoured with a date-range label", () => {
  const r = resolveKpiRange(
    { kpiRange: "custom", kpiFrom: "2026-01-01", kpiTo: "2026-01-31" },
    NOW
  );
  assert.deepEqual(
    { preset: r.preset, from: r.from, to: r.to, days: r.days },
    { preset: "custom", from: "2026-01-01", to: "2026-01-31", days: 31 }
  );
  assert.equal(r.label, "01.01.2026 – 31.01.2026");
});

test("custom: reversed pair is swapped", () => {
  const r = resolveKpiRange(
    { kpiRange: "custom", kpiFrom: "2026-01-31", kpiTo: "2026-01-01" },
    NOW
  );
  assert.equal(r.from, "2026-01-01");
  assert.equal(r.to, "2026-01-31");
});

test("custom: a future end is clamped to today", () => {
  const r = resolveKpiRange(
    { kpiRange: "custom", kpiFrom: "2026-06-01", kpiTo: "2099-01-01" },
    NOW
  );
  assert.equal(r.to, "2026-06-21");
  assert.equal(r.from, "2026-06-01");
});

test("custom: an over-long span is clamped to the max window", () => {
  const r = resolveKpiRange(
    { kpiRange: "custom", kpiFrom: "2000-01-01", kpiTo: "2026-06-21" },
    NOW
  );
  assert.equal(r.days, MAX_CUSTOM_RANGE_DAYS);
  assert.equal(r.to, "2026-06-21");
});

test("custom: incomplete/invalid dates fall back to the default preset", () => {
  const fallback = resolveKpiRange({}, NOW);
  assert.deepEqual(
    resolveKpiRange({ kpiRange: "custom", kpiFrom: "2026-01-01" }, NOW),
    fallback
  );
  assert.deepEqual(
    resolveKpiRange({ kpiRange: "custom", kpiFrom: "bad", kpiTo: "2026-01-31" }, NOW),
    fallback
  );
});
