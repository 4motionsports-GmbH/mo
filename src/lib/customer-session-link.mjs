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
 * Upsert the direct session → customer link. Idempotent: a later bind under the
 * same session re-points it (e.g. tier-2 email link → tier-3 sign-in). Returns
 * false (without touching the DB) when there's nothing safe to write. Never
 * throws — best-effort, exactly like the conversation attach it backs up.
 *
 * @param {*} sql                 tagged-template sql client (or null)
 * @param {unknown} sessionId     the widget's localStorage session id
 * @param {number|null} customerId
 * @returns {Promise<boolean>}
 */
export async function linkSessionToCustomer(sql, sessionId, customerId) {
  const sid = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!sql || !sid || customerId == null) return false;
  await sql`
    INSERT INTO customer_session_links (session_id, customer_id, linked_at, last_seen_at)
    VALUES (${sid}, ${customerId}, now(), now())
    ON CONFLICT (session_id) DO UPDATE SET
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
 * for a blank session, an unlinked session, or a session linked only to a
 * tier-1/2 customer (no shopify_customer_id).
 *
 * Reads the direct link first (migration 0019); falls back to the legacy
 * conversation stamp so sessions linked before the backfill still resolve. Both
 * are gated on shopify_customer_id IS NOT NULL — identity, not just any link.
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
      FROM customers c
     WHERE c.shopify_customer_id IS NOT NULL
       AND c.id = COALESCE(
         (SELECT customer_id FROM customer_session_links WHERE session_id = ${sid}),
         (SELECT customer_id FROM conversations
           WHERE session_id = ${sid} AND customer_id IS NOT NULL
           ORDER BY id DESC LIMIT 1)
       )
     LIMIT 1
  `;
  const r = rows && rows[0];
  if (!r || r.shopify_customer_id == null) return null;
  return {
    customerId: Number(r.id),
    shopifyCustomerId: String(r.shopify_customer_id),
  };
}
