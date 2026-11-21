import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GIFT_VOUCHER_MAIL_KIND,
  buildGiftVoucherMail,
  escapeMailHtml,
  formatGiftVoucherMailDate,
  giftVoucherDownloadUrl,
  giftVoucherMailIdempotencyKey,
  giftVoucherMailSubject,
  giftVoucherMailTarget,
  giftVoucherPdfFilename,
  maskGiftVoucherCode,
  planGiftVoucherMailFailure,
  redactGiftVoucherMailParams,
} from "./gift-voucher-mail-core.mjs";

const STYLES = { text: "color:#000;", muted: "color:#555;", link: "color:#008ccb;" };
const CODE = "ABCDEFGHJKLMNPQR";
const TOKEN = "tok_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
const DOWNLOAD = giftVoucherDownloadUrl("https://mo.motionsports.de/", TOKEN);

/** @param {Partial<import("./gift-voucher-mail-core.mjs").GiftVoucherMailParams>} [over] */
function params(over = {}) {
  return {
    audience: /** @type {const} */ ("buyer"),
    locale: /** @type {const} */ ("de"),
    amountCents: 5000,
    number: "G-2026-00042",
    code: CODE,
    expiresOn: "2029-12-31",
    recipientName: "Lena",
    senderName: "Jonas",
    orderName: "#1001",
    downloadUrl: DOWNLOAD,
    hasAttachment: true,
    print: null,
    pageUrl: "https://www.motionsports.de/pages/gutschein",
    termsUrl: "https://www.motionsports.de/pages/gutscheinbedingungen",
    ...over,
  };
}

// ── recipient ────────────────────────────────────────────────────────────────

test("giftVoucherMailTarget: shop → buyer, admin e-mail → recipient, else no mail", () => {
  assert.deepEqual(giftVoucherMailTarget({ source: "shop", delivery: "pdf", buyerEmail: " Kaeufer@Example.de " }), {
    ok: true,
    audience: "buyer",
    to: "kaeufer@example.de",
  });
  assert.deepEqual(giftVoucherMailTarget({ source: "shop", delivery: "print", buyerEmail: null }), { ok: false, mailStatus: "skipped" });
  assert.deepEqual(giftVoucherMailTarget({ source: "shop", delivery: "pdf", buyerEmail: "kein-at" }), { ok: false, mailStatus: "skipped" });
  assert.deepEqual(giftVoucherMailTarget({ source: "admin", delivery: "email", recipientEmail: "lena@example.de", buyerEmail: "x@y.de" }), {
    ok: true,
    audience: "recipient",
    to: "lena@example.de",
  });
  assert.deepEqual(giftVoucherMailTarget({ source: "admin", delivery: "email", recipientEmail: "" }), { ok: false, mailStatus: "skipped" });
  assert.deepEqual(giftVoucherMailTarget({ source: "admin", delivery: "pdf", recipientEmail: "lena@example.de" }), { ok: false, mailStatus: "none" });
  assert.deepEqual(giftVoucherMailTarget({ source: "admin", delivery: "print" }), { ok: false, mailStatus: "none" });
});

// ── small parts ──────────────────────────────────────────────────────────────

test("subjects: buyer with the value, recipient without — de and en, never the code", () => {
  assert.equal(giftVoucherMailSubject({ audience: "buyer", locale: "de", amountCents: 5000 }), "Dein Geschenkgutschein über 50,00 € ist da");
  assert.equal(giftVoucherMailSubject({ audience: "buyer", locale: "en", amountCents: 2550 }), "Your gift voucher for €25.50 is here");
  assert.equal(giftVoucherMailSubject({ audience: "recipient", locale: "de", amountCents: 5000 }), "Ein Geschenkgutschein für dich");
  assert.equal(giftVoucherMailSubject({ audience: "recipient", locale: "en", amountCents: 5000 }), "A gift voucher for you");
  assert.equal(giftVoucherMailSubject({ audience: "buyer", locale: "fr", amountCents: 100000 }), "Dein Geschenkgutschein über 1.000,00 € ist da");
});

test("maskGiftVoucherCode: only the last four stay, idempotent", () => {
  assert.equal(maskGiftVoucherCode(CODE), "•••• •••• •••• NPQR");
  assert.equal(maskGiftVoucherCode("abcd efgh jklm npqr"), "•••• •••• •••• NPQR");
  assert.equal(maskGiftVoucherCode(maskGiftVoucherCode(CODE)), "•••• •••• •••• NPQR");
  assert.equal(maskGiftVoucherCode(""), "•••• •••• •••• ••••");
  assert.equal(maskGiftVoucherCode(null), "•••• •••• •••• ••••");
});

