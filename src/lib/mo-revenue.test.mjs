import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REVENUE_CHANNELS,
  classifyRevenueOrder,
  daysAfterChat,
  drillInsights,
  mainCurrency,
  markConsultedLines,
  mergeCodeRedemptions,
  moCodesOf,
  orderTrendPoints,
  orderPathSummary,
  periodDelta,
  previousPeriod,
  revenuePerAiEuro,
  revenueSeries,
  summariseRevenue,
} from "./mo-revenue.mjs";

const paid = (o) => ({ financialStatus: "PAID", currency: "EUR", ...o });

test("every channel belongs to one of the three tiers", () => {
  for (const c of REVENUE_CHANNELS) assert.ok(["assisted", "influenced", "direct"].includes(c.tier), c.key);
  assert.equal(new Set(REVENUE_CHANNELS.map((c) => c.key)).size, REVENUE_CHANNELS.length);
});

test("moCodesOf keeps only MS5-/MK- codes", () => {
  assert.deepEqual(moCodesOf(["SUMMER10", " mk-ab12 ", "MS5-X", null]), ["mk-ab12", "MS5-X"]);
  assert.deepEqual(moCodesOf(null), []);
});

test("classifyRevenueOrder: the stored tier wins and picks the channel", () => {
  assert.equal(classifyRevenueOrder({ tier: "assisted", source: "widget" }).channel, "beraten_gekauft");
  assert.equal(classifyRevenueOrder({ tier: "influenced", source: "widget" }).channel, "beraten_anderes");
  assert.equal(classifyRevenueOrder({ tier: "direct", source: "bundle" }).channel, "set");
  assert.equal(classifyRevenueOrder({ tier: "direct", source: "summary_email" }).channel, "zusammenfassung");
  assert.equal(classifyRevenueOrder({ tier: "direct", source: "marketing_email" }).channel, "marketing");
  assert.equal(classifyRevenueOrder({ tier: "direct", source: "discount_code" }).channel, "sonstig");
});

test("classifyRevenueOrder: a Mo code beats the link marker (MK before MS5)", () => {
  const both = classifyRevenueOrder({ tier: "direct", source: "bundle", discountCodes: ["MK-1"] });
  assert.equal(both.channel, "kampagne");
  assert.deepEqual(both.moCodes, ["MK-1"]);
  assert.equal(classifyRevenueOrder({ tier: "direct", source: "widget", discountCodes: ["MS5-9"] }).channel, "marketing");
  assert.equal(classifyRevenueOrder({ tier: "direct", discountCodes: ["ms5-1", "mk-2"] }).channel, "kampagne");
  // A foreign code changes nothing.
  assert.equal(classifyRevenueOrder({ tier: "direct", source: "bundle", discountCodes: ["SALE"] }).channel, "set");
});

test("classifyRevenueOrder re-classifies rows without a valid tier, else null", () => {
  assert.equal(classifyRevenueOrder({ tier: null, source: "widget", overlap: true }).tier, "assisted");
  assert.equal(classifyRevenueOrder({ tier: "x", source: "widget", overlap: false }).tier, "influenced");
  assert.equal(classifyRevenueOrder({ tier: null, discountCodes: ["MK-1"] }).channel, "kampagne");
  assert.equal(classifyRevenueOrder({ tier: null, source: "summary_email" }).channel, "zusammenfassung");
  assert.equal(classifyRevenueOrder({ tier: null, source: null }), null);
  assert.equal(classifyRevenueOrder(null), null);
});

test("mainCurrency is the most frequent realised currency, EUR by default", () => {
  assert.equal(mainCurrency([]), "EUR");
  assert.equal(
    mainCurrency([paid({ currency: "chf" }), paid({ currency: "EUR" }), paid({ currency: "CHF" }), { currency: "USD" }]),
    "CHF"
  );
});

