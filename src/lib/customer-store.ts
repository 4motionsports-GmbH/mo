// Customer data access — the email-keyed entity ABOVE sessions (migration 0008).
//
// Identity model (do not weaken this):
//   * A customer is keyed by the normalised EMAIL, the only reliable
//     cross-session identifier — and it exists only because the user gave it
//     with consent via /api/capture-email.
//   * The localStorage session id is a per-browser THREAD id, not a person.
//     Anonymous sessions are never linked to each other or to a customer.
//   * A conversation gets a customer_id when (and only when) an email is
//     captured for that session. Multiple sessions under one email = the
//     returning-customer case.
//
// email_captures stays the audit-grade source of truth for consent
// (consent_text_shown, DOI lifecycle); customers only MIRRORS the aggregated
// state for customer-level reads. Sync points: email capture, DOI confirm,
// unsubscribe.
//
// Everything here is defensive: linking is best-effort and must never break
// the capture flow; readers return null/[] when no DB is configured.

import { getSql, type Sql } from "./db";
import { normalizeEmail } from "./email-capture-store";
import type { TranscriptMessage } from "./conversation-store";
import type { OrderHistory } from "./shopify-orders";
import type { SignedInAccountSummary } from "./shopify-customer-account";
import { reportError } from "./observability";
import { decideMerge } from "./customer-merge.mjs";
import { isBestandskundeEligible } from "./bestandskunden.mjs";
import { linkSessionToCustomer, resolveSignedInCustomerRow } from "./customer-session-link.mjs";

export type CustomerMarketingStatus = "none" | "pending" | "confirmed" | "unsubscribed";

export interface Customer {
  id: number;
  email: string;
  createdAt: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  transactionalConsent: boolean;
  marketingStatus: CustomerMarketingStatus;
  /** Cached "current understanding" profile (regenerated on demand). */
  profileSummary: string | null;
  profileSummaryUpdatedAt: string | null;
  /** Cached Shopify order-history summary (refreshed on demand). */
  purchaseSummary: OrderHistory | null;
  purchaseSummaryUpdatedAt: string | null;
  /**
   * §7 Abs. 3 UWG eligibility (migration 0017): true ⇔ the cached
   * purchase_summary contains a COMPLETED purchase. A SEPARATE lawful basis
   * from `marketingStatus` (DOI) — never merge the two. Recomputed whenever the
   * purchase summary is refreshed (saveCustomerPurchaseSummary).
   */
  bestandskundeEligible: boolean;
  bestandskundeEligibleUpdatedAt: string | null;
  /**
   * Cached signed-in (tier-3) Customer Account snapshot — name + a
   * data-minimised address context (city/country only). Populated from the
   * Customer Account API on sign-in / refresh (migration 0015). Null for
   * tiers 1–2 and for tier-3 rows not yet refreshed.
   */
  shopifyAccountSummary: SignedInAccountSummary | null;
  shopifyAccountSummaryUpdatedAt: string | null;
  /**
   * The LAWFUL full postal address (migration 0022), the ONLY basis for physical
   * mail (lib/physical-address). Its OWN store, SEPARATE from the minimised
   * city/country account summary above: written only by a future consented-
   * capture / purchase-derived flow, NULL by default. The profile/greeting never
   * read it — minimisation stays intact. Shape:
   * { name, company?, address_line_1, address_line_2?, postal_code, city,
   *   country }. `postalAddressSource` records the lawful basis ('purchase' |
   *   'consented_capture').
   */
  postalAddress: Record<string, unknown> | null;
  postalAddressSource: string | null;
  /**
   * Admin free-text special instructions for the next generated marketing
   * email (migration 0010) — e.g. "mention the new rowing machine line". The
   * CURRENT editable value; the snapshot that went into a specific draft is
   * frozen on the marketing_sends row.
   */
  adminInstructions: string | null;
  adminInstructionsUpdatedAt: string | null;
  // Historical welcome-discount data (migration 0009). The automatic issuance
  // feature was retired pre-launch; these columns are now READ-ONLY — never
  // written again — and back the dashboard's historical view of codes that
  // were issued while the feature was live.
  /** The one-time welcome discount code, if one was issued historically. */
  welcomeCode: string | null;
  /** When that welcome code stops working (Shopify endsAt). */
  welcomeCodeExpiresAt: string | null;
  /** Issuance stamp — non-NULL means a welcome code was issued historically. */
  welcomeIssuedAt: string | null;
  // --- Tier-3 (signed-in Shopify customer) identity (migration 0014) ---------
  /** Numeric extracted from the Shopify customer GID — the tier-3 key. */
  shopifyCustomerId: string | null;
  /** Canonical gid://shopify/Customer/<numeric>. */
  shopifyCustomerGid: string | null;
  /** When sign-in first bound this row to a Shopify identity. */
  shopifyLinkedAt: string | null;
  /** 1 anonymous, 2 email-identified, 3 signed-in. */
  identityTier: 1 | 2 | 3;
}

