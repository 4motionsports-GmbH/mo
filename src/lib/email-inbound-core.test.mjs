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
  redactGiftVoucherSecrets,
} from "./email-inbound-core.mjs";
import { GIFT_VOUCHER_CODE_ALPHABET, formatGiftVoucherCode } from "./gift-voucher-core.mjs";
import {
  buildGiftVoucherMail,
  giftVoucherDownloadUrl,
  maskGiftVoucherCode,
  redactGiftVoucherMailParams,
} from "./gift-voucher-mail-core.mjs";

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

// ---------------------------------------------------------------------------
// Geschenkgutschein secrets in replies
// ---------------------------------------------------------------------------
// The voucher mail invites replies and mail clients quote it. The stored copy
// (email_messages → Korrespondenz, Eingang, AI prompts) must hold neither the
// full code nor the live download link — the same rule as the logged voucher
// mail. The quotes below are built from the REAL voucher mail, so a change of
// the printed code or of the link fails here.

const GV_CODE = "ABCDEFGHJKLMNPQR";
const GV_TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const GV_STYLES = { text: "color:#000;", muted: "color:#555;", link: "color:#008ccb;" };
const GV_PARAMS = {
  audience: "buyer",
  locale: "de",
  amountCents: 5000,
  number: "G-2026-00042",
  code: GV_CODE,
  expiresOn: "2029-12-31",
  recipientName: "Oma Erna",
  orderName: "#1001",
  downloadUrl: giftVoucherDownloadUrl("https://mo.motionsports.de", GV_TOKEN),
  hasAttachment: true,
};
const GV_MAIL = buildGiftVoucherMail(GV_PARAMS, GV_STYLES);
const GV_PRINTED = formatGiftVoucherCode(GV_CODE); // "ABCD EFGH JKLM NPQR"
const GV_MASKED = maskGiftVoucherCode(GV_CODE); // "•••• •••• •••• NPQR"
const quote = (text) => text.split("\n").map((l) => `> ${l}`).join("\n");
/** No full code (any separator) and no link token (plain or URL-encoded) left. */
function assertNoVoucherSecrets(s, what) {
  assert.ok(!/ABCD.{0,8}EFGH/.test(s), `${what}: the full code is gone`);
  assert.ok(!s.includes(GV_TOKEN), `${what}: the link token is gone`);
  assert.ok(!s.includes(encodeURIComponent(GV_TOKEN)), `${what}: the encoded link token is gone`);
}

test("a plain-text reply quoting the voucher mail is stored without the code and the link", () => {
  assert.ok(GV_MAIL.text.includes(GV_PRINTED) && GV_MAIL.text.includes(GV_TOKEN), "the real mail carries both");
  const reply = `Hallo, der Code geht an der Kasse nicht.\n\nAm 20.11.2026 um 10:00 schrieb motion sports:\n${quote(GV_MAIL.text)}\n`;
  const m = normalizeInboundMessage({ ...FULL, text: reply, html: null });
  assertNoVoucherSecrets(m.bodyText, "text");
  assertNoVoucherSecrets(m.snippet, "snippet");
  assert.ok(m.bodyText.includes(`> Dein Gutscheincode: ${GV_MASKED}`), "the code keeps its last group, as in the mail log");
  assert.ok(m.bodyText.includes("/api/gift-vouchers/download?t=[entfernt]"), "the link says it was removed");
  assert.ok(m.bodyText.startsWith("Hallo, der Code geht an der Kasse nicht."), "the customer's own words stay");
  // A bottom-posted reply (no top text) — the AI prompt falls back to the raw stored body.
  const bottom = normalizeInboundMessage({ ...FULL, text: `${quote(GV_MAIL.text)}\n\nDer Code geht nicht.`, html: null });
  assertNoVoucherSecrets(bottom.bodyText, "bottom-posted text");
});

