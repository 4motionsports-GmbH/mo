import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withCartAttribution,
  isMoDiscountCode,
  parseOrderWebhook,
  hasMoMarker,
  matchOrderLineItems,
  classifyAttributionTier,
  isWithinAttributionWindow,
} from "./order-attribution.mjs";

// ---------------------------------------------------------------------------
// withCartAttribution
// ---------------------------------------------------------------------------

test("withCartAttribution appends attribute + ref to a bare permalink", () => {
  const url = withCartAttribution("https://motionsports.de/cart/40123:1", "tok_abc");
  assert.equal(
    url,
    "https://motionsports.de/cart/40123:1?attributes[_mo]=tok_abc&ref=mo"
  );
});

test("withCartAttribution uses & when the URL already has a query", () => {
  const url = withCartAttribution(
    "https://motionsports.de/cart/40123:1?discount=MS5-XYZ",
    "tok_abc"
  );
  assert.equal(
    url,
    "https://motionsports.de/cart/40123:1?discount=MS5-XYZ&attributes[_mo]=tok_abc&ref=mo"
  );
});

test("withCartAttribution URL-encodes the token value", () => {
  const url = withCartAttribution("https://x.de/cart/1:1", "a b&c");
  assert.ok(url.includes("attributes[_mo]=a%20b%26c"));
});

test("withCartAttribution passes the URL through when token is missing", () => {
  assert.equal(withCartAttribution("https://x.de/cart/1:1", null), "https://x.de/cart/1:1");
  assert.equal(withCartAttribution("https://x.de/cart/1:1", "  "), "https://x.de/cart/1:1");
});

test("withCartAttribution returns null for a null/empty URL", () => {
  assert.equal(withCartAttribution(null, "tok"), null);
  assert.equal(withCartAttribution("", "tok"), null);
});

// ---------------------------------------------------------------------------
// isMoDiscountCode
// ---------------------------------------------------------------------------

test("isMoDiscountCode accepts MS5- and MK- prefixes, case-insensitively", () => {
  assert.equal(isMoDiscountCode("MS5-A1B2C3"), true);
  assert.equal(isMoDiscountCode("ms5-a1b2c3"), true);
  assert.equal(isMoDiscountCode("MK-ZZZ"), true);
  assert.equal(isMoDiscountCode(" mk-1 "), true);
});

test("isMoDiscountCode rejects other codes and junk", () => {
  assert.equal(isMoDiscountCode("SUMMER10"), false);
  assert.equal(isMoDiscountCode("MS-123"), false);
  assert.equal(isMoDiscountCode(""), false);
  assert.equal(isMoDiscountCode(null), false);
});

// ---------------------------------------------------------------------------
// parseOrderWebhook
// ---------------------------------------------------------------------------

const ORDER_PAYLOAD = {
  id: 5678901234,
  admin_graphql_api_id: "gid://shopify/Order/5678901234",
  name: "#1042",
  created_at: "2026-08-01T10:00:00+02:00",
  processed_at: "2026-08-01T10:00:05+02:00",
  financial_status: "paid",
  currency: "EUR",
  total_price: "499.00",
  current_total_price: "479.00",
  discount_codes: [{ code: "MS5-ABC123", amount: "20.00", type: "percentage" }],
  note_attributes: [
    { name: "irrelevant", value: "x" },
    { name: "_mo", value: "tok_123" },
  ],
  line_items: [
    {
      title: "150 KG ATX® GYM Set",
      quantity: 1,
      price: "479.00",
      variant_id: 40123456789,
      product_id: 7001,
    },
  ],
  // Protected customer fields the parser must ignore entirely:
  email: "buyer@example.com",
  customer: { first_name: "Max", email: "buyer@example.com" },
  shipping_address: { city: "Berlin" },
};

