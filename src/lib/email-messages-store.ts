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
  /**
   * REPLY threading (the in-admin client, §5). A fresh outbound mail omits these
   * and starts its own thread (thread_id = its own Message-ID); a reply passes
   * the parent's Message-ID (inReplyTo), the extended References chain, and the
   * parent's thread_id so the sent row joins the conversation it answers.
   */
  inReplyTo?: string | null;
  references?: string[];
  threadId?: string | null;
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
    // A reply carries the parent's thread + In-Reply-To/References; a fresh mail
    // starts its own thread (thread_id = its own Message-ID, no In-Reply-To).
    const inReplyTo = input.inReplyTo ?? null;
    const references = input.references ?? [];
    const threadId = input.threadId ?? input.messageId;
    await sql`
      INSERT INTO email_messages
        (customer_id, direction, channel, message_id, in_reply_to, references_ids,
         thread_id, from_address, to_address, subject, body_text, body_html,
         snippet, attachments, provider, provider_email_id, marketing_send_id,
         occurred_at)
      VALUES
        (${customerId}, 'sent', 'email', ${input.messageId}, ${inReplyTo},
         ${references}::text[], ${threadId}, ${input.fromAddress}, ${input.toAddress},
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

// ---------------------------------------------------------------------------
// ADMIN CLIENT READ/WRITE — the per-customer "Korrespondenz" panel, the lazy
// body expand, and the global "Unmatched inbound" queue (§5). These are THIN
// presentation queries over the same log; they never touch a consent gate and
// never change a send guarantee.
// ---------------------------------------------------------------------------

/** One row for the per-customer thread list — METADATA + snippet only, NO body.
 * The full body/attachments are fetched lazily (getMessageById) on expand. */
export interface CorrespondenceMessage {
  id: number;
  direction: "sent" | "received";
  messageId: string | null;
  threadId: string | null;
  subject: string | null;
  fromAddress: string;
  toAddress: string;
  snippet: string | null;
  attachmentCount: number;
  hasBody: boolean;
  providerEmailId: string | null;
  marketingSendId: number | null;
  occurredAt: string | null;
}

function mapListRow(r: Record<string, unknown>): CorrespondenceMessage {
  const attachments = Array.isArray(r.attachments) ? (r.attachments as unknown[]) : [];
  return {
    id: Number(r.id),
    direction: r.direction === "received" ? "received" : "sent",
    messageId: (r.message_id as string | null) ?? null,
    threadId: (r.thread_id as string | null) ?? null,
    subject: (r.subject as string | null) ?? null,
    fromAddress: (r.from_address as string | null) ?? "",
    toAddress: (r.to_address as string | null) ?? "",
    snippet: (r.snippet as string | null) ?? null,
    attachmentCount: attachments.length,
    hasBody: Boolean(r.has_body),
    providerEmailId: (r.provider_email_id as string | null) ?? null,
    marketingSendId: r.marketing_send_id == null ? null : Number(r.marketing_send_id),
    occurredAt: (r.occurred_at as string | null) ?? null,
  };
}

/**
 * List ONE customer's email messages for the Korrespondenz panel — sent +
 * received interleaved, oldest-first (the panel groups by thread client-side).
 * A CHEAP query: no provider round-trip, and the (potentially large) body
 * columns are deliberately NOT selected — only a `has_body` flag so the panel
 * knows whether an expand will have something to show.
 */
export async function listCustomerMessages(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<CorrespondenceMessage[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, direction, message_id, thread_id, subject, from_address,
             to_address, snippet, attachments, provider_email_id, marketing_send_id,
             occurred_at,
             (body_text IS NOT NULL OR body_html IS NOT NULL) AS has_body
        FROM email_messages
       WHERE customer_id = ${customerId}
       ORDER BY occurred_at ASC, id ASC
    `) as Array<Record<string, unknown>>;
    return rows.map(mapListRow);
  } catch (err) {
    reportError(err, { route: "lib/email-messages-store", phase: "listCustomerMessages" });
    return [];
  }
}

/** The full, lazily-fetched body of one message (the expand). */
export interface MessageBody {
  id: number;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: AttachmentMeta[];
  providerEmailId: string | null;
}

/** Read ONE message's stored body + attachments (no provider round-trip). The
 * route does the provider fallback via provider_email_id when both bodies are
 * absent. Returns null when the row doesn't exist (or no DB). */
export async function getMessageById(
  id: number,
  sql: Sql | null = getSql()
): Promise<MessageBody | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT id, body_text, body_html, attachments, provider_email_id
        FROM email_messages
       WHERE id = ${id}
    `) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      bodyText: (r.body_text as string | null) ?? null,
      bodyHtml: (r.body_html as string | null) ?? null,
      attachments: Array.isArray(r.attachments) ? (r.attachments as AttachmentMeta[]) : [],
      providerEmailId: (r.provider_email_id as string | null) ?? null,
    };
  } catch (err) {
    reportError(err, { route: "lib/email-messages-store", phase: "getMessageById" });
    return null;
  }
}

/** Persist a body/attachments fetched on demand from the provider, so the next
 * expand is a cheap DB read. Best-effort: a failure just means we refetch. */
export async function saveFetchedBody(
  id: number,
  bodyText: string | null,
  bodyHtml: string | null,
  attachments: AttachmentMeta[],
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE email_messages
         SET body_text = ${bodyText},
             body_html = ${bodyHtml},
             attachments = ${JSON.stringify(attachments ?? [])}::jsonb,
             snippet = COALESCE(snippet, ${buildSnippet(bodyText, bodyHtml)})
       WHERE id = ${id}
    `;
  } catch (err) {
    reportError(err, { route: "lib/email-messages-store", phase: "saveFetchedBody" });
  }
}

