// Data access for `email_messages` — the UNIFIED mail log (migration 0021).
//
// This is its OWN data category: Korrespondenz (contract / legitimate interest),
// NOT marketing consent. It deliberately does NOT touch — and is never read by —
// canSendMarketing / loadEligibleCapture / the §7(3) audience. Writing here
// never gates a send and never blocks one: every write is best-effort and
// fail-soft (a logged failure, never a throw that breaks the mail path).
//
//   - insertReceivedMessage()  the inbound webhook, dedup'd on Message-ID
//   - recordSentMessage()      the mirror-write at each send site (additive)

import { getSql, type Sql } from "./db";
import { getCustomerByEmail } from "./customer-store";
import { interpretReceivedInsert } from "./email-inbound-core.mjs";
import {
  renderCorrespondence,
  MAX_CORRESPONDENCE_IN_PROMPT,
} from "./correspondence-core.mjs";
import { reportError } from "./observability";

export interface AttachmentMeta {
  id: string | null;
  filename: string | null;
  content_type: string | null;
  size: number | null;
  content_id: string | null;
  content_disposition: string | null;
}

/** A normalised inbound message (from email-inbound-core.normalizeInboundMessage). */
export interface InboundMessageInput {
  customerId: number | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  threadId: string | null;
  fromAddress: string;
  toAddress: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  attachments: AttachmentMeta[];
  providerEmailId: string | null;
  occurredAt: string | null;
}

export type InsertReceivedResult =
  | { inserted: true; id: number }
  | { inserted: false; reason: "duplicate" | "no_db" | "error" };

/**
 * INSERT a direction='received' row. Dedup is enforced by the UNIQUE partial
 * index on message_id: a webhook re-delivery carrying the same Message-ID hits
 * ON CONFLICT DO NOTHING, RETURNING zero rows → we report `duplicate` instead of
 * writing a second copy. Messages without a Message-ID (rare) can't be deduped
 * by header and are always inserted.
 */
export async function insertReceivedMessage(
  input: InboundMessageInput,
  sql: Sql | null = getSql()
): Promise<InsertReceivedResult> {
  if (!sql) return { inserted: false, reason: "no_db" };
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  try {
    const rows = (await sql`
      INSERT INTO email_messages
        (customer_id, direction, channel, message_id, in_reply_to, references_ids,
         thread_id, from_address, to_address, subject, body_text, body_html,
         snippet, attachments, provider, provider_email_id, marketing_send_id,
         occurred_at)
      VALUES
        (${input.customerId}, 'received', 'email', ${input.messageId},
         ${input.inReplyTo}, ${input.references}::text[], ${input.threadId},
         ${input.fromAddress}, ${input.toAddress}, ${input.subject},
         ${input.bodyText}, ${input.bodyHtml}, ${input.snippet},
         ${JSON.stringify(input.attachments ?? [])}::jsonb, 'resend',
         ${input.providerEmailId}, NULL, ${occurredAt})
      ON CONFLICT (message_id) WHERE message_id IS NOT NULL
        DO NOTHING
      RETURNING id
    `) as Array<{ id: number }>;
    // Zero rows back (with a message_id present) ⇒ the unique index rejected a
    // re-delivery. Shared interpretation so the dedup decision is unit-tested.
    const outcome = interpretReceivedInsert(rows) as
      | { inserted: true; id: number }
      | { inserted: false; reason: "duplicate" };
    return outcome.inserted
      ? { inserted: true, id: outcome.id }
      : { inserted: false, reason: "duplicate" };
  } catch (err) {
    reportError(err, { route: "lib/email-messages-store", phase: "insertReceivedMessage" });
    return { inserted: false, reason: "error" };
  }
}

export interface SentMessageInput {
  /** The recipient (a customer or a one-off transactional address). */
  toAddress: string;
  /** Our verified sender. */
  fromAddress: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  /** The Message-ID we set on the wire (from outboundThreading) — also threads. */
  messageId: string;
  /** Known customer id (per-customer marketing draft). Else looked up by email. */
  customerId?: number | null;
  /** Workflow link when this 'sent' mail was a campaign send. */
  marketingSendId?: number | null;
  /** ISO send time; defaults to now. */
  occurredAt?: string | null;
}

/**
 * MIRROR-WRITE: record a direction='sent' row right after a send returns ok.
 * ADDITIVE — it changes no existing behaviour and must never break the send, so
 * it swallows every error (the mail already went out). A fresh outbound mail
 * starts its own thread (thread_id = its own Message-ID). When `customerId`
 * isn't supplied we best-effort resolve it from the recipient address (so
 * transactional/DOI mail still attributes to a known customer when one exists);
 * an unmatched recipient stays NULL.
 */
