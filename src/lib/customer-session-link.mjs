// The DIRECT, durable session_id ↔ customer link (migration 0019).
//
// Kept in plain .mjs (sql is INJECTED, no module-level I/O) so the re-hydration
// contract — "the session the widget holds resolves to the linked signed-in
// customer" — is unit-testable with a fake sql, mirroring the
// customer-merge.mjs / customer-account-oauth.mjs convention.
//
// WHY this exists: the link used to live ONLY on conversations.customer_id, so it
// was lost whenever a session signed in before it had any conversation row (the
// prompt=none silent check, or "Anmelden" before chatting). resolveSignedInCustomer
// then found nothing and the widget never flipped to signed-in. See migration
// 0019 for the full write-up. We now write the link here on every identity bind
// and read it here first; the conversation attach stays only for history.

/**
 * How a session was linked (migration 0071). Only a verified sign-in IN THIS
 * SESSION counts as signed in; a typed e-mail proves nothing about mailbox
 * ownership, and 'legacy' rows (before 0071) fail closed.
 *   email             /api/capture-email, /api/chat-marketing-opt-in (tier 2)
 *   customer_account  Customer Account OAuth callback (tier 3)
 *   app_proxy         the shop's App Proxy, HMAC-signed logged_in_customer_id
 */
export const LINK_KINDS = ["email", "customer_account", "app_proxy"];
export const SIGNED_IN_LINK_KINDS = ["customer_account", "app_proxy"];

/** @param {unknown} kind */
export function isSignedInLinkKind(kind) {
  return typeof kind === "string" && SIGNED_IN_LINK_KINDS.includes(kind);
}

/**
 * Upsert the direct session → customer link. Idempotent: a later bind under the
 * same session re-points it (e.g. tier-2 email link → tier-3 sign-in). A typed
 * e-mail for the SAME customer never weakens a signed-in link (a signed-in
 * customer asking for the summary mail stays signed in); a link to ANOTHER
 * customer always takes the new kind, so typing someone else's e-mail drops
 * the sign-in (fail closed). Returns false (without touching the DB) when
 * there's nothing safe to write. Never throws — best-effort, exactly like the
 * conversation attach it backs up.
 *
 * @param {*} sql                 tagged-template sql client (or null)
 * @param {unknown} sessionId     the widget's localStorage session id
 * @param {number|null} customerId
 * @param {"email" | "customer_account" | "app_proxy"} [kind]  how the link was proven
 * @returns {Promise<boolean>}
 */
export async function linkSessionToCustomer(sql, sessionId, customerId, kind = "email") {
  const sid = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!sql || !sid || customerId == null) return false;
  const linkKind = LINK_KINDS.includes(kind) ? kind : "email";
  const signedIn = isSignedInLinkKind(linkKind);
  await sql`
    INSERT INTO customer_session_links (session_id, customer_id, linked_at, last_seen_at, link_kind, authenticated_at)
    VALUES (${sid}, ${customerId}, now(), now(), ${linkKind}, ${signedIn ? new Date().toISOString() : null})
    ON CONFLICT (session_id) DO UPDATE SET
      link_kind = CASE
        WHEN customer_session_links.customer_id = EXCLUDED.customer_id
         AND customer_session_links.link_kind IN ('customer_account', 'app_proxy')
         AND EXCLUDED.link_kind = 'email'
        THEN customer_session_links.link_kind
        ELSE EXCLUDED.link_kind
      END,
      authenticated_at = CASE
        WHEN customer_session_links.customer_id = EXCLUDED.customer_id
         AND customer_session_links.link_kind IN ('customer_account', 'app_proxy')
         AND EXCLUDED.link_kind = 'email'
        THEN customer_session_links.authenticated_at
        ELSE EXCLUDED.authenticated_at
      END,
      customer_id  = EXCLUDED.customer_id,
      last_seen_at = now()
  `;
  return true;
}

/**
 * Resolve the customer_id a session is linked to (ANY tier), or null when the
 * session is blank/unlinked or there's no sql. This is the DIRECT link only — it
 * does NOT gate on shopify_customer_id (use resolveSignedInCustomerRow for the
 * signed-in-only gate). It exists so a conversation can be stamped with its
 * owning customer AT CREATION (lib/conversation-create + persistTurn): a new
 * "Neue Beratung" thread is created under a session that is already linked, so
 * resolving the link here and writing conversations.customer_id eagerly is what
 * makes the thread show up in the customer's history list (the lost-conversation
 * bug was a new row created with customer_id = NULL, never linked).
 *
 * @param {*} sql               tagged-template sql client (or null)
 * @param {unknown} sessionId   the widget's localStorage session id
 * @returns {Promise<number|null>}
 */
export async function resolveLinkedCustomerId(sql, sessionId) {
  const sid = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!sql || !sid) return null;
  const rows = await sql`
    SELECT customer_id FROM customer_session_links WHERE session_id = ${sid}
  `;
  const r = rows && rows[0];
  const id = r && r.customer_id != null ? Number(r.customer_id) : null;
  return Number.isFinite(id) ? id : null;
}

/**
 * Resolve the SIGNED-IN customer for a widget session. Fail-closed: returns null
 * for a blank session, an unlinked session, a session linked by a typed e-mail
 * or before migration 0071 ('legacy'), or a customer without shopify_customer_id.
 *
 * Only the direct link counts, and only when it was proven by a sign-in in THIS
 * session (link_kind customer_account / app_proxy). A typed e-mail never does:
 * since the customer mirror every shop customer has a shopify_customer_id, so
 * "linked customer is a Shopify customer" no longer means "this session signed
 * in". (The old fallback via conversations.customer_id is gone for the same
 * reason — an e-mail capture stamps conversations too.) Callers still check the
 * live token (getValidAccessToken) on top.
 *
 * @param {*} sql               tagged-template sql client (or null)
 * @param {unknown} sessionId   the widget's localStorage session id
 * @returns {Promise<{ customerId: number, shopifyCustomerId: string } | null>}
 */
export async function resolveSignedInCustomerRow(sql, sessionId) {
  const sid = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!sql || !sid) return null;
  const rows = await sql`
    SELECT c.id, c.shopify_customer_id, c.identity_tier
      FROM customer_session_links l
      JOIN customers c ON c.id = l.customer_id
     WHERE l.session_id = ${sid}
       AND l.link_kind IN ('customer_account', 'app_proxy')
       AND c.shopify_customer_id IS NOT NULL
     LIMIT 1
  `;
  const r = rows && rows[0];
  if (!r || r.shopify_customer_id == null) return null;
  return {
    customerId: Number(r.id),
    shopifyCustomerId: String(r.shopify_customer_id),
  };
}