test("summariseRevenue counts every order once, per tier and channel", () => {
  const s = summariseRevenue([
    paid({ total: "100.50", tier: "assisted", source: "widget" }),
    paid({ total: 50, tier: "influenced", source: "widget" }),
    paid({ total: 200, tier: "direct", source: "bundle", discountCodes: ["MK-1"] }),
    paid({ total: 49.5, tier: "direct", source: "summary_email" }),
    paid({ total: 10, tier: "direct", source: "discount_code", discountCodes: ["MS5-2"] }),
  ]);
  assert.equal(s.currency, "EUR");
  assert.equal(s.orders, 5);
  assert.equal(s.revenue, 410);
  assert.equal(s.aov, 82);
  assert.deepEqual(s.byTier.assisted, { orders: 1, revenue: 100.5 });
  assert.deepEqual(s.byTier.direct, { orders: 3, revenue: 259.5 });
  const ch = Object.fromEntries(s.byChannel.map((c) => [c.key, c]));
  assert.equal(ch.kampagne.revenue, 200);
  assert.equal(ch.set.orders, 0, "the coded bundle order counts under its code only");
  assert.equal(ch.marketing.revenue, 10);
  assert.equal(ch.zusammenfassung.aov, 49.5);
  // The cross-cut is inside the channels, not on top.
  assert.deepEqual(s.withMoCode, { orders: 2, revenue: 210 });
  const sum = s.byChannel.reduce((a, c) => a + c.revenue, 0);
  assert.equal(Math.round(sum * 100) / 100, s.revenue);
  assert.ok(Math.abs(s.byChannel.reduce((a, c) => a + (c.share ?? 0), 0) - 1) < 1e-9);
});

test("summariseRevenue tallies what it does not count", () => {
  const s = summariseRevenue([
    { total: 80, financialStatus: "PENDING", tier: "direct", source: "bundle" },
    paid({ total: 30, currency: "USD", tier: "direct", source: "bundle" }),
    paid({ total: 20, tier: null, source: null }),
    paid({ total: null, tier: "assisted", source: "widget" }),
    paid({ total: 15, tier: "assisted", source: "widget" }),
  ]);
  assert.deepEqual(s.unrealised, { orders: 1, revenue: 80 });
  assert.equal(s.otherCurrency, 1);
  assert.equal(s.unclassified, 1);
  assert.equal(s.orders, 2, "a paid order without an amount is an order, adding nothing");
  assert.equal(s.revenue, 15);
});

test("summariseRevenue on nothing", () => {
  const s = summariseRevenue(undefined);
  assert.equal(s.orders, 0);
  assert.equal(s.revenue, 0);
  assert.equal(s.aov, null);
  assert.ok(s.byChannel.every((c) => c.share === null));
});

test("periodDelta in percent, null without a base", () => {
  assert.deepEqual(periodDelta(120, 100), { value: 20, isNew: false });
  assert.deepEqual(periodDelta(50, 200), { value: -75, isNew: false });
  assert.deepEqual(periodDelta(5, 0), { value: null, isNew: true });
  assert.deepEqual(periodDelta(0, 0), { value: null, isNew: false });
  assert.deepEqual(periodDelta(null, 3), { value: null, isNew: false });
  assert.equal(periodDelta(1, 3).value, -66.7);
});

test("previousPeriod is the same length directly before", () => {
  assert.deepEqual(previousPeriod({ from: "2026-08-01", to: "2026-09-30" }), { from: "2026-06-01", to: "2026-07-31", days: 61 });
  assert.deepEqual(previousPeriod({ from: "2026-03-01", to: "2026-03-01" }), { from: "2026-02-28", to: "2026-02-28", days: 1 });
  assert.equal(previousPeriod({ from: "2026-09-30", to: "2026-08-01" }), null);
  assert.equal(previousPeriod({ from: "x", to: "2026-08-01" }), null);
});

