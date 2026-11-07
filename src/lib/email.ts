// Centralised transactional/marketing email sending via Resend.
//
// Every send here is DEFENSIVE: a failure is always logged via reportError and
// surfaced to the caller through the returned result — never silently lost. The
// caller decides how to react (e.g. a 502 to the widget, or a logged-but-
// tolerated DOI failure). When Resend isn't configured we DO NOT pretend the
// mail was sent: we return `{ ok: false, skipped: true }` so the caller can
// fall back to a local-dev log and respond honestly.
//
// The sender is the client's verified Resend sender (CONTACT_FROM_EMAIL),
// reused from the contact form so the whole backend speaks with one voice. The
// env value only supplies the ADDRESS; the display name „Mo von motion
// sports“ comes from the code (email-sender.mjs; EMAIL_SENDER_NAME overrides).
// A marketing send may carry another From (`from`): a sender identity the
// operator chose for the campaign (sender-identities.mjs — resolved and
// domain-checked by the caller with resolveSender, migration 0081).
//
// Bulk mail (Rundmail, mailing-send.ts) goes through sendEmailBatch: Resend's
// batch endpoint, up to 100 separate messages per request (one recipient each
// — never several addresses in one message), with an idempotency key so a
// retry after a timeout can never deliver a batch twice.

import { Resend } from "resend";
import { reportError } from "./observability";
import { formatSender } from "./email-sender.mjs";
import { classifyResendError, type ResendErrorClass } from "./mailing-core.mjs";

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  /**
   * Our own RFC-5322 Message-ID (e.g. "<hex@motionsports.de>"). Set on the wire
   * as a custom header so the reply that comes back carries it in
   * In-Reply-To/References and threads onto the originating row. Additive —
   * callers that don't thread (e.g. the contact form) simply omit it.
   */
  messageId?: string;
  /**
   * RFC-5322 reply headers, set on the wire so a reply we SEND threads in the
   * customer's mail client AND the reply that comes back carries the chain.
   * Additive — non-reply callers omit them. Ids should be angle-bracketed.
   */
  inReplyTo?: string;
  references?: string[];
  /**
   * RFC-8058/2369 unsubscribe URL, set on the wire as a `List-Unsubscribe`
   * header so mail clients can surface their native unsubscribe affordance,
   * plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click` — the one-click
   * unsubscribe Gmail and Yahoo require from bulk senders: the mail client
   * POSTs to the same signed /api/unsubscribe link (route.ts POST). Only
   * marketing-type sends pass it.
   */
  listUnsubscribeUrl?: string;
  /**
   * The From header for this mail (a sender identity the caller resolved and
   * domain-checked with sender-identities.mjs resolveSender). Omitted → the
   * default sender (senderAddress()).
   */
  from?: string;
  /**
   * Bulk mail (Rundmail): adds `Precedence: bulk` and
   * `X-Auto-Response-Suppress: OOF, AutoReply`, so out-of-office robots do
   * not answer thousands of identical mails into the reply mailbox.
   */
  bulk?: boolean;
  /** Resend tags (ASCII letters, digits, _ and - only) — filterable in Resend. */
  tags?: Array<{ name: string; value: string }>;
  /** Tag used in error logs to identify which mail failed. */
  kind: string;
}

export type SendEmailResult =
  | { ok: true; id?: string }
  | { ok: false; skipped: true } // Resend not configured (local-dev)
  | { ok: false; skipped: false; error: unknown };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && senderAddress());
}

/**
 * The From header: „Mo von motion sports <address>“ — the address from
 * CONTACT_FROM_EMAIL (a verified Resend sender; a display name in it is
 * ignored), the name from the code or EMAIL_SENDER_NAME. undefined when no
 * address is configured.
 */
export function senderAddress(): string | undefined {
  return formatSender(process.env.CONTACT_FROM_EMAIL, process.env.EMAIL_SENDER_NAME);
}

/**
 * Send one email. Returns a discriminated result; NEVER throws. On failure it
 * has already called reportError, so callers only need to decide how to surface
 * it to the user.
 */
/**
 * The custom headers of one outbound mail (threading, unsubscribe, bulk) —
 * shared by sendEmail and sendEmailBatch so both put the same lines on the
 * wire. Empty object when the mail needs none.
 */
