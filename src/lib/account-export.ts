// Structured data export for a signed-in (tier-3) customer — the machine-
// readable Art. 15 (access) / Art. 20 (portability) companion to the PDF summary
// (LEGAL_READINESS_REPORT §8 OQ-11). Gathers EVERYTHING this system holds about
// one customer into a single JSON document.
//
// Scoped strictly to the resolved customer id / their email (the route gates on
// requireSignedInCustomer, so the caller can only ever export THEIR OWN data).
// Each section is best-effort but the whole returns null on a hard failure so
// the route can 503 honestly rather than hand back a partial export that looks
// complete.

import { getSql, type Sql } from "./db";
import { getCustomerById } from "./customer-store";
import { reportError } from "./observability";

const MAX_CONVERSATIONS = 500;
const MAX_MESSAGES_PER_CONVERSATION = 1000;
const MAX_ROWS = 1000;

export interface CustomerDataExport {
  exportedAt: string;
  note: string;
  customer: Record<string, unknown> | null;
  consentRecords: Array<Record<string, unknown>>;
  conversations: Array<Record<string, unknown>>;
  correspondence: Array<Record<string, unknown>>;
  physicalLetters: Array<Record<string, unknown>>;
  marketingSends: Array<Record<string, unknown>>;
  bundleOffers: Array<Record<string, unknown>>;
  feedback: Array<Record<string, unknown>>;
  suppression: { marketing: Array<Record<string, unknown>> };
}

/**
 * Build the full data export for one customer. Returns null when no DB is
 * configured, the customer no longer exists, or a query hard-fails.
 */
export async function buildCustomerDataExport(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<CustomerDataExport | null> {
  if (!sql) return null;
  try {
    const customer = await getCustomerById(customerId, sql);
    if (!customer) return null;
    const email = customer.email;

    // Consent records (Cluster B — the audit-grade trail), by email.
    const consentRecords = (await sql`
      SELECT email, transactional_consent, marketing_consent, marketing_doi_status,
             consent_copy_version, consent_text_shown, doi_sent_at, doi_confirmed_at,
             unsubscribed_at, created_at
        FROM email_captures WHERE email = ${email} LIMIT ${MAX_ROWS}
    `) as Array<Record<string, unknown>>;

    // Conversations + their readable transcripts, by customer_id.
    const convRows = (await sql`
      SELECT id, conversation_key, title, title_auto, persona_label, status,
             created_at, updated_at, last_activity_at
        FROM conversations
       WHERE customer_id = ${customerId}
       ORDER BY last_activity_at DESC, id DESC
       LIMIT ${MAX_CONVERSATIONS}
    `) as Array<Record<string, unknown>>;
    const conversations: Array<Record<string, unknown>> = [];
    for (const c of convRows) {
      const msgs = (await sql`
        SELECT role, content, tool_name, created_at
          FROM messages
         WHERE conversation_id = ${Number(c.id)}
           AND role IN ('user', 'assistant')
           AND tool_name IS NULL
           AND length(btrim(content)) > 0
         ORDER BY created_at ASC, id ASC
         LIMIT ${MAX_MESSAGES_PER_CONVERSATION}
      `) as Array<Record<string, unknown>>;
      conversations.push({ ...c, messages: msgs });
    }

    // Correspondence (both directions), by customer_id — include the bodies (it
    // is the subject's own correspondence).
    const correspondence = (await sql`
      SELECT direction, from_address, to_address, subject, snippet, body_text, body_html,
             occurred_at, created_at
        FROM email_messages WHERE customer_id = ${customerId}
       ORDER BY occurred_at DESC LIMIT ${MAX_ROWS}
    `) as Array<Record<string, unknown>>;

    const physicalLetters = (await sql`
      SELECT status, recipient_name, recipient_company, recipient_address_line1,
             recipient_address_line2, recipient_postal_code, recipient_city,
             recipient_country, subject, body, cost_cents, created_at, submitted_at
        FROM physical_letters WHERE customer_id = ${customerId}
       ORDER BY created_at DESC LIMIT ${MAX_ROWS}
    `) as Array<Record<string, unknown>>;

    const marketingSends = (await sql`
      SELECT subject, drafted_text, discount_code, discount_percent, status, sent_at, created_at
        FROM marketing_sends WHERE customer_id = ${customerId}
       ORDER BY created_at DESC LIMIT ${MAX_ROWS}
    `) as Array<Record<string, unknown>>;

    const bundleOffers = (await sql`
      SELECT title, bundle_price, currency, status, created_at, expires_at
        FROM bundle_offers WHERE customer_id = ${customerId}
       ORDER BY created_at DESC LIMIT ${MAX_ROWS}
    `) as Array<Record<string, unknown>>;

    const feedback = (await sql`
      SELECT message, page, tier, created_at
        FROM feedback WHERE email = ${email}
       ORDER BY created_at DESC LIMIT ${MAX_ROWS}
    `) as Array<Record<string, unknown>>;

    const suppMarketing = (await sql`
      SELECT email, reason, added_at FROM suppression_list WHERE email = ${email}
    `) as Array<Record<string, unknown>>;

    return {
      exportedAt: new Date().toISOString(),
      note:
        "Vollständiger Export der bei motion sports zu diesem Konto gespeicherten Daten (Art. 15/20 DSGVO).",
      customer: customer as unknown as Record<string, unknown>,
      consentRecords,
      conversations,
      correspondence,
      physicalLetters,
      marketingSends,
      bundleOffers,
      feedback,
      suppression: { marketing: suppMarketing },
    };
  } catch (err) {
    reportError(err, { route: "lib/account-export", phase: "buildCustomerDataExport" });
    return null;
  }
}
