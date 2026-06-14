import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pingenHosts,
  tokenUrl,
  fileUploadUrl,
  lettersUrl,
  letterUrl,
  sendLetterUrl,
  buildCreateLetterBody,
  buildSendLetterBody,
  normalizePingenStatus,
  tokenIsFresh,
  tokenExpiryMs,
  interpretWebhookEvent,
} from "./pingen-core.mjs";

test("hosts + endpoints: production", () => {
  assert.deepEqual(pingenHosts(false), {
    api: "https://api.pingen.com",
    identity: "https://identity.pingen.com",
  });
  assert.equal(tokenUrl(false), "https://identity.pingen.com/auth/access-tokens");
  assert.equal(fileUploadUrl(false), "https://api.pingen.com/file-upload");
  assert.equal(lettersUrl(false, "ORG"), "https://api.pingen.com/organisations/ORG/letters");
  assert.equal(letterUrl(false, "ORG", "L1"), "https://api.pingen.com/organisations/ORG/letters/L1");
  assert.equal(
    sendLetterUrl(false, "ORG", "L1"),
    "https://api.pingen.com/organisations/ORG/letters/L1/send"
  );
});

test("hosts + endpoints: staging", () => {
  assert.deepEqual(pingenHosts(true), {
    api: "https://api-staging.pingen.com",
    identity: "https://identity-staging.pingen.com",
  });
  assert.equal(tokenUrl(true), "https://identity-staging.pingen.com/auth/access-tokens");
  assert.equal(lettersUrl(true, "ORG"), "https://api-staging.pingen.com/organisations/ORG/letters");
});

test("buildCreateLetterBody: JSON:API shape + verified attribute names", () => {
  const body = buildCreateLetterBody({
    fileUrl: "https://upload/x",
    fileSignature: "sig",
    fileOriginalName: "brief-1.pdf",
    addressPosition: "left",
    autoSend: true,
  });
  assert.equal(body.data.type, "letters");
  const a = body.data.attributes;
  // The exact field names verified against the official SDKs.
  assert.deepEqual(Object.keys(a).sort(), [
    "address_position",
    "auto_send",
    "delivery_product",
    "file_original_name",
    "file_url",
    "file_url_signature",
    "print_mode",
    "print_spectrum",
  ]);
  assert.equal(a.file_url, "https://upload/x");
  assert.equal(a.file_url_signature, "sig");
  assert.equal(a.address_position, "left");
  assert.equal(a.auto_send, true);
  // Sensible defaults.
  assert.equal(a.delivery_product, "fast");
  assert.equal(a.print_mode, "simplex");
  assert.equal(a.print_spectrum, "grayscale");
});

test("buildSendLetterBody: carries the letter id + print options", () => {
  const body = buildSendLetterBody({ letterId: "L1", printSpectrum: "color" });
  assert.equal(body.data.id, "L1");
  assert.equal(body.data.type, "letters");
  assert.equal(body.data.attributes.print_spectrum, "color");
});

test("normalizePingenStatus: maps the lifecycle, unknown → submitted", () => {
  assert.equal(normalizePingenStatus("queued"), "queued");
  assert.equal(normalizePingenStatus("PRINTED"), "printed");
  assert.equal(normalizePingenStatus("sent"), "posted");
  assert.equal(normalizePingenStatus("delivered"), "posted");
  assert.equal(normalizePingenStatus("invalid"), "failed");
  assert.equal(normalizePingenStatus("undeliverable"), "undeliverable");
  assert.equal(normalizePingenStatus("something_new"), "submitted");
  assert.equal(normalizePingenStatus(null), "submitted");
});

test("token freshness: refreshes early, treats missing as stale", () => {
  const now = 1_000_000;
  assert.equal(tokenIsFresh(null, now), false);
  assert.equal(tokenIsFresh({ token: "t", expiresAtMs: now + 120_000 }, now), true);
  // Within the 60s skew → considered stale.
  assert.equal(tokenIsFresh({ token: "t", expiresAtMs: now + 30_000 }, now), false);
  assert.equal(tokenIsFresh({ token: null, expiresAtMs: now + 999_999 }, now), false);
});

test("tokenExpiryMs: uses expires_in, falls back to 1h", () => {
  assert.equal(tokenExpiryMs(3600, 0), 3_600_000);
  assert.equal(tokenExpiryMs(undefined, 0), 3_600_000);
  assert.equal(tokenExpiryMs(-5, 1000), 1000 + 3_600_000);
});

test("interpretWebhookEvent: JSON:API letter resource", () => {
  const r = interpretWebhookEvent({
    data: { type: "letters", id: "L9", attributes: { status: "printed", price: "0.86" } },
  });
  assert.equal(r.providerLetterId, "L9");
  assert.equal(r.status, "printed");
  assert.equal(r.costCents, 86);
});

test("interpretWebhookEvent: nested letter_id + numeric price", () => {
  const r = interpretWebhookEvent({
    data: { type: "webhooks", attributes: { letter_id: "L7", status: "sent", price: 1.2 } },
  });
  assert.equal(r.providerLetterId, "L7");
  assert.equal(r.status, "posted");
  assert.equal(r.costCents, 120);
});

test("interpretWebhookEvent: shapeless event → nulls (route acks, no update)", () => {
  const r = interpretWebhookEvent({ hello: "world" });
  assert.equal(r.providerLetterId, null);
  assert.equal(r.status, null);
  assert.equal(r.costCents, null);
});
