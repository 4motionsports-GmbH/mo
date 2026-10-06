import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachSessionOnEmailCapture,
  captureMovesConversationsFrom,
  isSignedInLinkKind,
  linkSessionToCustomer,
  resolveLinkedCustomerId,
  resolveSignedInCustomerRow,
  resolveSignedInLink,
  resolveSignedInLinkWithProof,
} from "./customer-session-link.mjs";

// ---------------------------------------------------------------------------
// A tiny in-memory stand-in for the tagged-template sql client. It models just
// enough of the two tables the link touches:
//   * customer_session_links (session_id → customer_id)        — written by link
//   * customers (id → { shopify_customer_id, identity_tier })  — seeded per test
// so a write-then-read round-trip exercises the REAL re-hydration contract:
// "the session the widget holds resolves to the linked signed-in customer."
// ---------------------------------------------------------------------------
function makeSql({ customers = {}, conversations = [] } = {}) {
  const links = new Map(); // session_id → { customerId, kind }
  const authAt = new Map(); // session_id → authenticated_at
  // conversations: id → { sessionId, customerId } (only what the capture attach touches)
  const convs = new Map(conversations.map((c) => [c.id, { sessionId: c.sessionId, customerId: c.customerId ?? null }]));
  const sql = (strings, ...values) => {
    const text = strings.join("?");
    if (text.includes("SELECT customer_id, link_kind FROM customer_session_links")) {
      // attachSessionOnEmailCapture — the session's link BEFORE the capture.
      const link = links.get(values[0]);
      return Promise.resolve(link ? [{ customer_id: link.customerId, link_kind: link.kind }] : []);
    }
    if (text.includes("UPDATE conversations SET customer_id")) {
      // Two spelled-out variants: (NULL | new) and (NULL | new | the corrected e-mail's customer).
      const [to, sid, same, from] = values;
      assert.equal(to, same);
      assert.equal(text.split("OR customer_id = ?").length - 1, values.length === 4 ? 2 : 1);
      for (const c of convs.values()) {
        if (c.sessionId !== sid) continue;
        if (c.customerId == null || c.customerId === to || (values.length === 4 && c.customerId === from)) c.customerId = to;
      }
      return Promise.resolve([]);
    }
    if (text.includes("INSERT INTO customer_session_links")) {
      const [sid, customerId, kind] = values;
      const prev = links.get(sid);
      // The ON CONFLICT rule: an e-mail link for the SAME customer keeps a
      // signed-in kind, an App Proxy link keeps a Customer Account sign-in;
      // anything else takes the new kind.
      assert.match(text, /link_kind = 'customer_account'\s+AND EXCLUDED\.link_kind = 'app_proxy'/);
      const keep =
        prev &&
        prev.customerId === customerId &&
        ((isSignedInLinkKind(prev.kind) && kind === "email") ||
          (prev.kind === "customer_account" && kind === "app_proxy"));
      links.set(sid, { customerId, kind: keep ? prev.kind : kind });
      if (!keep) authAt.set(sid, values[3] ?? null);
      return Promise.resolve([]);
    }
    // resolveSignedInCustomerRow joins the link to customers and only accepts
    // the signed-in kinds; match it before the standalone link read.
    if (text.includes("JOIN customers c")) {
      assert.match(text, /link_kind IN \('customer_account', 'app_proxy'\)/);
      const sid = values[0];
      const link = links.get(sid);
      const cust = link ? customers[link.customerId] : undefined;
      if (!link || !isSignedInLinkKind(link.kind) || !cust || cust.shopify_customer_id == null) {
        return Promise.resolve([]);
      }
      return Promise.resolve([
        {
          id: link.customerId,
          shopify_customer_id: cust.shopify_customer_id,
          identity_tier: cust.identity_tier ?? 3,
          link_kind: link.kind,
          authenticated_at: authAt.get(sid) ?? null,
        },
      ]);
    }
    if (text.includes("SELECT customer_id FROM customer_session_links")) {
      // resolveLinkedCustomerId — the ANY-tier direct link read (standalone).
      const sid = values[0];
      const link = links.get(sid);
      return Promise.resolve(link ? [{ customer_id: link.customerId }] : []);
    }
    throw new Error(`unexpected query: ${text}`);
  };
  sql._links = links;
  sql._convs = convs;
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
  assert.deepEqual(sql._links.get("sess-widget-1"), { customerId: 42, kind: "email" });
  // An unknown kind is stored as the weakest one.
  await linkSessionToCustomer(sql, "sess-2", 42, "admin");
  assert.equal(sql._links.get("sess-2").kind, "email");
});

// ---------------------------------------------------------------------------
// resolveLinkedCustomerId — the ANY-tier direct link (stamps conversations)
// ---------------------------------------------------------------------------