function mapCustomer(r: Record<string, unknown>): Customer {
  return {
    id: Number(r.id),
    email: String(r.email),
    createdAt: (r.created_at as string | null) ?? null,
    firstSeenAt: (r.first_seen_at as string | null) ?? null,
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
    transactionalConsent: Boolean(r.transactional_consent),
    marketingStatus: (r.marketing_status as CustomerMarketingStatus) ?? "none",
    profileSummary: (r.profile_summary as string | null) ?? null,
    profileSummaryUpdatedAt: (r.profile_summary_updated_at as string | null) ?? null,
    purchaseSummary: (r.purchase_summary as OrderHistory | null) ?? null,
    purchaseSummaryUpdatedAt: (r.purchase_summary_updated_at as string | null) ?? null,
    bestandskundeEligible: Boolean(r.bestandskunde_eligible),
    bestandskundeEligibleUpdatedAt: (r.bestandskunde_eligible_updated_at as string | null) ?? null,
    shopifyAccountSummary: (r.shopify_account_summary as SignedInAccountSummary | null) ?? null,
    shopifyAccountSummaryUpdatedAt: (r.shopify_account_summary_updated_at as string | null) ?? null,
    postalAddress: (r.postal_address as Record<string, unknown> | null) ?? null,
    postalAddressSource: (r.postal_address_source as string | null) ?? null,
    adminInstructions: (r.admin_instructions as string | null) ?? null,
    adminInstructionsUpdatedAt: (r.admin_instructions_updated_at as string | null) ?? null,
    welcomeCode: (r.welcome_code as string | null) ?? null,
    welcomeCodeExpiresAt: (r.welcome_code_expires_at as string | null) ?? null,
    welcomeIssuedAt: (r.welcome_issued_at as string | null) ?? null,
    shopifyCustomerId: (r.shopify_customer_id as string | null) ?? null,
    shopifyCustomerGid: (r.shopify_customer_gid as string | null) ?? null,
    shopifyLinkedAt: (r.shopify_linked_at as string | null) ?? null,
    identityTier: (Number(r.identity_tier ?? 1) as 1 | 2 | 3) ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Identity bind — the consent-anchored bridge into Cluster A.
//
// Two entry points share this module:
//   * linkCustomerOnEmailCapture (tier 2) — /api/capture-email, keyed by the
//     consented email.
//   * bindShopifyIdentity (tier 3) — the Customer Account sign-in callback,
//     keyed by the verified Shopify customer id, merging by email.
// ---------------------------------------------------------------------------

export interface LinkCustomerInput {
  email: string;
  sessionId: string | null;
}

/**
 * Find-or-create the customer for an email capture, attach the current
 * conversation, bump last_seen_at, and mirror the aggregated consent state.
 * Returns the customer id, or null when skipped/failed. Best-effort: a failure
 * here must NEVER break the capture flow (the consent is already stored), so
 * this logs and returns null instead of throwing.
 *
 * Stamps identity_tier to at least 2 (email-identified) without ever
 * downgrading an existing tier-3 (signed-in) customer who re-captures an email.
 */
export async function linkCustomerOnEmailCapture(
  input: LinkCustomerInput,
  sql: Sql | null = getSql()
): Promise<number | null> {
  if (!sql) return null;
  const email = normalizeEmail(input.email);
  if (!email) return null;
  const sessionId = input.sessionId?.trim() || null;

  try {
    // Find-or-create keyed by email. An existing customer means a RETURNING
    // visit — bump last_seen_at; first_seen_at stays put. A new row is at least
    // tier 2; GREATEST never weakens an already signed-in (tier 3) customer.
    const rows = await sql`
      INSERT INTO customers (email, identity_tier)
      VALUES (${email}, 2)
      ON CONFLICT (email) DO UPDATE SET
        last_seen_at = now(),
        identity_tier = GREATEST(customers.identity_tier, 2)
      RETURNING id
    `;
    const customerId = rows[0]?.id != null ? Number(rows[0].id) : null;
    if (customerId == null) return null;

    // Mirror the aggregated consent state from the (just-upserted) capture.
    await syncCustomerConsent(email, sql);

    // Attach the consent record.
    await sql`
      UPDATE email_captures SET customer_id = ${customerId} WHERE email = ${email}
    `;

    // Attach the current conversation — the one explicit, consent-anchored
    // bridge into Cluster A. Latest capture wins: if a user corrects their
    // email mid-session, the conversation follows the newest identity.
    if (sessionId) {
      await sql`
        UPDATE conversations SET customer_id = ${customerId} WHERE session_id = ${sessionId}
      `;
      // Record the DIRECT session → customer link (migration 0019) so identity
      // resolution never depends on a conversation row existing.
      await linkSessionToCustomer(sql, sessionId, customerId);
    }
    return customerId;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "linkCustomerOnEmailCapture" });
    return null;
  }
}

