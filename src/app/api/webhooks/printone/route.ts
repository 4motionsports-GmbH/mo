// POST /api/webhooks/printone — print.one order status webhook (Premium-Karte,
// spec §10, docs/GIFT_VOUCHERS.md).
//
// print.one POSTs { data: <order>, event: "order_status_update", created_at }
// whenever an order changes status. We:
//   1. VERIFY the signature (x-webhook-hmac-sha256 = base64 HMAC-SHA256 of the
//      RAW body with PRINTONE_WEBHOOK_SECRET; several secrets for rotation) over
//      the exact bytes BEFORE parsing — an unverified request never reaches the
//      store (lib/printone-webhook.mjs, constant-time compare);
//   2. INTERPRET it: only order status updates are acted on, everything else is
//      acknowledged and ignored;
//   3. APPLY it to the print job with that print.one order id — monotonic and
//      idempotent (lib/gift-voucher-print.ts applyPrintOneOrderUpdate), because
//      print.one signs no timestamp: a replayed or late event changes nothing.
//
// Answers (same discipline as /api/webhooks/pingen): 503 without a secret
// (fail closed; statuses then come from polling only), 413 for an oversized
// body, 401 for a missing / wrong signature, 400 for a signed body that is not
// JSON, 200 for ignored events and orders that are not Mo's (or whose id is not
// stored yet — the poll catches up), 500 only when the store failed (print.one
// may deliver again; the update is idempotent). Nothing from the payload is
// echoed or logged.

import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { printOneWebhookSecret } from "@/lib/gift-voucher-flags.mjs";
import { applyPrintOneOrderUpdate } from "@/lib/gift-voucher-print";
import {
  PRINTONE_WEBHOOK_MAX_BYTES,
  interpretPrintOneWebhook,
  parsePrintOneWebhookPayload,
  parsePrintOneWebhookSecrets,
  readPrintOneWebhookHeaders,
  verifyPrintOneWebhookSignature,
} from "@/lib/printone-webhook.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

const ROUTE = "api/webhooks/printone";

export async function POST(req: Request) {
  const secrets = parsePrintOneWebhookSecrets(printOneWebhookSecret());
  if (secrets.length === 0) {
    // No signing secret ⇒ we cannot trust ANY payload. Fail closed.
    return NextResponse.json({ ok: false, error: "print.one webhook not configured" }, { status: 503 });
  }

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > PRINTONE_WEBHOOK_MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  // (1) RAW bytes first — the signature covers exactly these.
  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await req.arrayBuffer());
  } catch {
    return NextResponse.json({ ok: false, error: "Unreadable body" }, { status: 400 });
  }
  if (rawBody.length > PRINTONE_WEBHOOK_MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  const headers = readPrintOneWebhookHeaders(req.headers);
  const verified = verifyPrintOneWebhookSignature({ rawBody, signature: headers.signature, secret: secrets });
  if (!verified.ok) {
    reportError(new Error(`print.one webhook rejected: ${verified.reason}`), { route: ROUTE, phase: "verify" });
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  // (2) Only now parse and interpret.
  const parsed = parsePrintOneWebhookPayload(rawBody);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  const event = interpretPrintOneWebhook(parsed.payload, { eventHeader: headers.event });
  if (event.kind !== "order_status") return NextResponse.json({ ok: true, ignored: true });

  // (3) Apply. Without a database the update cannot be stored — ask for a retry.
  if (!getSql()) return NextResponse.json({ ok: false, error: "Store unavailable" }, { status: 503 });
  try {
    const result = await applyPrintOneOrderUpdate({ order: event.order, eventAt: event.eventAt });
    switch (result.outcome) {
      case "updated":
        return NextResponse.json({ ok: true, updated: true, status: result.status });
      case "unchanged":
        return NextResponse.json({ ok: true, updated: false });
      case "unknown_order":
        return NextResponse.json({ ok: true, ignored: true });
      default:
        return NextResponse.json({ ok: false, error: "Ingest failed" }, { status: 500 });
    }
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "ingest" });
    return NextResponse.json({ ok: false, error: "Ingest failed" }, { status: 500 });
  }
}
