import { test } from "node:test";
import assert from "node:assert/strict";
import { desiredMoTags, moTagDiff } from "./shopify-insight-tags.mjs";

test("desired tags from the facts", () => {
  assert.deepEqual(
    desiredMoTags({ lifecycleSegment: "zurueckholen", valueTier: "grossgeraet", conversationsCount: 2, churnRisk: "hoch" }),
    ["mo-abwanderung-hoch", "mo-kontakt", "mo-segment-zurueckholen", "mo-wert-grossgeraet"]
  );
  assert.deepEqual(desiredMoTags({ lifecycleSegment: null, valueTier: null, conversationsCount: 0, churnRisk: "niedrig" }), []);
  assert.deepEqual(desiredMoTags({ lifecycleSegment: "Ausbauen früh!" }), ["mo-segment-ausbauen_fr_h"]);
});

test("the diff only touches mo- tags", () => {
  const d = moTagDiff(["VIP", "mo-segment-frisch", "mo-kontakt", "Newsletter"], ["mo-kontakt", "mo-segment-ausbauen"]);
  assert.deepEqual(d.add, ["mo-segment-ausbauen"]);
  assert.deepEqual(d.remove, ["mo-segment-frisch"]);
  assert.equal(d.changed, true);
  assert.equal(moTagDiff(["mo-kontakt"], ["mo-kontakt"]).changed, false);
  assert.deepEqual(moTagDiff(null, []).remove, []);
});
