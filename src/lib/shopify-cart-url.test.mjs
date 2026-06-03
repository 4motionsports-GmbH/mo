import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHOP_DOMAIN,
  buildCartPermalink,
  buildShopifyCartUrl,
  parseNumericVariantId,
} from "./shopify-cart-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// A cart URL the storefront accepts: a numeric variant id, either as a
// permalink (`/cart/<digits>:<digits>`) or the add form (`/cart/add?id=<digits>`).
const VALID_CART_URL = /\/cart\/(?:\d+:\d+|add\?id=\d+)$/;
// Anything with a SKU-style token (letters/dashes) after `/cart/` is broken.
const SKU = "MS-ATX-FMB-800-B";

test("parseNumericVariantId pulls the numeric id from a variant GID", () => {
  assert.equal(
    parseNumericVariantId("gid://shopify/ProductVariant/40123456789"),
    "40123456789"
  );
});

test("parseNumericVariantId accepts a bare numeric id", () => {
  assert.equal(parseNumericVariantId("40123456789"), "40123456789");
  assert.equal(parseNumericVariantId(40123456789), "40123456789");
});

test("parseNumericVariantId rejects SKUs, handles and empties", () => {
  assert.equal(parseNumericVariantId(SKU), null);
  assert.equal(parseNumericVariantId("MS-VP150-50-ATX-GB"), null);
  assert.equal(parseNumericVariantId("some-product-handle"), null);
  assert.equal(parseNumericVariantId(""), null);
  assert.equal(parseNumericVariantId(null), null);
  assert.equal(parseNumericVariantId(undefined), null);
});

test("buildShopifyCartUrl emits a numeric permalink for qty 1", () => {
  const url = buildShopifyCartUrl("gid://shopify/ProductVariant/40123456789");
  assert.equal(url, `${SHOP_DOMAIN}/cart/40123456789:1`);
  assert.match(url, VALID_CART_URL);
  assert.ok(!url.includes(SKU));
});

test("buildShopifyCartUrl defaults quantity to 1 and never goes below 1", () => {
  assert.equal(buildShopifyCartUrl("123").endsWith(":1"), true);
  assert.equal(buildShopifyCartUrl("123", 0).endsWith(":1"), true);
  assert.equal(buildShopifyCartUrl("123", -5).endsWith(":1"), true);
  assert.equal(buildShopifyCartUrl("123", 3).endsWith(":3"), true);
});

test("buildShopifyCartUrl returns null for a SKU (so callers omit the field)", () => {
  assert.equal(buildShopifyCartUrl(SKU), null);
  assert.equal(buildShopifyCartUrl(null), null);
  assert.equal(buildShopifyCartUrl(undefined), null);
});

test("buildCartPermalink chains multiple variants into one prefilled cart", () => {
  const url = buildCartPermalink([
    "gid://shopify/ProductVariant/111",
    "222",
  ]);
  assert.equal(url, `${SHOP_DOMAIN}/cart/111:1,222:1`);
});

test("buildCartPermalink de-dupes variants and skips unresolvable ids", () => {
  const url = buildCartPermalink(["111", SKU, "111", "222", null]);
  assert.equal(url, `${SHOP_DOMAIN}/cart/111:1,222:1`);
});

test("buildCartPermalink appends an encoded discount code when given", () => {
  const url = buildCartPermalink(["111"], { discountCode: "SOMMER 25" });
  assert.equal(url, `${SHOP_DOMAIN}/cart/111:1?discount=SOMMER%2025`);
});

test("buildCartPermalink returns null when nothing resolves", () => {
  assert.equal(buildCartPermalink([SKU, null, undefined]), null);
  assert.equal(buildCartPermalink([]), null);
});

test("the bundled catalog never emits a SKU-based cart URL", async () => {
  const raw = await readFile(
    path.join(ROOT, "src/data/product-catalog.json"),
    "utf8"
  );
  const products = JSON.parse(raw);
  assert.ok(Array.isArray(products) && products.length > 0);

  for (const p of products) {
    if (p.shopifyCartUrl == null) continue; // omitted is allowed (graceful degrade)
    assert.match(
      p.shopifyCartUrl,
      VALID_CART_URL,
      `product ${p.id} has a non-numeric cart URL: ${p.shopifyCartUrl}`
    );
    // The id segment after /cart/ must be purely numeric — no SKU leakage.
    const idPart = p.shopifyCartUrl.replace(/^.*\/cart\//, "").replace(/^add\?id=/, "");
    assert.match(
      idPart,
      /^\d+(?::\d+)?$/,
      `product ${p.id} cart URL contains a non-numeric id: ${p.shopifyCartUrl}`
    );
  }
});
