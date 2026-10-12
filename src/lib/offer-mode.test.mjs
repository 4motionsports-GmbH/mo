import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OFFER_ITEMS,
  OFFER_SET,
  OFFER_CONFLICT_MESSAGE,
  discountForOffer,
  offerConflict,
  offerKind,
} from "./offer-mode.mjs";

test("offerKind: an attached active set makes a set mail, otherwise items", () => {
  assert.equal(offerKind(true), OFFER_SET);
  assert.equal(offerKind(false), OFFER_ITEMS);
  assert.equal(offerKind(null), OFFER_ITEMS);
  assert.equal(offerKind(undefined), OFFER_ITEMS);
});

test("offerConflict: only a set mail with a positive discount conflicts", () => {
  assert.equal(offerConflict({ discountPercent: 10, hasActiveBundle: true }), true);
  assert.equal(offerConflict({ discountPercent: 0, hasActiveBundle: true }), false);
  assert.equal(offerConflict({ discountPercent: null, hasActiveBundle: true }), false);
  assert.equal(offerConflict({ discountPercent: 10, hasActiveBundle: false }), false);
  assert.equal(offerConflict({ discountPercent: Number.NaN, hasActiveBundle: true }), false);
});

test("discountForOffer: a set mail never carries a discount", () => {
  assert.equal(discountForOffer(15, true), 0);
  assert.equal(discountForOffer(15, false), 15);
  assert.equal(discountForOffer(null, false), 0);
  assert.equal(discountForOffer(-5, false), 0);
});

test("the conflict message is German and names the fix", () => {
  assert.match(OFFER_CONFLICT_MESSAGE, /Set-Mail/);
  assert.match(OFFER_CONFLICT_MESSAGE, /Rabatt entfernen/);
});
