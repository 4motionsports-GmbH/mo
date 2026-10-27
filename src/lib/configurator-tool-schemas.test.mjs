import { test } from "node:test";
import assert from "node:assert/strict";
import { floorAreaSchema, lineQuantitySchema } from "./configurator-tool-schemas.mjs";
import { RULE_LIMITS, normalizeAreaM2 } from "./product-rules.mjs";

test("lineQuantitySchema: 1–200 (a floor line's cap), whole numbers, optional", () => {
  for (const ok of [1, 20, 30, 200, undefined]) assert.equal(lineQuantitySchema.safeParse(ok).success, true, String(ok));
  for (const bad of [0, -1, 201, 1.5, "2", null]) assert.equal(lineQuantitySchema.safeParse(bad).success, false, String(bad));
  assert.equal(RULE_LIMITS.floorLineMax, 200);
});

test("floorAreaSchema: a number, null or absent never invalidates the call; normalizeAreaM2 is the gate", () => {
  for (const ok of [12, 12.5, 0, -3, 9999, null, undefined]) assert.equal(floorAreaSchema.safeParse(ok).success, true, String(ok));
  // the model's schema says number — a text area still fails the call (as documented)
  assert.equal(floorAreaSchema.safeParse("12").success, false);
  // what passes the schema but is no area is dropped afterwards
  assert.deepEqual([null, undefined, 0, -3, 9999].map(normalizeAreaM2), [null, null, null, null, null]);
  assert.equal(normalizeAreaM2(12.5), 12.5);
});
