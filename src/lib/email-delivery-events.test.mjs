import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResendDeliveryEvent, suppressionReasonFor } from "./email-delivery-events.mjs";

test("a permanent bounce is a hard bounce that suppresses", () => {
  const p = parseResendDeliveryEvent({
    type: "email.bounced",
    created_at: "2026-09-09T08:00:00.000Z",
    data: { email_id: "re_123", to: ["Jure@Example.com", "jure@example.com"], bounce: { type: "Permanent", subType: "General", message: "550 5.1.1 user unknown" } },
  });
  assert.deepEqual(p, {
    kind: "bounced",
    emailId: "re_123",
    recipients: ["jure@example.com"],
    bounceType: "hard",
    message: "550 5.1.1 user unknown",
    occurredAt: "2026-09-09T08:00:00.000Z",
  });
  assert.equal(suppressionReasonFor(p), "bounce");
});

test("a transient bounce is soft and does not suppress", () => {
  const p = parseResendDeliveryEvent({ type: "email.bounced", data: { email_id: "re_1", to: ["a@b.de"], bounce: { type: "Transient" } } });
  assert.equal(p.bounceType, "soft");
  assert.equal(suppressionReasonFor(p), null);
  const u = parseResendDeliveryEvent({ type: "email.bounced", data: { to: "a@b.de", bounce: { type: "Undetermined" } } });
  assert.equal(u.bounceType, "soft");
  assert.equal(u.emailId, null);
  assert.deepEqual(u.recipients, ["a@b.de"]);
});

test("complaints suppress, delivered/delayed only stamp, other events are ignored", () => {
  const c = parseResendDeliveryEvent({ type: "email.complained", data: { email_id: "re_2", to: ["x@y.de"] } });
  assert.equal(c.kind, "complained");
  assert.equal(suppressionReasonFor(c), "complaint");
  const d = parseResendDeliveryEvent({ type: "email.delivered", data: { email_id: "re_3", to: ["x@y.de"] } });
  assert.equal(d.kind, "delivered");
  assert.equal(suppressionReasonFor(d), null);
  assert.equal(parseResendDeliveryEvent({ type: "email.delivery_delayed", data: {} }).kind, "delayed");
  assert.equal(parseResendDeliveryEvent({ type: "email.received", data: {} }), null);
  assert.equal(parseResendDeliveryEvent({ type: "email.sent", data: {} }), null);
  assert.equal(parseResendDeliveryEvent(null), null);
});

test("garbage recipients are dropped and long bounce messages are clipped", () => {
  const p = parseResendDeliveryEvent({ type: "email.bounced", data: { to: ["nope", "ok@ok.de"], bounce: { type: "Permanent", message: "x".repeat(900) } } });
  assert.deepEqual(p.recipients, ["ok@ok.de"]);
  assert.equal(p.message.length, 500);
});
