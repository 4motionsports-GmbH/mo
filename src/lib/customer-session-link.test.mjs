import { test } from "node:test";
import assert from "node:assert/strict";
import {
  linkSessionToCustomer,
  resolveSignedInCustomerRow,
} from "./customer-session-link.mjs";

// ---------------------------------------------------------------------------
// A tiny in-memory stand-in for the tagged-template sql client. It models just
// enough of the two tables the link touches:
//   * customer_session_links (session_id → customer_id)        — written by link
//   * customers (id → { shopify_customer_id, identity_tier })  — seeded per test
// so a write-then-read round-trip exercises the REAL re-hydration contract:
// "the session the widget holds resolves to the linked signed-in customer."
// ---------------------------------------------------------------------------
function makeSql({ customers = {} } = {}) {
  const links = new Map(); // session_id → customer_id
  const sql = (strings, ...values) => {
    const text = strings.join("?");
    if (text.includes("INSERT INTO customer_session_links")) {
      const [sid, customerId] = values;
      links.set(sid, customerId); // ON CONFLICT DO UPDATE → last write wins
      return Promise.resolve([]);
    }
    if (text.includes("FROM customers c")) {
      // resolveSignedInCustomerRow interpolates the session id (link subquery).
      const sid = values[0];
      const customerId = links.get(sid);
      const cust = customerId != null ? customers[customerId] : undefined;
      if (!cust || cust.shopify_customer_id == null) return Promise.resolve([]);
      return Promise.resolve([
        {
          id: customerId,
          shopify_customer_id: cust.shopify_customer_id,
          identity_tier: cust.identity_tier ?? 3,
        },
      ]);
    }
    throw new Error(`unexpected query: ${text}`);
  };
  sql._links = links;
  return sql;
}

// ---------------------------------------------------------------------------
// linkSessionToCustomer — the write guard
// ---------------------------------------------------------------------------

test("linkSessionToCustomer no-ops (no DB write) without sql / session / customer", async () => {
  const sql = makeSql();
  assert.equal(await linkSessionToCustomer(null, "sess-1", 42), false);
  assert.equal(await linkSessionToCustomer(sql, "", 42), false);
  assert.equal(await linkSessionToCustomer(sql, "   ", 42), false);
  assert.equal(await linkSessionToCustomer(sql, "sess-1", null), false);
  assert.equal(sql._links.size, 0);
});

test("linkSessionToCustomer trims and persists the link", async () => {
  const sql = makeSql();
  assert.equal(await linkSessionToCustomer(sql, "  sess-widget-1  ", 42), true);
  assert.equal(sql._links.get("sess-widget-1"), 42);
});

// ---------------------------------------------------------------------------
// resolveSignedInCustomerRow — the read guard (fail-closed)
// ---------------------------------------------------------------------------

test("resolveSignedInCustomerRow finds the signed-in customer under the widget's session_id", async () => {
  // Customer 42 is signed in (has a shopify_customer_id).
  const sql = makeSql({ customers: { 42: { shopify_customer_id: "9988", identity_tier: 3 } } });

  // Sign-in persists the DIRECT link under the SAME session the widget holds...
  await linkSessionToCustomer(sql, "sess-widget-1", 42);

  // ...and /api/auth/me re-hydrates by resolving that exact session id.
  const resolved = await resolveSignedInCustomerRow(sql, "sess-widget-1");
  assert.deepEqual(resolved, { customerId: 42, shopifyCustomerId: "9988" });

  // The widget may send the id with stray whitespace (query vs header) — same row.
  assert.deepEqual(await resolveSignedInCustomerRow(sql, "  sess-widget-1 "), {
    customerId: 42,
    shopifyCustomerId: "9988",
  });
});

test("resolveSignedInCustomerRow fails closed for blank / unlinked / non-signed-in sessions", async () => {
  const sql = makeSql({
    customers: {
      // tier-2 (email-only): linked but NOT signed in → must not resolve.
      7: { shopify_customer_id: null, identity_tier: 2 },
      42: { shopify_customer_id: "9988", identity_tier: 3 },
    },
  });
  await linkSessionToCustomer(sql, "sess-email-only", 7);
  await linkSessionToCustomer(sql, "sess-widget-1", 42);

  assert.equal(await resolveSignedInCustomerRow(sql, null), null);
  assert.equal(await resolveSignedInCustomerRow(sql, ""), null);
  assert.equal(await resolveSignedInCustomerRow(sql, "   "), null);
  assert.equal(await resolveSignedInCustomerRow(null, "sess-widget-1"), null);
  // Unknown session — never linked.
  assert.equal(await resolveSignedInCustomerRow(sql, "sess-unknown"), null);
  // Linked to a tier-2 (email-only) customer — no shopify id → fail closed.
  assert.equal(await resolveSignedInCustomerRow(sql, "sess-email-only"), null);
});

test("re-binding a session re-points the link (tier-2 link → tier-3 sign-in)", async () => {
  const sql = makeSql({
    customers: {
      7: { shopify_customer_id: null, identity_tier: 2 },
      42: { shopify_customer_id: "9988", identity_tier: 3 },
    },
  });
  // Email capture first links the session to the tier-2 row (resolves to null).
  await linkSessionToCustomer(sql, "sess-widget-1", 7);
  assert.equal(await resolveSignedInCustomerRow(sql, "sess-widget-1"), null);

  // Signing in re-points the SAME session to the tier-3 customer.
  await linkSessionToCustomer(sql, "sess-widget-1", 42);
  assert.deepEqual(await resolveSignedInCustomerRow(sql, "sess-widget-1"), {
    customerId: 42,
    shopifyCustomerId: "9988",
  });
});