/**
 * Re-mirror the aggregated consent state from email_captures onto the
 * customer row. Call after any consent transition (capture, DOI confirm,
 * unsubscribe). No-op when no customer/capture exists. Never throws.
 */
export async function syncCustomerConsent(
  email: string,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  const e = normalizeEmail(email);
  if (!e) return;
  try {
    await sql`
      UPDATE customers c
         SET transactional_consent = ec.transactional_consent,
             marketing_status = CASE
               WHEN ec.unsubscribed_at IS NOT NULL THEN 'unsubscribed'
               WHEN ec.marketing_doi_status IN ('pending', 'confirmed') THEN ec.marketing_doi_status
               ELSE 'none'
             END
        FROM email_captures ec
       WHERE ec.email = c.email
         AND c.email = ${e}
    `;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "syncCustomerConsent" });
  }
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export async function getCustomerById(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<Customer | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT * FROM customers WHERE id = ${customerId}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapCustomer(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "getCustomerById" });
    return null;
  }
}

export async function getCustomerByEmail(
  email: string,
  sql: Sql | null = getSql()
): Promise<Customer | null> {
  if (!sql) return null;
  const e = normalizeEmail(email);
  if (!e) return null;
  try {
    const rows = (await sql`
      SELECT * FROM customers WHERE email = ${e}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapCustomer(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "getCustomerByEmail" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tier-3 identity bind (Customer Account sign-in)
// ---------------------------------------------------------------------------

export interface BindShopifyIdentityInput {
  /** Numeric id extracted from the GraphQL customer.id GID — the tier-3 key. */
  shopifyCustomerId: string;
  /** Canonical gid://shopify/Customer/<numeric>. */
  shopifyCustomerGid: string;
  /** Shopify's VERIFIED email (authoritative for identity). */
  email: string | null;
  /** Optional id_token subject, recorded on the token row for cross-check. */
  idTokenSub?: string | null;
  /** Widget thread to attach to this identity. */
  sessionId: string | null;
}

export interface BindShopifyIdentityResult {
  customerId: number;
  /** Whether a merge conflict was logged for admin review. */
  conflict: boolean;
}

/**
 * Bind a verified Shopify identity to a customer row on sign-in, running the
 * email↔Shopify merge rule (see lib/customer-merge.mjs / docs/CUSTOMER_ACCOUNT.md):
 *   (a) existing row by shopify_customer_id → use it;
 *   (b) else existing tier-2 row by verified email → stamp shopify ids, tier 3
 *       (carries consent/profile/history forward);
 *   (c) else create a tier-3 row;
 *   (d) collision / email mismatch → prefer Shopify's verified email as the
 *       authoritative identity but DO NOT silently fuse consent records — record
 *       a merge-conflict for admin review.
 *
 * Re-keying NEVER imports Shopify's marketing state into marketing_status —
 * sign-in establishes IDENTITY, not marketing consent. Returns null only when
 * no DB is configured or the write hard-fails. Throws nothing the caller can't
 * handle: it returns null on failure (the callback degrades gracefully).
 */
export async function bindShopifyIdentity(
  input: BindShopifyIdentityInput,
  sql: Sql | null = getSql()
): Promise<BindShopifyIdentityResult | null> {
  if (!sql) return null;
  const shopifyId = input.shopifyCustomerId.trim();
  if (!shopifyId) return null;
  const email = input.email ? normalizeEmail(input.email) : "";
  const sessionId = input.sessionId?.trim() || null;

  try {
    const byShopifyRows = (await sql`
      SELECT id, email FROM customers WHERE shopify_customer_id = ${shopifyId}
    `) as Array<Record<string, unknown>>;
    const rowByShopifyId = byShopifyRows[0]
      ? { id: Number(byShopifyRows[0].id), email: (byShopifyRows[0].email as string | null) ?? null }
      : null;

    let rowByEmail: { id: number; email: string | null } | null = null;
    if (email) {
      const byEmailRows = (await sql`
        SELECT id, email FROM customers WHERE email = ${email}
      `) as Array<Record<string, unknown>>;
      rowByEmail = byEmailRows[0]
        ? { id: Number(byEmailRows[0].id), email: (byEmailRows[0].email as string | null) ?? null }
        : null;
    }

    const decision = decideMerge({ rowByShopifyId, rowByEmail, shopifyEmail: email });

    let customerId: number;
    if (decision.action === "create") {
      // No existing row → create a fresh tier-3 customer. If we have no verified
      // email we still need a unique key; fall back to a synthetic placeholder
      // keyed by the Shopify id (kept normalised + unique).
      const insertEmail = email || `shopify:${shopifyId}`;
      const rows = (await sql`
        INSERT INTO customers
          (email, shopify_customer_id, shopify_customer_gid, shopify_linked_at, identity_tier)
        VALUES (${insertEmail}, ${shopifyId}, ${input.shopifyCustomerGid}, now(), 3)
        ON CONFLICT (email) DO UPDATE SET last_seen_at = now()
        RETURNING id
      `) as Array<Record<string, unknown>>;
      customerId = Number(rows[0].id);
    } else {
      // use | stamp — both target an existing row. Stamp the Shopify ids and
      // bump to tier 3 (never weakening). We do NOT overwrite the
      // consent-anchored email even on a mismatch (Shopify is authoritative for
      // identity, but the consent provenance stays put — the conflict is logged).
      //
      // MATCH-UP (email-only → signed-in): in the STAMP case the targeted row is
      // the existing tier-2 customer matched by the verified email. This UPDATE
      // touches ONLY identity columns — it NEVER writes marketing_status /
      // transactional_consent — so a PRIOR DOI consent under that email carries
      // forward intact (still 'confirmed' in email_captures + the mirrored
      // customers row): none invented, none silently revoked. Signing in
      // establishes identity, never marketing consent.
      customerId = decision.customerId as number;
      await sql`
        UPDATE customers SET
          shopify_customer_id  = ${shopifyId},
          shopify_customer_gid = ${input.shopifyCustomerGid},
          shopify_linked_at    = COALESCE(shopify_linked_at, now()),
          identity_tier        = GREATEST(identity_tier, 3),
          last_seen_at         = now()
        WHERE id = ${customerId}
      `;
    }

    // Attach the current conversation to this identity (the generalised
    // "identity bind" — same bridge linkCustomerOnEmailCapture uses).
    //
    // MATCH-UP (current-anonymous-session → signed-in): this attaches ONLY the
    // chat that led to sign-in — the session in the signed `state`/pending
    // record — by matching `session_id = THIS session`. It deliberately NEVER
    // scoops other anonymous threads retroactively: a different browser/session
    // id simply doesn't match, so its conversations stay pseudonymous.
    if (sessionId) {
      await sql`
        UPDATE conversations SET customer_id = ${customerId} WHERE session_id = ${sessionId}
      `;
      // THE re-hydration link. The conversation attach above only fires when a
      // chat row already exists for this session — which it often does NOT at
      // sign-in (the prompt=none silent check / "Anmelden" before any message).
      // Persisting the DIRECT session → customer link here (migration 0019) is
      // what lets /api/auth/me and /api/account/* resolve this session back to
      // the signed-in customer regardless of whether a conversation exists yet.
      await linkSessionToCustomer(sql, sessionId, customerId);
    }

    // Record the id_token subject on the token row later (saveCustomerTokens);
    // here we only persist identity. Conflicts are audit-logged.
    let conflict = false;
    if (decision.conflict) {
      conflict = true;
      await sql`
        INSERT INTO customer_merge_conflicts
          (shopify_customer_id, shopify_customer_gid, shopify_email,
           email_row_customer_id, email_row_email, shopify_row_customer_id,
           conflict_kind, resolved_customer_id, session_id)
        VALUES (${shopifyId}, ${input.shopifyCustomerGid}, ${email || null},
                ${decision.conflict.emailRowCustomerId}, ${decision.conflict.emailRowEmail},
                ${decision.conflict.shopifyRowCustomerId}, ${decision.conflict.kind},
                ${customerId}, ${sessionId})
      `;
    }

    return { customerId, conflict };
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "bindShopifyIdentity" });
    return null;
  }
}

/**
 * Resolve the signed-in customer for a widget session (the opaque session
 * reference → customer row). Returns the tier-3 identity for re-hydration, or
 * null when the session isn't linked to a signed-in customer. Fail-closed.
 */
export interface SignedInIdentity {
  customerId: number;
  shopifyCustomerId: string;
  /** Best available display name (displayName → first+last → null). */
  name: string | null;
  tier: 3;
}

export async function resolveSignedInCustomer(
  sessionId: string | null,
  sql: Sql | null = getSql()
): Promise<SignedInIdentity | null> {
  if (!sql) return null;
  const sid = sessionId?.trim();
  if (!sid) return null;
  try {
    // Resolve through the DIRECT session → customer link (migration 0019), with a
    // fallback to the legacy conversation stamp. Reads shopify_customer_id IS NOT
    // NULL only — anonymous/email-only sessions resolve to null (fail closed).
    const resolved = await resolveSignedInCustomerRow(sql, sid);
    if (!resolved) return null;
    // The name comes from Shopify (authoritative) at sign-in; we don't cache PII
    // names locally for tier 3 in CA-1, so this resolver returns the linkage and
    // tier. The callback supplies the live name to /api/auth/me via Shopify.
    return {
      customerId: resolved.customerId,
      shopifyCustomerId: resolved.shopifyCustomerId,
      name: null,
      tier: 3,
    };
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "resolveSignedInCustomer" });
    return null;
  }
}

/**
 * Number of linked conversations EXCLUDING the given session — the customer's
 * PRIOR consultations. The live conversation is linked at capture time, so it
 * must not count as "history" of its own. Returns 0 on any failure.
 */
export async function countPriorConversations(
  customerId: number,
  excludeSessionId: string | null,
  sql: Sql | null = getSql()
): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = await sql`
      SELECT count(*)::int AS n FROM conversations
       WHERE customer_id = ${customerId}
         AND (${excludeSessionId}::text IS NULL OR session_id <> ${excludeSessionId})
    `;
    return rows[0]?.n != null ? Number(rows[0].n) : 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "countPriorConversations" });
    return 0;
  }
}

/** One linked conversation of a customer, with its readable transcript. */
export interface CustomerSession {
  conversationId: number;
  sessionId: string;
  createdAt: string | null;
  lastActivityAt: string | null;
  personaLabel: string | null;
  messageCount: number;
  /** Readable user/assistant turns (tool bookkeeping rows dropped). */
  transcript: TranscriptMessage[];
}

export interface CustomerWithSessions extends Customer {
  sessions: CustomerSession[];
}

// Bound the dashboard load: customers per page, conversations per customer.
const CUSTOMER_LIST_LIMIT = 100;
const SESSIONS_PER_CUSTOMER = 25;

/**
 * Load a customer's linked conversations (oldest first — a timeline) with
 * their transcripts. Returns [] on any failure.
 */
export async function loadCustomerSessions(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<CustomerSession[]> {
  if (!sql) return [];
  try {
    const convRows = (await sql`
      SELECT id, session_id, created_at, last_activity_at, persona_label, message_count
        FROM conversations
       WHERE customer_id = ${customerId}
       ORDER BY created_at ASC, id ASC
       LIMIT ${SESSIONS_PER_CUSTOMER}
    `) as Array<Record<string, unknown>>;
    if (convRows.length === 0) return [];

    const ids = convRows.map((r) => Number(r.id));
    const msgRows = (await sql`
      SELECT conversation_id, role, content, tool_name
        FROM messages
       WHERE conversation_id = ANY(${ids})
       ORDER BY created_at ASC, id ASC
    `) as Array<Record<string, unknown>>;

    const byConversation = new Map<number, TranscriptMessage[]>();
    for (const m of msgRows) {
      const cid = Number(m.conversation_id);
      const role = m.role as TranscriptMessage["role"];
      const content = typeof m.content === "string" ? m.content : "";
      const toolName = (m.tool_name as string | null) ?? null;
      // Keep only the readable conversation turns.
      if (toolName !== null || (role !== "user" && role !== "assistant") || !content.trim()) {
        continue;
      }
      const list = byConversation.get(cid) ?? [];
      list.push({ role, content, toolName: null });
      byConversation.set(cid, list);
    }

    return convRows.map((r) => ({
      conversationId: Number(r.id),
      sessionId: String(r.session_id),
      createdAt: (r.created_at as string | null) ?? null,
      lastActivityAt: (r.last_activity_at as string | null) ?? null,
      personaLabel: (r.persona_label as string | null) ?? null,
      messageCount: r.message_count != null ? Number(r.message_count) : 0,
      transcript: byConversation.get(Number(r.id)) ?? [],
    }));
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "loadCustomerSessions" });
    return [];
  }
}

/**
 * Customers for the admin dashboard (most recently seen first), each with
 * their session timeline. Returns [] when no DB is configured.
 */
export async function listCustomersWithSessions(
  sql: Sql | null = getSql()
): Promise<CustomerWithSessions[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT * FROM customers
       ORDER BY last_seen_at DESC, id DESC
       LIMIT ${CUSTOMER_LIST_LIMIT}
    `) as Array<Record<string, unknown>>;
    return Promise.all(
      rows.map(async (r) => {
        const customer = mapCustomer(r);
        const sessions = await loadCustomerSessions(customer.id, sql);
        return { ...customer, sessions };
      })
    );
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "listCustomersWithSessions" });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cached summaries (written by the admin routes)
// ---------------------------------------------------------------------------