test("revenueSeries: daily, gap-filled, per tier, realised only", () => {
  const { granularity, buckets } = revenueSeries(
    [
      paid({ total: 10, tier: "assisted", processedAt: "2026-08-02T10:00:00Z" }),
      paid({ total: 5, tier: "direct", source: "bundle", processedAt: "2026-08-02T23:30:00Z" }),
      { total: 99, financialStatus: "PENDING", tier: "direct", source: "bundle", processedAt: "2026-08-01T10:00:00Z" },
      paid({ total: 7, tier: "influenced", processedAt: "2026-07-31T10:00:00Z" }),
    ],
    { from: "2026-08-01", to: "2026-08-03" }
  );
  assert.equal(granularity, "day");
  assert.deepEqual(
    buckets.map((b) => [b.start, b.total, b.orders]),
    [
      ["2026-08-01", 0, 0],
      ["2026-08-02", 15, 2],
      ["2026-08-03", 0, 0],
    ]
  );
  assert.equal(buckets[1].assisted, 10);
  assert.equal(buckets[1].direct, 5);
});

test("revenueSeries: weekly from 93 days, first bucket at the range start", () => {
  const { granularity, buckets } = revenueSeries(
    [paid({ total: 3, tier: "direct", source: "bundle", processedAt: "2026-07-08T09:00:00Z" })],
    { from: "2026-07-01", to: "2026-10-01" }
  );
  assert.equal(granularity, "week");
  assert.equal(buckets[0].start, "2026-07-01"); // a Wednesday
  assert.equal(buckets[1].start, "2026-07-06"); // the next Monday
  assert.equal(buckets[1].total, 3);
  assert.equal(revenueSeries([], { from: "b", to: "a" }).buckets.length, 0);
});

test("mergeCodeRedemptions keeps only coded orders the ledger does not hold", () => {
  const { extra, alreadyCounted } = mergeCodeRedemptions({
    ledgerCodes: ["mk-1"],
    ledgerOrderNames: ["#1002"],
    redemptions: [
      { code: "MK-1", orderName: "#1001", amount: 10, financialStatus: "PAID" },
      { code: "MS5-2", orderName: "#1002", amount: 20, financialStatus: "PAID" },
      { code: "MK-3", orderName: "#1003", amount: 30, currency: "EUR", financialStatus: "PAID", createdAt: "2026-08-03T10:00:00Z" },
      { code: "MK-4", orderName: "#1003", amount: 30, financialStatus: "PAID" },
      { code: "SALE", orderName: "#1004", amount: 40, financialStatus: "PAID" },
    ],
  });
  assert.equal(alreadyCounted, 2);
  assert.equal(extra.length, 1, "one order with two codes counts once");
  assert.equal(extra[0].orderName, "#1003");
  assert.equal(extra[0].processedAt, "2026-08-03T10:00:00Z");
  assert.equal(classifyRevenueOrder(extra[0]).channel, "kampagne");
  assert.deepEqual(mergeCodeRedemptions().extra, []);
});

test("merged extras sum with the ledger without double counting", () => {
  const ledger = [paid({ total: 100, tier: "direct", source: "bundle", discountCodes: ["MK-1"] })];
  const { extra } = mergeCodeRedemptions({
    ledgerCodes: ["MK-1"],
    redemptions: [
      { code: "MK-1", orderName: "#1", amount: 100, financialStatus: "PAID" },
      { code: "MS5-7", orderName: "#2", amount: 25, currency: "EUR", financialStatus: "PAID" },
    ],
  });
  const s = summariseRevenue([...ledger, ...extra]);
  assert.equal(s.orders, 2);
  assert.equal(s.revenue, 125);
  assert.deepEqual(s.withMoCode, { orders: 2, revenue: 125 });
});

test("markConsultedLines flags products from the consultation", () => {
  const lines = markConsultedLines(
    [
      { title: "ATX® Rack", quantity: 2, price: "10.5", handle: "atx®-rack" },
      { title: "Matte", quantity: 0, price: null, handle: null },
      { title: "", handle: "x" },
    ],
    ["ATX-rack"]
  );
  assert.deepEqual(lines[0], { title: "ATX® Rack", quantity: 2, price: 10.5, consulted: true });
  assert.equal(lines[1].quantity, 1);
  assert.equal(lines[1].consulted, false);
  assert.equal(lines[2].title, "Unbenannter Artikel");
  assert.deepEqual(markConsultedLines(null, []), []);
});

