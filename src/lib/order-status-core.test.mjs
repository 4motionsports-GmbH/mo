import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_STATES,
  PAYMENT_STATES,
  MAX_ORDERS_SHOWN,
  MAX_ITEMS_PER_ORDER,
  DEFAULT_ACCOUNT_ORDERS_URL,
  accountOrdersUrl,
  berlinDay,
  buildOrderStatusForModel,
  carrierName,
  decideOrderAccess,
  matchOrderRef,
  normalizeOrderState,
  normalizePayment,
  normalizeTopic,
  orderRefDigits,
  parseLiveOrder,
  selectOrders,
  wantsLiveRead,
  confirmLedgerAnswer,
  withoutForeignOrders,
} from "./order-status-core.mjs";

const URL_ = "https://www.motionsports.de/account";

/** A ledger order shaped like lib/customer-orders-store.ts LedgerOrder. */
function ledgerOrder(over = {}) {
  return {
    id: 501,
    shopifyOrderId: "5550001112223",
    name: "#4711",
    processedAt: "2026-09-27T22:30:00.000Z", // 00:30 on the 28th in Berlin
    financialStatus: "PAID",
    fulfillmentStatus: "FULFILLED",
    cancelledAt: null,
    currency: "EUR",
    totalCents: 129900,
    refundedCents: 0,
    discountCodes: ["MS5-SECRET"],
    lineItems: [
      {
        id: "998877",
        title: "ATX Power Rack 620",
        variantTitle: "Schwarz",
        quantity: 1,
        unitPrice: 649.5,
        handle: "atx-power-rack-620",
        productId: "123123123",
        variantId: "456456456",
      },
      {
        id: "998878",
        title: "Hantelscheibe",
        variantTitle: "Default Title",
        quantity: 2,
        unitPrice: 325.0,
        handle: null,
        productId: null,
        variantId: null,
      },
    ],
    ...over,
  };
}

