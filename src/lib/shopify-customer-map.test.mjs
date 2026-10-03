import { test } from "node:test";
import assert from "node:assert/strict";
import {
  numericShopifyId,
  normalizeMirrorEmail,
  mapShopifyConsent,
  toShopifyConsentInput,
  mapShopifyCustomer,
  mapConsentWebhook,
  mapShopifyOrder,
  withCatalogHandles,
} from "./shopify-customer-map.mjs";

test("numericShopifyId accepts ids and GIDs only", () => {
  assert.equal(numericShopifyId("gid://shopify/Customer/123"), "123");
  assert.equal(numericShopifyId(456), "456");
  assert.equal(numericShopifyId(" 789 "), "789");
  assert.equal(numericShopifyId("gid://shopify/Order/5?x=1"), "5");
  assert.equal(numericShopifyId("abc"), null);
  assert.equal(numericShopifyId(null), null);
});

test("normalizeMirrorEmail lower-cases and rejects non-addresses", () => {
  assert.equal(normalizeMirrorEmail("  Anna@Example.DE "), "anna@example.de");
  assert.equal(normalizeMirrorEmail(""), null);
  assert.equal(normalizeMirrorEmail("no-at-sign"), null);
  assert.equal(normalizeMirrorEmail(undefined), null);
});

test("mapShopifyConsent reads GraphQL and REST shapes", () => {
  assert.deepEqual(
    mapShopifyConsent({ marketingState: "SUBSCRIBED", marketingOptInLevel: "CONFIRMED_OPT_IN", consentUpdatedAt: "2026-05-01T10:00:00Z" }),
    { state: "subscribed", level: "confirmed_opt_in", at: "2026-05-01T10:00:00.000Z" }
  );
  assert.deepEqual(
    mapShopifyConsent({ state: "unsubscribed", opt_in_level: "single_opt_in", consent_updated_at: null }),
    { state: "unsubscribed", level: "single_opt_in", at: null }
  );
  // A subscription without a level is "unknown", never silently confirmed.
  assert.equal(mapShopifyConsent({ marketingState: "SUBSCRIBED" }).level, "unknown");
  assert.equal(mapShopifyConsent({ state: "redacted" }).state, "redacted");
  assert.equal(mapShopifyConsent({ state: "weird" }), null);
  assert.equal(mapShopifyConsent(null), null);
});

test("toShopifyConsentInput maps back to the GraphQL enums", () => {
  assert.deepEqual(toShopifyConsentInput({ state: "subscribed", level: "confirmed_opt_in" }), {
    marketingState: "SUBSCRIBED",
    marketingOptInLevel: "CONFIRMED_OPT_IN",
  });
  assert.deepEqual(toShopifyConsentInput({ state: "unsubscribed", level: null }), {
    marketingState: "UNSUBSCRIBED",
    marketingOptInLevel: "UNKNOWN",
  });
  assert.equal(toShopifyConsentInput({ state: "not_subscribed" }).marketingState, "NOT_SUBSCRIBED");
});

test("mapShopifyCustomer handles a GraphQL node", () => {
  const c = mapShopifyCustomer({
    id: "gid://shopify/Customer/42",
    email: "Jonas@Example.com",
    firstName: "Jonas",
    lastName: " Keller ",
    locale: "de-DE",
    state: "ENABLED",
    tags: ["vip", " "],
    createdAt: "2024-01-02T03:04:05Z",
    updatedAt: "2026-09-01T00:00:00Z",
    defaultAddress: { countryCodeV2: "AT", address1: "Hidden 1" },
    emailMarketingConsent: { marketingState: "SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN", consentUpdatedAt: "2025-03-01T00:00:00Z" },
    phone: "+49123",
  });
  assert.equal(c.shopifyId, "42");
  assert.equal(c.gid, "gid://shopify/Customer/42");
  assert.equal(c.email, "jonas@example.com");
  assert.equal(c.lastName, "Keller");
  assert.equal(c.countryCode, "AT");
  assert.deepEqual(c.tags, ["vip"]);
  assert.equal(c.consent.state, "subscribed");
  assert.equal(c.consent.level, "single_opt_in");
  // Minimisation: nothing beyond the typed fields leaves the mapper.
  assert.equal("phone" in c, false);
  assert.equal(JSON.stringify(c).includes("Hidden"), false);
});

