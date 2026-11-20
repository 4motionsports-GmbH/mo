import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  PRINTONE_EVENT_HEADER,
  PRINTONE_ORDER_STATUS_EVENT,
  PRINTONE_SIGNATURE_HEADER,
  interpretPrintOneWebhook,
  parsePrintOneWebhookPayload,
  parsePrintOneWebhookSecrets,
  readPrintOneWebhookHeaders,
  signPrintOneWebhookBody,
  verifyPrintOneWebhookSignature,
} from "./printone-webhook.mjs";

const SECRET = "whsec-print-one-secret-1";
const SECRET_NEW = "rotated-secret-2";

/** What print.one sends: { data: <order>, event, created_at } (OpenAPI v2 `webhooks.order_status_update`). */
function payload(overrides = {}, data = {}) {
  return {
    data: {
      id: "ord_1234567890",
      templateId: "tmpl_1",
      format: "GREETINGCARD_SQ14",
      status: "order_pdf_delivered",
      friendlyStatus: "Sent",
      isBillable: true,
      errors: [],
      warnings: [],
      mergeVariables: { outside_url: "https://mo.example/a-outside.jpg", inside_url: "https://mo.example/a-inside.jpg" },
      createdAt: "2026-11-20T10:00:00.000Z",
      updatedAt: "2026-11-21T06:10:00.000Z",
      ...data,
    },
    event: "order_status_update",
    created_at: "2026-11-21T06:10:01.000Z",
    ...overrides,
  };
}

/** The SDK's own computation (PrintOne.isValidWebhook): base64(HMAC-SHA256(secret, body)). */
function sdkSignature(body, secret) {
  return createHmac("sha256", secret).update(body).digest("base64");
}

test("signPrintOneWebhookBody matches the official SDK's signature", () => {
  const body = JSON.stringify(payload());
  assert.equal(signPrintOneWebhookBody(body, SECRET), sdkSignature(body, SECRET));
  assert.equal(signPrintOneWebhookBody(Buffer.from(body), SECRET), sdkSignature(body, SECRET));
});

test("valid signature over the raw body (string or bytes) is accepted", () => {
  const body = JSON.stringify(payload());
  const signature = sdkSignature(body, SECRET);
  assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: body, signature, secret: SECRET }), { ok: true });
  assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: Buffer.from(body, "utf8"), signature, secret: SECRET }), { ok: true });
  assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: new Uint8Array(Buffer.from(body)), signature: ` ${signature}\n`, secret: SECRET }), { ok: true });
  assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: body, signature: `sha256=${signature}`, secret: SECRET }), { ok: true });
});

test("non-ASCII bodies are signed over their UTF-8 bytes", () => {
  const body = JSON.stringify(payload({}, { recipient: { name: "Jürgen Weiß", city: "Gröbenzell" } }));
  const signature = sdkSignature(Buffer.from(body, "utf8"), SECRET);
  assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: Buffer.from(body, "utf8"), signature, secret: SECRET }), { ok: true });
});

test("invalid signatures are refused: wrong secret, tampered body, other digest", () => {
  const body = JSON.stringify(payload());
  const wrongSecret = sdkSignature(body, "not-the-secret");
  assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: body, signature: wrongSecret, secret: SECRET }), {
    ok: false,
    reason: "invalid_signature",
  });
  const tampered = body.replace("order_pdf_delivered", "order_cancelled");
  assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: tampered, signature: sdkSignature(body, SECRET), secret: SECRET }), {
    ok: false,
    reason: "invalid_signature",
  });
  // a signature of the body without the secret (sha256 of the body) is not an HMAC
  const plainHash = createHmac("sha256", "").update(body).digest("base64");
  assert.equal(verifyPrintOneWebhookSignature({ rawBody: body, signature: plainHash, secret: SECRET }).ok, false);
});

test("missing and malformed signatures are refused before any HMAC work", () => {
  const body = JSON.stringify(payload());
  for (const signature of [null, undefined, "", "   "]) {
    assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: body, signature, secret: SECRET }), { ok: false, reason: "missing_signature" });
  }
  const hex = createHmac("sha256", SECRET).update(body).digest("hex");
  for (const signature of [hex, "abc", "!!!!", sdkSignature(body, SECRET).slice(0, 40), `${sdkSignature(body, SECRET)}AA==`]) {
    assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: body, signature, secret: SECRET }), { ok: false, reason: "malformed_signature" }, signature);
  }
});

test("without a configured secret nothing verifies", () => {
  const body = JSON.stringify(payload());
  const signature = sdkSignature(body, "");
  for (const secret of [null, undefined, "", "  ,  ", []]) {
    assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: body, signature, secret }), { ok: false, reason: "no_secret" });
  }
});

test("rotation: a body signed with ANY configured secret verifies", () => {
  const body = JSON.stringify(payload());
  const env = `${SECRET}, ${SECRET_NEW}`;
  assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: body, signature: sdkSignature(body, SECRET), secret: env }), { ok: true });
  assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: body, signature: sdkSignature(body, SECRET_NEW), secret: env }), { ok: true });
  assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: body, signature: sdkSignature(body, SECRET_NEW), secret: [SECRET, SECRET_NEW] }), { ok: true });
  assert.deepEqual(verifyPrintOneWebhookSignature({ rawBody: body, signature: sdkSignature(body, "third"), secret: env }), {
    ok: false,
    reason: "invalid_signature",
  });
});

