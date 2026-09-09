import { test } from "node:test";
import assert from "node:assert/strict";
import { TtlCache, parseFreshnessFloor, isStale } from "./ttl-cache.mjs";

test("TtlCache: set/get within the TTL, miss after it", () => {
  const c = new TtlCache(10_000);
  assert.equal(c.get("a", 1_000), null);
  c.set("a", { n: 1 }, 1_000);
  assert.deepEqual(c.get("a", 5_000)?.value, { n: 1 });
  assert.equal(c.get("a", 5_000)?.fetchedAt, 1_000);
  assert.equal(c.get("a", 11_000), null, "expired at exactly ttl");
});

test("TtlCache: freshness floor turns an unexpired entry into a miss", () => {
  const c = new TtlCache(600_000);
  c.set("r", "old", 100_000);
  assert.equal(c.get("r", 200_000)?.value, "old");
  assert.equal(c.get("r", 200_000, 150_000), null, "fetched before the floor");
  assert.equal(c.get("r", 200_000, 100_000)?.value, "old", "floor is inclusive");
  c.set("r", "new", 200_000);
  assert.equal(c.get("r", 200_001, 150_000)?.value, "new");
});

test("TtlCache: prune drops only expired entries; delete removes one", () => {
  const c = new TtlCache(1_000);
  c.set("a", 1, 0);
  c.set("b", 2, 900);
  c.prune(1_000);
  assert.equal(c.size, 1);
  assert.equal(c.get("b", 1_000)?.value, 2);
  assert.equal(c.delete("b"), true);
  assert.equal(c.size, 0);
});

test("TtlCache: rejects a non-positive ttl", () => {
  assert.throws(() => new TtlCache(0), TypeError);
  assert.throws(() => new TtlCache(Number.NaN), TypeError);
});

test("parseFreshnessFloor: unix seconds → ms; garbage and future values → 0", () => {
  const now = 1_700_000_000_000;
  assert.equal(parseFreshnessFloor("1699999000", now), 1_699_999_000_000);
  assert.equal(parseFreshnessFloor(undefined, now), 0);
  assert.equal(parseFreshnessFloor("", now), 0);
  assert.equal(parseFreshnessFloor("abc", now), 0);
  assert.equal(parseFreshnessFloor("-5", now), 0);
  assert.equal(parseFreshnessFloor("0", now), 0);
  assert.equal(parseFreshnessFloor(String(Math.floor(now / 1000) + 30), now), (Math.floor(now / 1000) + 30) * 1000, "small skew ok");
  assert.equal(parseFreshnessFloor(String(Math.floor(now / 1000) + 120), now), 0, "future → no floor");
  assert.equal(parseFreshnessFloor("1".repeat(13), now), 0, "too long");
});

test("isStale", () => {
  assert.equal(isStale(0, 5_000, 5_000), true);
  assert.equal(isStale(0, 4_999, 5_000), false);
});
