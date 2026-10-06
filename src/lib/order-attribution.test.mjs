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
  attributionAnchor,
  unresolvedMarkerEvent,
  countUnresolvedMarkers,
  unresolvedMarkerDedupeKey,
  restartsWindowOnReuse,
  overlapLookback,
  unionConsultedProducts,
  SESSION_ANCHORED_SOURCES,
  CONSULTATION_ANCHOR_TOOLS,
  UNRESOLVED_MARKER_REASONS,
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

// ---------------------------------------------------------------------------
// attributionAnchor / unresolved markers (ATTR-TOKEN-LIFETIME)
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const MINT = "2026-08-01T00:00:00.000Z";
const at = (days) => new Date(Date.parse(MINT) + days * DAY).toISOString();

test("attributionAnchor: link sources keep the mint even after a later consultation", () => {
  for (const source of ["summary_email", "marketing_email", "bundle"]) {
    const a = attributionAnchor({ source, tokenCreatedAt: MINT, lastConsultedAt: at(25), orderAt: at(32) });
    assert.equal(a?.toISOString(), MINT, source);
  }
});

test("attributionAnchor: the widget anchors on the latest consultation", () => {
  const a = attributionAnchor({ source: "widget", tokenCreatedAt: MINT, lastConsultedAt: at(25), orderAt: at(32) });
  assert.equal(a?.toISOString(), at(25));
  assert.equal(isWithinAttributionWindow(at(32), a, 30), true);
  const late = attributionAnchor({ source: "widget", tokenCreatedAt: MINT, lastConsultedAt: at(25), orderAt: at(56) });
  assert.equal(isWithinAttributionWindow(at(56), late, 30), false);
  // Without the anchor the day-32 order is outside — what the switch changes.
  assert.equal(isWithinAttributionWindow(at(32), MINT, 30), false);
});

test("attributionAnchor: a consultation before the mint keeps the mint", () => {
  const a = attributionAnchor({ source: "widget", tokenCreatedAt: MINT, lastConsultedAt: at(-3), orderAt: at(10) });
  assert.equal(a?.toISOString(), MINT);
});

test("attributionAnchor never moves past the order", () => {
  const order = at(40);
  const after = new Date(Date.parse(order) + 60_000).toISOString();
  assert.equal(
    attributionAnchor({ source: "widget", tokenCreatedAt: MINT, lastConsultedAt: after, orderAt: order })?.toISOString(),
    MINT
  );
  assert.equal(
    attributionAnchor({ source: "widget", tokenCreatedAt: MINT, lastConsultedAt: order, orderAt: order })?.toISOString(),
    order
  );
});

test("attributionAnchor: switch off (no consultation) → the mint", () => {
  const a = attributionAnchor({ source: "widget", tokenCreatedAt: MINT, lastConsultedAt: null, orderAt: at(5) });
  assert.equal(a?.toISOString(), MINT);
});

test("attributionAnchor fails closed on a bad mint, falls back to the mint on bad other input", () => {
  assert.equal(attributionAnchor({ source: "widget", tokenCreatedAt: null, lastConsultedAt: at(2), orderAt: at(3) }), null);
  assert.equal(attributionAnchor({ source: "widget", tokenCreatedAt: "nope", lastConsultedAt: at(2), orderAt: at(3) }), null);
  assert.equal(isWithinAttributionWindow(at(3), null, 30), false);
  assert.equal(
    attributionAnchor({ source: "widget", tokenCreatedAt: MINT, lastConsultedAt: "garbage", orderAt: at(3) })?.toISOString(),
    MINT
  );
  assert.equal(
    attributionAnchor({ source: "widget", tokenCreatedAt: MINT, lastConsultedAt: at(2), orderAt: "garbage" })?.toISOString(),
    MINT
  );
  assert.equal(
    attributionAnchor({ source: "widget", tokenCreatedAt: new Date(MINT), lastConsultedAt: new Date(at(2)), orderAt: new Date(at(3)) })?.toISOString(),
    at(2)
  );
});

