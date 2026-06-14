import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { verifyResendWebhook } from "./email-webhook.mjs";

// The inbound webhook's security gate. These pin that a Resend (Svix) signature
// is verified over the RAW body BEFORE parsing, and that ANY tampering — body,
// secret, or a missing header — is rejected. A forged reply must never reach
// the store.

/** Mint a whsec_… secret + a valid Svix signature for `rawBody`. */
function sign(rawBody, { id = `msg_${randomBytes(6).toString("hex")}`, timestamp = Math.floor(Date.now() / 1000).toString() } = {}) {
  const keyBytes = randomBytes(24);
  const secret = `whsec_${keyBytes.toString("base64")}`;
  const signature = createHmac("sha256", keyBytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  return { secret, svixId: id, svixTimestamp: timestamp, svixSignature: `v1,${signature}` };
}

const RECEIVED_EVENT = JSON.stringify({
  type: "email.received",
  created_at: "2026-06-14T10:00:00.000Z",
  data: { email_id: "em_abc123", from: "kunde@example.de", message_id: "<reply-1@example.de>" },
});

test("a correctly-signed payload verifies and returns the parsed event", () => {
  const sig = sign(RECEIVED_EVENT);
  const event = verifyResendWebhook({ rawBody: RECEIVED_EVENT, ...sig });
  assert.equal(event.type, "email.received");
  assert.equal(event.data.email_id, "em_abc123");
});

test("a tampered body is rejected (signature no longer matches)", () => {
  const sig = sign(RECEIVED_EVENT);
  const tampered = RECEIVED_EVENT.replace("kunde@example.de", "angreifer@evil.example");
  assert.throws(() => verifyResendWebhook({ rawBody: tampered, ...sig }));
});

test("the wrong secret is rejected", () => {
  const sig = sign(RECEIVED_EVENT);
  const wrong = { ...sig, secret: `whsec_${randomBytes(24).toString("base64")}` };
  assert.throws(() => verifyResendWebhook({ rawBody: RECEIVED_EVENT, ...wrong }));
});

test("missing svix headers are rejected before any verification", () => {
  const sig = sign(RECEIVED_EVENT);
  assert.throws(
    () => verifyResendWebhook({ rawBody: RECEIVED_EVENT, ...sig, svixSignature: null }),
    /Missing required svix signature headers/
  );
});

test("a missing webhook secret is rejected", () => {
  const sig = sign(RECEIVED_EVENT);
  assert.throws(
    () => verifyResendWebhook({ rawBody: RECEIVED_EVENT, ...sig, secret: "" }),
    /RESEND_WEBHOOK_SECRET is not configured/
  );
});
