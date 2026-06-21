import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeRedemptions,
  isRealisedFinancialStatus,
} from "./kpi-revenue-core.mjs";

test("isRealisedFinancialStatus only accepts paid/partially-refunded", () => {
  assert.equal(isRealisedFinancialStatus("PAID"), true);
  assert.equal(isRealisedFinancialStatus("partially_refunded"), true);
  assert.equal(isRealisedFinancialStatus("PENDING"), false);
  assert.equal(isRealisedFinancialStatus("AUTHORIZED"), false);
  assert.equal(isRealisedFinancialStatus("REFUNDED"), false);
  assert.equal(isRealisedFinancialStatus("VOIDED"), false);
  assert.equal(isRealisedFinancialStatus(null), false);
  assert.equal(isRealisedFinancialStatus(undefined), false);
  assert.equal(isRealisedFinancialStatus(""), false);
});

test("sums realised revenue and counts the orders", () => {
  const out = summarizeRedemptions([
    { status: "redeemed", amount: 100.5, currency: "EUR", financialStatus: "PAID" },
    { status: "redeemed", amount: 49.5, currency: "EUR", financialStatus: "PARTIALLY_REFUNDED" },
    { status: "not_redeemed" },
  ]);
  assert.deepEqual(out, {
    revenueAmount: 150,
    currency: "EUR",
    orderCount: 2,
    redemptionUnknown: 0,
    codesChecked: 3,
  });
});

test("excludes redeemed-but-unpaid orders from revenue", () => {
  const out = summarizeRedemptions([
    { status: "redeemed", amount: 80, currency: "EUR", financialStatus: "PENDING" },
    { status: "redeemed", amount: 20, currency: "EUR", financialStatus: "PAID" },
  ]);
  assert.equal(out.revenueAmount, 20);
  assert.equal(out.orderCount, 1);
});

test("counts unknown lookups separately and never as zero revenue", () => {
  const out = summarizeRedemptions([
    { status: "unknown" },
    { status: "unknown" },
    { status: "redeemed", amount: 33.33, currency: "EUR", financialStatus: "PAID" },
  ]);
  assert.equal(out.redemptionUnknown, 2);
  assert.equal(out.orderCount, 1);
  assert.equal(out.revenueAmount, 33.33);
});

test("ignores bad/negative amounts and missing money", () => {
  const out = summarizeRedemptions([
    { status: "redeemed", amount: null, currency: "EUR", financialStatus: "PAID" },
    { status: "redeemed", amount: -5, currency: "EUR", financialStatus: "PAID" },
    { status: "redeemed", amount: Number.NaN, currency: "EUR", financialStatus: "PAID" },
  ]);
  assert.equal(out.revenueAmount, 0);
  assert.equal(out.orderCount, 0);
  assert.equal(out.currency, null);
});

test("rounds summed money to cents (no float drift)", () => {
  const out = summarizeRedemptions([
    { status: "redeemed", amount: 0.1, currency: "EUR", financialStatus: "PAID" },
    { status: "redeemed", amount: 0.2, currency: "EUR", financialStatus: "PAID" },
  ]);
  assert.equal(out.revenueAmount, 0.3);
});

test("handles empty / non-array input", () => {
  const zero = {
    revenueAmount: 0,
    currency: null,
    orderCount: 0,
    redemptionUnknown: 0,
    codesChecked: 0,
  };
  assert.deepEqual(summarizeRedemptions([]), zero);
  assert.deepEqual(summarizeRedemptions(null), zero);
  assert.deepEqual(summarizeRedemptions(undefined), zero);
});
