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

test("accepts a signature under any of several secrets (store key or app secret)", () => {
  const appSecret = "shpss_app_secret";
  const evt = verifyShopifyWebhook({ rawBody: BODY, hmacHeader: sign(BODY, appSecret), secret: [SECRET, null, appSecret] });
  assert.equal(evt.handle, "power-rack");
  assert.throws(
    () => verifyShopifyWebhook({ rawBody: BODY, hmacHeader: sign(BODY, "other"), secret: [SECRET, appSecret] }),
    /Invalid Shopify webhook signature/
  );
  assert.throws(() => verifyShopifyWebhook({ rawBody: BODY, hmacHeader: sign(BODY), secret: [null, ""] }), /not configured/);
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

test("classifyShopifyTopic routes every platform topic", async () => {
  const { classifyShopifyTopic } = await import("./shopify-webhook.mjs");
  assert.equal(classifyShopifyTopic("products/update"), "catalog");
  assert.equal(classifyShopifyTopic("inventory_levels/connect"), "catalog");
  assert.equal(classifyShopifyTopic("orders/updated"), "order");
  assert.equal(classifyShopifyTopic("ORDERS/PAID"), "order");
  assert.equal(classifyShopifyTopic("customers/update"), "customer");
  assert.equal(classifyShopifyTopic("customers_email_marketing_consent/update"), "consent");
  assert.equal(classifyShopifyTopic("customers/delete"), "customer_delete");
  assert.equal(classifyShopifyTopic("customers/redact"), "compliance");
  assert.equal(classifyShopifyTopic("shop/redact"), "compliance");
  assert.equal(classifyShopifyTopic("bulk_operations/finish"), "bulk");
  assert.equal(classifyShopifyTopic("app/uninstalled"), "other");
  assert.equal(classifyShopifyTopic(null), "other");
});

test("only mirror writes wait for the customer sync switch", async () => {
  const { classifyShopifyTopic, webhookNeedsCustomerSync } = await import("./shopify-webhook.mjs");
  const needs = (t) => webhookNeedsCustomerSync(classifyShopifyTopic(t));
  assert.equal(needs("customers/create"), true);
  assert.equal(needs("customers/update"), true);
  assert.equal(needs("customers_email_marketing_consent/update"), true);
  assert.equal(needs("orders/create"), true);
  // Deletions and the compliance topics are honoured whatever the switch says.
  assert.equal(needs("customers/delete"), false);
  assert.equal(needs("customers/redact"), false);
  assert.equal(needs("customers/data_request"), false);
  assert.equal(needs("shop/redact"), false);
  assert.equal(needs("bulk_operations/finish"), false);
  assert.equal(needs("products/update"), false);
});