test("resolveLinkedCustomerId returns the linked customer_id for ANY tier (or null)", async () => {
  const sql = makeSql();
  // Even a tier-2 (email-only) link resolves here — this read is NOT gated on
  // shopify_customer_id (it stamps conversations.customer_id at creation).
  await linkSessionToCustomer(sql, "sess-1", 7);
  assert.equal(await resolveLinkedCustomerId(sql, "sess-1"), 7);
  assert.equal(await resolveLinkedCustomerId(sql, "  sess-1 "), 7);

  // Fail-soft: no sql / blank / unlinked session → null.
  assert.equal(await resolveLinkedCustomerId(null, "sess-1"), null);
  assert.equal(await resolveLinkedCustomerId(sql, ""), null);
  assert.equal(await resolveLinkedCustomerId(sql, "sess-unknown"), null);
});

// ---------------------------------------------------------------------------
// resolveSignedInCustomerRow — the read guard (fail-closed)
// ---------------------------------------------------------------------------

test("resolveSignedInCustomerRow finds the signed-in customer under the widget's session_id", async () => {
  // Customer 42 is signed in (has a shopify_customer_id).
  const sql = makeSql({ customers: { 42: { shopify_customer_id: "9988", identity_tier: 3 } } });

  // Sign-in persists the DIRECT link under the SAME session the widget holds...
  await linkSessionToCustomer(sql, "sess-widget-1", 42, "customer_account");

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
  await linkSessionToCustomer(sql, "sess-widget-1", 42, "customer_account");

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
  await linkSessionToCustomer(sql, "sess-widget-1", 42, "customer_account");
  assert.deepEqual(await resolveSignedInCustomerRow(sql, "sess-widget-1"), {
    customerId: 42,
    shopifyCustomerId: "9988",
  });
});

// ---------------------------------------------------------------------------
// The proof behind a link (migration 0071)
// ---------------------------------------------------------------------------

test("a TYPED e-mail of a Shopify customer never makes the session signed in", async () => {
  // Since the customer mirror every shop customer has a shopify_customer_id —
  // typing their address in another browser must not resolve as their sign-in.
  const sql = makeSql({ customers: { 42: { shopify_customer_id: "9988", identity_tier: 3 } } });
  await linkSessionToCustomer(sql, "sess-attacker", 42, "email");
  assert.equal(await resolveSignedInCustomerRow(sql, "sess-attacker"), null);
  // The default kind is "email" too.
  await linkSessionToCustomer(sql, "sess-default", 42);
  assert.equal(await resolveSignedInCustomerRow(sql, "sess-default"), null);
});

test("the App Proxy sign-in counts; a legacy or unknown kind does not", async () => {
  const sql = makeSql({ customers: { 42: { shopify_customer_id: "9988", identity_tier: 3 } } });
  await linkSessionToCustomer(sql, "sess-proxy", 42, "app_proxy");
  assert.deepEqual(await resolveSignedInCustomerRow(sql, "sess-proxy"), { customerId: 42, shopifyCustomerId: "9988" });
  sql._links.set("sess-legacy", { customerId: 42, kind: "legacy" });
  assert.equal(await resolveSignedInCustomerRow(sql, "sess-legacy"), null);
  assert.equal(isSignedInLinkKind("legacy"), false);
  assert.equal(isSignedInLinkKind("email"), false);
  assert.equal(isSignedInLinkKind("customer_account"), true);
});

test("a signed-in customer typing their OWN e-mail stays signed in; another customer's drops it", async () => {
  const sql = makeSql({
    customers: {
      42: { shopify_customer_id: "9988", identity_tier: 3 },
      43: { shopify_customer_id: "7777", identity_tier: 3 },
    },
  });
  await linkSessionToCustomer(sql, "sess-1", 42, "customer_account");
  await linkSessionToCustomer(sql, "sess-1", 42, "email"); // summary mail to their own address
  assert.deepEqual(await resolveSignedInCustomerRow(sql, "sess-1"), { customerId: 42, shopifyCustomerId: "9988" });
  await linkSessionToCustomer(sql, "sess-1", 43, "email"); // someone else's address
  assert.equal(await resolveSignedInCustomerRow(sql, "sess-1"), null);
});

// ---------------------------------------------------------------------------
// resolveSignedInLink — the signed-in link WITH its kind (order status gate)
// ---------------------------------------------------------------------------

