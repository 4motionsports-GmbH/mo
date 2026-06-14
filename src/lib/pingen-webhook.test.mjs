import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyPingenWebhook, parseSecrets } from "./pingen-webhook.mjs";

// Build a valid standard-webhooks signature for a given secret + payload.
function sign(secret, id, timestamp, body) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${sig}`;
}

const SECRET_A = "whsec_" + Buffer.from("secret-a-key-material").toString("base64");
const SECRET_B = "whsec_" + Buffer.from("secret-b-key-material").toString("base64");
const ID = "msg_1";
const TS = "1718000000";
const BODY = JSON.stringify({ data: { type: "letters", id: "L1", attributes: { status: "sent" } } });

test("parseSecrets: splits a comma/whitespace list, drops blanks", () => {
  assert.deepEqual(parseSecrets("whsec_a, whsec_b\n whsec_c"), ["whsec_a", "whsec_b", "whsec_c"]);
  assert.deepEqual(parseSecrets("whsec_only"), ["whsec_only"]);
  assert.deepEqual(parseSecrets(""), []);
  assert.deepEqual(parseSecrets(undefined), []);
});

test("verifies a valid signature and returns the parsed event", () => {
  const signature = sign(SECRET_A, ID, TS, BODY);
  const evt = verifyPingenWebhook({
    rawBody: BODY,
    id: ID,
    timestamp: TS,
    signature,
    secret: SECRET_A,
  });
  assert.equal(evt.data.id, "L1");
});

test("multi-secret: a payload signed with ANY listed secret verifies", () => {
  // Signed with B, but the env lists A and B (one per Pingen subscription).
  const signature = sign(SECRET_B, ID, TS, BODY);
  const evt = verifyPingenWebhook({
    rawBody: BODY,
    id: ID,
    timestamp: TS,
    signature,
    secret: `${SECRET_A}, ${SECRET_B}`,
  });
  assert.equal(evt.data.attributes.status, "sent");
});

test("rejects a signature that matches NONE of the secrets", () => {
  const signature = sign("whsec_" + Buffer.from("other").toString("base64"), ID, TS, BODY);
  assert.throws(
    () => verifyPingenWebhook({ rawBody: BODY, id: ID, timestamp: TS, signature, secret: SECRET_A }),
    /Invalid webhook signature/
  );
});

test("rejects a tampered body (signature no longer matches)", () => {
  const signature = sign(SECRET_A, ID, TS, BODY);
  assert.throws(
    () =>
      verifyPingenWebhook({
        rawBody: BODY + " ",
        id: ID,
        timestamp: TS,
        signature,
        secret: SECRET_A,
      }),
    /Invalid webhook signature/
  );
});

test("throws when no secret is configured", () => {
  assert.throws(
    () => verifyPingenWebhook({ rawBody: BODY, id: ID, timestamp: TS, signature: "v1,x", secret: "" }),
    /not configured/
  );
});

test("throws when required svix/webhook headers are missing", () => {
  assert.throws(
    () => verifyPingenWebhook({ rawBody: BODY, id: null, timestamp: TS, signature: "v1,x", secret: SECRET_A }),
    /Missing required webhook signature headers/
  );
});
