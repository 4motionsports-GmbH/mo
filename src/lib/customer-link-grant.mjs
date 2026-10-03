// One-time sign-in grants (migration 0073): a verified sign-in becomes a
// session link only when the widget that STARTED it redeems the code.
//
// The Customer Account callback and the App Proxy (whoami) used to link the
// session id they were given in the URL. Anyone can put any session id into a
// URL, so a stranger could have a shop customer's browser complete a silent
// sign-in for the stranger's session. Now both mint a grant for that session;
// the code reaches only the browser that completed the sign-in, and
// redeemLinkGrant writes the link only when the redeeming session is the one
// the grant names. Codes are stored as SHA-256 hashes, expire after
// LINK_GRANT_TTL_MINUTES and are consumed on first use — a redeem attempt from
// another session burns the code as well.
//
// Plain .mjs with an injected sql (like customer-session-link.mjs) so the
// contract is unit-tested with a fake client. Functions throw on DB errors;
// the TypeScript callers catch and report.

import { createHash, randomBytes } from "node:crypto";
import { linkSessionToCustomer } from "./customer-session-link.mjs";

export const LINK_GRANT_TTL_MINUTES = 10;
export const LINK_GRANT_KINDS = ["customer_account", "app_proxy"];

/** 32 random bytes, base64url — 43 characters. */
export function newLinkCode() {
  return randomBytes(32).toString("base64url");
}

/** @param {string} code */
export function hashLinkCode(code) {
  return createHash("sha256").update(String(code), "utf8").digest("hex");
}

/** @param {unknown} v */
export function isLinkCode(v) {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}

/** @param {unknown} v */
function cleanSession(v) {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.length <= 200 ? s : "";
}

/**
 * Mint a grant for (session, customer, kind). Returns the plain code (never
 * stored) or null when there is nothing safe to mint.
 *
 * @param {*} sql
 * @param {{ sessionId: unknown, customerId: number | null, kind: string, ttlMinutes?: number }} input
 * @returns {Promise<string | null>}
 */
export async function createLinkGrant(sql, input) {
  const sid = cleanSession(input.sessionId);
  if (!sql || !sid || input.customerId == null || !LINK_GRANT_KINDS.includes(input.kind)) return null;
  const ttl = Math.max(1, Math.min(60, Math.floor(input.ttlMinutes ?? LINK_GRANT_TTL_MINUTES)));
  const code = newLinkCode();
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();
  await sql`
    INSERT INTO customer_link_grants (code_hash, session_id, customer_id, link_kind, expires_at)
    VALUES (${hashLinkCode(code)}, ${sid}, ${input.customerId}, ${input.kind}, ${expiresAt})
  `;
  return code;
}

/**
 * Redeem a code for the session that presents it. Consumes the grant on the
 * first attempt (whatever the outcome), then links the session — only when it
 * is the session the grant was minted for — and attaches its conversations to
 * the customer (the chat that led to the sign-in).
 *
 * @param {*} sql
 * @param {{ code: unknown, sessionId: unknown }} input
 * @returns {Promise<{ ok: true, customerId: number, kind: string } | { ok: false, reason: "invalid" | "session_mismatch" }>}
 */
export async function redeemLinkGrant(sql, input) {
  const sid = cleanSession(input.sessionId);
  if (!sql || !sid || !isLinkCode(input.code)) return { ok: false, reason: "invalid" };
  const rows = await sql`
    UPDATE customer_link_grants
       SET consumed_at = now()
     WHERE code_hash = ${hashLinkCode(/** @type {string} */ (input.code))}
       AND consumed_at IS NULL
       AND expires_at > now()
    RETURNING session_id, customer_id, link_kind
  `;
  const g = rows && rows[0];
  if (!g) return { ok: false, reason: "invalid" };
  if (String(g.session_id) !== sid) return { ok: false, reason: "session_mismatch" };
  const customerId = Number(g.customer_id);
  const kind = String(g.link_kind);
  await sql`UPDATE conversations SET customer_id = ${customerId} WHERE session_id = ${sid}`;
  await linkSessionToCustomer(sql, sid, customerId, /** @type {any} */ (kind));
  return { ok: true, customerId, kind };
}

/**
 * Sign-out: remove the signed-in links. The customer's tokens are per customer
 * (not per session) and are deleted on logout, so every Customer Account link
 * of that customer goes too — otherwise a later sign-in on another device
 * would revive a session left behind on a shared computer. The logging-out
 * session also loses an App Proxy link. Typed-e-mail links stay (they never
 * counted as signed in). Returns the number of links removed.
 *
 * @param {*} sql
 * @param {{ customerId: number | null, sessionId?: unknown }} input
 * @returns {Promise<number>}
 */
export async function unlinkSignedInSessions(sql, input) {
  if (!sql || input.customerId == null) return 0;
  const sid = cleanSession(input.sessionId) || null;
  const rows = await sql`
    DELETE FROM customer_session_links
     WHERE (customer_id = ${input.customerId} AND link_kind = 'customer_account')
        OR (${sid}::text IS NOT NULL AND session_id = ${sid}
            AND link_kind IN ('customer_account', 'app_proxy'))
    RETURNING session_id
  `;
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * The shop says this session's browser is NOT logged in (a valid App Proxy
 * request without logged_in_customer_id): drop the session's App Proxy link,
 * so a shop logout ends the chat's signed-in state too.
 *
 * @param {*} sql
 * @param {unknown} sessionId
 * @returns {Promise<number>}
 */
export async function unlinkAppProxySession(sql, sessionId) {
  const sid = cleanSession(sessionId);
  if (!sql || !sid) return 0;
  const rows = await sql`
    DELETE FROM customer_session_links
     WHERE session_id = ${sid} AND link_kind = 'app_proxy'
    RETURNING session_id
  `;
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Retention: grants past their expiry (consumed or not).
 * @param {*} sql
 * @returns {Promise<number>}
 */
export async function purgeExpiredLinkGrants(sql) {
  if (!sql) return 0;
  const rows = await sql`
    WITH del AS (DELETE FROM customer_link_grants WHERE expires_at < now() - interval '1 day' RETURNING 1)
    SELECT count(*)::int AS n FROM del
  `;
  return rows && rows[0] && rows[0].n != null ? Number(rows[0].n) : 0;
}
