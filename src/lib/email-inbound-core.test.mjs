import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractEmailAddress,
  normalizeSubject,
  parseReferences,
  deriveThreadId,
  generateMessageId,
  normalizeInboundMessage,
  interpretReceivedInsert,
  buildSnippet,
} from "./email-inbound-core.mjs";

// ---------------------------------------------------------------------------
// from → customer mapping
// ---------------------------------------------------------------------------
// The bridge to customers.email is: normalise data.from → the bare, lower-cased
// address → look it up. These pin the KEY derivation (the lookup itself is a DB
// read). A reply must resolve to the SAME key a capture stored, regardless of
// display name, casing, or angle brackets.

test("extractEmailAddress yields the customers.email lookup key", () => {
  assert.equal(extractEmailAddress("Max Mustermann <Max@Example.DE>"), "max@example.de");
  assert.equal(extractEmailAddress("<a@b.de>"), "a@b.de");
  assert.equal(extractEmailAddress("  KUNDE@Example.de  "), "kunde@example.de");
  // Multi-address header: the sender is the first token.
  assert.equal(extractEmailAddress("a@b.de, c@d.de"), "a@b.de");
});

test("extractEmailAddress returns '' for junk (→ unmatched-inbound queue)", () => {
  assert.equal(extractEmailAddress("not-an-address"), "");
  assert.equal(extractEmailAddress(""), "");
  assert.equal(extractEmailAddress(null), "");
  assert.equal(extractEmailAddress(undefined), "");
});

test("a reply from a KNOWN address normalises to the stored customer key; UNKNOWN stays unmatched", () => {
  // Simulate the route's mapping decision over a tiny customers table.
  const customers = new Map([["kunde@example.de", 42]]);
  const lookup = (from) => customers.get(extractEmailAddress(from)) ?? null;

  assert.equal(lookup("Kunde <KUNDE@Example.DE>"), 42); // known → attach customer_id
  assert.equal(lookup("fremde@nirgendwo.example"), null); // unknown → NULL queue
});

// ---------------------------------------------------------------------------
// threading (header-first, subject fallback)
// ---------------------------------------------------------------------------

test("normalizeSubject strips Re:/AW:/Fwd:/WG: chains for subject-fallback threading", () => {
  assert.equal(normalizeSubject("Re: Deine Bestellung"), "deine bestellung");
  assert.equal(normalizeSubject("AW: WG: Re: Frage"), "frage");
  assert.equal(normalizeSubject("Re[2]: Lieferzeit?"), "lieferzeit?");
  assert.equal(normalizeSubject("Fwd:   spaced   out"), "spaced out");
  // A bare subject is unchanged (bar casing/whitespace); blank stays blank.
  assert.equal(normalizeSubject("Neue Anfrage"), "neue anfrage");
  assert.equal(normalizeSubject(""), "");
});

test("parseReferences splits an angle-bracketed id chain", () => {
  assert.deepEqual(parseReferences("<a@x> <b@x>\n <c@x>"), ["a@x", "b@x", "c@x"]);
  assert.deepEqual(parseReferences(["<a@x>", "b@x"]), ["a@x", "b@x"]);
  assert.deepEqual(parseReferences(""), []);
  assert.deepEqual(parseReferences(null), []);
});

test("deriveThreadId is header-first: References root, else In-Reply-To, else own Message-ID", () => {
  assert.equal(
    deriveThreadId({ messageId: "<reply@x>", inReplyTo: "<parent@x>", references: "<root@x> <parent@x>" }),
    "root@x"
  );
  assert.equal(deriveThreadId({ messageId: "<reply@x>", inReplyTo: "<parent@x>" }), "parent@x");
  assert.equal(deriveThreadId({ messageId: "<first@x>" }), "first@x");
  assert.equal(deriveThreadId({}), null);
});

test("generateMessageId emits a unique <token@domain> and derives the domain from the sender", () => {
  const a = generateMessageId("motion sports <kontakt@motionsports.de>");
  const b = generateMessageId("motionsports.de");
  assert.match(a, /^<[0-9a-f]{32}@motionsports\.de>$/);
  assert.match(b, /^<[0-9a-f]{32}@motionsports\.de>$/);
  assert.notEqual(a, b); // unique per call
  // Junk domain falls back so we never emit a malformed Message-ID.
  assert.match(generateMessageId(""), /@motionsports\.de>$/);
});

