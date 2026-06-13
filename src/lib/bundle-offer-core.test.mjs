import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NATIVE_FIXED_BUNDLE,
  PLAIN_UNLISTED_PRODUCT,
  resolveBundleCreationMode,
  pickBundleCreator,
  toCents,
  centsToMoney,
  computeComponentsSum,
  computeCompareAtPrice,
  validateAndSnapshotComponents,
  isExpired,
  runBundleExpirySweep,
} from "./bundle-offer-core.mjs";

// ── Money helpers ─────────────────────────────────────────────────────────────

test("toCents parses numbers, decimal strings and a German comma", () => {
  assert.equal(toCents(149), 14900);
  assert.equal(toCents("149.00"), 14900);
  assert.equal(toCents("6,50"), 650);
  assert.equal(toCents(" 12.34 "), 1234);
});

test("toCents rejects junk and negatives", () => {
  assert.equal(toCents(null), null);
  assert.equal(toCents(""), null);
  assert.equal(toCents("abc"), null);
  assert.equal(toCents(-1), null);
});

test("centsToMoney formats back to a 2-decimal string", () => {
  assert.equal(centsToMoney(14900), "149.00");
  assert.equal(centsToMoney(650), "6.50");
  assert.equal(centsToMoney(5), "0.05");
});

// ── components_sum ────────────────────────────────────────────────────────────

test("computeComponentsSum sums unitPrice * quantity with no float drift", () => {
  const sum = computeComponentsSum([
    { unitPrice: "149.00", quantity: 1 },
    { unitPrice: "6.50", quantity: 30 },
  ]);
  // 149.00 + 30*6.50 = 344.00
  assert.equal(sum, "344.00");
});

test("computeComponentsSum defaults quantity to 1 and avoids 0.1+0.2 drift", () => {
  assert.equal(computeComponentsSum([{ unitPrice: "0.10" }, { unitPrice: "0.20" }]), "0.30");
});

test("computeComponentsSum throws on an unpriceable component", () => {
  assert.throws(() => computeComponentsSum([{ unitPrice: "nope" }]));
});

// ── compareAtPrice rule (PAngV) ──────────────────────────────────────────────

test("compareAtPrice is set only when the bundle is genuinely cheaper", () => {
  // price < sum  → compare-at = sum (a real saving)
  assert.equal(computeCompareAtPrice("299.00", "344.00"), "344.00");
});

test("compareAtPrice is NULL when price >= sum (never invent a strike price)", () => {
  // price == sum → no compare-at
  assert.equal(computeCompareAtPrice("344.00", "344.00"), null);
  // price > sum  → no compare-at
  assert.equal(computeCompareAtPrice("400.00", "344.00"), null);
});

// ── seam selection per BUNDLE_CREATION_MODE ──────────────────────────────────

test("resolveBundleCreationMode defaults to native and round-trips known modes", () => {
  assert.equal(resolveBundleCreationMode(undefined), NATIVE_FIXED_BUNDLE);
  assert.equal(resolveBundleCreationMode(""), NATIVE_FIXED_BUNDLE);
  assert.equal(resolveBundleCreationMode("garbage"), NATIVE_FIXED_BUNDLE);
  assert.equal(resolveBundleCreationMode("native_fixed_bundle"), NATIVE_FIXED_BUNDLE);
  assert.equal(resolveBundleCreationMode(" plain_unlisted_product "), PLAIN_UNLISTED_PRODUCT);
});

test("pickBundleCreator dispatches to the impl for the selected mode", () => {
  const creators = {
    [NATIVE_FIXED_BUNDLE]: () => "native",
    [PLAIN_UNLISTED_PRODUCT]: () => "plain",
  };
  assert.equal(pickBundleCreator(creators, NATIVE_FIXED_BUNDLE)(), "native");
  assert.equal(pickBundleCreator(creators, PLAIN_UNLISTED_PRODUCT)(), "plain");
  assert.throws(() => pickBundleCreator(creators, "unknown_mode"));
});

// ── sold-out rejection + snapshot ─────────────────────────────────────────────

function catalog(products) {
  return new Map(products.map((p) => [p.id, p]));
}

const IN_STOCK_A = {
  id: "atx-bar",
  name: "ATX Bar",
  price: 149,
  currency: "EUR",
  shopifyVariantId: "gid://shopify/ProductVariant/111",
  inStock: true,
};
const IN_STOCK_B = {
  id: "atx-bands",
  name: "ATX Bands",
  price: 6.5,
  currency: "EUR",
  shopifyVariantId: "222",
  inStock: true,
};

