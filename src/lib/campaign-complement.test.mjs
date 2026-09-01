import { strict as assert } from "node:assert";
import test from "node:test";
import { buildAccessoryMap, pickComplementIds } from "./campaign-complement.mjs";

const MAP = new Map([
  ["rack", ["hooks", "plates", "bar"]],
  ["bench", ["plates", "mat"]],
  ["treadmill", ["mat", "cleaner"]],
]);
const all = () => true;

test("picks accessories of what the contact owns", () => {
  const picks = pickComplementIds({ ownedIds: ["rack"], accessoryMap: MAP, isAvailable: all });
  assert.deepEqual(picks, ["hooks", "plates", "bar"]);
});

test("never recommends something already owned", () => {
  const picks = pickComplementIds({
    ownedIds: ["rack", "hooks"],
    accessoryMap: MAP,
    isAvailable: all,
  });
  assert.ok(!picks.includes("hooks"));
  assert.deepEqual(picks, ["plates", "bar"]);
});

test("an accessory fitting several owned products outranks one fitting a single item", () => {
  // "plates" fits both rack and bench; "hooks"/"bar"/"mat" fit one each.
  const picks = pickComplementIds({
    ownedIds: ["rack", "bench"],
    accessoryMap: MAP,
    isAvailable: all,
    max: 1,
  });
  assert.deepEqual(picks, ["plates"]);
});

test("accessories of the most recent purchase come first", () => {
  // Owns both; the treadmill is the recent one, so its accessories lead even
  // though "plates" has more owners.
  const picks = pickComplementIds({
    ownedIds: ["rack", "bench", "treadmill"],
    recentOwnedIds: ["treadmill"],
    accessoryMap: MAP,
    isAvailable: all,
  });
  assert.deepEqual(picks.slice(0, 2), ["mat", "cleaner"]);
});

test("recency beats owner count, but owner count still orders within recency", () => {
  const picks = pickComplementIds({
    ownedIds: ["rack", "bench"],
    recentOwnedIds: ["bench"],
    accessoryMap: MAP,
    isAvailable: all,
  });
  // bench → plates, mat (both recent). plates also fits the rack → 2 owners.
  assert.deepEqual(picks.slice(0, 2), ["plates", "mat"]);
});

test("unavailable products are excluded", () => {
  const picks = pickComplementIds({
    ownedIds: ["rack"],
    accessoryMap: MAP,
    isAvailable: (id) => id !== "hooks",
  });
  assert.deepEqual(picks, ["plates", "bar"]);
});

test("respects the max and is deterministic across runs", () => {
  const args = { ownedIds: ["rack", "bench"], accessoryMap: MAP, isAvailable: all, max: 2 };
  const a = pickComplementIds(args);
  const b = pickComplementIds(args);
  assert.equal(a.length, 2);
  assert.deepEqual(a, b);
});

test("no owned products, no curated accessories, or max 0 yields nothing", () => {
  assert.deepEqual(pickComplementIds({ ownedIds: [], accessoryMap: MAP, isAvailable: all }), []);
  assert.deepEqual(
    pickComplementIds({ ownedIds: ["unknown"], accessoryMap: MAP, isAvailable: all }),
    []
  );
  assert.deepEqual(
    pickComplementIds({ ownedIds: ["rack"], accessoryMap: MAP, isAvailable: all, max: 0 }),
    []
  );
  assert.deepEqual(pickComplementIds({}), []);
});

test("malformed accessory entries are skipped, not crashed on", () => {
  const bad = new Map([["rack", ["hooks", "", null, 42, "bar"]]]);
  assert.deepEqual(
    pickComplementIds({ ownedIds: ["rack"], accessoryMap: bad, isAvailable: all }),
    ["hooks", "bar"]
  );
});

test("the accessory map keeps only products with curated accessories", () => {
  const map = buildAccessoryMap([
    { id: "a", compatibleWith: ["x"] },
    { id: "b", compatibleWith: [] },
    { id: "c" },
    { compatibleWith: ["y"] },
  ]);
  assert.deepEqual([...map.keys()], ["a"]);
  assert.deepEqual(buildAccessoryMap(undefined).size, 0);
});
