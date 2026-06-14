// Pingen status-webhook signature verification — the security gate in front of
// /api/webhooks/pingen. Same HMAC-FIRST discipline as the Resend inbound webhook
// (lib/email-webhook.mjs): verify over the RAW body BEFORE parsing it.
//
// Pingen signs webhooks with the Svix "standard-webhooks" scheme. Unlike the
// Resend path (which borrows the Resend SDK's verifier), there is no Pingen SDK,
// so we implement the standard-webhooks HMAC directly with node:crypto:
//   signedContent = `${id}.${timestamp}.${rawBody}`
//   expected      = base64( HMAC-SHA256(secretKey, signedContent) )
//   secret        = "whsec_<base64>" → base64-decode the part after the prefix
//   header        = space-separated `v1,<sig>` entries (any one may match)
// Comparison is constant-time. We accept either the svix-* or the unbranded
// webhook-* header names (standard-webhooks defines both).

import { createHmac, timingSafeEqual } from "node:crypto";

/** Read the secret's raw key bytes (strip the `whsec_` prefix, base64-decode). */
function secretKey(secret) {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(raw, "base64");
}

function constantTimeEquals(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verify a Pingen (standard-webhooks) signature and return the parsed event.
 * THROWS when the secret/headers are missing or the signature doesn't match —
 * the route turns that into a 400 and never touches the body.
 *
 * @param {{ rawBody: string, id: string|null, timestamp: string|null,
 *           signature: string|null, secret: string }} args
 * @returns {unknown} the parsed JSON event (only after the signature checks out)
 */
export function verifyPingenWebhook({ rawBody, id, timestamp, signature, secret }) {
  if (!secret) throw new Error("PINGEN_WEBHOOK_SECRET is not configured");
  if (!id || !timestamp || !signature) {
    throw new Error("Missing required webhook signature headers");
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretKey(secret)).update(signedContent).digest("base64");

  // The header is a space-separated list of `version,signature` pairs.
  const provided = signature
    .split(" ")
    .map((part) => {
      const comma = part.indexOf(",");
      return comma === -1 ? part : part.slice(comma + 1);
    })
    .filter(Boolean);

  const matched = provided.some((sig) => constantTimeEquals(sig, expected));
  if (!matched) throw new Error("Invalid webhook signature");

  return JSON.parse(rawBody);
}

/** Read the signature headers from a Request, accepting svix-* or webhook-* names. */
export function readWebhookHeaders(headers) {
  return {
    id: headers.get("webhook-id") ?? headers.get("svix-id"),
    timestamp: headers.get("webhook-timestamp") ?? headers.get("svix-timestamp"),
    signature: headers.get("webhook-signature") ?? headers.get("svix-signature"),
  };
}