test("parseOrderWebhook extracts the pseudonymous subset", () => {
  const parsed = parseOrderWebhook(ORDER_PAYLOAD);
  assert.equal(parsed.shopifyOrderId, "5678901234");
  assert.equal(parsed.orderName, "#1042");
  assert.equal(parsed.processedAt, "2026-08-01T10:00:05+02:00");
  assert.equal(parsed.financialStatus, "paid");
  assert.equal(parsed.currency, "EUR");
  assert.equal(parsed.totalPrice, 479);
  assert.deepEqual(parsed.discountCodes, ["MS5-ABC123"]);
  assert.equal(parsed.moToken, "tok_123");
  assert.equal(parsed.lineItems.length, 1);
  assert.deepEqual(parsed.lineItems[0], {
    title: "150 KG ATX® GYM Set",
    quantity: 1,
    price: 479,
    variantId: "40123456789",
    productId: "7001",
  });
  // No customer field survives parsing.
  const json = JSON.stringify(parsed);
  assert.ok(!json.includes("buyer@example.com"));
  assert.ok(!json.includes("Berlin"));
  assert.ok(!json.includes("Max"));
});

test("parseOrderWebhook falls back to total_price and created_at", () => {
  const parsed = parseOrderWebhook({
    id: 1,
    created_at: "2026-08-01T00:00:00Z",
    total_price: "10.50",
  });
  assert.equal(parsed.totalPrice, 10.5);
  assert.equal(parsed.processedAt, "2026-08-01T00:00:00Z");
  assert.equal(parsed.moToken, null);
  assert.deepEqual(parsed.discountCodes, []);
});

test("parseOrderWebhook accepts a GID-only id and rejects an id-less payload", () => {
  assert.equal(
    parseOrderWebhook({ admin_graphql_api_id: "gid://shopify/Order/99" }).shopifyOrderId,
    "99"
  );
  assert.equal(parseOrderWebhook({}), null);
  assert.equal(parseOrderWebhook(null), null);
});

// ---------------------------------------------------------------------------
// hasMoMarker
// ---------------------------------------------------------------------------

test("hasMoMarker: token, Mo code, both, neither", () => {
  const base = parseOrderWebhook({ id: 1 });
  assert.equal(hasMoMarker({ ...base, moToken: "t" }), true);
  assert.equal(hasMoMarker({ ...base, discountCodes: ["MS5-X"] }), true);
  assert.equal(hasMoMarker({ ...base, discountCodes: ["SUMMER10"] }), false);
  assert.equal(hasMoMarker(base), false);
  assert.equal(hasMoMarker(null), false);
});

// ---------------------------------------------------------------------------
// matchOrderLineItems
// ---------------------------------------------------------------------------

const CATALOG = [
  { id: "150-kg-atx-gym-set", shopifyVariantId: "40123456789" },
  { id: "laufband-x", shopifyVariantId: "40999" },
  { id: "hantelbank-basic" },
];

test("matchOrderLineItems matches by exact variant id first", () => {
  const { items, matchedHandles } = matchOrderLineItems(
    [{ title: "Umbenanntes Produkt", quantity: 1, price: 1, variantId: "40999", productId: null }],
    CATALOG
  );
  assert.equal(items[0].handle, "laufband-x");
  assert.deepEqual(matchedHandles, ["laufband-x"]);
});

test("matchOrderLineItems falls back to normalised title (® stripped)", () => {
  const { items } = matchOrderLineItems(
    [
      // Non-default variant → variant id unknown to the catalog; title decides.
      { title: "150 KG ATX® GYM Set", quantity: 1, price: 1, variantId: "555", productId: null },
      { title: "Hantelbank Basic", quantity: 2, price: 1, variantId: null, productId: null },
    ],
    CATALOG
  );
  assert.equal(items[0].handle, "150-kg-atx-gym-set");
  assert.equal(items[1].handle, "hantelbank-basic");
});

