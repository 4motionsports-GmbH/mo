import { test } from "node:test";
import assert from "node:assert/strict";

import { bundleHeadline, shouldRenderBundleBlock, bundleStattPrice } from "./bundle-email-core.mjs";

test("shouldRenderBundleBlock: block omitted when no bundle is attached", () => {
  assert.equal(shouldRenderBundleBlock(null), false);
  assert.equal(shouldRenderBundleBlock(undefined), false);
});

test("shouldRenderBundleBlock: only an ACTIVE attached bundle renders", () => {
  assert.equal(shouldRenderBundleBlock({ status: "active" }), true);
  assert.equal(shouldRenderBundleBlock({ status: "pending" }), false);
  assert.equal(shouldRenderBundleBlock({ status: "expired" }), false);
  assert.equal(shouldRenderBundleBlock({ status: "failed" }), false);
});

test("bundleStattPrice: present (= true component sum) only when bundle is cheaper", () => {
  // A genuine saving → strike price = the snapshotted component sum.
  assert.equal(bundleStattPrice("149.00", "160.00"), "160.00");
  assert.equal(bundleStattPrice(149, 160), "160.00");
});

test("bundleStattPrice: omitted when price >= sum (PAngV — no invented strike)", () => {
  assert.equal(bundleStattPrice("160.00", "160.00"), null); // equal ⇒ no statt
  assert.equal(bundleStattPrice("170.00", "160.00"), null); // above ⇒ no statt
});

test("bundleHeadline keeps short operator titles and replaces generated long ones", () => {
  assert.equal(bundleHeadline("Dein Rack-Upgrade", "de"), "Dein Rack-Upgrade");
  assert.equal(bundleHeadline("Set: Bodenschutzmatte Excellence 1000x1000 mm + ATX® Jammer Arms X1-600", "de"), "Dein persönliches Set");
  assert.equal(bundleHeadline("Ein Titel, der deutlich länger ist als vierzig Zeichen", "de"), "Dein persönliches Set");
  assert.equal(bundleHeadline("", "en"), "Your personal set");
  assert.equal(bundleHeadline(null, "de"), "Dein persönliches Set");
});