export async function saveCustomerPurchaseSummary(
  customerId: number,
  history: OrderHistory,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    // Recompute the §7(3) Bestandskunden eligibility in the SAME write, so the
    // cached flag can never drift from the purchase history it is derived from.
    // SEPARATE basis from marketing_status (DOI) — this only reflects "is there
    // a completed purchase", nothing about consent. See lib/bestandskunden.mjs.
    const eligible = isBestandskundeEligible(history);
    const rows = await sql`
      UPDATE customers
         SET purchase_summary = ${JSON.stringify(history)}::jsonb,
             purchase_summary_updated_at = now(),
             bestandskunde_eligible = ${eligible},
             bestandskunde_eligible_updated_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "saveCustomerPurchaseSummary" });
    return false;
  }
}

/**
 * Cache the signed-in (tier-3) Customer Account snapshot — name + the
 * data-minimised address context (migration 0015). Best-effort; returns false
 * when the customer doesn't exist or the write failed. Never throws.
 */
export async function saveCustomerAccountSummary(
  customerId: number,
  summary: SignedInAccountSummary,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE customers
         SET shopify_account_summary = ${JSON.stringify(summary)}::jsonb,
             shopify_account_summary_updated_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "saveCustomerAccountSummary" });
    return false;
  }
}

/**
 * Persist the LAWFUL full postal address (migration 0022) — the ONLY basis for
 * physical mail. SEPARATE from the minimised account summary: written by the
 * address-acquisition flow (a completed order's shipping address, or the saved
 * profile address) with the lawful basis recorded in postal_address_source. The
 * caller passes a COMPLETE, normalised address (lib/postal-address) — we never
 * part-fill here. Best-effort; returns false when the customer doesn't exist or
 * the write failed. Never throws.
 */
export async function saveCustomerPostalAddress(
  customerId: number,
  address: Record<string, unknown>,
  source: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE customers
         SET postal_address = ${JSON.stringify(address)}::jsonb,
             postal_address_source = ${source},
             postal_address_updated_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "saveCustomerPostalAddress" });
    return false;
  }
}

/**
 * Persist the admin's free-text special instructions for the next generated
 * marketing email. NULL clears them. Returns false when the customer doesn't
 * exist or the write failed. Never throws.
 */
export async function saveCustomerAdminInstructions(
  customerId: number,
  instructions: string | null,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE customers
         SET admin_instructions = ${instructions},
             admin_instructions_updated_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "saveCustomerAdminInstructions" });
    return false;
  }
}

/** Per-conversation product sets of a customer, NEWEST conversation first. */
export interface CustomerProductSelection {
  selectedProductIds: string[];
  recommendedProductIds: string[];
}

/**
 * The product sets of every linked conversation, newest first — the raw input
 * for the per-customer email's product chooser (see chooseCustomerProductIds
 * in lib/cart). Returns [] on any failure.
 */
export async function loadCustomerProductSelections(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<CustomerProductSelection[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT selected_product_ids, recommended_product_ids
        FROM conversations
       WHERE customer_id = ${customerId}
       ORDER BY created_at DESC, id DESC
       LIMIT ${SESSIONS_PER_CUSTOMER}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      selectedProductIds: Array.isArray(r.selected_product_ids)
        ? (r.selected_product_ids as string[])
        : [],
      recommendedProductIds: Array.isArray(r.recommended_product_ids)
        ? (r.recommended_product_ids as string[])
        : [],
    }));
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "loadCustomerProductSelections" });
    return [];
  }
}

export async function saveCustomerProfileSummary(
  customerId: number,
  summary: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE customers
         SET profile_summary = ${summary},
             profile_summary_updated_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "saveCustomerProfileSummary" });
    return false;
  }
}
