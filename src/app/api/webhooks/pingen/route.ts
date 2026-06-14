// POST /api/webhooks/pingen — Pingen status webhook (S10D item 10 / §4).
//
// Pingen POSTs a letter status-change event here as it moves through its
// lifecycle (queued → printed → posted). We:
//   1. VERIFY the standard-webhooks signature over the RAW body BEFORE parsing —
//      an unverified request never touches the store (mirrors /api/inbound/resend
//      and the signed-unsubscribe HMAC-first discipline).
//   2. EXTRACT the Pingen letter id + status (defensively, across payload shapes).
//   3. UPDATE the matching physical_letters row's status (+ cost when present).
//
// Same ingest pattern as 10D-1: fail closed (503) without a secret, 400 on a bad
// signature, 500 only on a real store failure (so Pingen retries safely — the
// update is idempotent by provider_letter_id).

import { NextResponse } from "next/server";
import { verifyPingenWebhook, readWebhookHeaders } from "@/lib/pingen-webhook.mjs";
import { interpretWebhookEvent } from "@/lib/pingen-core.mjs";
import { updatePhysicalLetterStatusByProviderId } from "@/lib/physical-letters-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

function webhookSecret(): string | undefined {
  return process.env.PINGEN_WEBHOOK_SECRET?.trim() || undefined;
}

export async function POST(req: Request) {
  const secret = webhookSecret();
  if (!secret) {
    // No signing secret ⇒ we cannot trust ANY payload. Fail closed.
    return NextResponse.json(
      { ok: false, error: "Pingen webhook not configured" },
      { status: 503 }
    );
  }

  // (1) RAW body first — verification must run over the exact signed bytes.
  const rawBody = await req.text();
  const { id, timestamp, signature } = readWebhookHeaders(req.headers);

  let event: unknown;
  try {
    event = verifyPingenWebhook({ rawBody, id, timestamp, signature, secret });
  } catch (err) {
    reportError(err, { route: "api/webhooks/pingen", phase: "verify" });
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 400 });
  }

  try {
    // (2) Pull the letter id + normalised status from the (verified) event.
    const { providerLetterId, status, costCents } = interpretWebhookEvent(event);
    if (!providerLetterId || !status) {
      // A non-letter / shapeless event — ack so Pingen stops retrying.
      return NextResponse.json({ ok: true, ignored: true });
    }

    // (3) Apply it. An unknown letter id (not ours) is ack'd without retry.
    const updated = await updatePhysicalLetterStatusByProviderId(
      providerLetterId,
      status,
      costCents
    );
    return NextResponse.json({ ok: true, updated, status });
  } catch (err) {
    reportError(err, { route: "api/webhooks/pingen", phase: "ingest" });
    // Real failure → 500 so Pingen retries (the update is idempotent by id).
    return NextResponse.json({ ok: false, error: "Ingest failed" }, { status: 500 });
  }
}
