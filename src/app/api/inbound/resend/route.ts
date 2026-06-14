// POST /api/inbound/resend — Resend Inbound webhook (S10D items 7+8).
//
// Resend's MX receives a reply to our outbound mail and POSTs an
// `email.received` event here (METADATA only). We:
//   1. VERIFY the Svix signature over the RAW body BEFORE parsing — an
//      unverified request never touches the store (mirrors the HMAC-first
//      discipline of the signed unsubscribe links).
//   2. FETCH the full message by data.email_id (body/headers/attachments are
//      deliberately kept out of the webhook body) via emails.receiving.get.
//   3. MAP the sender to a customer (normalise from → customers.email). Known →
//      customer_id; unknown → NULL (the unmatched-inbound queue).
//   4. INSERT a direction='received' row, dedup'd on Message-ID.
//
// LAWFUL BASIS: this writes Korrespondenz only — it does NOT touch any consent
// gate. Receiving a reply rests on contract/legitimate interest, independent of
// marketing DOI.

import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getCustomerByEmail } from "@/lib/customer-store";
import { insertReceivedMessage } from "@/lib/email-messages-store";
import { inboundWebhookSecret } from "@/lib/email-inbound";
import { verifyResendWebhook } from "@/lib/email-webhook.mjs";
import { normalizeInboundMessage } from "@/lib/email-inbound-core.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

export async function POST(req: Request) {
  const secret = inboundWebhookSecret();
  if (!secret) {
    // No signing secret configured ⇒ we cannot trust ANY inbound payload.
    // Fail closed (503) rather than ingesting unverifiable mail.
    return NextResponse.json(
      { ok: false, error: "Inbound webhook not configured" },
      { status: 503 }
    );
  }

  // (1) RAW body first — verification must run over the exact bytes Resend
  // signed; JSON-parsing + re-serialising would invalidate the signature.
  const rawBody = await req.text();

  let event: unknown;
  try {
    event = verifyResendWebhook({
      rawBody,
      svixId: req.headers.get("svix-id"),
      svixTimestamp: req.headers.get("svix-timestamp"),
      svixSignature: req.headers.get("svix-signature"),
      secret,
    });
  } catch (err) {
    // Bad/missing signature — reject. Do NOT log the body; just the failure.
    reportError(err, { route: "api/inbound/resend", phase: "verify" });
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 400 });
  }

  const evt = event as { type?: string; data?: Record<string, unknown> };

  // We only ingest received mail; ack everything else so Resend stops retrying.
  if (evt.type !== "email.received") {
    return NextResponse.json({ ok: true, ignored: evt.type ?? "unknown" });
  }

  try {
    const data = (evt.data ?? {}) as {
      email_id?: string;
      from?: string;
      to?: string[];
      subject?: string;
      message_id?: string;
      created_at?: string;
      attachments?: unknown[];
    };
    const emailId = data.email_id;
    if (!emailId) {
      return NextResponse.json({ ok: false, error: "Missing email_id" }, { status: 400 });
    }

    // (2) Fetch the full message (body + headers + attachment metadata). If the
    // fetch fails (no API key / transient), we still ingest from the webhook
    // metadata — it already carries from/to/subject/message_id for dedup+mapping.
    const full = await fetchFullInboundMessage(emailId);
    const normalized = normalizeInboundMessage(full, data);

    // (3) Map sender → customer. Known address attaches; unknown ⇒ NULL (the
    // unmatched-inbound queue surfaced in the admin triage list).
    let customerId: number | null = null;
    if (normalized.fromAddress) {
      const customer = await getCustomerByEmail(normalized.fromAddress);
      customerId = customer?.id ?? null;
    }

    // (4) INSERT, dedup'd on Message-ID.
    const result = await insertReceivedMessage({
      customerId,
      messageId: normalized.messageId,
      inReplyTo: normalized.inReplyTo,
      references: normalized.references,
      threadId: normalized.threadId,
      fromAddress: normalized.fromAddress,
      toAddress: normalized.toAddress,
      subject: normalized.subject,
      bodyText: normalized.bodyText,
      bodyHtml: normalized.bodyHtml,
      snippet: normalized.snippet,
      attachments: normalized.attachments,
      providerEmailId: normalized.providerEmailId,
      occurredAt: normalized.occurredAt,
    });

    if (!result.inserted && result.reason === "error") {
      // A real DB failure: 500 so Resend retries (the dedup index makes the
      // retry safe — a row that did land won't be duplicated).
      return NextResponse.json({ ok: false, error: "Store failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      stored: result.inserted,
      duplicate: !result.inserted && result.reason === "duplicate",
      matched: customerId != null,
    });
  } catch (err) {
    reportError(err, { route: "api/inbound/resend", phase: "ingest" });
    return NextResponse.json({ ok: false, error: "Ingest failed" }, { status: 500 });
  }
}

/**
 * Fetch the full inbound message by id. Returns the success payload, or null on
 * any failure (no API key, network, provider error) so the caller can degrade to
 * the webhook metadata rather than dropping the message.
 */
async function fetchFullInboundMessage(emailId: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.receiving.get(emailId);
    if (error) {
      reportError(error, { route: "api/inbound/resend", phase: "receiving.get" });
      return null;
    }
    return data;
  } catch (err) {
    reportError(err, { route: "api/inbound/resend", phase: "receiving.get" });
    return null;
  }
}