test("resolveSignedInLink returns the customer and HOW the session signed in", async () => {
  const sql = makeSql({ customers: { 42: { shopify_customer_id: "9988", identity_tier: 3 } } });
  await linkSessionToCustomer(sql, "sess-oauth", 42, "customer_account");
  await linkSessionToCustomer(sql, "sess-proxy", 42, "app_proxy");
  assert.deepEqual(await resolveSignedInLink(sql, " sess-oauth "), {
    customerId: 42,
    shopifyCustomerId: "9988",
    linkKind: "customer_account",
  });
  assert.deepEqual(await resolveSignedInLink(sql, "sess-proxy"), {
    customerId: 42,
    shopifyCustomerId: "9988",
    linkKind: "app_proxy",
  });
});

test("resolveSignedInLink fails closed exactly like resolveSignedInCustomerRow", async () => {
  const sql = makeSql({
    customers: {
      7: { shopify_customer_id: null, identity_tier: 2 },
      42: { shopify_customer_id: "9988", identity_tier: 3 },
    },
  });
  await linkSessionToCustomer(sql, "sess-email", 42, "email"); // typed e-mail of a shop customer
  await linkSessionToCustomer(sql, "sess-no-shop", 7, "customer_account");
  sql._links.set("sess-legacy", { customerId: 42, kind: "legacy" });

  assert.equal(await resolveSignedInLink(null, "sess-email"), null);
  assert.equal(await resolveSignedInLink(sql, ""), null);
  assert.equal(await resolveSignedInLink(sql, undefined), null);
  assert.equal(await resolveSignedInLink(sql, "sess-unknown"), null);
  assert.equal(await resolveSignedInLink(sql, "sess-email"), null);
  assert.equal(await resolveSignedInLink(sql, "sess-no-shop"), null);
  assert.equal(await resolveSignedInLink(sql, "sess-legacy"), null);
});

test("resolveSignedInLink rejects a row whose kind is not a signed-in kind (defence in depth)", async () => {
  // Even if a query ever returned a weaker kind, the helper must not pass it on.
  const sql = () => Promise.resolve([{ id: 42, shopify_customer_id: "9988", link_kind: "email" }]);
  assert.equal(await resolveSignedInLink(sql, "sess-1"), null);
});

test("the shop's App Proxy never downgrades a Customer Account sign-in of the same customer", async () => {
  const sql = makeSql({ customers: { 7: { shopify_customer_id: "111" }, 8: { shopify_customer_id: "222" } } });
  await linkSessionToCustomer(sql, "s", 7, "customer_account");
  await linkSessionToCustomer(sql, "s", 7, "app_proxy");
  assert.equal(sql._links.get("s").kind, "customer_account");
  // Another customer always re-points with the new kind.
  await linkSessionToCustomer(sql, "s", 8, "app_proxy");
  assert.deepEqual(sql._links.get("s"), { customerId: 8, kind: "app_proxy" });
});

test("resolveSignedInLinkWithProof also returns when the link was authenticated", async () => {
  const sql = makeSql({ customers: { 42: { shopify_customer_id: "9988" } } });
  await linkSessionToCustomer(sql, "sess-proxy", 42, "app_proxy");
  const r = await resolveSignedInLinkWithProof(sql, "sess-proxy");
  assert.equal(r?.linkKind, "app_proxy");
  assert.equal(r?.customerId, 42);
  assert.ok(r?.authenticatedAt && Number.isFinite(Date.parse(r.authenticatedAt)));
  assert.equal(await resolveSignedInLinkWithProof(sql, "nope"), null);
  await linkSessionToCustomer(sql, "typed", 42, "email");
  assert.equal(await resolveSignedInLinkWithProof(sql, "typed"), null);
});

// ---------------------------------------------------------------------------
// attachSessionOnEmailCapture — which chats follow a typed e-mail (C.27)
// ---------------------------------------------------------------------------

const owners = (sql) => Object.fromEntries([...sql._convs].map(([id, c]) => [id, c.customerId]));

test("captureMovesConversationsFrom: only a correction of an earlier typed e-mail moves owned chats", () => {
  assert.equal(captureMovesConversationsFrom(null, 9), null); // anonymous: nothing owned to move
  assert.equal(captureMovesConversationsFrom(undefined, 9), null);
  assert.equal(captureMovesConversationsFrom({ customerId: 7, kind: "email" }, 9), 7); // correction
  assert.equal(captureMovesConversationsFrom({ customerId: "7", kind: "email" }, 9), 7);
  assert.equal(captureMovesConversationsFrom({ customerId: 9, kind: "email" }, 9), null); // same customer
  assert.equal(captureMovesConversationsFrom({ customerId: 42, kind: "customer_account" }, 9), null); // signed in
  assert.equal(captureMovesConversationsFrom({ customerId: 42, kind: "app_proxy" }, 9), null);
  assert.equal(captureMovesConversationsFrom({ customerId: 42, kind: "legacy" }, 9), null); // unknown proof: fail closed
  assert.equal(captureMovesConversationsFrom({ customerId: null, kind: "email" }, 9), null);
  assert.equal(captureMovesConversationsFrom({ customerId: "x", kind: "email" }, 9), null);
});

