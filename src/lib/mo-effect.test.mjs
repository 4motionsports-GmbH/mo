import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMoEffect, consentSourceGroup } from "./mo-effect.mjs";

const row = (tier, mo, n, orders, spentEur, repeaters) => ({ tier, mo, n, orders, spentCents: spentEur * 100, repeaters });

test("raw figures per group", () => {
  const r = computeMoEffect([row("klein", true, 10, 20, 1000, 5), row("klein", false, 40, 60, 3000, 10)], { minGroupSize: 1 });
  assert.equal(r.mo.n, 10);
  assert.equal(r.mo.avgOrders, 2);
  assert.equal(r.mo.aovCents, 5000);
  assert.equal(r.mo.repurchaseRate, 0.5);
  assert.equal(r.withoutMo.avgOrders, 1.5);
  assert.equal(r.withoutMo.repurchaseRate, 0.25);
  assert.equal(r.enough, true);
});

test("the no-Mo group is re-weighted to the Mo group's tier mix", () => {
  // Without Mo: many small-parts buyers (low AOV), few big buyers. Mo: mostly big buyers.
  const rows = [
    row("klein", true, 10, 10, 500, 2),
    row("grossgeraet", true, 90, 90, 90000, 18),
    row("klein", false, 900, 900, 45000, 180),
    row("grossgeraet", false, 100, 100, 100000, 20),
  ];
  const r = computeMoEffect(rows, { minGroupSize: 1 });
  // Raw comparison is dominated by the tier mix …
  assert.ok(r.withoutMo.aovCents < 20000);
  // … matched comparison uses the Mo weights (10 % klein, 90 % groß): 0.1·5000 + 0.9·100000 cents.
  assert.equal(Math.round(r.withoutMoMatched.aovCents), Math.round(0.1 * 5000 + 0.9 * 100000));
  // Same repurchase per tier → no lift.
  assert.equal(Math.round(r.lift.repurchaseRate * 1000), 0);
});

test("tiers only one group has are left out of the matching; small groups are flagged", () => {
  const r = computeMoEffect([row("komponente", true, 5, 6, 600, 1), row("klein", false, 50, 50, 500, 5)]);
  assert.equal(r.withoutMoMatched, null);
  assert.equal(r.lift, null);
  assert.equal(r.enough, false);
});

test("empty input", () => {
  const r = computeMoEffect([]);
  assert.equal(r.mo.n, 0);
  assert.equal(r.mo.avgOrders, null);
  assert.deepEqual(r.tiers, []);
});

test("consent sources group into shop / Mo / admin / other", () => {
  assert.equal(consentSourceGroup("shopify"), "shopify");
  assert.equal(consentSourceGroup("mo_chat_gate"), "mo");
  assert.equal(consentSourceGroup("mo"), "mo");
  assert.equal(consentSourceGroup("admin"), "admin");
  assert.equal(consentSourceGroup("import"), "sonstige");
  assert.equal(consentSourceGroup(null), "sonstige");
});
