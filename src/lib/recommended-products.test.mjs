import { test } from "node:test";
import assert from "node:assert/strict";

import {
  productIdsFromToolCall,
  collectDiscussedProductIds,
  latestSelectedProductIds,
  recommendedCardIdsInOrder,
  guardRecommendedCardIds,
  selectRecommendedCards,
} from "./recommended-products.mjs";

// Tiny catalog: `omega` (the named/recommended product) + two retrieved-but-
// not-recommended candidates, one sold-out item, all keyed by id.
const CATALOG = {
  omega: { id: "omega", name: "Horizon Fitness Omega Z", inStock: true },
  cand1: { id: "cand1", name: "Retrieved Candidate 1", inStock: true },
  cand2: { id: "cand2", name: "Retrieved Candidate 2", inStock: true },
  soldout: { id: "soldout", name: "Sold Out Treadmill", inStock: false },
};
const show = (productId, reason) => ({ toolName: "show_product", input: { productId, reason } });
const cart = (productIds) => ({ toolName: "add_to_cart", input: { productIds, message: "x" } });
const compare = (productIds) => ({ toolName: "compare_products", input: { productIds } });

test("productIdsFromToolCall reads both productId and productIds, ignores non-product tools", () => {
  assert.deepEqual(productIdsFromToolCall(show("omega")), ["omega"]);
  assert.deepEqual(productIdsFromToolCall(cart(["a", "b"])), ["a", "b"]);
  assert.deepEqual(
    productIdsFromToolCall({ toolName: "update_customer_profile", input: { segment: "private" } }),
    []
  );
  assert.deepEqual(productIdsFromToolCall({ toolName: "show_product", input: null }), []);
  assert.deepEqual(productIdsFromToolCall(null), []);
});

test("recommendedCardIdsInOrder = show_product ids in call order, deduped", () => {
  const calls = [show("omega"), show("cand1"), show("omega")];
  assert.deepEqual(recommendedCardIdsInOrder(calls), ["omega", "cand1"]);
});

test("recommendedCardIdsInOrder ignores compare_products and add_to_cart (only show_product declares a recommendation card)", () => {
  // The model compares cand1/cand2 but recommends only omega in prose+card.
  const calls = [compare(["cand1", "cand2"]), show("omega"), cart(["omega"])];
  assert.deepEqual(recommendedCardIdsInOrder(calls), ["omega"]);
});

test("a named/recommended product appears as a card; retrieved-but-not-recommended products do NOT", () => {
  // cand1 + cand2 were retrieved for context (in the catalog) but the model only
  // recommended (show_product'd) omega. The card set must be exactly [omega].
  const turnToolCalls = [show("omega", "Leise und klappbar — passt in die Wohnung.")];
  const { cardIds, droppedUnknown, droppedSoldOut } = selectRecommendedCards(turnToolCalls, CATALOG);
  assert.deepEqual(cardIds, ["omega"]);
  assert.equal(droppedUnknown.length, 0);
  assert.equal(droppedSoldOut.length, 0);
  // Hard assertion: the retrieved-but-not-recommended candidates are never carded.
  assert.ok(!cardIds.includes("cand1"));
  assert.ok(!cardIds.includes("cand2"));
});

test("availability guard: a sold-out recommended id is dropped (never carded)", () => {
  const calls = [show("omega"), show("soldout")];
  const { cardIds, droppedSoldOut } = selectRecommendedCards(calls, CATALOG);
  assert.deepEqual(cardIds, ["omega"]);
  assert.deepEqual(droppedSoldOut, ["soldout"]);
});

test("membership guard: an unknown / hallucinated id is dropped (never carded)", () => {
  const calls = [show("omega"), show("does-not-exist")];
  const { cardIds, droppedUnknown } = selectRecommendedCards(calls, CATALOG);
  assert.deepEqual(cardIds, ["omega"]);
  assert.deepEqual(droppedUnknown, ["does-not-exist"]);
});

test("guard preserves recommendation order", () => {
  const calls = [show("cand2"), show("omega"), show("cand1")];
  assert.deepEqual(selectRecommendedCards(calls, CATALOG).cardIds, ["cand2", "omega", "cand1"]);
});

test("guardRecommendedCardIds accepts a Map catalog too", () => {
  const map = new Map(Object.entries(CATALOG));
  const { cardIds, droppedSoldOut } = guardRecommendedCardIds(["omega", "soldout"], map);
  assert.deepEqual(cardIds, ["omega"]);
  assert.deepEqual(droppedSoldOut, ["soldout"]);
});

test("collectDiscussedProductIds spans every product tool, deduped, first-seen order", () => {
  const calls = [compare(["cand1", "cand2"]), show("omega"), cart(["omega"]), show("cand1")];
  assert.deepEqual(collectDiscussedProductIds(calls), ["cand1", "cand2", "omega"]);
});

test("latestSelectedProductIds: latest add_to_cart replaces earlier ones; null when none", () => {
  assert.equal(latestSelectedProductIds([show("omega")]), null);
  const switched = [cart(["cand1"]), show("omega"), cart(["omega"])];
  assert.deepEqual(latestSelectedProductIds(switched), ["omega"]);
});

test("empty / missing tool calls never throw", () => {
  assert.deepEqual(recommendedCardIdsInOrder(undefined), []);
  assert.deepEqual(collectDiscussedProductIds([]), []);
  assert.equal(latestSelectedProductIds([]), null);
  assert.deepEqual(guardRecommendedCardIds(undefined, CATALOG).cardIds, []);
});
