import { strict as assert } from "node:assert";
import test from "node:test";
import {
  VALUE_TIERS,
  accessoryFollowUpRate,
  accessoryRateByWindow,
  anchorValueEur,
  buildRepurchaseIntervals,
  daysBetween,
  percentile,
  repeatRateByTier,
  sortedOrders,
  summarizeIntervals,
  valueTierKey,
} from "./repurchase-analysis.mjs";

const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString();
const order = (id, dayNo, items) => ({
  id,
  createdAt: day(dayNo),
  lineItems: items.map(([handle, unitPriceEur]) => ({ handle, quantity: 1, unitPriceEur })),
});

test("anchor value is the largest single item, not the order total", () => {
  // Ten €50 plates total €500 but anchor at €50 — a different customer from
  // someone who bought one €500 bench.
  const plates = order("a", 0, Array.from({ length: 10 }, (_, i) => [`plate-${i}`, 50]));
  assert.equal(anchorValueEur(plates), 50);
  assert.equal(anchorValueEur(order("b", 0, [["bench", 500]])), 500);
});

test("anchor value ignores unpriced items and returns null when nothing is priced", () => {
  assert.equal(anchorValueEur(order("a", 0, [["x", null], ["y", 80]])), 80);
  assert.equal(anchorValueEur(order("b", 0, [["x", null]])), null);
  assert.equal(anchorValueEur({ lineItems: [] }), null);
});

test("value tiers split at the catalogue's 150 / 1500 boundaries", () => {
  assert.equal(valueTierKey(0), "klein");
  assert.equal(valueTierKey(149.99), "klein");
  assert.equal(valueTierKey(150), "komponente");
  assert.equal(valueTierKey(1499.99), "komponente");
  assert.equal(valueTierKey(1500), "grossgeraet");
  assert.equal(valueTierKey(16499), "grossgeraet");
  assert.equal(VALUE_TIERS.length, 3);
});

test("an unpriceable order is excluded, never counted as cheap", () => {
  for (const bad of [null, undefined, NaN, -1, "50"]) {
    assert.equal(valueTierKey(bad), null);
  }
});

test("percentiles interpolate and handle the degenerate cases", () => {
  assert.equal(percentile([10, 20, 30, 40], 0.5), 25);
  assert.equal(percentile([10], 0.9), 10);
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([1, 2, 3], 0), 1);
  assert.equal(percentile([1, 2, 3], 1), 3);
});

test("intervals are tagged with the tier of the order they START from", () => {
  // Bought a €2000 machine, came back 40 days later for a €30 mat, then again
  // 300 days later. First gap belongs to Großgeräte, second to Kleinteile.
  const customers = [
    {
      key: "c1",
      orders: [
        order("o1", 0, [["treadmill", 2000]]),
        order("o2", 40, [["mat", 30]]),
        order("o3", 340, [["bar", 199]]),
      ],
    },
  ];
  const intervals = buildRepurchaseIntervals(customers);
  assert.deepEqual(
    intervals.map((i) => [i.tierKey, i.days]),
    [
      ["grossgeraet", 40],
      ["klein", 300],
    ]
  );
});

test("a single-order customer contributes no interval", () => {
  assert.equal(buildRepurchaseIntervals([{ key: "c", orders: [order("o", 0, [["x", 10]])] }]).length, 0);
  assert.equal(buildRepurchaseIntervals([]).length, 0);
});

test("orders are sorted by date regardless of input order", () => {
  const shuffled = [order("c", 30, [["x", 1]]), order("a", 0, [["x", 1]]), order("b", 10, [["x", 1]])];
  assert.deepEqual(sortedOrders(shuffled).map((o) => o.id), ["a", "b", "c"]);
});

test("summary reports per-tier and overall rows with months alongside days", () => {
  const customers = [
    { key: "c1", orders: [order("o1", 0, [["mat", 30]]), order("o2", 60, [["mat2", 30]])] },
    { key: "c2", orders: [order("o3", 0, [["mat", 30]]), order("o4", 120, [["mat2", 30]])] },
  ];
  const rows = summarizeIntervals(buildRepurchaseIntervals(customers));
  const klein = rows.find((r) => r.key === "klein");
  assert.equal(klein.n, 2);
  assert.equal(klein.median, 90);
  assert.ok(Math.abs(klein.medianMonths - 90 / 30.44) < 1e-9);
  const alle = rows.find((r) => r.key === "alle");
  assert.equal(alle.n, 2);
  // Tiers with no data report n=0 and null percentiles rather than 0.
  assert.equal(rows.find((r) => r.key === "grossgeraet").n, 0);
  assert.equal(rows.find((r) => r.key === "grossgeraet").median, null);
});

test("repeat rate buckets customers by their FIRST order's tier", () => {
  const customers = [
    { key: "a", orders: [order("1", 0, [["treadmill", 3000]]), order("2", 50, [["mat", 30]])] },
    { key: "b", orders: [order("3", 0, [["treadmill", 3000]])] },
    { key: "c", orders: [order("4", 0, [["mat", 30]])] },
  ];
  const rows = repeatRateByTier(customers);
  const gross = rows.find((r) => r.key === "grossgeraet");
  assert.equal(gross.customers, 2);
  assert.equal(gross.repeaters, 1);
  assert.equal(gross.rate, 0.5);
  const alle = rows.find((r) => r.key === "alle");
  assert.equal(alle.customers, 3);
  assert.equal(alle.rate, 1 / 3);
});

