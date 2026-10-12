import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SET_MIN_UNITS,
  clampQuantity,
  setNormalPriceCents,
  setPriceCheck,
  setSelectionCheck,
  setUnits,
} from "./set-composer-core.mjs";

test("setNormalPriceCents: unit price × count, summed in cents", () => {
  assert.equal(setNormalPriceCents([{ price: 49, quantity: 2 }, { price: 19.9, quantity: 1 }]), 11790);
  assert.equal(setNormalPriceCents([{ price: 0.1, quantity: 3 }]), 30);
  assert.equal(setNormalPriceCents([]), null);
  assert.equal(setNormalPriceCents([{ price: null, quantity: 1 }, { price: 10, quantity: 1 }]), null);
});

test("clampQuantity keeps counts within 1…10", () => {
  assert.equal(clampQuantity(3), 3);
  assert.equal(clampQuantity("2"), 2);
  assert.equal(clampQuantity(0), 1);
  assert.equal(clampQuantity(-2), 1);
  assert.equal(clampQuantity("x"), 1);
  assert.equal(clampQuantity(99), 10);
});

test("setUnits and setSelectionCheck: at least two units", () => {
  assert.equal(SET_MIN_UNITS, 2);
  assert.equal(setUnits([{ price: 1, quantity: 2 }, { price: 1, quantity: 3 }]), 5);
  assert.deepEqual(setSelectionCheck([{ price: 1, quantity: 2 }]), { ok: true });
  assert.deepEqual(setSelectionCheck([{ price: 1, quantity: 1 }, { price: 2, quantity: 1 }]), { ok: true });
  const one = setSelectionCheck([{ price: 1, quantity: 1 }]);
  assert.equal(one.ok, false);
  assert.match(one.reason, /mindestens zwei Stück/);
  assert.equal(setSelectionCheck([]).ok, false);
});

test("setPriceCheck: empty keeps the normal price", () => {
  assert.deepEqual(setPriceCheck({ normalCents: 18980, input: "" }), { kind: "empty" });
  assert.deepEqual(setPriceCheck({ normalCents: 18980, input: "   " }), { kind: "empty" });
  assert.deepEqual(setPriceCheck({ normalCents: 18980, input: undefined }), { kind: "empty" });
});

test("setPriceCheck: a lower price is a genuine saving, with the mail's percentage", () => {
  // 29,90 / 189,80 = 15,75 % — the mail prints 15 % (rounded down), so does the dialog
  assert.deepEqual(setPriceCheck({ normalCents: 18980, input: "159,90" }), {
    kind: "saving",
    priceCents: 15990,
    savingCents: 2990,
    savingPct: 15,
  });
  // under 1 %: a saving amount, but no percentage (the mail shows none either)
  assert.deepEqual(setPriceCheck({ normalCents: 100000, input: "995" }), {
    kind: "saving",
    priceCents: 99500,
    savingCents: 500,
    savingPct: null,
  });
  // the German way of typing, with grouping and the € sign
  assert.equal(setPriceCheck({ normalCents: 150000, input: "1.299,00 €" }).kind, "saving");
});

test("setPriceCheck: at or above the normal price there is no saving", () => {
  assert.deepEqual(setPriceCheck({ normalCents: 18980, input: "189,80" }), { kind: "no_saving", priceCents: 18980 });
  assert.deepEqual(setPriceCheck({ normalCents: 18980, input: "200" }), { kind: "no_saving", priceCents: 20000 });
});

test("setPriceCheck: junk, zero and an unknown normal price", () => {
  assert.deepEqual(setPriceCheck({ normalCents: 18980, input: "abc" }), { kind: "invalid" });
  assert.deepEqual(setPriceCheck({ normalCents: 18980, input: "0" }), { kind: "invalid" });
  assert.deepEqual(setPriceCheck({ normalCents: null, input: "99" }), { kind: "unknown", priceCents: 9900 });
});
