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
import { reportError } from "./observability";

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
  purchaseSummary: Record<string, unknown> | null;
  purchaseSummaryUpdatedAt: string | null;
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
    purchaseSummary: (r.purchase_summary as Record<string, unknown> | null) ?? null,
    purchaseSummaryUpdatedAt: (r.purchase_summary_updated_at as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Linking — called from /api/capture-email after the consent upsert.
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
    // visit — bump last_seen_at; first_seen_at stays put.
    const rows = await sql`
      INSERT INTO customers (email)
      VALUES (${email})
      ON CONFLICT (email) DO UPDATE SET last_seen_at = now()
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
  history: Record<string, unknown>,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE customers
         SET purchase_summary = ${JSON.stringify(history)}::jsonb,
             purchase_summary_updated_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/customer-store", phase: "saveCustomerPurchaseSummary" });
    return false;
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