/** The Admin GraphQL `order` node as Shopify returns it. */
function liveNode(over = {}) {
  return {
    customer: { id: "gid://shopify/Customer/9988" },
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "FULFILLED",
    fulfillments: [
      {
        status: "SUCCESS",
        displayStatus: "IN_TRANSIT",
        inTransitAt: "2026-09-29T08:00:00Z",
        deliveredAt: null,
        estimatedDeliveryAt: "2026-10-01T10:00:00Z",
        trackingInfo: [
          { company: "DHL Express", number: "JJD000390007827", url: "https://www.dhl.de/track?id=JJD000390007827" },
        ],
      },
    ],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

test("decideOrderAccess: only an enabled switch + a Customer Account sign-in + a live token", () => {
  const ok = { flagOn: true, sessionId: "sess-1", linkKind: "customer_account", hasToken: true };
  assert.equal(decideOrderAccess(ok), "ok");
  assert.equal(decideOrderAccess({ ...ok, flagOn: false }), "disabled");
  assert.equal(decideOrderAccess({ ...ok, flagOn: "true" }), "disabled");
  assert.equal(decideOrderAccess({ ...ok, sessionId: null }), "sign_in_required");
  assert.equal(decideOrderAccess({ ...ok, sessionId: "   " }), "sign_in_required");
  // The App Proxy link, a typed e-mail, a legacy link or none: not enough.
  for (const linkKind of ["app_proxy", "email", "legacy", null, undefined]) {
    assert.equal(decideOrderAccess({ ...ok, linkKind }), "sign_in_required", String(linkKind));
  }
  assert.equal(decideOrderAccess({ ...ok, hasToken: false }), "sign_in_required");
});

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

test("normalizeOrderState: ledger values (REST upper-cased and GraphQL display)", () => {
  const s = (fulfillmentStatus) => normalizeOrderState({ fulfillmentStatus, cancelledAt: null });
  assert.equal(s(null), "not_shipped");
  assert.equal(s(undefined), "not_shipped");
  assert.equal(s("UNFULFILLED"), "not_shipped");
  assert.equal(s("unfulfilled"), "not_shipped");
  assert.equal(s("OPEN"), "not_shipped");
  assert.equal(s("SCHEDULED"), "not_shipped");
  assert.equal(s("IN_PROGRESS"), "being_prepared");
  assert.equal(s("PENDING_FULFILLMENT"), "being_prepared");
  assert.equal(s("PARTIAL"), "partially_shipped");
  assert.equal(s("PARTIALLY_FULFILLED"), "partially_shipped");
  assert.equal(s("FULFILLED"), "shipped");
  assert.equal(s("fulfilled"), "shipped");
  assert.equal(s("ON_HOLD"), "on_hold");
  // What Mo cannot explain goes to a human (on_hold → contact form).
  assert.equal(s("RESTOCKED"), "on_hold");
  assert.equal(s("REQUEST_DECLINED"), "on_hold");
  assert.equal(s("SOMETHING_NEW"), "on_hold");
});

test("normalizeOrderState: a cancellation wins over everything", () => {
  assert.equal(
    normalizeOrderState({
      fulfillmentStatus: "FULFILLED",
      cancelledAt: "2026-09-30T10:00:00Z",
      fulfillments: [{ status: "SUCCESS", displayStatus: "DELIVERED", deliveredAt: "2026-10-01T10:00:00Z" }],
    }),
    "cancelled"
  );
  // An unparseable timestamp is not a cancellation.
  assert.equal(normalizeOrderState({ fulfillmentStatus: "FULFILLED", cancelledAt: "nope" }), "shipped");
});

test("normalizeOrderState: live fulfillments refine the order-level status", () => {
  const st = (fulfillments, fulfillmentStatus = "FULFILLED") =>
    normalizeOrderState({ fulfillmentStatus, cancelledAt: null, fulfillments });
  assert.equal(st([{ status: "SUCCESS", displayStatus: "DELIVERED" }]), "delivered");
  assert.equal(st([{ status: "SUCCESS", displayStatus: null, deliveredAt: "2026-10-01T10:00:00Z" }]), "delivered");
  assert.equal(st([{ status: "SUCCESS", displayStatus: "PICKED_UP" }]), "delivered");
  assert.equal(st([{ status: "SUCCESS", displayStatus: "OUT_FOR_DELIVERY" }]), "out_for_delivery");
  assert.equal(st([{ status: "SUCCESS", displayStatus: "IN_TRANSIT" }]), "in_transit");
  assert.equal(st([{ status: "SUCCESS", displayStatus: "CONFIRMED", inTransitAt: "2026-09-29T08:00:00Z" }]), "in_transit");
  assert.equal(st([{ status: "SUCCESS", displayStatus: "LABEL_PRINTED" }]), "being_prepared");
  assert.equal(st([{ status: "SUCCESS", displayStatus: "FULFILLED" }]), "shipped");
  assert.equal(st([{ status: "SUCCESS", displayStatus: "ATTEMPTED_DELIVERY" }]), "delivery_problem");
  assert.equal(st([{ status: "SUCCESS", displayStatus: "FAILURE" }]), "delivery_problem");
  // Two parcels: one delivered, one under way → the order is in transit.
  assert.equal(
    st([
      { status: "SUCCESS", displayStatus: "DELIVERED" },
      { status: "SUCCESS", displayStatus: "IN_TRANSIT" },
    ]),
    "in_transit"
  );
  // A delivery problem on any parcel shows.
  assert.equal(
    st([
      { status: "SUCCESS", displayStatus: "DELIVERED" },
      { status: "SUCCESS", displayStatus: "NOT_DELIVERED" },
    ]),
    "delivery_problem"
  );
  // Partially fulfilled stays partially_shipped even when the first parcel arrived.
  assert.equal(st([{ status: "SUCCESS", displayStatus: "DELIVERED" }], "PARTIALLY_FULFILLED"), "partially_shipped");
  // Cancelled / failed fulfillments are no shipment → order level decides.
  assert.equal(st([{ status: "CANCELLED", displayStatus: "CANCELED" }], "UNFULFILLED"), "not_shipped");
  assert.equal(st([{ status: "ERROR" }], "UNFULFILLED"), "not_shipped");
  assert.equal(st([{ status: "SUCCESS", displayStatus: "LABEL_VOIDED" }], "IN_PROGRESS"), "being_prepared");
  assert.equal(st([], "ON_HOLD"), "on_hold");
});

test("normalizeOrderState: a delivered parcel never overrides an order that is not finished", () => {
  const st = (fulfillments, fulfillmentStatus) =>
    normalizeOrderState({ fulfillmentStatus, cancelledAt: null, fulfillments });
  const delivered = [{ status: "SUCCESS", displayStatus: "DELIVERED" }];
  const moving = [{ status: "SUCCESS", displayStatus: "IN_TRANSIT" }];
  assert.equal(st(delivered, "ON_HOLD"), "on_hold");
  assert.equal(st(delivered, "RESTOCKED"), "on_hold");
  assert.equal(st(delivered, "IN_PROGRESS"), "partially_shipped");
  assert.equal(st(delivered, "UNFULFILLED"), "partially_shipped");
  assert.equal(st(moving, "UNFULFILLED"), "partially_shipped");
  // A label printed for a not-yet-finished order is still preparation.
  assert.equal(st([{ status: "SUCCESS", displayStatus: "LABEL_PRINTED" }], "IN_PROGRESS"), "being_prepared");
  // A delivery problem still shows whatever the order level says.
  assert.equal(st([{ status: "SUCCESS", displayStatus: "FAILURE" }], "ON_HOLD"), "delivery_problem");
  // FULFILLED is refined as before.
  assert.equal(st(delivered, "FULFILLED"), "delivered");
});

test("normalizeOrderState only ever returns a documented state", () => {
  const inputs = [null, "FULFILLED", "PARTIAL", "ON_HOLD", "X", "IN_PROGRESS"];
  const fulfillmentSets = [
    undefined,
    [],
    [{ status: "SUCCESS", displayStatus: "DELIVERED" }],
    [{ status: "SUCCESS", displayStatus: "WHATEVER" }],
    [null, 42, "x"],
  ];
  for (const fulfillmentStatus of inputs) {
    for (const fulfillments of fulfillmentSets) {
      const s = normalizeOrderState({ fulfillmentStatus, cancelledAt: null, fulfillments });
      assert.ok(ORDER_STATES.includes(s), `${fulfillmentStatus} → ${s}`);
    }
  }
});

test("normalizePayment: status and cents (total is the CURRENT total after refunds)", () => {
  assert.equal(normalizePayment("PAID", 0, 129900), "paid");
  assert.equal(normalizePayment("paid", 0, 129900), "paid");
  assert.equal(normalizePayment("AUTHORIZED", 0, 129900), "paid");
  assert.equal(normalizePayment("PENDING", 0, 129900), "pending");
  assert.equal(normalizePayment("PARTIALLY_PAID", 0, 129900), "pending");
  assert.equal(normalizePayment("PARTIALLY_REFUNDED", 5000, 124900), "refunded_partial");
  assert.equal(normalizePayment("REFUNDED", 129900, 0), "refunded_full");
  assert.equal(normalizePayment("VOIDED", 0, 129900), "voided");
  assert.equal(normalizePayment("EXPIRED", 0, 129900), "voided");
  // The ledger's cents tell the refund even when the status lags behind.
  assert.equal(normalizePayment("PAID", 5000, 124900), "refunded_partial");
  assert.equal(normalizePayment("PAID", 129900, 0), "refunded_full");
  // Unknown → null (left out of the answer).
  assert.equal(normalizePayment(null, 0, 129900), null);
  assert.equal(normalizePayment("SOMETHING", 0, 129900), null);
  for (const fs of ["PAID", "PENDING", "REFUNDED", "VOIDED", "PARTIALLY_REFUNDED"]) {
    assert.ok(PAYMENT_STATES.includes(normalizePayment(fs, 0, 100)));
  }
});

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

test("orderRefDigits / matchOrderRef: '#1234', '1234', 'Bestellung 1234' against the customer's own orders", () => {
  const orders = [ledgerOrder({ name: "#1234" }), ledgerOrder({ name: "MS1001", shopifyOrderId: "777" })];
  for (const ref of ["#1234", "1234", "Bestellung 1234", "bestellung #1234", "Bestellnr. 01234"]) {
    assert.equal(matchOrderRef(orders, ref)?.name, "#1234", ref);
  }
  assert.equal(matchOrderRef(orders, "MS-1001")?.name, "MS1001");
  assert.equal(matchOrderRef(orders, "9999"), null);
  assert.equal(matchOrderRef(orders, ""), null);
  assert.equal(matchOrderRef(orders, null), null);
  // Never by Shopify's internal id.
  assert.equal(matchOrderRef(orders, "777"), null);
  assert.equal(matchOrderRef(orders, "5550001112223"), null);
  // Day/month numbers are no order numbers.
  assert.deepEqual(orderRefDigits("die vom 12.09."), []);
  assert.deepEqual(orderRefDigits("#1234"), ["1234"]);
});

test("selectOrders: matched, not found, no number, no orders", () => {
  const orders = Array.from({ length: 8 }, (_, i) => ledgerOrder({ name: `#${1000 + i}`, shopifyOrderId: String(i) }));
  assert.deepEqual(selectOrders([], "#1000"), { status: "no_orders", selected: [] });
  const hit = selectOrders(orders, "Bestellung 1003");
  assert.equal(hit.status, "ok");
  assert.equal(hit.matched, true);
  assert.deepEqual(hit.selected.map((o) => o.name), ["#1003"]);
  const miss = selectOrders(orders, "#4242");
  assert.equal(miss.status, "not_found");
  assert.equal(miss.matched, false);
  assert.equal(miss.selected.length, MAX_ORDERS_SHOWN);
  const none = selectOrders(orders, "die letzte");
  assert.equal(none.status, "ok");
  assert.equal(none.matched, undefined);
  assert.equal(none.selected.length, MAX_ORDERS_SHOWN);
  assert.equal(none.selected[0].name, "#1000");
});

test("wantsLiveRead skips cancelled orders", () => {
  assert.equal(wantsLiveRead(ledgerOrder()), true);
  assert.equal(wantsLiveRead(ledgerOrder({ cancelledAt: "2026-09-30T10:00:00Z" })), false);
});

// ---------------------------------------------------------------------------
// Live read: ownership + whitelist
// ---------------------------------------------------------------------------

test("parseLiveOrder drops an order that belongs to someone else", () => {
  assert.equal(parseLiveOrder(liveNode(), "1111"), null);
  assert.equal(parseLiveOrder(liveNode({ customer: null }), "9988"), null);
  assert.equal(parseLiveOrder(liveNode(), null), null);
  assert.equal(parseLiveOrder(null, "9988"), null);
  assert.ok(parseLiveOrder(liveNode(), "9988"));
  assert.ok(parseLiveOrder(liveNode(), "gid://shopify/Customer/9988"));
});

test("parseLiveOrder keeps only the carrier name — never tracking numbers or links", () => {
  const live = parseLiveOrder(liveNode(), "9988");
  assert.deepEqual(live.fulfillments[0].carriers, ["DHL Express"]);
  const json = JSON.stringify(live);
  assert.doesNotMatch(json, /JJD000390007827/);
  assert.doesNotMatch(json, /https?:/);
  assert.equal(carrierName("DHL"), "DHL");
  assert.equal(carrierName("  Spedition  Schenker "), "Spedition Schenker");
  assert.equal(carrierName("JJD000390007827"), null);
  assert.equal(carrierName("https://track.example"), null);
  assert.equal(carrierName("www.dhl.de"), null);
  assert.equal(carrierName(""), null);
  assert.equal(carrierName(42), null);
});

// ---------------------------------------------------------------------------
// The model-facing result
// ---------------------------------------------------------------------------

test("buildOrderStatusForModel: ledger-only answer", () => {
  const out = buildOrderStatusForModel({
    status: "ok",
    orders: [ledgerOrder()],
    ordersPageUrl: URL_,
  });
  assert.deepEqual(out, {
    status: "ok",
    orders: [
      {
        ref: "A",
        placedOn: "2026-09-28",
        items: ["1× ATX Power Rack 620 (Schwarz)", "2× Hantelscheibe"],
        state: "shipped",
        payment: "paid",
      },
    ],
    ordersPageUrl: URL_,
  });
});

test("buildOrderStatusForModel: live enrichment adds carrier and dates, not ids", () => {
  const live = new Map([["5550001112223", parseLiveOrder(liveNode(), "9988")]]);
  const out = buildOrderStatusForModel({
    status: "ok",
    matched: true,
    orders: [ledgerOrder()],
    live,
    ordersPageUrl: URL_,
  });
  assert.equal(out.matched, true);
  assert.deepEqual(out.orders[0], {
    ref: "A",
    placedOn: "2026-09-28",
    items: ["1× ATX Power Rack 620 (Schwarz)", "2× Hantelscheibe"],
    state: "in_transit",
    payment: "paid",
    carrier: "DHL Express",
    estimatedDelivery: "2026-10-01",
  });

  const delivered = new Map([
    [
      "5550001112223",
      parseLiveOrder(
        liveNode({
          fulfillments: [
            {
              status: "SUCCESS",
              displayStatus: "DELIVERED",
              deliveredAt: "2026-09-30T23:15:00Z", // 01:15 on Oct 1st in Berlin
              estimatedDeliveryAt: "2026-09-30T10:00:00Z",
              trackingInfo: [{ company: "DHL" }],
            },
          ],
        }),
        "9988"
      ),
    ],
  ]);
  const d = buildOrderStatusForModel({ status: "ok", orders: [ledgerOrder()], live: delivered, ordersPageUrl: URL_ });
  assert.equal(d.orders[0].state, "delivered");
  assert.equal(d.orders[0].deliveredOn, "2026-10-01");
  assert.equal(d.orders[0].estimatedDelivery, undefined);
});

test("buildOrderStatusForModel: no orders, sign-in required and unavailable carry no orders", () => {
  for (const status of ["no_orders", "sign_in_required", "unavailable"]) {
    const out = buildOrderStatusForModel({ status, orders: [ledgerOrder()], ordersPageUrl: URL_ });
    assert.deepEqual(out, { status, orders: [], ordersPageUrl: URL_ });
  }
});

test("buildOrderStatusForModel: letters, at most 5 orders and 6 items", () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    ledgerOrder({
      shopifyOrderId: String(i),
      lineItems: Array.from({ length: 8 }, (_, j) => ({ title: `Artikel ${j}`, quantity: 1 })),
    })
  );
  const out = buildOrderStatusForModel({ status: "not_found", matched: false, orders: many, ordersPageUrl: URL_ });
  assert.equal(out.matched, false);
  assert.deepEqual(out.orders.map((o) => o.ref), ["A", "B", "C", "D", "E"]);
  assert.equal(out.orders[0].items.length, MAX_ITEMS_PER_ORDER);
  assert.equal(out.orders[0].moreItems, 2);
});