test("attributionAnchor: unknown sources keep the mint (conservative)", () => {
  const a = attributionAnchor({ source: "foo", tokenCreatedAt: MINT, lastConsultedAt: at(25), orderAt: at(32) });
  assert.equal(a?.toISOString(), MINT);
});

test("unresolvedMarkerEvent: orders/create only, enum reasons only, source only for outside_window", () => {
  assert.equal(unresolvedMarkerEvent("orders/paid", { action: "ignored", reason: "unknown_token" }), null);
  assert.deepEqual(unresolvedMarkerEvent("orders/create", { action: "ignored", reason: "unknown_token", tokenSource: "widget" }), {
    reason: "unknown_token",
  });
  assert.deepEqual(unresolvedMarkerEvent("orders/create", { action: "ignored", reason: "outside_window", tokenSource: "widget" }), {
    reason: "outside_window",
    source: "widget",
  });
  assert.deepEqual(unresolvedMarkerEvent("orders/create", { action: "ignored", reason: "outside_window", tokenSource: "evil<script>" }), {
    reason: "outside_window",
  });
  for (const reason of ["no-mo-marker", "unclassifiable", "db-error", "no-db", undefined]) {
    assert.equal(unresolvedMarkerEvent("orders/create", { action: "ignored", reason }), null, String(reason));
  }
  assert.equal(unresolvedMarkerEvent("orders/create", { action: "stored" }), null);
  assert.equal(unresolvedMarkerEvent("orders/create", null), null);
});

test("countUnresolvedMarkers ignores unknown reasons and empty input", () => {
  assert.deepEqual(countUnresolvedMarkers(null), { unknownToken: 0, outsideWindow: 0 });
  assert.deepEqual(
    countUnresolvedMarkers([
      { reason: "unknown_token", n: 3 },
      { reason: "outside_window", n: "2" },
      { reason: "other", n: 9 },
      { reason: "", n: 1 },
    ]),
    { unknownToken: 3, outsideWindow: 2 }
  );
});

test("unresolvedMarkerDedupeKey: one key per Shopify event id, null without a usable header", () => {
  assert.equal(
    unresolvedMarkerDedupeKey("98880550-7158-44d4-b7cd-2c97c8a091b5"),
    "mo-unresolved:98880550-7158-44d4-b7cd-2c97c8a091b5"
  );
  assert.equal(unresolvedMarkerDedupeKey("  12345  "), "mo-unresolved:12345");
  for (const bad of [null, undefined, "", "   ", 42, "a b", "x;DROP", "x".repeat(101)]) {
    assert.equal(unresolvedMarkerDedupeKey(bad), null, String(bad));
  }
});

// ---------------------------------------------------------------------------
// §9.1 — a mail link restarts its window when its token is reused
// ---------------------------------------------------------------------------

test("restartsWindowOnReuse: the Mo-built link sources only, never the widget", () => {
  for (const s of ["summary_email", "marketing_email", "bundle"]) assert.equal(restartsWindowOnReuse(s), true, s);
  for (const s of ["widget", "foo", "", null, undefined]) assert.equal(restartsWindowOnReuse(s), false, String(s));
});

test("§9.1: a mail on day 31–37 after the first ships a working link; the earlier mail's link keeps attributing", () => {
  // One token per (session, summary_email): mail 1 on day 0, mail 2 on day 33.
  const firstMail = MINT;
  const secondMail = at(33);
  // Without the restart, the window still counts from mail 1: an order through
  // mail 2's link on day 35 was lost although mail 2 is two days old.
  assert.equal(isWithinAttributionWindow(at(35), firstMail, 30), false);
  // With created_at re-stamped at mail 2, the same order attributes …
  const anchor = attributionAnchor({ source: "summary_email", tokenCreatedAt: secondMail, lastConsultedAt: null, orderAt: at(35) });
  assert.equal(isWithinAttributionWindow(at(35), anchor, 30), true);
  // … and so does an order through mail 1's link (same token) inside mail 2's window …
  assert.equal(isWithinAttributionWindow(at(60), anchor, 30), true);
  // … but not beyond it.
  assert.equal(isWithinAttributionWindow(at(64), anchor, 30), false);
});