// ── The hypothesis test itself ────────────────────────────────────────────────

const ACCESSORIES = new Map([
  ["rack", ["hooks", "plates", "bar"]],
  ["treadmill", ["mat", "cleaner"]],
]);

test("detects a planted accessory follow-up and ignores an unrelated one", () => {
  const customers = [
    // Bought a rack, came back for its hooks → a hit.
    { key: "a", orders: [order("1", 0, [["rack", 700]]), order("2", 30, [["hooks", 60]])] },
    // Bought a rack, came back for a yoga mat (not in its accessory list) → miss.
    { key: "b", orders: [order("3", 0, [["rack", 700]]), order("4", 30, [["yoga", 40]])] },
  ];
  const rows = accessoryFollowUpRate(customers, ACCESSORIES, { catalogSize: 965 });
  const alle = rows[rows.length - 1];
  assert.equal(alle.transitions, 2);
  assert.equal(alle.hits, 1);
  assert.equal(alle.rate, 0.5);
  // Against a 965-product catalogue, 50 % is a very large lift.
  assert.ok(alle.lift > 50, `expected a large lift, got ${alle.lift}`);
});

test("an item the customer already owns does not count as an accessory follow-up", () => {
  // Owns rack AND hooks already; re-buying hooks is a replacement, not an
  // accessory discovery.
  const customers = [
    {
      key: "a",
      orders: [
        order("1", 0, [["rack", 700], ["hooks", 60]]),
        order("2", 30, [["hooks", 60]]),
      ],
    },
  ];
  const [alle] = accessoryFollowUpRate(customers, ACCESSORIES, { catalogSize: 965 }).slice(-1);
  assert.equal(alle.transitions, 1);
  assert.equal(alle.hits, 0);
});

test("the accessory set accumulates over ALL earlier orders, not just the last", () => {
  // Rack in order 1, unrelated item in order 2, rack's hooks in order 3.
  // The hit must still be found — owning the rack is what makes hooks relevant.
  const customers = [
    {
      key: "a",
      orders: [
        order("1", 0, [["rack", 700]]),
        order("2", 30, [["yoga", 40]]),
        order("3", 60, [["hooks", 60]]),
      ],
    },
  ];
  const [alle] = accessoryFollowUpRate(customers, ACCESSORIES, { catalogSize: 965 }).slice(-1);
  assert.equal(alle.transitions, 2);
  assert.equal(alle.hits, 1);
});

test("the time window filters transitions without truncating purchase history", () => {
  const customers = [
    {
      key: "a",
      orders: [
        order("1", 0, [["rack", 700]]),
        order("2", 10, [["yoga", 40]]),
        order("3", 400, [["hooks", 60]]),
      ],
    },
  ];
  // The late transition (day 10 → 400) is the accessory one. Restricting to
  // the first 90 days must exclude it...
  const [early] = accessoryFollowUpRate(customers, ACCESSORIES, {
    catalogSize: 965,
    maxDays: 90,
  }).slice(-1);
  assert.equal(early.transitions, 1);
  assert.equal(early.hits, 0);
  // ...and the late window must still SEE the rack bought on day 0, even
  // though that order is outside the window.
  const [late] = accessoryFollowUpRate(customers, ACCESSORIES, {
    catalogSize: 965,
    minDays: 90,
  }).slice(-1);
  assert.equal(late.transitions, 1);
  assert.equal(late.hits, 1);
});

test("window slices partition the transitions exactly once", () => {
  const customers = [
    { key: "a", orders: [order("1", 0, [["rack", 700]]), order("2", 15, [["hooks", 60]])] },
    { key: "b", orders: [order("3", 0, [["rack", 700]]), order("4", 200, [["hooks", 60]])] },
    { key: "c", orders: [order("5", 0, [["rack", 700]]), order("6", 900, [["hooks", 60]])] },
  ];
  const rows = accessoryRateByWindow(customers, ACCESSORIES, { catalogSize: 965 });
  const total = rows.reduce((s, r) => s + r.transitions, 0);
  assert.equal(total, 3, "every transition lands in exactly one bucket");
  assert.equal(rows.find((r) => r.toDays === 30).transitions, 1);
  assert.equal(rows.find((r) => r.toDays === 365).transitions, 1);
  assert.equal(rows.find((r) => r.toDays === Infinity).transitions, 1);
});

test("days between instants, and unusable dates", () => {
  assert.equal(daysBetween(day(0), day(10)), 10);
  assert.equal(daysBetween("nope", day(1)), null);
});

test("empty input never throws", () => {
  assert.deepEqual(buildRepurchaseIntervals(undefined), []);
  assert.equal(summarizeIntervals([]).length, VALUE_TIERS.length + 1);
  assert.equal(repeatRateByTier([]).find((r) => r.key === "alle").rate, null);
  const [alle] = accessoryFollowUpRate([], new Map(), { catalogSize: 1 }).slice(-1);
  assert.equal(alle.rate, null);
});