test("PRIVACY: the model never receives order numbers, amounts, tracking, ids, addresses or e-mail", () => {
  const order = ledgerOrder({
    refundedCents: 5000,
    totalCents: 124900,
    // A careless merchant title must not smuggle a link or an e-mail through.
    lineItems: [
      ...ledgerOrder().lineItems,
      { id: "998879", title: "Gutschein info@example.com https://evil.example/x", quantity: 1, unitPrice: 50 },
    ],
  });
  const node = liveNode();
  node.shippingAddress = { address1: "Musterstraße 12", zip: "82194", city: "Gröbenzell" };
  node.email = "kunde@example.com";
  node.name = "#4711";
  node.totalPriceSet = { shopMoney: { amount: "1299.00" } };
  const live = new Map([["5550001112223", parseLiveOrder(node, "9988")]]);
  const results = [
    buildOrderStatusForModel({ status: "ok", matched: true, orders: [order], live, ordersPageUrl: URL_ }),
    buildOrderStatusForModel({ status: "not_found", matched: false, orders: [order], live, ordersPageUrl: URL_ }),
    buildOrderStatusForModel({ status: "ok", orders: [order], ordersPageUrl: URL_ }),
  ];
  for (const result of results) {
    const { ordersPageUrl, ...rest } = result;
    assert.equal(ordersPageUrl, URL_);
    const json = JSON.stringify(rest);
    const forbidden = [
      "4711", // order name / number
      "5550001112223", // Shopify order id
      "gid://",
      "9988", // Shopify customer id
      "998877", // line-item id
      "123123123", // product id
      "456456456", // variant id
      "atx-power-rack-620", // handle (catalog id is fine elsewhere, but not needed here)
      "1299", // total
      "1249", // current total
      "649", // unit price
      "325", // unit price
      "5000", // refunded cents
      "50.00",
      "EUR",
      "€",
      "MS5-SECRET", // discount code
      "JJD000390007827", // tracking number
      "http", // tracking URL (and any link)
      "dhl.de",
      "@", // e-mail
      "Musterstraße",
      "82194",
      "Gröbenzell",
    ];
    for (const needle of forbidden) {
      assert.ok(!json.includes(needle), `model output must not contain "${needle}": ${json}`);
    }
    // Only whitelisted keys.
    for (const o of rest.orders) {
      for (const key of Object.keys(o)) {
        assert.ok(
          ["ref", "placedOn", "items", "moreItems", "state", "payment", "carrier", "estimatedDelivery", "deliveredOn"].includes(key),
          key
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

test("berlinDay uses the shop's calendar day", () => {
  assert.equal(berlinDay("2026-09-27T22:30:00.000Z"), "2026-09-28");
  assert.equal(berlinDay("2026-01-15T12:00:00Z"), "2026-01-15");
  assert.equal(berlinDay("2026-12-31T23:30:00Z"), "2027-01-01");
  assert.equal(berlinDay(null), null);
  assert.equal(berlinDay("not a date"), null);
});

test("accountOrdersUrl: env override (https only) with the account page as default", () => {
  assert.equal(accountOrdersUrl({}), DEFAULT_ACCOUNT_ORDERS_URL);
  assert.equal(DEFAULT_ACCOUNT_ORDERS_URL, "https://www.motionsports.de/account");
  assert.equal(accountOrdersUrl({ SHOPIFY_ACCOUNT_ORDERS_URL: "  " }), DEFAULT_ACCOUNT_ORDERS_URL);
  assert.equal(
    accountOrdersUrl({ SHOPIFY_ACCOUNT_ORDERS_URL: " https://account.motionsports.de/orders " }),
    "https://account.motionsports.de/orders"
  );
  assert.equal(accountOrdersUrl({ SHOPIFY_ACCOUNT_ORDERS_URL: "http://insecure.example" }), DEFAULT_ACCOUNT_ORDERS_URL);
  assert.equal(accountOrdersUrl({ SHOPIFY_ACCOUNT_ORDERS_URL: "javascript:alert(1)" }), DEFAULT_ACCOUNT_ORDERS_URL);
  assert.equal(accountOrdersUrl({ SHOPIFY_ACCOUNT_ORDERS_URL: "not a url" }), DEFAULT_ACCOUNT_ORDERS_URL);
});

test("normalizeTopic defaults to status", () => {
  assert.equal(normalizeTopic("refund"), "refund");
  assert.equal(normalizeTopic("shipping"), "shipping");
  assert.equal(normalizeTopic("other"), "status");
  assert.equal(normalizeTopic(undefined), "status");
});

test("confirmLedgerAnswer: 'no orders' / 'not found' only when a live read confirms it", () => {
  const ok = (orderIds) => ({ ok: true, orderIds });
  // Other statuses pass untouched, even without a live read.
  assert.equal(confirmLedgerAnswer({ status: "ok", ledgerOrderIds: ["1"], live: null }), "ok");
  // Confirmed: Shopify has no order the ledger lacks.
  assert.equal(confirmLedgerAnswer({ status: "no_orders", ledgerOrderIds: [], live: ok([]) }), "no_orders");
  assert.equal(confirmLedgerAnswer({ status: "not_found", ledgerOrderIds: ["1", "2"], live: ok(["2", "1"]) }), "not_found");
  // The ledger is behind (late webhook, order before the mirror) → unavailable.
  assert.equal(confirmLedgerAnswer({ status: "no_orders", ledgerOrderIds: [], live: ok(["9"]) }), "unavailable");
  assert.equal(confirmLedgerAnswer({ status: "not_found", ledgerOrderIds: ["1"], live: ok(["9", "1"]) }), "unavailable");
  // No confirmation possible → never claim "no orders".
  assert.equal(confirmLedgerAnswer({ status: "no_orders", ledgerOrderIds: [], live: { ok: false, orderIds: [] } }), "unavailable");
  assert.equal(confirmLedgerAnswer({ status: "not_found", ledgerOrderIds: ["1"], live: null }), "unavailable");
});

test("withoutForeignOrders drops orders Shopify reports for another customer", () => {
  const orders = [{ shopifyOrderId: "1" }, { shopifyOrderId: "2" }, { shopifyOrderId: "3" }];
  assert.deepEqual(withoutForeignOrders(orders, new Set(["2"])).map((o) => o.shopifyOrderId), ["1", "3"]);
  assert.equal(withoutForeignOrders(orders, []).length, 3);
  assert.deepEqual(withoutForeignOrders(null, ["1"]), []);
});

test("buildOrderStatusForModel: signedInViaShop only on sign_in_required for a shop-login session", async () => {
  const { buildOrderStatusForModel: b } = await import("./order-status-core.mjs");
  const url = "https://shop.example/account";
  assert.equal(b({ status: "sign_in_required", ordersPageUrl: url, shopSignedIn: true }).signedInViaShop, true);
  assert.equal("signedInViaShop" in b({ status: "sign_in_required", ordersPageUrl: url }), false);
  assert.equal("signedInViaShop" in b({ status: "unavailable", ordersPageUrl: url, shopSignedIn: true }), false);
});