/** The threading + envelope fields of one message, for building a REPLY to it. */
export interface MessageHeaders {
  id: number;
  customerId: number | null;
  messageId: string | null;
  references: string[];
  threadId: string | null;
  subject: string | null;
  fromAddress: string;
}

/** Read the threading fields of one message so a reply can set its
 * In-Reply-To/References and stay in the same thread. Null when absent. */
export async function getMessageHeaders(
  id: number,
  sql: Sql | null = getSql()
): Promise<MessageHeaders | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT id, customer_id, message_id, references_ids, thread_id, subject,
             from_address
        FROM email_messages
       WHERE id = ${id}
    `) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      customerId: r.customer_id == null ? null : Number(r.customer_id),
      messageId: (r.message_id as string | null) ?? null,
      references: Array.isArray(r.references_ids) ? (r.references_ids as string[]) : [],
      threadId: (r.thread_id as string | null) ?? null,
      subject: (r.subject as string | null) ?? null,
      fromAddress: (r.from_address as string | null) ?? "",
    };
  } catch (err) {
    reportError(err, { route: "lib/email-messages-store", phase: "getMessageHeaders" });
    return null;
  }
}

/** One unmatched inbound row for the global triage queue (customer_id IS NULL). */
export interface UnmatchedInboundMessage {
  id: number;
  messageId: string | null;
  subject: string | null;
  fromAddress: string;
  toAddress: string;
  snippet: string | null;
  attachmentCount: number;
  occurredAt: string | null;
}

/**
 * The ONLY global view (§5): received messages from an unknown address
 * (customer_id IS NULL), newest first, so an admin can triage and assign them.
 * Minimal by design — no body, no provider round-trip.
 */
export async function listUnmatchedInbound(
  sql: Sql | null = getSql()
): Promise<UnmatchedInboundMessage[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, message_id, subject, from_address, to_address, snippet,
             attachments, occurred_at
        FROM email_messages
       WHERE customer_id IS NULL
         AND direction = 'received'
       ORDER BY occurred_at DESC, id DESC
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const attachments = Array.isArray(r.attachments) ? (r.attachments as unknown[]) : [];
      return {
        id: Number(r.id),
        messageId: (r.message_id as string | null) ?? null,
        subject: (r.subject as string | null) ?? null,
        fromAddress: (r.from_address as string | null) ?? "",
        toAddress: (r.to_address as string | null) ?? "",
        snippet: (r.snippet as string | null) ?? null,
        attachmentCount: attachments.length,
        occurredAt: (r.occurred_at as string | null) ?? null,
      };
    });
  } catch (err) {
    reportError(err, { route: "lib/email-messages-store", phase: "listUnmatchedInbound" });
    return [];
  }
}

export type AssignInboundResult =
  | { ok: true; threadId: string | null }
  | { ok: false; reason: "not_found" | "not_unmatched" | "no_db" | "error" };

/**
 * Assign an unmatched inbound message to a customer (the queue's action): set
 * customer_id, then RE-THREAD it. If this reply references a message we already
 * hold (by In-Reply-To / References → an existing message_id), it adopts that
 * conversation's thread_id so it lands in the right thread on the customer's
 * panel; otherwise its existing (header-derived) thread_id stands. Only updates
 * a row that is still unmatched (customer_id IS NULL) so a double-click can't
 * re-home an already-assigned message.
 */
export async function assignInboundToCustomer(
  messageId: number,
  customerId: number,
  sql: Sql | null = getSql()
): Promise<AssignInboundResult> {
  if (!sql) return { ok: false, reason: "no_db" };
  try {
    const rows = (await sql`
      SELECT id, in_reply_to, references_ids, thread_id, customer_id
        FROM email_messages
       WHERE id = ${messageId}
    `) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return { ok: false, reason: "not_found" };
    if (row.customer_id != null) return { ok: false, reason: "not_unmatched" };

    // Candidate parent ids this reply points at: In-Reply-To first, then the
    // References chain. We adopt the thread of the first one we actually hold.
    const refs = Array.isArray(row.references_ids) ? (row.references_ids as string[]) : [];
    const inReplyTo = (row.in_reply_to as string | null) ?? null;
    const candidates = [inReplyTo, ...refs].filter((x): x is string => Boolean(x));

    let threadId = (row.thread_id as string | null) ?? null;
    if (candidates.length > 0) {
      // Match an existing message by Message-ID (brackets vary across sent/
      // received rows, so compare on the bracket-stripped form).
      const stripped = candidates.map((c) => c.replace(/^</, "").replace(/>$/, ""));
      const parents = (await sql`
        SELECT thread_id
          FROM email_messages
         WHERE customer_id = ${customerId}
           AND trim(both '<>' from message_id) = ANY(${stripped}::text[])
           AND thread_id IS NOT NULL
         ORDER BY occurred_at ASC
         LIMIT 1
      `) as Array<{ thread_id: string | null }>;
      if (parents[0]?.thread_id) threadId = parents[0].thread_id;
    }

    await sql`
      UPDATE email_messages
         SET customer_id = ${customerId},
             thread_id = ${threadId}
       WHERE id = ${messageId}
         AND customer_id IS NULL
    `;
    return { ok: true, threadId };
  } catch (err) {
    reportError(err, { route: "lib/email-messages-store", phase: "assignInboundToCustomer" });
    return { ok: false, reason: "error" };
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