export function outboundHeaders(
  input: Pick<SendEmailInput, "messageId" | "inReplyTo" | "references" | "listUnsubscribeUrl" | "bulk">
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (input.messageId) headers["Message-ID"] = input.messageId;
  if (input.inReplyTo) headers["In-Reply-To"] = input.inReplyTo;
  if (input.references && input.references.length > 0) {
    headers["References"] = input.references.join(" ");
  }
  if (input.listUnsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${input.listUnsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (input.bulk) {
    headers["Precedence"] = "bulk";
    headers["X-Auto-Response-Suppress"] = "OOF, AutoReply";
  }
  return headers;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = input.from || senderAddress();

  if (!apiKey || !from) {
    // Local-dev fallback: there's nothing to send through. Be honest about it —
    // but do NOT log the recipient address or subject (PII; application logs are
    // a processor-visible sink — GDPR OQ-18, the same rule the contact-form
    // fallback follows). The `kind` tag is enough to see what was skipped.
    console.log(
      `[email:${input.kind}] not sent — RESEND_API_KEY/CONTACT_FROM_EMAIL not set`
    );
    return { ok: false, skipped: true };
  }

  try {
    const resend = new Resend(apiKey);
    // Custom RFC-5322 headers (Message-ID + reply chain, unsubscribe, bulk)
    // only when set, so plain callers (e.g. the contact form) ship none.
    const headers = outboundHeaders(input);
    const result = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
    });
    if (result.error) {
      reportError(result.error, { route: "lib/email", kind: input.kind, phase: "resend" });
      return { ok: false, skipped: false, error: result.error };
    }
    return { ok: true, id: result.data?.id };
  } catch (err) {
    reportError(err, { route: "lib/email", kind: input.kind, phase: "resend" });
    return { ok: false, skipped: false, error: err };
  }
}

// ── Batch (Rundmail) ─────────────────────────────────────────────────────────

/** One message of a batch — exactly ONE recipient. */
export interface BatchEmailInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

export type SendEmailBatchResult =
  | {
      ok: true;
      /** Resend's message id per input index (null where Resend refused that one). */
      ids: Array<string | null>;
      /** Per-message refusals (permissive validation): index + Resend's message. */
      errors: Array<{ index: number; message: string }>;
    }
  | {
      ok: false;
      /** What the caller should do — mailing-core.mjs classifyResendError. */
      errorClass: ResendErrorClass | "not_configured";
      message: string;
      statusCode: number | null;
      /** Resend's Retry-After in ms (rate limits), else null. */
      retryAfterMs: number | null;
    };

/**
 * Send up to 100 separate messages in ONE Resend request (the batch
 * endpoint). `idempotencyKey` makes the request safe to repeat: Resend
 * answers a repeated key (within 24 h) with the first response instead of
 * sending again — the Rundmail runner retries an unclear batch with the same
 * key, so a timeout can never deliver it twice. Permissive validation: one
 * invalid address refuses only its own message (reported in `errors`), not
 * the whole batch. Never throws; reports errors to Sentry.
 */
export async function sendEmailBatch(
  emails: BatchEmailInput[],
  opts: { idempotencyKey: string; kind: string }
): Promise<SendEmailBatchResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email:${opts.kind}] batch not sent — RESEND_API_KEY not set`);
    return { ok: false, errorClass: "not_configured", message: "RESEND_API_KEY fehlt.", statusCode: null, retryAfterMs: null };
  }
  if (emails.length === 0) return { ok: true, ids: [], errors: [] };
  try {
    const resend = new Resend(apiKey);
    const result = await resend.batch.send(
      emails.map((e) => ({
        from: e.from,
        to: e.to,
        subject: e.subject,
        text: e.text,
        html: e.html,
        ...(e.replyTo ? { replyTo: e.replyTo } : {}),
        ...(e.headers && Object.keys(e.headers).length > 0 ? { headers: e.headers } : {}),
        ...(e.tags && e.tags.length > 0 ? { tags: e.tags } : {}),
      })),
      { idempotencyKey: opts.idempotencyKey, batchValidation: "permissive" }
    );
    if (result.error) {
      const errorClass = classifyResendError(result.error);
      const retryAfter = Number(result.headers?.["retry-after"]);
      // Rate limits are expected under load — not worth a Sentry event each.
      if (errorClass !== "rate_limited") {
        reportError(result.error, { route: "lib/email", kind: opts.kind, phase: "resend-batch" });
      }
      return {
        ok: false,
        errorClass,
        message: result.error.message,
        statusCode: result.error.statusCode ?? null,
        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
      };
    }
    const data = (result.data?.data ?? []) as Array<{ id?: string } | null>;
    const errors = ((result.data as { errors?: Array<{ index: number; message: string }> } | null)?.errors ?? []).filter(
      (e) => Number.isInteger(e?.index)
    );
    // Permissive mode: `data` lists the ACCEPTED messages in input order and
    // the refused indexes are in `errors`. Map ids back onto the input
    // indexes; a response that lists one entry per input is taken as is.
    const refused = new Set(errors.map((e) => e.index));
    const idOf = (entry: { id?: string } | null | undefined) =>
      typeof entry?.id === "string" && entry.id ? entry.id : null;
    const ids: Array<string | null> = [];
    if (data.length === emails.length) {
      for (let i = 0; i < emails.length; i++) ids.push(refused.has(i) ? null : idOf(data[i]));
    } else {
      let next = 0;
      for (let i = 0; i < emails.length; i++) {
        ids.push(refused.has(i) ? null : idOf(data[next++]));
      }
    }
    return { ok: true, ids, errors };
  } catch (err) {
    reportError(err, { route: "lib/email", kind: opts.kind, phase: "resend-batch" });
    return {
      ok: false,
      errorClass: "transient",
      message: err instanceof Error ? err.message : "Netzwerkfehler",
      statusCode: null,
      retryAfterMs: null,
    };
  }
}