// ---------------------------------------------------------------------------
// §9.2 — the overlap check reads every thread inside the window
// ---------------------------------------------------------------------------

test("overlapLookback: threads started by the order and active within the window before it", () => {
  assert.deepEqual(overlapLookback(at(40), 30), { since: at(10), until: at(40) });
  assert.deepEqual(overlapLookback(new Date(at(40)), 7), { since: at(33), until: at(40) });
});

test("overlapLookback fails closed on an unusable order time or window", () => {
  for (const bad of [null, undefined, "", "garbage", 123]) assert.equal(overlapLookback(bad, 30), null, String(bad));
  for (const w of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(overlapLookback(at(5), w), null, String(w));
});

test("unionConsultedProducts: discussed ∪ selected across threads, deduped, junk dropped", () => {
  assert.deepEqual(unionConsultedProducts(null), []);
  assert.deepEqual(
    unionConsultedProducts([
      { recommended_product_ids: ["kettlebell-16", "yoga-matte"], selected_product_ids: ["kettlebell-16"] },
      { recommended_product_ids: ["laufband-x"], selected_product_ids: null },
      { recommended_product_ids: [" ", 7, null, "yoga-matte"], selected_product_ids: ["hantelbank"] },
      { recommended_product_ids: "not-an-array" },
      null,
    ]),
    ["kettlebell-16", "yoga-matte", "laufband-x", "hantelbank"]
  );
});

test("§9.2: a product from an older thread inside the window makes the order „assisted“", () => {
  // Thread 1 (days 18–20) discussed the kettlebell, thread 2 (day 25) the mat;
  // the order on day 28 buys the kettlebell. The latest thread alone said
  // „influenced“; the union over the window says „assisted“.
  const span = overlapLookback(at(28), 30);
  const threads = [
    { created_at: at(18), last_activity_at: at(20), recommended_product_ids: ["kettlebell-16"], selected_product_ids: [] },
    { created_at: at(25), last_activity_at: at(25), recommended_product_ids: ["yoga-matte"], selected_product_ids: [] },
    // Started after the order: never counts, even if it names the purchase.
    { created_at: at(29), last_activity_at: at(29), recommended_product_ids: ["hantelbank"], selected_product_ids: [] },
    // Last active before the window: does not count either.
    { created_at: at(-20), last_activity_at: at(-5), recommended_product_ids: ["laufband-x"], selected_product_ids: [] },
  ];
  // The query's WHERE, applied to the fixture.
  const inSpan = threads.filter((t) => t.created_at <= span.until && t.last_activity_at >= span.since);
  const consulted = unionConsultedProducts(inSpan);
  assert.deepEqual(consulted, ["kettlebell-16", "yoga-matte"]);
  const tier = (bought) =>
    classifyAttributionTier({ hasMoCode: false, tokenSource: "widget", hasOverlap: consulted.includes(bought) });
  assert.equal(tier("kettlebell-16"), "assisted");
  assert.equal(tier("hantelbank"), "influenced");
  assert.equal(tier("laufband-x"), "influenced");
});

test("anchor constants are pinned", () => {
  assert.deepEqual([...SESSION_ANCHORED_SOURCES], ["widget"]);
  assert.deepEqual([...CONSULTATION_ANCHOR_TOOLS].sort(), ["add_to_cart", "compare_products", "show_product", "suggest_showroom"]);
  assert.deepEqual([...UNRESOLVED_MARKER_REASONS], ["unknown_token", "outside_window"]);
});
