import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LINK_GRANT_TTL_MINUTES,
  createLinkGrant,
  hashLinkCode,
  isLinkCode,
  newLinkCode,
  purgeExpiredLinkGrants,
  redeemLinkGrant,
  unlinkAppProxySession,
  unlinkSignedInSessions,
} from "./customer-link-grant.mjs";

// In-memory stand-in for the three tables the grant touches:
//   customer_link_grants, customer_session_links, conversations.
function makeSql({ now = () => Date.now() } = {}) {
  const grants = new Map(); // code_hash → row
  const links = new Map(); // session_id → { customerId, kind }
  const conversations = [
    { session_id: "sess-victim", customer_id: null },
    { session_id: "sess-attacker", customer_id: null },
  ];
  const sql = (strings, ...values) => {
    const text = strings.join("?");
    if (text.includes("INSERT INTO customer_link_grants")) {
      const [hash, sid, customerId, kind, expiresAt] = values;
      grants.set(hash, { session_id: sid, customer_id: customerId, link_kind: kind, expires_at: Date.parse(expiresAt), consumed_at: null });
      return Promise.resolve([]);
    }
    if (text.includes("UPDATE customer_link_grants")) {
      const [hash] = values;
      const g = grants.get(hash);
      if (!g || g.consumed_at != null || g.expires_at <= now()) return Promise.resolve([]);
      g.consumed_at = now();
      return Promise.resolve([{ session_id: g.session_id, customer_id: g.customer_id, link_kind: g.link_kind }]);
    }
    if (text.includes("UPDATE conversations SET customer_id")) {
      const [customerId, sid] = values;
      for (const c of conversations) if (c.session_id === sid) c.customer_id = customerId;
      return Promise.resolve([]);
    }
    if (text.includes("INSERT INTO customer_session_links")) {
      const [sid, customerId, kind] = values;
      links.set(sid, { customerId, kind });
      return Promise.resolve([]);
    }
    if (text.includes("DELETE FROM customer_session_links") && text.includes("link_kind = 'app_proxy'") && !text.includes("customer_id =")) {
      const [sid] = values;
      const l = links.get(sid);
      if (l && l.kind === "app_proxy") {
        links.delete(sid);
        return Promise.resolve([{ session_id: sid }]);
      }
      return Promise.resolve([]);
    }
    if (text.includes("DELETE FROM customer_session_links")) {
      const [customerId, sid1] = values;
      const out = [];
      for (const [sid, l] of [...links]) {
        const byCustomer = l.customerId === customerId && l.kind === "customer_account";
        const bySession = sid1 != null && sid === sid1 && (l.kind === "customer_account" || l.kind === "app_proxy");
        if (byCustomer || bySession) {
          links.delete(sid);
          out.push({ session_id: sid });
        }
      }
      return Promise.resolve(out);
    }
    if (text.includes("DELETE FROM customer_link_grants")) {
      let n = 0;
      for (const [h, g] of [...grants]) if (g.expires_at < now() - 86_400_000) { grants.delete(h); n++; }
      return Promise.resolve([{ n }]);
    }
    throw new Error(`unexpected query: ${text}`);
  };
  Object.assign(sql, { grants, links, conversations });
  return sql;
}

test("codes: 43 url-safe chars, unique, only the hash is stored", async () => {
  const a = newLinkCode();
  const b = newLinkCode();
  assert.ok(isLinkCode(a) && isLinkCode(b));
  assert.notEqual(a, b);
  assert.match(hashLinkCode(a), /^[0-9a-f]{64}$/);
  assert.equal(isLinkCode("short"), false);
  assert.equal(isLinkCode(null), false);
  const sql = makeSql();
  const code = await createLinkGrant(sql, { sessionId: "sess-victim", customerId: 7, kind: "customer_account" });
  assert.ok(isLinkCode(code));
  assert.equal(sql.grants.has(hashLinkCode(code)), true);
  assert.equal([...sql.grants.keys()].includes(code), false, "the plain code is never stored");
  const g = sql.grants.get(hashLinkCode(code));
  assert.ok(Math.abs(g.expires_at - Date.now() - LINK_GRANT_TTL_MINUTES * 60_000) < 5000);
});

test("the widget that started the sign-in redeems its code: linked + its chat attached", async () => {
  const sql = makeSql();
  const code = await createLinkGrant(sql, { sessionId: "sess-victim", customerId: 7, kind: "customer_account" });
  const r = await redeemLinkGrant(sql, { code, sessionId: "sess-victim" });
  assert.deepEqual(r, { ok: true, customerId: 7, kind: "customer_account" });
  assert.deepEqual(sql.links.get("sess-victim"), { customerId: 7, kind: "customer_account" });
  assert.equal(sql.conversations.find((c) => c.session_id === "sess-victim").customer_id, 7);
});

