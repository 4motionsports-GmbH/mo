import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveDisplayName,
  mapCustomerAccountOrders,
  buildAddressContext,
  buildAccountSummary,
  countAddresses,
  canPersonaliseSignedIn,
} from "./customer-account-data.mjs";

// ---------------------------------------------------------------------------
// deriveDisplayName
// ---------------------------------------------------------------------------

test("deriveDisplayName prefers displayName", () => {
  assert.equal(
    deriveDisplayName({ displayName: "Marcel K.", firstName: "Marcel", lastName: "Kueck" }),
    "Marcel K."
  );
});

test("deriveDisplayName falls back to first+last, then first, then null", () => {
  assert.equal(deriveDisplayName({ displayName: "  ", firstName: "Marcel", lastName: "Kueck" }), "Marcel Kueck");
  assert.equal(deriveDisplayName({ displayName: null, firstName: "Marcel", lastName: null }), "Marcel");
  assert.equal(deriveDisplayName({ displayName: null, firstName: null, lastName: null }), null);
  assert.equal(deriveDisplayName(null), null);
});

// ---------------------------------------------------------------------------
// mapCustomerAccountOrders — Customer Account API shapes → OrderHistory
// ---------------------------------------------------------------------------

test("mapCustomerAccountOrders normalises CA fields into the OrderHistory shape", () => {
  const node = {
    orders: {
      nodes: [
        {
          id: "gid://shopify/Order/1",
          name: "#1042",
          processedAt: "2026-05-01T10:00:00Z",
          financialStatus: "PAID",
          totalPrice: { amount: "199.90", currencyCode: "EUR" },
          lineItems: {
            nodes: [
              { title: "ATX Power Rack", quantity: 1 },
              { title: "Hantelbank", quantity: 2 },
            ],
          },
        },
      ],
    },
  };
  const h = mapCustomerAccountOrders(node);
  assert.equal(h.orders.length, 1);
  const o = h.orders[0];
  assert.equal(o.name, "#1042");
  // processedAt becomes createdAt (the shared OrderHistory field).
  assert.equal(o.createdAt, "2026-05-01T10:00:00Z");
  // flat MoneyV2 totalPrice → totalAmount / currencyCode.
  assert.equal(o.totalAmount, "199.90");
  assert.equal(o.currencyCode, "EUR");
  assert.equal(o.financialStatus, "PAID");
  assert.deepEqual(o.items, [
    { title: "ATX Power Rack", handle: null, quantity: 1 },
    { title: "Hantelbank", handle: null, quantity: 2 },
  ]);
  assert.equal(h.truncated, false);
  assert.ok(h.fetchedAt);
});

test("mapCustomerAccountOrders tolerates missing/empty connections", () => {
  assert.deepEqual(mapCustomerAccountOrders(null).orders, []);
  assert.deepEqual(mapCustomerAccountOrders({}).orders, []);
  assert.deepEqual(mapCustomerAccountOrders({ orders: { nodes: [] } }).orders, []);
});

test("mapCustomerAccountOrders caps orders + line items and sets truncated", () => {
  const nodes = Array.from({ length: 25 }, (_, i) => ({
    name: `#${i}`,
    processedAt: "2026-01-01T00:00:00Z",
    totalPrice: null,
    lineItems: { nodes: Array.from({ length: 30 }, (_, j) => ({ title: `p${j}`, quantity: 1 })) },
  }));
  const h = mapCustomerAccountOrders({ orders: { nodes } }, { maxOrders: 20, maxLineItems: 25 });
  assert.equal(h.orders.length, 20);
  assert.equal(h.orders[0].items.length, 25);
  assert.equal(h.truncated, true);
  // Null total stays null (not "null").
  assert.equal(h.orders[0].totalAmount, null);
  assert.equal(h.orders[0].currencyCode, null);
});

test("mapCustomerAccountOrders reads line-item `name` when `title` is absent, and product.handle when present", () => {
  const node = {
    orders: {
      nodes: [
        {
          name: "#1",
          processedAt: "2026-01-01T00:00:00Z",
          lineItems: { nodes: [{ name: "Kettlebell", quantity: 3, product: { handle: "kettlebell-16" } }] },
        },
      ],
    },
  };
  const h = mapCustomerAccountOrders(node);
  assert.deepEqual(h.orders[0].items, [{ title: "Kettlebell", handle: "kettlebell-16", quantity: 3 }]);
});

// ---------------------------------------------------------------------------
// address context + account summary
// ---------------------------------------------------------------------------

test("buildAddressContext returns city + ISO country, or null", () => {
  assert.deepEqual(
    buildAddressContext({ defaultAddress: { city: "München", territoryCode: "DE" } }),
    { city: "München", countryCode: "DE" }
  );
  // fallback country field name
  assert.deepEqual(
    buildAddressContext({ defaultAddress: { city: "", countryCodeV2: "AT" } }),
    { city: null, countryCode: "AT" }
  );
  assert.equal(buildAddressContext({ defaultAddress: null }), null);
  assert.equal(buildAddressContext({ defaultAddress: { city: "", territoryCode: "" } }), null);
  assert.equal(buildAddressContext({}), null);
});

test("countAddresses counts the connection, falling back to defaultAddress presence", () => {
  assert.equal(countAddresses({ addresses: { nodes: [{ id: "a" }, { id: "b" }] } }), 2);
  assert.equal(countAddresses({ defaultAddress: { city: "X" } }), 1);
  assert.equal(countAddresses({}), 0);
});

test("buildAccountSummary is data-minimised: name + city/country + counts only", () => {
  const node = {
    displayName: "Marcel Kueck",
    firstName: "Marcel",
    lastName: "Kueck",
    emailAddress: { emailAddress: "marcel@example.com" },
    defaultAddress: { city: "München", territoryCode: "DE", address1: "Geheimstr. 1" },
    addresses: { nodes: [{ id: "a" }] },
  };
  const s = buildAccountSummary(node);
  assert.equal(s.displayName, "Marcel Kueck");
  assert.equal(s.firstName, "Marcel");
  assert.deepEqual(s.addressContext, { city: "München", countryCode: "DE" });
  assert.equal(s.addressCount, 1);
  assert.ok(s.fetchedAt);
  // Never carries the raw street or the email.
  assert.equal(JSON.stringify(s).includes("Geheimstr"), false);
  assert.equal(JSON.stringify(s).includes("marcel@example.com"), false);
});

// ---------------------------------------------------------------------------
// canPersonaliseSignedIn — THE consent gate (fails closed)
// ---------------------------------------------------------------------------

test("canPersonaliseSignedIn requires BOTH lawyer approval AND confirmed marketing consent", () => {
  // Happy path (only once Legal flips the flag).
  assert.equal(canPersonaliseSignedIn({ lawyerApproved: true, marketingStatus: "confirmed" }), true);

  // Lawyer gate not yet open → never, regardless of consent.
  assert.equal(canPersonaliseSignedIn({ lawyerApproved: false, marketingStatus: "confirmed" }), false);

  // No / partial / withdrawn marketing consent → never.
  for (const status of ["none", "pending", "unsubscribed", null, undefined]) {
    assert.equal(canPersonaliseSignedIn({ lawyerApproved: true, marketingStatus: status }), false);
  }
});
