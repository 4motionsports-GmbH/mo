// POST /api/webhooks/resend — Resend delivery events (bounced / complained /
// delivered / delivery_delayed).
//
// Setup in Resend → Webhooks: endpoint https://<host>/api/webhooks/resend,
// events email.bounced, email.complained, email.delivered (delivery_delayed
// optional); the signing secret goes into RESEND_EVENTS_WEBHOOK_SECRET (or,
// when this endpoint is added to the SAME webhook as the inbound route,
// RESEND_WEBHOOK_SECRET — both are accepted).
//
// Contract: verify the Svix signature over the RAW body first, then apply
// (email-delivery-events.ts): hard bounces and complaints suppress the
// address for good, every event stamps the campaign send it belongs to.
// Unknown event types are acknowledged so Resend stops retrying.

import { NextResponse } from "next/server";
import { verifyResendWebhook } from "@/lib/email-webhook.mjs";
import { applyResendDeliveryEvent } from "@/lib/email-delivery-events";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

function secrets(): string[] {
  return [process.env.RESEND_EVENTS_WEBHOOK_SECRET, process.env.RESEND_WEBHOOK_SECRET]
    .map((s) => s?.trim() ?? "")
    .filter(Boolean);
}

export async function POST(req: Request) {
  const candidates = secrets();
  if (candidates.length === 0) {
    return NextResponse.json({ ok: false, error: "Webhook not configured" }, { status: 503 });
  }
  const rawBody = await req.text();
  const headers = {
    svixId: req.headers.get("svix-id"),
    svixTimestamp: req.headers.get("svix-timestamp"),
    svixSignature: req.headers.get("svix-signature"),
  };
  let event: unknown = null;
  let lastError: unknown = null;
  for (const secret of candidates) {
    try {
      event = verifyResendWebhook({ rawBody, ...headers, secret });
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!event) {
    reportError(lastError, { route: "api/webhooks/resend", phase: "verify" });
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 400 });
  }
  try {
    const outcome = await applyResendDeliveryEvent(event);
    if (!outcome) {
      const type = (event as { type?: string }).type ?? "unknown";
      return NextResponse.json({ ok: true, ignored: type });
    }
    return NextResponse.json({ ok: true, ...outcome });
  } catch (err) {
    reportError(err, { route: "api/webhooks/resend", phase: "apply" });
    // Acknowledge anyway: the failure is reported, a retry would not help.
    return NextResponse.json({ ok: true, applied: false });
  }
}