test("daysAfterChat in whole days, never negative", () => {
  assert.equal(daysAfterChat("2026-08-01T10:00:00Z", "2026-08-03T09:00:00Z"), 1);
  assert.equal(daysAfterChat("2026-08-01T10:00:00Z", "2026-08-01T12:00:00Z"), 0);
  assert.equal(daysAfterChat("2026-08-02T10:00:00Z", "2026-08-01T12:00:00Z"), 0);
  assert.equal(daysAfterChat(null, "2026-08-01T12:00:00Z"), null);
});

test("orderPathSummary tells what happened", () => {
  const assisted = orderPathSummary({
    channel: "beraten_gekauft",
    lastChatAt: "2026-08-10T10:00:00Z",
    processedAt: "2026-08-12T11:00:00Z",
    lines: [{ consulted: true }, { consulted: false }],
  });
  assert.deepEqual(assisted, { lead: "Beraten am 10.08.", lag: "2 Tage später gekauft", match: "1 von 2 Produkten aus der Beratung" });
  assert.equal(
    orderPathSummary({ channel: "beraten_anderes", lastChatAt: null, processedAt: null, lines: [{ consulted: false }] }).match,
    "kein Produkt aus der Beratung"
  );
  assert.equal(orderPathSummary({ channel: "kampagne", moCodes: ["MK-AB"] }).lead, "Kampagnen-Code MK-AB eingelöst");
  assert.equal(
    orderPathSummary({ channel: "marketing", moCodes: ["MS5-1"], origin: "shopify_code" }).lag,
    "per Code-Abgleich in Shopify gefunden"
  );
  assert.equal(orderPathSummary({ channel: "set" }).lead, "Set-Angebot über den Mo-Link gekauft");
  assert.equal(orderPathSummary({ channel: "sonstig" }).lead, "Direkt über Mo zugeordnet");
});

test("revenuePerAiEuro needs a positive cost", () => {
  assert.equal(revenuePerAiEuro(1000, 8), 125);
  assert.equal(revenuePerAiEuro(1000, 0), null);
  assert.equal(revenuePerAiEuro(null, 3), null);
});

test("orderTrendPoints sums a long daily series per week", () => {
  const days = Array.from({ length: 30 }, (_, i) => ({ start: `2026-08-${String(i + 1).padStart(2, "0")}`, orders: i % 2 }));
  const pts = orderTrendPoints(days, "day");
  assert.equal(pts.length, 5);
  assert.deepEqual(pts[0], { x: "2026-08-01", y: 3 });
  assert.deepEqual(pts[4], { x: "2026-08-29", y: 1 });
  assert.equal(orderTrendPoints(days.slice(0, 7), "day").length, 7);
  assert.equal(orderTrendPoints(days, "week").length, 30);
  assert.deepEqual(orderTrendPoints(null, "day"), []);
});

test("every channel has a short chip label", () => {
  for (const c of REVENUE_CHANNELS) assert.ok(c.short && c.short.length <= 20, c.key);
});

test("drillInsights: median days and orders with a consulted product", () => {
  const r = (o) => ({ realised: true, tier: "assisted", daysAfterChat: null, lines: [], ...o });
  const out = drillInsights([
    r({ daysAfterChat: 0, lines: [{ consulted: true }] }),
    r({ daysAfterChat: 4, tier: "influenced", lines: [{ consulted: false }] }),
    r({ daysAfterChat: 2, tier: "direct" }),
    r({ daysAfterChat: 9, realised: false }),
    r({ daysAfterChat: 1, lines: [{ consulted: false }, { consulted: true }] }),
  ]);
  assert.deepEqual(out, { medianDaysToOrder: 1.5, ordersWithChat: 4, consultingOrders: 3, withConsultedProduct: 2 });
  assert.equal(drillInsights([]).medianDaysToOrder, null);
  assert.equal(drillInsights([r({ daysAfterChat: 3 })]).medianDaysToOrder, 3);
});
