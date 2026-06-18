import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyShopifyWebhook,
  isValidShopifyWebhook,
  planCatalogAction,
  toProductGid,
} from "./shopify-webhook.mjs";

const SECRET = "shpss_test_secret";
// Shopify signs base64(HMAC-SHA256(rawBody, secret)) in X-Shopify-Hmac-SHA256.
const sign = (body, secret = SECRET) =>
  createHmac("sha256", secret).update(body, "utf8").digest("base64");

const BODY = JSON.stringify({ id: 123, handle: "power-rack", admin_graphql_api_id: "gid://shopify/Product/123" });

test("verifies a valid signature and returns the parsed event", () => {
  const evt = verifyShopifyWebhook({ rawBody: BODY, hmacHeader: sign(BODY), secret: SECRET });
  assert.equal(evt.handle, "power-rack");
});

test("isValidShopifyWebhook returns true/false for good/bad signatures", () => {
  assert.equal(isValidShopifyWebhook({ rawBody: BODY, hmacHeader: sign(BODY), secret: SECRET }), true);
  assert.equal(isValidShopifyWebhook({ rawBody: BODY, hmacHeader: "AAAA", secret: SECRET }), false);
});

test("rejects a tampered body (signature no longer matches)", () => {
  const sig = sign(BODY);
  assert.throws(
    () => verifyShopifyWebhook({ rawBody: BODY + " ", hmacHeader: sig, secret: SECRET }),
    /Invalid Shopify webhook signature/
  );
});

test("rejects a signature made with a different secret", () => {
  const sig = sign(BODY, "wrong_secret");
  assert.throws(
    () => verifyShopifyWebhook({ rawBody: BODY, hmacHeader: sig, secret: SECRET }),
    /Invalid Shopify webhook signature/
  );
});

test("throws when the HMAC header is missing", () => {
  assert.throws(
    () => verifyShopifyWebhook({ rawBody: BODY, hmacHeader: null, secret: SECRET }),
    /Missing X-Shopify-Hmac-SHA256 header/
  );
});

test("throws when no secret is configured (fail closed)", () => {
  assert.throws(
    () => verifyShopifyWebhook({ rawBody: BODY, hmacHeader: sign(BODY), secret: "" }),
    /not configured/
  );
});

test("toProductGid normalises a numeric id to a GID", () => {
  assert.equal(toProductGid(123), "gid://shopify/Product/123");
  assert.equal(toProductGid("gid://shopify/Product/9"), "gid://shopify/Product/9");
  assert.equal(toProductGid(null), null);
});

test("planCatalogAction routes topics to the right targeted action", () => {
  assert.deepEqual(
    planCatalogAction("products/update", { admin_graphql_api_id: "gid://shopify/Product/5" }),
    { action: "refresh-product", productGid: "gid://shopify/Product/5" }
  );
  assert.deepEqual(planCatalogAction("products/create", { id: 7 }), {
    action: "refresh-product",
    productGid: "gid://shopify/Product/7",
  });
  assert.deepEqual(planCatalogAction("products/delete", { id: 8 }), {
    action: "remove-product",
    productGid: "gid://shopify/Product/8",
  });
  assert.deepEqual(planCatalogAction("inventory_levels/update", { inventory_item_id: 42 }), {
    action: "refresh-inventory",
    inventoryItemGid: "gid://shopify/InventoryItem/42",
  });
  assert.equal(planCatalogAction("orders/create", {}).action, "ignore");
});