test("attachSessionOnEmailCapture no-ops without sql / session / customer", async () => {
  const sql = makeSql({ conversations: [{ id: 1, sessionId: "s" }] });
  assert.equal(await attachSessionOnEmailCapture(null, "s", 9), false);
  assert.equal(await attachSessionOnEmailCapture(sql, "  ", 9), false);
  assert.equal(await attachSessionOnEmailCapture(sql, "s", null), false);
  assert.deepEqual(owners(sql), { 1: null });
  assert.equal(sql._links.size, 0);
});

test("an anonymous capture links the session and all its chats, as before", async () => {
  const sql = makeSql({
    conversations: [
      { id: 1, sessionId: "anon" },
      { id: 2, sessionId: "anon" },
      { id: 3, sessionId: "other", customerId: null },
    ],
  });
  assert.equal(await attachSessionOnEmailCapture(sql, " anon ", 9), true);
  assert.deepEqual(owners(sql), { 1: 9, 2: 9, 3: null }); // another session is never touched
  assert.deepEqual(sql._links.get("anon"), { customerId: 9, kind: "email" });
});

test("a corrected e-mail in an anonymous session takes its chats along (latest capture wins)", async () => {
  const sql = makeSql({ conversations: [{ id: 1, sessionId: "anon" }, { id: 2, sessionId: "anon" }] });
  await attachSessionOnEmailCapture(sql, "anon", 7); // typo
  await attachSessionOnEmailCapture(sql, "anon", 9); // corrected
  assert.deepEqual(owners(sql), { 1: 9, 2: 9 });
  assert.deepEqual(sql._links.get("anon"), { customerId: 9, kind: "email" });
});

test("C.27: a signed-in customer typing someone else's e-mail ends the sign-in, the chats stay theirs", async () => {
  // Customer 42 signed in without a verified e-mail (shopify: placeholder); the
  // capture form is the 422 fallback. Customer 9 owns the typed address.
  const sql = makeSql({
    customers: { 42: { shopify_customer_id: "9988", identity_tier: 3 }, 9: { shopify_customer_id: "5555" } },
    conversations: [
      { id: 1, sessionId: "s", customerId: 42 }, // stamped by the redeem / created while signed in
      { id: 2, sessionId: "s", customerId: 42 },
      { id: 3, sessionId: "s", customerId: null }, // no owner yet
    ],
  });
  await linkSessionToCustomer(sql, "s", 42, "customer_account");
  await attachSessionOnEmailCapture(sql, "s", 9);
  assert.deepEqual(owners(sql), { 1: 42, 2: 42, 3: 9 });
  // Only the sign-in link changed: the session is now linked by the typed e-mail.
  assert.deepEqual(sql._links.get("s"), { customerId: 9, kind: "email" });
  assert.equal(await resolveSignedInCustomerRow(sql, "s"), null);

  // A further capture in the same session corrects the typed address only:
  // the former signed-in customer's chats still stay with them.
  await attachSessionOnEmailCapture(sql, "s", 11);
  assert.deepEqual(owners(sql), { 1: 42, 2: 42, 3: 11 });
});

test("the same holds for a shop-login (App Proxy) sign-in and a legacy link", async () => {
  const sql = makeSql({
    conversations: [
      { id: 1, sessionId: "proxy", customerId: 42 },
      { id: 2, sessionId: "legacy", customerId: 42 },
    ],
  });
  await linkSessionToCustomer(sql, "proxy", 42, "app_proxy");
  sql._links.set("legacy", { customerId: 42, kind: "legacy" });
  await attachSessionOnEmailCapture(sql, "proxy", 9);
  await attachSessionOnEmailCapture(sql, "legacy", 9);
  assert.deepEqual(owners(sql), { 1: 42, 2: 42 });
});

test("a signed-in customer typing their OWN address stays signed in; another person's chat stays theirs", async () => {
  const sql = makeSql({
    customers: { 42: { shopify_customer_id: "9988", identity_tier: 3 } },
    conversations: [
      { id: 1, sessionId: "s", customerId: null },
      { id: 2, sessionId: "s", customerId: 42 },
      { id: 3, sessionId: "s", customerId: 7 }, // typed by someone before this sign-in (shared browser)
    ],
  });
  await linkSessionToCustomer(sql, "s", 42, "customer_account");
  await attachSessionOnEmailCapture(sql, "s", 42); // the summary mail / the opt-in after sign-in
  assert.deepEqual(owners(sql), { 1: 42, 2: 42, 3: 7 });
  assert.deepEqual(await resolveSignedInCustomerRow(sql, "s"), { customerId: 42, shopifyCustomerId: "9988" });
});