export async function recordSentMessage(
  input: SentMessageInput,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    let customerId = input.customerId ?? null;
    if (customerId == null && input.toAddress) {
      const customer = await getCustomerByEmail(input.toAddress, sql);
      customerId = customer?.id ?? null;
    }
    const snippet = buildSnippet(input.bodyText, input.bodyHtml);
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    await sql`
      INSERT INTO email_messages
        (customer_id, direction, channel, message_id, in_reply_to, references_ids,
         thread_id, from_address, to_address, subject, body_text, body_html,
         snippet, attachments, provider, provider_email_id, marketing_send_id,
         occurred_at)
      VALUES
        (${customerId}, 'sent', 'email', ${input.messageId}, NULL, '{}'::text[],
         ${input.messageId}, ${input.fromAddress}, ${input.toAddress},
         ${input.subject}, ${input.bodyText}, ${input.bodyHtml}, ${snippet},
         '[]'::jsonb, 'resend', NULL, ${input.marketingSendId ?? null},
         ${occurredAt})
      ON CONFLICT (message_id) WHERE message_id IS NOT NULL
        DO NOTHING
    `;
  } catch (err) {
    reportError(err, { route: "lib/email-messages-store", phase: "recordSentMessage" });
  }
}

// ---------------------------------------------------------------------------
// KB READ — fold correspondence into the per-customer knowledge base (§3).
// ---------------------------------------------------------------------------

// DATA-MINIMISATION recency cap (§3 mitigation ii): never feed the KB passes mail
// older than this. Retention already purges email_messages past
// CORRESPONDENCE_RETENTION_DAYS (default 365); this is the SECOND, independent
// bound so the KB never sees stale correspondence even if retention is tuned up.
const MAX_CORRESPONDENCE_MONTHS = 12;

/**
 * Load a customer's email correspondence rendered as ONE readable block for the
 * KB passes (generateCustomerProfile / generateCustomerMarketingDraft), oldest-
 * first, both directions — see docs/EMAIL_SUBSYSTEM_SPIKE.md §3. Returns "" when
 * there is nothing (or no DB) so the caller can show a placeholder.
 *
 * DATA-MINIMISATION (required):
 *  - body TEXT ONLY — the query selects body_text only, NEVER from/to/subject/
 *    message-id or any other header/address line.
 *  - recency-capped — only the most recent MAX_CORRESPONDENCE_IN_PROMPT messages
 *    AND only within the last MAX_CORRESPONDENCE_MONTHS.
 * This is its own data category (Korrespondenz); it never touches the consent /
 * eligibility gates, and it only runs inside the SAME explicit, admin-triggered
 * regeneration the profile/draft passes already are.
 */
export async function loadCustomerCorrespondence(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<string> {
  if (!sql) return "";
  const recencyCutoff = new Date(
    Date.now() - MAX_CORRESPONDENCE_MONTHS * 30 * 86_400_000
  ).toISOString();
  try {
    // body_text + direction + occurred_at ONLY — no headers/addresses reach the
    // model. Most recent first so the LIMIT keeps the freshest window; reversed
    // to oldest-first below for the readable thread.
    const rows = (await sql`
      SELECT direction, occurred_at, body_text
        FROM email_messages
       WHERE customer_id = ${customerId}
         AND occurred_at >= ${recencyCutoff}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ${MAX_CORRESPONDENCE_IN_PROMPT}
    `) as Array<Record<string, unknown>>;
    if (rows.length === 0) return "";
    const messages = rows
      .map((r) => ({
        direction: r.direction === "received" ? "received" : "sent",
        occurredAt: (r.occurred_at as string | null) ?? null,
        bodyText: (r.body_text as string | null) ?? null,
      }))
      .reverse(); // DB gives newest-first; the thread reads oldest-first.
    return renderCorrespondence(messages);
  } catch (err) {
    reportError(err, { route: "lib/email-messages-store", phase: "loadCustomerCorrespondence" });
    return "";
  }
}

/** First ~200 chars of the body for list rendering (text preferred over HTML). */
function buildSnippet(bodyText: string | null, bodyHtml: string | null): string {
  const source =
    (bodyText && bodyText.trim()) ||
    (bodyHtml ? bodyHtml.replace(/<[^>]+>/g, " ") : "") ||
    "";
  const collapsed = source.replace(/\s+/g, " ").trim();
  return collapsed.length > 200 ? collapsed.slice(0, 200) : collapsed;
}
