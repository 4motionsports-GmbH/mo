// Resend inbound webhook signature verification — the security gate in front of
// /api/inbound/resend.
//
// Resend signs webhooks with the Svix standard-webhooks scheme: the signature
// covers `${svix-id}.${svix-timestamp}.${raw-body}` keyed by the endpoint
// secret. We MUST verify over the RAW request body BEFORE parsing it (parsing
// and re-serialising changes the bytes and invalidates the signature) — the
// same HMAC-first discipline the signed unsubscribe links use in
// email-capture-store.ts.
//
// We delegate to the SDK's own verifier (resend.webhooks.verify), which wraps
// `standardwebhooks`. NB: despite the published TS type saying `headers: Headers`,
// the runtime reads `headers.id` / `headers.timestamp` / `headers.signature`
// (verified against the installed resend@6.12.4 — see EMAIL_SUBSYSTEM_SPIKE
// [VERIFY] #1), so we pass a plain object in that exact shape.

import { Resend } from "resend";

// One reusable instance — verify() is local crypto (no network call, the API
// key is irrelevant to it), but the constructor demands a non-empty key, so we
// pass a placeholder. The real RESEND_API_KEY is only used for sending /
// receiving.get, never here.
const verifier = new Resend(process.env.RESEND_API_KEY || "re_signature_verify_only");

/**
 * Verify a Resend webhook and return the parsed, trusted event payload.
 * THROWS (WebhookVerificationError) when the signature, secret, or any required
 * svix header is missing/invalid — the route turns that into a 400 and never
 * touches the body. Never returns an unverified payload.
 *
 * @param {object} args
 * @param {string} args.rawBody   the exact request body bytes, as text
 * @param {string|null} args.svixId
 * @param {string|null} args.svixTimestamp
 * @param {string|null} args.svixSignature
 * @param {string} args.secret    RESEND_WEBHOOK_SECRET (whsec_…)
 */
export function verifyResendWebhook({ rawBody, svixId, svixTimestamp, svixSignature, secret }) {
  if (!secret) {
    throw new Error("RESEND_WEBHOOK_SECRET is not configured");
  }
  if (!svixId || !svixTimestamp || !svixSignature) {
    throw new Error("Missing required svix signature headers");
  }
  return verifier.webhooks.verify({
    payload: rawBody,
    // Runtime shape the SDK actually reads (id/timestamp/signature), not the
    // Web `Headers` the published type claims.
    headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
    webhookSecret: secret,
  });
}