test("validateAndSnapshotComponents rejects sold-out components, listing offenders", () => {
  const cat = catalog([IN_STOCK_A, { ...IN_STOCK_B, inStock: false }]);
  const result = validateAndSnapshotComponents(cat, [
    { productId: "atx-bar" },
    { productId: "atx-bands" },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "sold_out");
  assert.deepEqual(result.soldOut, ["atx-bands"]);
});

test("validateAndSnapshotComponents rejects unknown products", () => {
  const cat = catalog([IN_STOCK_A]);
  const result = validateAndSnapshotComponents(cat, [{ productId: "nope" }]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown_products");
  assert.deepEqual(result.unknown, ["nope"]);
});

test("validateAndSnapshotComponents rejects an empty component list", () => {
  assert.equal(validateAndSnapshotComponents(catalog([]), []).reason, "empty");
});

test("validateAndSnapshotComponents snapshots price + numeric variant id", () => {
  const cat = catalog([IN_STOCK_A, IN_STOCK_B]);
  const result = validateAndSnapshotComponents(cat, [
    { productId: "atx-bar", quantity: 2 },
    { productId: "atx-bands", quantity: 30 },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.components[0], {
    productId: "atx-bar",
    title: "ATX Bar",
    variantId: "gid://shopify/ProductVariant/111",
    numericVariantId: "111",
    quantity: 2,
    unitPrice: "149.00",
    currency: "EUR",
  });
  // bare numeric variant id is preserved as numericVariantId
  assert.equal(result.components[1].numericVariantId, "222");
  // sum honours the snapshot prices + quantities: 2*149 + 30*6.50 = 493.00
  assert.equal(computeComponentsSum(result.components), "493.00");
});

test("validateAndSnapshotComponents prefers salePrice as the unit price", () => {
  const cat = catalog([{ ...IN_STOCK_A, salePrice: 99 }]);
  const result = validateAndSnapshotComponents(cat, [{ productId: "atx-bar" }]);
  assert.equal(result.components[0].unitPrice, "99.00");
});

// ── expiry ────────────────────────────────────────────────────────────────────

test("isExpired compares against now", () => {
  const now = Date.UTC(2026, 5, 13);
  assert.equal(isExpired({ expiresAt: new Date(now - 1000).toISOString() }, now), true);
  assert.equal(isExpired({ expiresAt: new Date(now + 1000).toISOString() }, now), false);
  assert.equal(isExpired({ expiresAt: null }, now), false);
});

// ── expiry-cron idempotency ──────────────────────────────────────────────────

test("runBundleExpirySweep archives due offers and is a no-op on re-run", async () => {
  // Simulate the store: a guarded markExpired flips active→expired, so the
  // second fetch (active-only) returns nothing — the idempotency guarantee.
  let store = [{ id: 1, status: "active", shopifyProductId: "gid://shopify/Product/9" }];
  const archived = [];
  const deps = {
    fetchDueOffers: async () =>
      store
        .filter((o) => o.status === "active")
        .map((o) => ({ id: o.id, shopifyProductId: o.shopifyProductId })),
    archiveProduct: async (pid) => {
      archived.push(pid);
    },
    markExpired: async (id) => {
      const o = store.find((x) => x.id === id);
      if (o && o.status === "active") o.status = "expired"; // guarded flip
    },
    onError: () => {},
  };

  const first = await runBundleExpirySweep(deps);
  assert.deepEqual(first, { archived: 1, failed: 0, scanned: 1 });
  assert.deepEqual(archived, ["gid://shopify/Product/9"]);

  // Re-run: nothing is due, nothing is archived again.
  const second = await runBundleExpirySweep(deps);
  assert.deepEqual(second, { archived: 0, failed: 0, scanned: 0 });
  assert.equal(archived.length, 1);
});

test("runBundleExpirySweep keeps a failed archive due for the next run", async () => {
  const store = [{ id: 7, status: "active", shopifyProductId: "gid://shopify/Product/7" }];
  let attempt = 0;
  const errors = [];
  const deps = {
    fetchDueOffers: async () =>
      store
        .filter((o) => o.status === "active")
        .map((o) => ({ id: o.id, shopifyProductId: o.shopifyProductId })),
    archiveProduct: async () => {
      attempt++;
      if (attempt === 1) throw new Error("Shopify 500");
    },
    markExpired: async (id) => {
      const o = store.find((x) => x.id === id);
      if (o && o.status === "active") o.status = "expired";
    },
    onError: (err) => errors.push(err),
  };

  const first = await runBundleExpirySweep(deps);
  assert.deepEqual(first, { archived: 0, failed: 1, scanned: 1 });
  assert.equal(errors.length, 1); // failure logged loudly
  assert.equal(store[0].status, "active"); // NOT marked expired — stays due

  // Next run succeeds and clears it.
  const second = await runBundleExpirySweep(deps);
  assert.deepEqual(second, { archived: 1, failed: 0, scanned: 1 });
  assert.equal(store[0].status, "expired");
});
