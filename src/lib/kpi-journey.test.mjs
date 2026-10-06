import { test } from "node:test";
import assert from "node:assert/strict";
import { JOURNEY_STAGES, journeyFunnel } from "./kpi-journey.mjs";

test("five nested stages in order", () => {
  assert.deepEqual(
    JOURNEY_STAGES.map((s) => s.key),
    ["chats", "shown", "clicked", "cart", "ordered"]
  );
});

test("rates, losses and the biggest drop", () => {
  const f = journeyFunnel({ chats: 100, shown: 80, clicked: 40, cart: 10, ordered: 4, orderedAny: 9, orderedOrders: 11, revenue: 1234.567 });
  assert.deepEqual(
    f.stages.map((s) => [s.value, s.lost]),
    [
      [100, 0],
      [80, 20],
      [40, 40],
      [10, 30],
      [4, 6],
    ]
  );
  assert.equal(f.stages[0].ofPrevious, null);
  assert.equal(f.stages[2].ofPrevious, 0.5);
  assert.equal(f.stages[4].ofStart, 0.04);
  assert.deepEqual(f.biggestDrop, { from: "Produkt angeklickt", to: "Warenkorb / Kasse", lost: 30, rate: 0.75 });
  assert.equal(f.orderedAny, 9);
  assert.equal(f.orderedWithoutCart, 5);
  assert.equal(f.orderedOrders, 11);
  assert.equal(f.chatToOrderRate, 0.09);
  assert.equal(f.revenue, 1234.57);
  assert.equal(f.revenuePerChat, 12.35);
});

test("a later stage never exceeds the one before", () => {
  const f = journeyFunnel({ chats: 5, shown: 7, clicked: 9, cart: 1, ordered: 3, orderedAny: 8 });
  assert.deepEqual(
    f.stages.map((s) => s.value),
    [5, 5, 5, 1, 1]
  );
  assert.ok(f.stages.every((s) => s.ofPrevious == null || s.ofPrevious <= 1));
  assert.equal(f.orderedAny, 5);
});

test("empty and garbage input", () => {
  const f = journeyFunnel(undefined);
  assert.ok(f.stages.every((s) => s.value === 0 && s.ofStart === null));
  assert.equal(f.biggestDrop, null);
  assert.equal(f.chatToOrderRate, null);
  assert.equal(f.revenuePerChat, null);
  assert.equal(journeyFunnel({ chats: "x", shown: -3, revenue: Number.NaN }).revenue, 0);
});
