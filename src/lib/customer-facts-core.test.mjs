import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCustomerFacts,
  isRealisedOrder,
  recencyScore,
  frequencyScore,
  monetaryScore,
  churnRisk,
  complementCandidates,
} from "./customer-facts-core.mjs";

const NOW = "2026-10-01T12:00:00.000Z";
const daysAgo = (d) => new Date(new Date(NOW).getTime() - d * 86_400_000).toISOString();

function order(days, cents, items, extra = {}) {
  return {
    processedAt: daysAgo(days),
    totalCents: cents,
    refundedCents: 0,
    financialStatus: "PAID",
    cancelledAt: null,
    discountCodes: [],
    lineItems: items,
    ...extra,
  };
}

const catalog = {
  rack: { category: "Kraft", compatibleWith: ["matte", "hantel", "rack"] },
  matte: { category: "Zubehör", compatibleWith: ["rack"] },
  hantel: { category: "Kraft", compatibleWith: ["matte"] },
  band: { category: "Zubehör", compatibleWith: [] },
};

test("a customer without orders has empty purchase facts and no segment", () => {
  const f = computeCustomerFacts({ orders: [], now: NOW });
  assert.equal(f.ordersCount, 0);
  assert.equal(f.totalSpentCents, 0);
  assert.equal(f.lifecycleSegment, null);
  assert.equal(f.valueTier, null);
  assert.equal(f.rfmR, null);
  assert.equal(f.churnRisk, null);
  assert.deepEqual(f.boughtHandles, []);
  assert.equal(f.lastActivityAt, null);
});

test("only paid, non-cancelled orders count", () => {
  assert.equal(isRealisedOrder(order(1, 100, [])), true);
  assert.equal(isRealisedOrder(order(1, 100, [], { financialStatus: "PARTIALLY_REFUNDED" })), true);
  assert.equal(isRealisedOrder(order(1, 100, [], { financialStatus: "PENDING" })), false);
  assert.equal(isRealisedOrder(order(1, 100, [], { financialStatus: "REFUNDED" })), false);
  assert.equal(isRealisedOrder(order(1, 100, [], { cancelledAt: NOW })), false);
});

test("a one-time big buyer 20 days ago sits in the early accessory window", () => {
  const f = computeCustomerFacts({
    orders: [order(20, 89900, [{ handle: "rack", quantity: 1, unitPrice: 899 }])],
    catalog,
    now: NOW,
  });
  assert.equal(f.ordersCount, 1);
  assert.equal(f.totalSpentCents, 89900);
  assert.equal(f.aovCents, 89900);
  assert.equal(f.lifecycleSegment, "ausbauen_frueh");
  assert.equal(f.valueTier, "komponente");
  assert.equal(f.rfmR, 5);
  assert.equal(f.rfmF, 1);
  assert.equal(f.rfmM, 3);
  assert.equal(f.churnRisk, "niedrig");
  assert.equal(f.medianIntervalDays, null);
  assert.deepEqual(f.boughtHandles, ["rack"]);
  assert.deepEqual(f.boughtCategories, ["Kraft"]);
  // Accessories of the rack, minus the rack itself.
  assert.deepEqual(f.complementHandles, ["matte", "hantel"]);
});

test("split checkouts merge into one occasion; the rhythm uses occasions", () => {
  const f = computeCustomerFacts({
    orders: [
      order(300, 5000, [{ handle: "band", quantity: 1, unitPrice: 50 }]),
      order(298, 2000, [{ handle: "matte", quantity: 1, unitPrice: 20 }]), // same occasion
      order(200, 5000, [{ handle: "band", quantity: 1, unitPrice: 50 }]),
      order(100, 5000, [{ handle: "band", quantity: 1, unitPrice: 50 }]),
    ],
    catalog,
    now: NOW,
  });
  assert.equal(f.ordersCount, 4);
  assert.equal(f.medianIntervalDays, 100);
  assert.equal(f.rfmF, 3);
  // 100 days since last / 100-day rhythm → still in rhythm.
  assert.equal(f.churnRisk, "niedrig");
  assert.equal(new Date(f.expectedNextOrderAt).toISOString(), daysAgo(0));
});

test("churn risk grows with the gap relative to the personal rhythm", () => {
  assert.equal(churnRisk(110, 100, 3), "niedrig");
  assert.equal(churnRisk(150, 100, 3), "mittel");
  assert.equal(churnRisk(250, 100, 3), "hoch");
  assert.equal(churnRisk(400, null, 1), "hoch");
  assert.equal(churnRisk(null, null, 0), null);
});

test("RFM thresholds are fixed", () => {
  assert.equal(recencyScore(10), 5);
  assert.equal(recencyScore(400), 1);
  assert.equal(frequencyScore(1), 1);
  assert.equal(frequencyScore(5), 4);
  assert.equal(frequencyScore(9), 5);
  assert.equal(monetaryScore(99), 1);
  assert.equal(monetaryScore(6000), 5);
  assert.equal(monetaryScore(0), null);
});

test("discount share, refunds and cancelled orders", () => {
  const f = computeCustomerFacts({
    orders: [
      order(50, 10000, [], { discountCodes: ["MK-1"] }),
      order(40, 10000, [], { financialStatus: "PARTIALLY_REFUNDED", refundedCents: 500 }),
      order(30, 10000, [], { cancelledAt: daysAgo(29) }),
    ],
    now: NOW,
  });
  assert.equal(f.ordersCount, 2);
  assert.equal(f.discountOrderShare, 0.5);
  assert.equal(f.refundsCount, 1);
  assert.equal(f.totalSpentCents, 20000);
});

test("activity is the newest customer-initiated event, not our sends", () => {
  const f = computeCustomerFacts({
    orders: [order(300, 1000, [])],
    chats: { count: 2, lastAt: daysAgo(5), discussed: ["rack", "rack", "matte"], selected: ["rack"] },
    marketing: { sentCount: 3, lastSentAt: daysAgo(1), lastClickAt: daysAgo(10), clicks90d: 2, redemptions: 1 },
    service: { lastInboundAt: daysAgo(20), unanswered: 1 },
    now: NOW,
  });
  assert.equal(f.conversationsCount, 2);
  assert.deepEqual(f.discussedHandles, ["rack", "matte"]);
  assert.equal(f.lastActivityAt, daysAgo(5));
  assert.equal(f.emailsSentCount, 3);
  assert.equal(f.unansweredInboundCount, 1);
});

test("complement ranking prefers accessories that fit more owned products", () => {
  const cat = {
    a: { compatibleWith: ["x", "y"] },
    b: { compatibleWith: ["y"] },
    x: {},
    y: {},
  };
  assert.deepEqual(complementCandidates(["a", "b"], cat), ["y", "x"]);
  assert.deepEqual(complementCandidates(["a"], null), []);
});