test("mapShopifyCustomer handles a REST webhook payload", () => {
  const c = mapShopifyCustomer({
    id: 77,
    email: null,
    first_name: "Lea",
    last_name: "Hoffmann",
    state: "disabled",
    tags: "newsletter, kraft",
    created_at: "2023-05-05T10:00:00+02:00",
    updated_at: "2026-09-30T10:00:00+02:00",
    default_address: { country_code: "de" },
    email_marketing_consent: { state: "not_subscribed", opt_in_level: null, consent_updated_at: null },
  });
  assert.equal(c.shopifyId, "77");
  assert.equal(c.email, null);
  assert.equal(c.firstName, "Lea");
  assert.equal(c.state, "DISABLED");
  assert.deepEqual(c.tags, ["newsletter", "kraft"]);
  assert.equal(c.countryCode, "DE");
  assert.equal(c.consent.state, "not_subscribed");
  assert.equal(c.createdAt, "2023-05-05T08:00:00.000Z");
});

test("mapShopifyCustomer refuses payloads without an id", () => {
  assert.equal(mapShopifyCustomer({ email: "a@b.de" }), null);
  assert.equal(mapShopifyCustomer(null), null);
});

test("mapConsentWebhook reads the consent topic payload", () => {
  const r = mapConsentWebhook({
    customer_id: 9,
    email_address: "X@Y.de",
    email_marketing_consent: { state: "subscribed", opt_in_level: "confirmed_opt_in", consent_updated_at: "2026-09-01T00:00:00Z" },
  });
  assert.deepEqual(r, {
    shopifyId: "9",
    email: "x@y.de",
    consent: { state: "subscribed", level: "confirmed_opt_in", at: "2026-09-01T00:00:00.000Z" },
  });
  assert.equal(mapConsentWebhook({ customer_id: 9 }), null);
});

test("mapShopifyOrder handles a GraphQL order with bulk child line items", () => {
  const o = mapShopifyOrder(
    {
      id: "gid://shopify/Order/1001",
      name: "#1001",
      processedAt: "2026-08-01T12:00:00Z",
      updatedAt: "2026-08-02T12:00:00Z",
      cancelledAt: null,
      displayFinancialStatus: "PARTIALLY_REFUNDED",
      displayFulfillmentStatus: "FULFILLED",
      currencyCode: "EUR",
      subtotalPriceSet: { shopMoney: { amount: "100.00" } },
      currentTotalPriceSet: { shopMoney: { amount: "89.90" } },
      totalRefundedSet: { shopMoney: { amount: "10.10" } },
      refunds: [
        { createdAt: "2026-08-05T08:00:00Z", totalRefundedSet: { shopMoney: { amount: "10.10" } } },
        { createdAt: "2026-08-09T08:00:00Z", totalRefundedSet: { shopMoney: { amount: "0.00" } } },
      ],
      discountCodes: ["MK-ABC", ""],
      sourceName: "web",
      customer: { id: "gid://shopify/Customer/42" },
      shippingAddress: { address1: "secret" },
    },
    [
      {
        id: "gid://shopify/LineItem/900",
        title: "Hantelbank X",
        variantTitle: "Schwarz",
        quantity: 2,
        originalUnitPriceSet: { shopMoney: { amount: "49.95" } },
        variant: { id: "gid://shopify/ProductVariant/55" },
        product: { id: "gid://shopify/Product/66", handle: "hantelbank-x" },
      },
    ]
  );
  assert.equal(o.shopifyOrderId, "1001");
  assert.equal(o.shopifyCustomerId, "42");
  assert.equal(o.financialStatus, "PARTIALLY_REFUNDED");
  assert.equal(o.totalCents, 8990);
  assert.equal(o.subtotalCents, 10000);
  assert.equal(o.refundedCents, 1010);
  assert.equal(o.lastRefundAt, "2026-08-05T08:00:00.000Z");
  assert.deepEqual(o.discountCodes, ["MK-ABC"]);
  assert.deepEqual(o.lineItems, [
    {
      id: "900",
      title: "Hantelbank X",
      variantTitle: "Schwarz",
      quantity: 2,
      unitPrice: 49.95,
      handle: "hantelbank-x",
      productId: "66",
      variantId: "55",
    },
  ]);
  assert.equal(JSON.stringify(o).includes("secret"), false);
});