test("quoted HTML: groups joined by &nbsp;, &#160;, &#xA0; or U+00A0 and an Outlook Safe Links URL are masked", () => {
  const cta = GV_MAIL.cta;
  assert.ok(cta && cta.url.includes(GV_TOKEN), "the real mail has the download button");
  const safelink = `https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent(cta.url)}&amp;data=05%7C02%7C&amp;reserved=0`;
  const html =
    `<div dir="ltr">Der Code geht nicht.</div><div class="gmail_quote"><blockquote>` +
    GV_MAIL.bodyHtml.replace(GV_PRINTED, GV_PRINTED.replaceAll(" ", "&nbsp;")) +
    `<p>${GV_PRINTED.replaceAll(" ", "&#160;")}</p><p>${GV_PRINTED.replaceAll(" ", "&#xA0;")}</p>` +
    `<p>${GV_PRINTED.replaceAll(" ", "\u00a0")}</p>` +
    `<a href="${safelink}">${cta.label}</a> <a href="${cta.url}">${cta.label}</a></blockquote></div>`;
  assert.ok(html.includes("ABCD&nbsp;EFGH&nbsp;JKLM&nbsp;NPQR"), "the &nbsp; form is in the quote");
  const m = normalizeInboundMessage({ ...FULL, text: null, html });
  assertNoVoucherSecrets(m.bodyHtml, "html");
  assertNoVoucherSecrets(m.snippet, "snippet from html");
  assert.ok(m.bodyHtml.includes("%2Fapi%2Fgift-vouchers%2Fdownload%3Ft%3D[entfernt]&amp;data=05"), "the Safe Links URL loses only the token");
  assert.ok(m.bodyHtml.includes('href="https://mo.motionsports.de/api/gift-vouchers/download?t=[entfernt]"'));
  assert.equal(m.bodyHtml.split(GV_MASKED).length - 1, 4, "all four code forms keep only the last group");
});

test("redactGiftVoucherSecrets: exactly the code alphabet, a fixed point, and the logged voucher mail unchanged", () => {
  const groupOf = (c) => `${c}${c}${c}${c} ${c}${c}${c}${c} ${c}${c}${c}${c} NPQR`;
  for (const c of GIFT_VOUCHER_CODE_ALPHABET) assert.equal(redactGiftVoucherSecrets(groupOf(c)), GV_MASKED, `symbol ${c}`);
  for (const c of "IO01abc") assert.equal(redactGiftVoucherSecrets(groupOf(c)), groupOf(c), `${c} is no code symbol`);
  const once = redactGiftVoucherSecrets(GV_MAIL.text);
  assert.equal(redactGiftVoucherSecrets(once), once, "redacting twice changes nothing");
  const logged = buildGiftVoucherMail(redactGiftVoucherMailParams(GV_PARAMS), GV_STYLES);
  assert.equal(redactGiftVoucherSecrets(logged.text), logged.text, "the logged (redacted) voucher mail is already clean");
  assert.equal(redactGiftVoucherSecrets(logged.bodyHtml), logged.bodyHtml);
});

test("redactGiftVoucherSecrets leaves ordinary mail alone; the known false positive is harmless", () => {
  for (const s of [
    "Bestellung #1001 vom 20.11.2026, Sendungsnummer 00340434161234567890",
    "BITTE INFO ZUM GUTSCHEIN", // I and O are no code symbols
    "https://motionsports.de/pages/gutschein#guthaben",
    "https://mo.motionsports.de/api/gift-vouchers/balance",
    "",
  ]) {
    assert.equal(redactGiftVoucherSecrets(s), s);
  }
  // Only the printed form is a code here: lower case would hit ordinary words,
  // and a code typed without groups is left as it is (documented).
  for (const s of [GV_PRINTED.toLowerCase(), `Ohne Leerzeichen: ${GV_CODE}`]) assert.equal(redactGiftVoucherSecrets(s), s);
  // Four all-caps four-letter words without I/O/0/1 look like a printed code:
  // only the stored copy loses the first three — accepted, documented.
  assert.equal(redactGiftVoucherSecrets("DANK EUCH SEHR GUTE ARBEIT"), "•••• •••• •••• GUTE ARBEIT");
  assert.equal(normalizeInboundMessage({ ...FULL, text: null, html: null }).bodyText, null, "no body stays null");
});