test("ATTACK: a sign-in started for a stranger's session never links when another session redeems", async () => {
  // The stranger put their own session into the login link; the victim's
  // browser completed the silent sign-in and its widget sees the code.
  const sql = makeSql();
  const code = await createLinkGrant(sql, { sessionId: "sess-attacker", customerId: 7, kind: "customer_account" });
  const r = await redeemLinkGrant(sql, { code, sessionId: "sess-victim" });
  assert.deepEqual(r, { ok: false, reason: "session_mismatch" });
  assert.equal(sql.links.size, 0);
  // …and the code is burned: the stranger cannot use it afterwards either.
  const again = await redeemLinkGrant(sql, { code, sessionId: "sess-attacker" });
  assert.deepEqual(again, { ok: false, reason: "invalid" });
  assert.equal(sql.links.size, 0);
  assert.equal(sql.conversations.find((c) => c.session_id === "sess-attacker").customer_id, null);
});

test("a stranger without the code gets nothing; codes are single-use and expire", async () => {
  let t = Date.now();
  const sql = makeSql({ now: () => t });
  const code = await createLinkGrant(sql, { sessionId: "sess-attacker", customerId: 7, kind: "app_proxy" });
  assert.deepEqual(await redeemLinkGrant(sql, { code: newLinkCode(), sessionId: "sess-attacker" }), { ok: false, reason: "invalid" });
  assert.deepEqual(await redeemLinkGrant(sql, { code: "not-a-code", sessionId: "sess-attacker" }), { ok: false, reason: "invalid" });
  t += (LINK_GRANT_TTL_MINUTES + 1) * 60_000;
  assert.deepEqual(await redeemLinkGrant(sql, { code, sessionId: "sess-attacker" }), { ok: false, reason: "invalid" });
  t = Date.now();
  const fresh = await createLinkGrant(sql, { sessionId: "s1", customerId: 9, kind: "app_proxy" });
  assert.equal((await redeemLinkGrant(sql, { code: fresh, sessionId: "s1" })).ok, true);
  assert.deepEqual(await redeemLinkGrant(sql, { code: fresh, sessionId: "s1" }), { ok: false, reason: "invalid" });
});

test("nothing is minted without a session, a customer or a signed-in kind", async () => {
  const sql = makeSql();
  assert.equal(await createLinkGrant(sql, { sessionId: "", customerId: 7, kind: "customer_account" }), null);
  assert.equal(await createLinkGrant(sql, { sessionId: "s", customerId: null, kind: "customer_account" }), null);
  assert.equal(await createLinkGrant(sql, { sessionId: "s", customerId: 7, kind: "email" }), null);
  assert.equal(await createLinkGrant(null, { sessionId: "s", customerId: 7, kind: "customer_account" }), null);
  assert.equal(sql.grants.size, 0);
  assert.deepEqual(await redeemLinkGrant(sql, { code: newLinkCode(), sessionId: "" }), { ok: false, reason: "invalid" });
});

test("logout removes every Customer Account link of the customer and the session's App Proxy link", async () => {
  const sql = makeSql();
  sql.links.set("pc-shared", { customerId: 7, kind: "customer_account" });
  sql.links.set("phone", { customerId: 7, kind: "customer_account" });
  sql.links.set("shop-tab", { customerId: 7, kind: "app_proxy" });
  sql.links.set("typed", { customerId: 7, kind: "email" });
  sql.links.set("other-person", { customerId: 8, kind: "customer_account" });
  const n = await unlinkSignedInSessions(sql, { customerId: 7, sessionId: "shop-tab" });
  assert.equal(n, 3);
  assert.deepEqual([...sql.links.keys()].sort(), ["other-person", "typed"]);
  assert.equal(await unlinkSignedInSessions(sql, { customerId: null }), 0);
});

test("a logged-out shop session drops only its own App Proxy link", async () => {
  const sql = makeSql();
  sql.links.set("tab", { customerId: 7, kind: "app_proxy" });
  sql.links.set("tab-oauth", { customerId: 7, kind: "customer_account" });
  assert.equal(await unlinkAppProxySession(sql, "tab"), 1);
  assert.equal(await unlinkAppProxySession(sql, "tab-oauth"), 0);
  assert.equal(await unlinkAppProxySession(sql, ""), 0);
  assert.deepEqual([...sql.links.keys()], ["tab-oauth"]);
});

test("purge removes grants a day past expiry", async () => {
  let t = Date.now();
  const sql = makeSql({ now: () => t });
  await createLinkGrant(sql, { sessionId: "s", customerId: 7, kind: "customer_account" });
  assert.equal(await purgeExpiredLinkGrants(sql), 0);
  t += 2 * 86_400_000;
  assert.equal(await purgeExpiredLinkGrants(sql), 1);
  assert.equal(await purgeExpiredLinkGrants(null), 0);
});