test("file name, date, key, download link", () => {
  assert.equal(giftVoucherPdfFilename("G-2026-00042"), "Gutschein-G-2026-00042.pdf");
  assert.equal(giftVoucherPdfFilename('G-2026-"/../x'), "Gutschein-G-2026-x.pdf");
  assert.equal(giftVoucherPdfFilename(null), "Gutschein-Geschenkgutschein.pdf");
  assert.equal(formatGiftVoucherMailDate("2029-12-31", "de"), "31.12.2029");
  assert.equal(formatGiftVoucherMailDate("2029-03-01", "en"), "1 March 2029");
  assert.equal(formatGiftVoucherMailDate("31.12.2029", "de"), null);
  assert.equal(formatGiftVoucherMailDate("2029-13-01", "de"), null);
  assert.equal(formatGiftVoucherMailDate(null, "de"), null);
  // Unique across databases: the voucher's created_at (ms) — the +00:00 microsecond JSON form parses.
  const created = "2026-11-20T10:00:00.123456+00:00";
  const ms = Date.parse("2026-11-20T10:00:00.123Z");
  assert.equal(giftVoucherMailIdempotencyKey(42, 0, created), `gift-voucher-mail-42-${ms}-0`);
  assert.equal(giftVoucherMailIdempotencyKey(42, 3, created), `gift-voucher-mail-42-${ms}-3`);
  assert.equal(giftVoucherMailIdempotencyKey(42, -1, created), `gift-voucher-mail-42-${ms}-0`);
  assert.equal(giftVoucherMailIdempotencyKey(42, 0, new Date(ms)), `gift-voucher-mail-42-${ms}-0`);
  assert.notEqual(
    giftVoucherMailIdempotencyKey(1, 0, "2026-11-20T10:00:00Z"),
    giftVoucherMailIdempotencyKey(1, 0, "2026-11-21T08:00:00Z"),
    "voucher 1 of another database is another key"
  );
  assert.equal(giftVoucherMailIdempotencyKey(42, 1, null), "gift-voucher-mail-42-0-1", "an unreadable time counts as 0");
  assert.equal(DOWNLOAD, `https://mo.motionsports.de/api/gift-vouchers/download?t=${TOKEN}`);
  assert.equal(giftVoucherDownloadUrl("https://x.de", "a b+c"), "https://x.de/api/gift-vouchers/download?t=a%20b%2Bc");
  assert.equal(GIFT_VOUCHER_MAIL_KIND, "gift_voucher");
});