test("mapShopifyOrder handles a REST orders webhook incl. refunds", () => {
  const o = mapShopifyOrder({
    id: 2002,
    admin_graphql_api_id: "gid://shopify/Order/2002",
    name: "#2002",
    created_at: "2026-09-01T10:00:00+02:00",
    processed_at: "2026-09-01T10:00:00+02:00",
    updated_at: "2026-09-03T10:00:00+02:00",
    financial_status: "paid",
    fulfillment_status: null,
    currency: "EUR",
    current_subtotal_price: "120.00",
    current_total_price: "120.00",
    discount_codes: [{ code: "MS5-XYZ", amount: "5.00" }],
    source_name: "web",
    customer: { id: 42, email: "jonas@example.com" },
    refunds: [
      { created_at: "2026-09-02T12:00:00+02:00", transactions: [{ kind: "refund", status: "success", amount: "20.00" }, { kind: "sale", amount: "1" }] },
      { created_at: "2026-09-03T09:00:00+02:00", transactions: [] }, // restock only: moves no money
      // a small follow-up (return shipping, 1.4 % of the order) never moves the date
      { created_at: "2026-09-04T09:00:00+02:00", transactions: [{ kind: "refund", status: "success", amount: "2.00" }] },
      { created_at: "2026-09-05T09:00:00+02:00", transactions: [{ kind: "refund", status: "pending", amount: "50.00" }] },
    ],
    line_items: [{ id: 31, title: "Matte", variant_title: null, quantity: 1, price: "120.00", variant_id: 7, product_id: 8 }],
  });
  assert.equal(o.shopifyOrderId, "2002");
  assert.equal(o.shopifyCustomerId, "42");
  assert.equal(o.financialStatus, "PAID");
  assert.equal(o.processedAt, "2026-09-01T08:00:00.000Z");
  assert.equal(o.refundedCents, 2200);
  assert.equal(o.lastRefundAt, "2026-09-02T10:00:00.000Z");
  assert.deepEqual(o.discountCodes, ["MS5-XYZ"]);
  assert.equal(o.lineItems[0].handle, null);
  assert.equal(o.lineItems[0].variantId, "7");
  assert.equal(o.lineItems[0].id, "31");
});

test("mapShopifyOrder refuses orders without id or date", () => {
  assert.equal(mapShopifyOrder({ name: "#1" }), null);
  assert.equal(mapShopifyOrder({ id: 1 }), null);
});

test("withCatalogHandles fills only the missing handles", () => {
  const items = [
    { id: null, title: "A", variantTitle: null, quantity: 1, unitPrice: 1, handle: "a", productId: null, variantId: null },
    { id: null, title: "B", variantTitle: null, quantity: 1, unitPrice: 1, handle: null, productId: null, variantId: "9" },
  ];
  const out = withCatalogHandles(items, () => ({ items: [{ handle: "x" }, { handle: "b", ref: "b~9" }] }));
  assert.equal(out[0].handle, "a");
  assert.equal(out[1].handle, "b");
  assert.equal(out[1].ref, "b~9");
  // Nothing missing → the matcher is not even called.
  assert.equal(withCatalogHandles([items[0]], () => { throw new Error("no"); })[0].handle, "a");
});
