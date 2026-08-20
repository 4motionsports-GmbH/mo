import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pendingEntry,
  parsePendingEntry,
  gateCooldownMs,
  GATE_MIN_MS,
  GATE_EXHAUSTED_MS,
} from "./shopify-backpressure.mjs";
import { THROTTLE_MAX_WAIT_MS } from "./shopify-throttle.mjs";

test("pendingEntry encodes a product / inventory-item target", () => {
  assert.equal(
    pendingEntry("product", "gid://shopify/Product/123"),
    "product:gid://shopify/Product/123"
  );
  assert.equal(
    pendingEntry("inventory_item", "gid://shopify/InventoryItem/456"),
    "inventory_item:gid://shopify/InventoryItem/456"
  );
});

test("pendingEntry rejects unknown kinds and non-GID ids", () => {
  assert.equal(pendingEntry("order", "gid://shopify/Order/1"), null);
  assert.equal(pendingEntry("product", "123"), null); // numeric id, not a GID
  assert.equal(pendingEntry("product", ""), null);
  assert.equal(pendingEntry("product", null), null);
});

test("parsePendingEntry round-trips what pendingEntry produced", () => {
  const entry = pendingEntry("product", "gid://shopify/Product/123");
  assert.deepEqual(parsePendingEntry(entry), {
    kind: "product",
    gid: "gid://shopify/Product/123",
  });
  const inv = pendingEntry("inventory_item", "gid://shopify/InventoryItem/456");
  assert.deepEqual(parsePendingEntry(inv), {
    kind: "inventory_item",
    gid: "gid://shopify/InventoryItem/456",
  });
});

test("parsePendingEntry rejects malformed / foreign set values", () => {
  assert.equal(parsePendingEntry("order:gid://shopify/Order/1"), null); // unknown kind
  assert.equal(parsePendingEntry("product:123"), null); // not a GID
  assert.equal(parsePendingEntry("no-separator"), null);
  assert.equal(parsePendingEntry(""), null);
  assert.equal(parsePendingEntry(null), null);
  assert.equal(parsePendingEntry(42), null);
});

test("gateCooldownMs uses the computed wait, clamped to [floor, throttle cap]", () => {
  assert.equal(gateCooldownMs({ waitMs: 5_000 }), 5_000);
  // Sub-second deficit still gates for the floor — a same-second burst must defer.
  assert.equal(gateCooldownMs({ waitMs: 120 }), GATE_MIN_MS);
  assert.equal(gateCooldownMs({ waitMs: 10 ** 9 }), THROTTLE_MAX_WAIT_MS);
  // Missing/invalid wait → floor, never 0 (an instantly-expiring gate is no gate).
  assert.equal(gateCooldownMs({}), GATE_MIN_MS);
  assert.equal(gateCooldownMs(), GATE_MIN_MS);
  assert.equal(gateCooldownMs({ waitMs: -5 }), GATE_MIN_MS);
});

test("an exhausted retry cap holds the gate for the longer fixed cooldown", () => {
  assert.equal(gateCooldownMs({ exhausted: true }), GATE_EXHAUSTED_MS);
  assert.equal(gateCooldownMs({ waitMs: 2_000, exhausted: true }), GATE_EXHAUSTED_MS);
  assert.ok(GATE_EXHAUSTED_MS > GATE_MIN_MS);
});