test("escapeMailHtml escapes markup and quotes", () => {
  assert.equal(escapeMailHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(escapeMailHtml(null), "");
});

// ── the mail ─────────────────────────────────────────────────────────────────

test("buyer mail (de): summary, formatted code, redeem hint, download, sign-off", () => {
  const m = buildGiftVoucherMail(params(), STYLES);
  assert.equal(m.subject, "Dein Geschenkgutschein über 50,00 € ist da");
  assert.equal(m.heading, "Dein Geschenkgutschein");
  assert.doesNotMatch(m.preheader, /ABCD|NPQR/);
  for (const part of [m.text, m.bodyHtml]) {
    assert.match(part, /ABCD EFGH JKLM NPQR/);
    assert.match(part, /Für/);
    assert.match(part, /Lena/);
    assert.match(part, /Jonas/);
    assert.match(part, /50,00 €/);
    assert.match(part, /31\.12\.2029/);
    assert.match(part, /G-2026-00042/);
    assert.match(part, /#1001/);
    assert.match(part, /Code im Checkout auf motionsports\.de eingeben\. Restguthaben bleibt erhalten\. Keine Barauszahlung\./);
    assert.match(part, /PDF im Anhang/);
  }
  assert.match(m.text, /^Hallo,\n/);
  assert.ok(m.text.includes(DOWNLOAD));
  assert.match(m.text, /Guthaben prüfen: https:\/\/www\.motionsports\.de\/pages\/gutschein#guthaben/);
  assert.match(m.text, /Viele Grüße\nDein motion sports Team$/);
  assert.deepEqual(m.cta, { label: "Gutschein herunterladen (PDF)", url: DOWNLOAD });
  assert.match(m.footnoteHtml, /Behandle den Code wie Bargeld/);
  assert.match(m.footnoteHtml, /href="https:\/\/www\.motionsports\.de\/pages\/gutscheinbedingungen"/);
  assert.match(m.signOffHtml, /Bei Fragen kannst du jederzeit auf diese E-Mail antworten\./);
  assert.ok(!/undefined|null/.test(m.text), m.text);
  assert.ok(!/undefined|null/.test(m.bodyHtml));
  // The personal message is never part of the mail.
  assert.ok(!("message" in m));
});

test("buyer mail (en): English copy and date", () => {
  const m = buildGiftVoucherMail(params({ locale: "en", amountCents: 2500 }), STYLES);
  assert.equal(m.subject, "Your gift voucher for €25.00 is here");
  assert.equal(m.heading, "Your gift voucher");
  assert.match(m.text, /^Hello,\n/);
  assert.match(m.text, /Valid until: 31 December 2029/);
  assert.match(m.text, /Voucher no\.: G-2026-00042/);
  assert.match(m.text, /Your voucher code: ABCD EFGH JKLM NPQR/);
  assert.match(m.text, /How to redeem: enter the code at checkout on motionsports\.de\./);
  assert.match(m.text, /Best regards\nYour motion sports team$/);
  assert.equal(m.cta?.label, "Download voucher (PDF)");
});

test("recipient mail: greets by name, no order, no „Für“ row", () => {
  const m = buildGiftVoucherMail(
    params({ audience: "recipient", amountCents: 2500, senderName: "Dein motion sports Team", orderName: "#9" }),
    STYLES
  );
  assert.equal(m.subject, "Ein Geschenkgutschein für dich");
  assert.equal(m.heading, "Ein Geschenkgutschein für dich");
  assert.match(m.preheader, /25,00 €/);
  assert.match(m.text, /^Hallo Lena,\n/);
  assert.match(m.text, /du bekommst einen Geschenkgutschein über 25,00 €/);
  assert.match(m.text, /Von: Dein motion sports Team/);
  assert.doesNotMatch(m.text, /Bestellung/);
  assert.doesNotMatch(m.text, /^Für:/m);
  const anonymous = buildGiftVoucherMail(params({ audience: "recipient", recipientName: null }), STYLES);
  assert.match(anonymous.text, /^Hallo,\n/);
});

test("validity: unlimited when the voucher never expires", () => {
  const de = buildGiftVoucherMail(params({ expiresOn: null }), STYLES);
  assert.match(de.text, /Gültigkeit: unbegrenzt gültig/);
  assert.doesNotMatch(de.text, /Gültig bis/);
  const en = buildGiftVoucherMail(params({ expiresOn: null, locale: "en" }), STYLES);
  assert.match(en.text, /Validity: no expiry date/);
});

test("print note: with the address, generic without, absent for a PDF voucher", () => {
  const withAddress = buildGiftVoucherMail(params({ print: { name: "Lena Muster", postalCode: "12345", city: "Musterstadt" } }), STYLES);
  assert.match(
    withAddress.text,
    /Die Premium-Karte wird gedruckt und an Lena Muster in 12345 Musterstadt geschickt — meist in 3–6 Werktagen\./
  );
  assert.match(withAddress.bodyHtml, /an Lena Muster in 12345 Musterstadt/);
  const generic = buildGiftVoucherMail(params({ print: { name: null, postalCode: null, city: null } }), STYLES);
  assert.match(generic.text, /Die Premium-Karte wird gedruckt und per Post verschickt — meist in 3–6 Werktagen\./);
  const en = buildGiftVoucherMail(params({ locale: "en", print: { name: "Lena", postalCode: "12345", city: "Musterstadt" } }), STYLES);
  assert.match(en.text, /sent to Lena in 12345 Musterstadt — usually within 3–6 working days\./);
  assert.doesNotMatch(buildGiftVoucherMail(params(), STYLES).text, /Premium-Karte/);
});

test("without an attachment the copy points to the button; without both, to a reply", () => {
  const viaButton = buildGiftVoucherMail(params({ hasAttachment: false }), STYLES);
  assert.match(viaButton.text, /Über den Button unten lädst du ihn als PDF herunter/);
  assert.doesNotMatch(viaButton.text, /im Anhang/);
  const neither = buildGiftVoucherMail(params({ hasAttachment: false, downloadUrl: null }), STYLES);
  assert.match(neither.text, /auf Nachfrage/);
  assert.equal(neither.cta, null);
});

test("every typed string is escaped in the HTML (no markup, no linkified URLs)", () => {
  const m = buildGiftVoucherMail(
    params({
      recipientName: `<script>alert("x")</script>`,
      senderName: `Jonas & "Co" <b>`,
      orderName: "#1<1>",
      print: { name: `<img src=x onerror=1>`, postalCode: "12345", city: `Köln<br>` },
    }),
    STYLES
  );
  const html = m.bodyHtml + m.footnoteHtml + m.signOffHtml;
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<b>"));
  assert.ok(!html.includes("Köln<br>"));
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert.ok(html.includes("Jonas &amp; &quot;Co&quot; &lt;b&gt;"));
  assert.ok(html.includes("Köln&lt;br&gt;"));
  // Plain text keeps the raw characters (it is text).
  assert.match(m.text, /Jonas & "Co" <b>/);
});

test("the log copy: masked code, no download link or token anywhere", () => {
  const redacted = redactGiftVoucherMailParams(params());
  assert.equal(redacted.code, "•••• •••• •••• NPQR");
  const m = buildGiftVoucherMail(redacted, STYLES);
  const all = [m.subject, m.preheader, m.text, m.bodyHtml, m.footnoteHtml, m.signOffHtml].join("\n");
  assert.ok(!all.includes(CODE));
  assert.ok(!all.includes("ABCD EFGH"));
  assert.ok(!all.includes(TOKEN));
  assert.ok(!all.includes("/api/gift-vouchers/download"));
  assert.match(m.text, /•••• •••• •••• NPQR/);
  assert.match(m.text, /Download-Link \(im Mail-Protokoll ausgeblendet\)/);
  assert.equal(m.cta, null);
  // Everything else mirrors the real mail.
  assert.match(m.text, /G-2026-00042/);
  assert.match(m.text, /PDF im Anhang/);
  // A mail without a link logs no "hidden link" line.
  const noLink = buildGiftVoucherMail(redactGiftVoucherMailParams(params({ downloadUrl: null })), STYLES);
  assert.doesNotMatch(noLink.text, /ausgeblendet/);
  // Redacting twice stays redacted.
  const twice = redactGiftVoucherMailParams(redacted);
  assert.equal(twice.hadDownloadLink, true);
  assert.equal(twice.code, "•••• •••• •••• NPQR");
});

test("a redacted flag on raw params still masks the code", () => {
  const m = buildGiftVoucherMail({ ...params(), redacted: true }, STYLES);
  assert.ok(!m.text.includes("ABCD EFGH"));
  assert.ok(!m.text.includes(TOKEN));
});

// ── after a failed send ──────────────────────────────────────────────────────

const NOW = Date.parse("2026-11-20T10:00:00Z");

test("planGiftVoucherMailFailure: not configured → retry by plan, failed after the tenth", () => {
  const first = planGiftVoucherMailFailure({ skipped: true, attempts: 0, now: NOW });
  assert.equal(first.status, "pending");
  assert.equal(first.outcome, "skipped");
  assert.equal(first.countAttempt, true);
  assert.equal(first.nextAttemptAt?.getTime(), NOW + 60_000);
  assert.match(first.error, /RESEND_API_KEY/);
  const last = planGiftVoucherMailFailure({ skipped: true, attempts: 10, now: NOW });
  assert.equal(last.status, "failed");
  assert.equal(last.nextAttemptAt, null);
});

test("planGiftVoucherMailFailure: transient, rate limit, configuration → retry; invalid → failed", () => {
  const transient = planGiftVoucherMailFailure({ error: { name: "application_error", statusCode: 500, message: "boom" }, attempts: 2, now: NOW });
  assert.equal(transient.status, "pending");
  assert.equal(transient.outcome, "failed");
  assert.equal(transient.nextAttemptAt?.getTime(), NOW + 5 * 60_000);
  const network = planGiftVoucherMailFailure({ error: new TypeError("fetch failed"), attempts: 0, now: NOW });
  assert.equal(network.status, "pending");
  const rate = planGiftVoucherMailFailure({ error: { name: "rate_limit_exceeded", statusCode: 429 }, attempts: 0, now: NOW });
  assert.equal(rate.status, "pending");
  const config = planGiftVoucherMailFailure({ error: { name: "invalid_from_address", statusCode: 403 }, attempts: 0, now: NOW });
  assert.equal(config.status, "pending");
  const invalid = planGiftVoucherMailFailure({ error: { name: "validation_error", statusCode: 422, message: "Invalid `to` field." }, attempts: 0, now: NOW });
  assert.equal(invalid.status, "failed");
  assert.equal(invalid.nextAttemptAt, null);
  assert.match(invalid.error, /abgelehnt/);
  const exhausted = planGiftVoucherMailFailure({ error: { name: "application_error", statusCode: 500 }, attempts: 10, now: NOW });
  assert.equal(exhausted.status, "failed");
  assert.match(exhausted.error, /Aufgegeben nach 11 Versuchen/);
});

test("planGiftVoucherMailFailure: an idempotency conflict means the attempt went out; in flight → same key later", () => {
  const conflict = planGiftVoucherMailFailure({ error: { name: "invalid_idempotent_request", statusCode: 409 }, attempts: 1, now: NOW });
  assert.equal(conflict.status, "sent");
  assert.equal(conflict.outcome, "sent");
  assert.equal(conflict.countAttempt, true);
  const concurrent = planGiftVoucherMailFailure({ error: { name: "concurrent_idempotent_requests", statusCode: 409 }, attempts: 1, now: NOW });
  assert.equal(concurrent.status, "pending");
  assert.equal(concurrent.countAttempt, false);
  assert.equal(concurrent.nextAttemptAt?.getTime(), NOW + 2 * 60_000);
});