test("parsePrintOneWebhookSecrets: comma / whitespace list, no blanks, no duplicates, at most 5", () => {
  assert.deepEqual(parsePrintOneWebhookSecrets("a, b\n c,,a"), ["a", "b", "c"]);
  assert.deepEqual(parsePrintOneWebhookSecrets("  only  "), ["only"]);
  assert.deepEqual(parsePrintOneWebhookSecrets(""), []);
  assert.deepEqual(parsePrintOneWebhookSecrets(undefined), []);
  assert.equal(parsePrintOneWebhookSecrets("1 2 3 4 5 6 7").length, 5);
});

test("readPrintOneWebhookHeaders: Headers (case-insensitive) and plain objects", () => {
  const h = new Headers({ "X-Webhook-HMAC-SHA256": "sig==", "X-Webhook-Event": "order_status_update" });
  assert.deepEqual(readPrintOneWebhookHeaders(h), { signature: "sig==", event: "order_status_update" });
  assert.deepEqual(readPrintOneWebhookHeaders({ [PRINTONE_SIGNATURE_HEADER]: "s", [PRINTONE_EVENT_HEADER]: ["e", "f"] }), { signature: "s", event: "e" });
  assert.deepEqual(readPrintOneWebhookHeaders(new Headers()), { signature: null, event: null });
  assert.deepEqual(readPrintOneWebhookHeaders(null), { signature: null, event: null });
});

test("parsePrintOneWebhookPayload never throws", () => {
  assert.deepEqual(parsePrintOneWebhookPayload('{"event":"x"}'), { ok: true, payload: { event: "x" } });
  assert.deepEqual(parsePrintOneWebhookPayload(Buffer.from('{"a":1}')), { ok: true, payload: { a: 1 } });
  assert.deepEqual(parsePrintOneWebhookPayload("{not json"), { ok: false });
  assert.deepEqual(parsePrintOneWebhookPayload(""), { ok: false });
});

test("interpretPrintOneWebhook: an order status update → the order + its mapped job status", () => {
  const res = interpretPrintOneWebhook(payload());
  assert.equal(res.kind, "order_status");
  assert.equal(res.order.id, "ord_1234567890");
  assert.equal(res.order.status, "order_pdf_delivered");
  assert.equal(res.order.jobStatus, "sent");
  assert.equal(res.order.isBillable, true);
  assert.equal(res.eventAt, "2026-11-21T06:10:01.000Z");
});

test("interpretPrintOneWebhook: createdAt (SDK spelling) and no timestamp at all", () => {
  const { created_at: _drop, ...rest } = payload();
  void _drop;
  assert.equal(interpretPrintOneWebhook({ ...rest, createdAt: "2026-11-21T07:00:00Z" }).eventAt, "2026-11-21T07:00:00.000Z");
  assert.equal(interpretPrintOneWebhook(rest).eventAt, null);
  assert.equal(interpretPrintOneWebhook({ ...rest, created_at: "yesterday-ish" }).eventAt, null);
});

test("interpretPrintOneWebhook: failed order carries print.one's errors", () => {
  const res = interpretPrintOneWebhook(payload({}, { status: "order_failed", friendlyStatus: "Failed", errors: ["Image could not be loaded (404)"] }));
  assert.equal(res.order.jobStatus, "failed");
  assert.deepEqual(res.order.errors, ["Image could not be loaded (404)"]);
});

test("interpretPrintOneWebhook: other events and odd shapes are ignored", () => {
  for (const event of ["template_preview_rendered", "batch_status_update", "coupon_code_used", "qr_code_scanned", "", "ORDER_STATUS_UPDATE"]) {
    assert.deepEqual(interpretPrintOneWebhook(payload({ event })), { kind: "ignored", reason: "event" }, event);
  }
  assert.deepEqual(interpretPrintOneWebhook(payload({}, { id: "../x" })), { kind: "ignored", reason: "shape" });
  assert.deepEqual(interpretPrintOneWebhook({ event: PRINTONE_ORDER_STATUS_EVENT }), { kind: "ignored", reason: "shape" });
  assert.deepEqual(interpretPrintOneWebhook({ event: PRINTONE_ORDER_STATUS_EVENT, data: "ord_1" }), { kind: "ignored", reason: "shape" });
  for (const junk of [null, undefined, "x", 1, []]) assert.deepEqual(interpretPrintOneWebhook(junk), { kind: "ignored", reason: "shape" });
});

test("interpretPrintOneWebhook: the unsigned event header is only a fallback", () => {
  const { event: _e, ...noEvent } = payload();
  void _e;
  assert.equal(interpretPrintOneWebhook(noEvent, { eventHeader: "order_status_update" }).kind, "order_status");
  assert.equal(interpretPrintOneWebhook(noEvent).kind, "ignored");
  // the signed body says qr_code_scanned — a forged header cannot turn it into a status update
  assert.equal(interpretPrintOneWebhook(payload({ event: "qr_code_scanned" }), { eventHeader: "order_status_update" }).kind, "ignored");
});