// ---------------------------------------------------------------------------
// normalizeInboundMessage — the full receiving.get → row shape
// ---------------------------------------------------------------------------

const FULL = {
  id: "em_abc123",
  object: "email",
  from: "Kunde <Kunde@Example.DE>",
  to: ["bot@chat.motionsports.de"],
  subject: "Re: Deine Empfehlung",
  text: "Danke! Wann kommt die Lieferung?",
  html: "<p>Danke! Wann kommt die Lieferung?</p>",
  message_id: "<reply-9@example.de>",
  headers: {
    "Message-ID": "<reply-9@example.de>",
    "In-Reply-To": "<send-1@motionsports.de>",
    References: "<send-1@motionsports.de>",
  },
  created_at: "2026-06-14T12:00:00.000Z",
  attachments: [
    { id: "att_1", filename: "foto.jpg", content_type: "image/jpeg", size: 1234, content_id: null, content_disposition: "attachment" },
  ],
};

test("normalizeInboundMessage flattens the message and keeps attachment METADATA only", () => {
  const m = normalizeInboundMessage(FULL, { email_id: "em_abc123" });
  assert.equal(m.fromAddress, "kunde@example.de"); // the customer key
  assert.equal(m.toAddress, "bot@chat.motionsports.de");
  assert.equal(m.messageId, "reply-9@example.de");
  assert.equal(m.inReplyTo, "send-1@motionsports.de");
  assert.deepEqual(m.references, ["send-1@motionsports.de"]);
  assert.equal(m.threadId, "send-1@motionsports.de"); // threads onto the parent send
  assert.equal(m.providerEmailId, "em_abc123");
  assert.equal(m.occurredAt, "2026-06-14T12:00:00.000Z");
  assert.equal(m.attachments.length, 1);
  assert.deepEqual(Object.keys(m.attachments[0]).sort(), [
    "content_disposition", "content_id", "content_type", "filename", "id", "size",
  ]);
  // No blob field ever leaks through.
  assert.ok(!("content" in m.attachments[0]));
});

test("normalizeInboundMessage degrades to webhook metadata when the body fetch failed (full=null)", () => {
  const m = normalizeInboundMessage(null, {
    email_id: "em_z",
    from: "kunde@example.de",
    to: ["bot@chat.motionsports.de"],
    subject: "Frage",
    message_id: "<only-meta@example.de>",
    created_at: "2026-06-14T09:00:00.000Z",
  });
  assert.equal(m.fromAddress, "kunde@example.de");
  assert.equal(m.messageId, "only-meta@example.de");
  assert.equal(m.threadId, "only-meta@example.de"); // new thread (no parent headers)
  assert.equal(m.bodyText, null);
});

test("buildSnippet prefers text, falls back to stripped html, and clips to 200 chars", () => {
  assert.equal(buildSnippet("  hello   world  ", "<p>ignored</p>"), "hello world");
  assert.equal(buildSnippet(null, "<p>from <b>html</b></p>"), "from html");
  assert.equal(buildSnippet("x".repeat(250), null).length, 200);
});

// ---------------------------------------------------------------------------
// dedup
// ---------------------------------------------------------------------------
// Resend can re-deliver the same webhook. Dedup keys on the RFC-5322 Message-ID
// via the UNIQUE partial index; the INSERT … ON CONFLICT DO NOTHING returns the
// new id once and ZERO rows on the redelivery. These pin (a) the dedup key is
// STABLE across redeliveries and (b) the store's interpretation of the result.

test("the dedup key (messageId) is identical across redeliveries of the same message", () => {
  const first = normalizeInboundMessage(FULL, { email_id: "em_abc123" });
  const redelivery = normalizeInboundMessage(structuredClone(FULL), { email_id: "em_abc123" });
  assert.equal(first.messageId, redelivery.messageId);
  assert.equal(first.threadId, redelivery.threadId);
});

test("interpretReceivedInsert: a returned id = inserted; zero rows = duplicate", () => {
  assert.deepEqual(interpretReceivedInsert([{ id: 7 }]), { inserted: true, id: 7 });
  assert.deepEqual(interpretReceivedInsert([{ id: "7" }]), { inserted: true, id: 7 });
  // The redelivery: ON CONFLICT DO NOTHING returned nothing → duplicate, not a new row.
  assert.deepEqual(interpretReceivedInsert([]), { inserted: false, reason: "duplicate" });
});