test("matchOrderLineItems leaves unmatched lines at handle: null", () => {
  const { items, matchedHandles } = matchOrderLineItems(
    [{ title: "Fremdes Produkt", quantity: 1, price: 1, variantId: null, productId: null }],
    CATALOG
  );
  assert.equal(items[0].handle, null);
  assert.deepEqual(matchedHandles, []);
});

// ---------------------------------------------------------------------------
// classifyAttributionTier
// ---------------------------------------------------------------------------

test("classifyAttributionTier: a Mo code is always direct", () => {
  assert.equal(
    classifyAttributionTier({ hasMoCode: true, tokenSource: null, hasOverlap: false }),
    "direct"
  );
});

test("classifyAttributionTier: Mo-built link sources are direct", () => {
  for (const source of ["summary_email", "marketing_email", "bundle"]) {
    assert.equal(
      classifyAttributionTier({ hasMoCode: false, tokenSource: source, hasOverlap: false }),
      "direct"
    );
  }
});

test("classifyAttributionTier: widget stamp splits on product overlap", () => {
  assert.equal(
    classifyAttributionTier({ hasMoCode: false, tokenSource: "widget", hasOverlap: true }),
    "assisted"
  );
  assert.equal(
    classifyAttributionTier({ hasMoCode: false, tokenSource: "widget", hasOverlap: false }),
    "influenced"
  );
});

test("classifyAttributionTier: nothing attributable → null", () => {
  assert.equal(
    classifyAttributionTier({ hasMoCode: false, tokenSource: null, hasOverlap: true }),
    null
  );
});

// ---------------------------------------------------------------------------
// isWithinAttributionWindow
// ---------------------------------------------------------------------------

test("isWithinAttributionWindow: inside, boundary, outside", () => {
  const minted = "2026-08-01T00:00:00Z";
  assert.equal(isWithinAttributionWindow("2026-08-15T00:00:00Z", minted, 30), true);
  assert.equal(isWithinAttributionWindow("2026-08-31T00:00:00Z", minted, 30), true);
  assert.equal(isWithinAttributionWindow("2026-09-01T00:00:01Z", minted, 30), false);
});

test("isWithinAttributionWindow tolerates small clock skew but not big ones", () => {
  const minted = "2026-08-01T00:00:00Z";
  assert.equal(isWithinAttributionWindow("2026-07-31T23:30:00Z", minted, 30), true);
  assert.equal(isWithinAttributionWindow("2026-07-30T00:00:00Z", minted, 30), false);
});

test("isWithinAttributionWindow fails closed on missing input", () => {
  assert.equal(isWithinAttributionWindow(null, "2026-08-01T00:00:00Z", 30), false);
  assert.equal(isWithinAttributionWindow("2026-08-01T00:00:00Z", null, 30), false);
  assert.equal(isWithinAttributionWindow("2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z", 0), false);
});

test("matchOrderLineItems matches NON-default variants by id and reports the ref", () => {
  const catalog = [
    {
      id: "atx-kettlebell",
      shopifyVariantId: "111",
      variants: [
        { id: "111", title: "8 kg", price: 24.9, available: true, isDefault: true },
        { id: "222", title: "16 kg", price: 46.9, available: true, isDefault: false },
      ],
    },
  ];
  const { items, matchedHandles } = matchOrderLineItems(
    [
      { title: "ATX Kettlebell", quantity: 1, price: "46.90", variantId: "222", productId: "9" },
      { title: "ATX Kettlebell", quantity: 1, price: "24.90", variantId: "111", productId: "9" },
    ],
    catalog
  );
  assert.deepEqual(matchedHandles, ["atx-kettlebell"]);
  // Non-default variant carries the ref; default stays the bare handle.
  assert.equal(items[0].handle, "atx-kettlebell");
  assert.equal(items[0].ref, "atx-kettlebell~222");
  assert.equal(items[1].handle, "atx-kettlebell");
  assert.equal(items[1].ref, undefined);
});
