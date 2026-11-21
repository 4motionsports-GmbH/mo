import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { isValidGiftVoucherDownloadToken } from "./gift-voucher-storefront.mjs";
import {
  GIFT_VOUCHER_STATUSES,
  GIFT_VOUCHER_REASONS,
  GIFT_VOUCHER_DELIVERIES,
  GIFT_VOUCHER_MAIL_STATUSES,
  PRINT_JOB_STATUSES,
  PRINT_JOB_FINAL_STATUSES,
  GIFT_VOUCHER_DESIGN_KEYS,
  GIFT_VOUCHER_OCCASIONS,
  GIFT_VOUCHER_TONES,
  GIFT_VOUCHER_DRAFT_PROPERTY,
  GIFT_VOUCHER_TEXT_LIMITS,
  GIFT_VOUCHER_STATUS_LABELS,
  GIFT_VOUCHER_HOLD_REASON_LABELS,
  GIFT_VOUCHER_REASON_LABELS,
  PRINT_JOB_STATUS_LABELS,
  GIFT_VOUCHER_ATTENTION_LABELS,
  GIFT_VOUCHER_CODE_ALPHABET,
  generateGiftVoucherCode,
  formatGiftVoucherCode,
  normalizeGiftVoucherCode,
  giftVoucherCodeHash,
  giftVoucherCodeLast4,
  hashOpaqueToken,
  newOpaqueToken,
  giftVoucherDownloadToken,
  isValidDraftToken,
  isValidPhotoId,
  giftVoucherPhotoPathname,
  giftVoucherPhotoIdFromPathname,
  berlinYear,
  giftVoucherExpiryDate,
  formatGiftVoucherNumber,
  parseGiftVoucherNumber,
  decimalToCents,
  centsToDecimalString,
  formatEuro,
  isPlausibleEmail,
  extractGiftVoucherOrder,
  pairPrintLines,
  refundedQuantities,
  decideGiftVoucherIssue,
  decideManualGiftVoucher,
  planGiftVoucherRetry,
  PRINT_JOB_STATUS_RANK,
  canAdvancePrintJobStatus,
  isFinalPrintJobStatus,
  isGiftVoucherStatus,
  isPrintJobStatus,
  sanitizeGiftVoucherText,
  validatePostalAddress,
  giftVoucherAddressFromJson,
  giftVoucherAddressToJson,
  validateGiftVoucherDraftInput,
  giftVoucherPreviewInput,
} from "./gift-voucher-core.mjs";

// ── vocabulary ───────────────────────────────────────────────────────────────

test("vocabulary: the lists match the migration's CHECK constraints and are frozen", () => {
  assert.deepEqual([...GIFT_VOUCHER_STATUSES], ["pending", "held", "issuing", "issued", "failed", "rejected", "cancelled", "deactivated"]);
  assert.deepEqual([...GIFT_VOUCHER_REASONS], ["verkauf", "kulanz", "marketing", "gewinnspiel", "firmengeschenk", "sonstiges"]);
  assert.deepEqual([...GIFT_VOUCHER_DELIVERIES], ["pdf", "print", "email"]);
  assert.deepEqual([...GIFT_VOUCHER_MAIL_STATUSES], ["none", "pending", "sent", "failed", "skipped"]);
  assert.deepEqual([...PRINT_JOB_STATUSES], ["review", "queued", "submitting", "submitted", "printing", "sent", "failed", "cancelled", "done"]);
  assert.deepEqual([...GIFT_VOUCHER_DESIGN_KEYS], ["classic", "birthday", "christmas", "thanks", "training", "photo"]);
  assert.deepEqual([...GIFT_VOUCHER_OCCASIONS], ["geburtstag", "weihnachten", "danke", "sport", "einfach_so"]);
  assert.deepEqual([...GIFT_VOUCHER_TONES], ["herzlich", "witzig", "sportlich", "kurz"]);
  assert.equal(GIFT_VOUCHER_DRAFT_PROPERTY, "_mo_gv");
  assert.deepEqual(GIFT_VOUCHER_TEXT_LIMITS, {
    recipientName: 40, senderName: 40, message: 350, messageLines: 8, addressName: 60, addressLine: 80, city: 60,
  });
  for (const list of [GIFT_VOUCHER_STATUSES, PRINT_JOB_STATUSES, GIFT_VOUCHER_DESIGN_KEYS, GIFT_VOUCHER_TEXT_LIMITS]) {
    assert.ok(Object.isFrozen(list));
  }
});

test("vocabulary: every status, reason and print status has a German label", () => {
  for (const s of GIFT_VOUCHER_STATUSES) assert.ok(GIFT_VOUCHER_STATUS_LABELS[s], s);
  for (const r of GIFT_VOUCHER_REASONS) assert.ok(GIFT_VOUCHER_REASON_LABELS[r], r);
  for (const s of PRINT_JOB_STATUSES) assert.ok(PRINT_JOB_STATUS_LABELS[s], s);
  assert.equal(GIFT_VOUCHER_STATUS_LABELS.held, "Zu prüfen");
  assert.equal(GIFT_VOUCHER_STATUS_LABELS.deactivated, "Gesperrt");
  assert.equal(PRINT_JOB_STATUS_LABELS.done, "Erledigt (manuell)");
  assert.deepEqual(Object.keys(GIFT_VOUCHER_HOLD_REASON_LABELS), [
    "disabled", "test_order", "currency", "discounted", "amount", "risk", "daily_limit", "not_paid", "refunded", "attempts",
  ]);
  assert.equal(GIFT_VOUCHER_HOLD_REASON_LABELS.refunded, "Bestellung (teilweise) erstattet");
  assert.deepEqual(Object.keys(GIFT_VOUCHER_ATTENTION_LABELS), [
    "refund_after_use", "cancelled_after_use", "print_without_voucher", "print_without_address", "deactivate_failed", "print_cancel_too_late",
    "unknown_product_line", "refund_after_use_ok", "cancelled_after_use_ok",
  ]);
  assert.equal(GIFT_VOUCHER_ATTENTION_LABELS.unknown_product_line, "Bestellzeile mit Gutschein-Entwurf auf unbekanntem Produkt");
  assert.equal(GIFT_VOUCHER_ATTENTION_LABELS.refund_after_use_ok, "Erstattet, eingelöst — geklärt");
  assert.ok(isGiftVoucherStatus("issued"));
  assert.ok(!isGiftVoucherStatus("ISSUED"));
  assert.ok(isPrintJobStatus("printing"));
  assert.ok(!isPrintJobStatus("posted"));
});

// ── codes ────────────────────────────────────────────────────────────────────

test("code alphabet: 32 distinct symbols without 0, O, 1 and I", () => {
  assert.equal(GIFT_VOUCHER_CODE_ALPHABET.length, 32);
  assert.equal(new Set(GIFT_VOUCHER_CODE_ALPHABET).size, 32);
  assert.match(GIFT_VOUCHER_CODE_ALPHABET, /^[A-Z2-9]+$/);
  for (const c of ["0", "O", "1", "I"]) assert.ok(!GIFT_VOUCHER_CODE_ALPHABET.includes(c), c);
});

test("generateGiftVoucherCode: 16 symbols from the alphabet, a valid Shopify code", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateGiftVoucherCode();
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/);
    assert.equal(normalizeGiftVoucherCode(code), code);
  }
  assert.notEqual(generateGiftVoucherCode(), generateGiftVoucherCode());
});

test("generateGiftVoucherCode: byte % 32 is unbiased — every symbol from exactly 8 of the 256 byte values", () => {
  const counts = new Map();
  for (let start = 0; start < 256; start += 16) {
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => start + i);
    for (const ch of generateGiftVoucherCode(() => bytes)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  assert.equal(counts.size, 32);
  for (const [ch, n] of counts) assert.equal(n, 8, ch);
  // Deterministic with injected bytes.
  assert.equal(generateGiftVoucherCode(() => new Uint8Array(16)), "A".repeat(16));
  assert.equal(generateGiftVoucherCode(() => new Uint8Array(16).fill(31)), "9".repeat(16));
  assert.equal(generateGiftVoucherCode(() => new Uint8Array(16).fill(32 + 7)), "H".repeat(16));
  assert.throws(() => generateGiftVoucherCode(() => new Uint8Array(4)));
});

test("formatGiftVoucherCode: groups of four, upper-case", () => {
  assert.equal(formatGiftVoucherCode("abcdefghjklmnpqr"), "ABCD EFGH JKLM NPQR");
  assert.equal(formatGiftVoucherCode("ABCD-EFGH-JK"), "ABCD EFGH JK");
  assert.equal(formatGiftVoucherCode(""), "");
  assert.equal(formatGiftVoucherCode(null), "");
});

test("normalizeGiftVoucherCode: separators out, upper-case, 8–20 letters and digits", () => {
  assert.equal(normalizeGiftVoucherCode("abcd efgh jklm npqr"), "ABCDEFGHJKLMNPQR");
  assert.equal(normalizeGiftVoucherCode(" ABCD-EFGH.JKLM-NPQR "), "ABCDEFGHJKLMNPQR");
  assert.equal(normalizeGiftVoucherCode("ABCD\u{a0}EFGH\u{2013}JKLM\u{200b}NPQR"), "ABCDEFGHJKLMNPQR");
  assert.equal(normalizeGiftVoucherCode("abcdefgh"), "ABCDEFGH");
  assert.equal(normalizeGiftVoucherCode("a".repeat(20)), "A".repeat(20));
  assert.equal(normalizeGiftVoucherCode("abcdefg"), null);
  assert.equal(normalizeGiftVoucherCode("a".repeat(21)), null);
  assert.equal(normalizeGiftVoucherCode("ABCD_EFGH"), null);
  assert.equal(normalizeGiftVoucherCode("ABCD/EFGH"), null);
  assert.equal(normalizeGiftVoucherCode(12345678), null);
  assert.equal(normalizeGiftVoucherCode(null), null);
});

test("giftVoucherCodeHash: sha256 hex of the lower-cased normalised code; null for junk", () => {
  const expected = createHash("sha256").update("abcdefghjklmnpqr").digest("hex");
  assert.equal(giftVoucherCodeHash("ABCDEFGHJKLMNPQR"), expected);
  assert.equal(giftVoucherCodeHash("abcd efgh jklm npqr"), expected);
  assert.equal(giftVoucherCodeHash("ABCD-EFGH-JKLM-NPQR"), expected);
  assert.match(expected, /^[0-9a-f]{64}$/);
  assert.notEqual(giftVoucherCodeHash("ABCDEFGHJKLMNPQS"), expected);
  assert.equal(giftVoucherCodeHash("short"), null);
  assert.equal(giftVoucherCodeHash(undefined), null);
});

test("giftVoucherCodeLast4 and hashOpaqueToken", () => {
  assert.equal(giftVoucherCodeLast4("abcd efgh jklm npqr"), "NPQR");
  assert.equal(giftVoucherCodeLast4("nope"), null);
  assert.equal(hashOpaqueToken("tok"), createHash("sha256").update("tok").digest("hex"));
});

test("newOpaqueToken: base64url, 32 characters from 24 bytes, 22 from 16; validators", () => {
  const t = newOpaqueToken();
  assert.match(t, /^[A-Za-z0-9_-]{32}$/);
  assert.ok(isValidDraftToken(t));
  const photo = newOpaqueToken(16);
  assert.equal(photo.length, 22);
  assert.ok(isValidPhotoId(photo));
  assert.ok(!isValidDraftToken(photo), "a 22-character photo id is too short for a draft token");
  assert.notEqual(newOpaqueToken(), newOpaqueToken());
  // Deterministic and URL-safe with injected bytes (0xfb 0xff → "-_" territory).
  assert.equal(newOpaqueToken(24, () => new Uint8Array(24).fill(0xff)), "_".repeat(32));
  assert.equal(newOpaqueToken(24, () => new Uint8Array(24).fill(0xfb)), "-_v7".repeat(8));
  assert.equal(newOpaqueToken(3, () => new Uint8Array(24)).length, 32, "out-of-range sizes fall back to 24 bytes");
  for (const bad of ["", "short", "x".repeat(65), "has space".padEnd(30, "x"), "a+b/c=".padEnd(30, "x"), null, 42]) {
    assert.ok(!isValidDraftToken(bad), String(bad));
  }
  assert.ok(isValidDraftToken("A".repeat(24)));
  assert.ok(isValidDraftToken("A".repeat(64)));
  assert.ok(!isValidPhotoId("A".repeat(21)));
});

test("giftVoucherDownloadToken: derived per mail attempt — same attempt same link, next attempt rotates", () => {
  const input = { secret: "a".repeat(64), voucherId: 42, mailAttempts: 0, code: "ABCDEFGHJKLMNPQR" };
  const t = giftVoucherDownloadToken(input);
  assert.match(t, /^[A-Za-z0-9_-]{32}$/);
  assert.ok(isValidGiftVoucherDownloadToken(t), "the download route accepts it");
  // HMAC-SHA256 keyed by sha256("gift-voucher-download|<secret>") over "<id>|<attempts>|<code>", first 24 bytes.
  const key = createHash("sha256").update(`gift-voucher-download|${input.secret}`).digest();
  const expected = createHmac("sha256", key).update("42|0|ABCDEFGHJKLMNPQR").digest().subarray(0, 24).toString("base64url");
  assert.equal(t, expected);
  assert.equal(giftVoucherDownloadToken({ ...input }), t, "a repeat of the attempt rebuilds the delivered link");
  assert.notEqual(giftVoucherDownloadToken({ ...input, mailAttempts: 1 }), t, "a concluded attempt rotates it");
  assert.notEqual(giftVoucherDownloadToken({ ...input, voucherId: 43 }), t);
  assert.notEqual(giftVoucherDownloadToken({ ...input, code: "ABCDEFGHJKLMNPQS" }), t, "the key alone forges no link");
  assert.notEqual(giftVoucherDownloadToken({ ...input, secret: "b".repeat(64) }), t);
  assert.equal(giftVoucherDownloadToken({ ...input, mailAttempts: -3 }), t, "junk attempts count as 0");
  for (const secret of ["", null, undefined]) {
    assert.throws(() => giftVoucherDownloadToken({ ...input, secret: /** @type {any} */ (secret) }), /secret/);
  }
});

test("photo pathnames: only valid ids, and back", () => {
  const id = "abcdefghijklmnopqrstuv";
  assert.equal(giftVoucherPhotoPathname(id), `gift-voucher-photos/${id}.jpg`);
  assert.equal(giftVoucherPhotoPathname("../../catalog"), null);
  assert.equal(giftVoucherPhotoPathname("short"), null);
  assert.equal(giftVoucherPhotoIdFromPathname(`gift-voucher-photos/${id}.jpg`), id);
  assert.equal(giftVoucherPhotoIdFromPathname(`gift-voucher-print/${id}.jpg`), null);
  assert.equal(giftVoucherPhotoIdFromPathname(`gift-voucher-photos/${id}.png`), null);
  assert.equal(giftVoucherPhotoIdFromPathname(null), null);
});

// ── dates and numbers ────────────────────────────────────────────────────────

test("berlinYear: the shop's calendar year, also around New Year", () => {
  assert.equal(berlinYear("2026-06-01T12:00:00Z"), 2026);
  // 31.12.2026 23:30 UTC is already 01.01.2027 00:30 in Berlin (CET, UTC+1).
  assert.equal(berlinYear("2026-12-31T23:30:00Z"), 2027);
  assert.equal(berlinYear("2026-12-31T22:59:59Z"), 2026);
  assert.equal(berlinYear(new Date("2027-01-01T00:00:00+01:00")), 2027);
  assert.equal(berlinYear(Date.UTC(2025, 11, 31, 23, 0, 0)), 2026);
  assert.equal(berlinYear("not a date"), null);
  assert.equal(berlinYear(undefined), null);
});

test("giftVoucherExpiryDate: 31 December of the Berlin year + years; 0 = never", () => {
  assert.equal(giftVoucherExpiryDate("2026-11-20T10:00:00Z", 3), "2029-12-31");
  assert.equal(giftVoucherExpiryDate("2026-01-01T00:30:00+01:00", 3), "2029-12-31");
  // Bought on New Year's Eve after 23:00 UTC = already the next Berlin year.
  assert.equal(giftVoucherExpiryDate("2026-12-31T23:30:00Z", 3), "2030-12-31");
  assert.equal(giftVoucherExpiryDate("2026-12-31T22:30:00Z", 3), "2029-12-31");
  assert.equal(giftVoucherExpiryDate("2026-11-20T10:00:00Z", 1), "2027-12-31");
  assert.equal(giftVoucherExpiryDate("2026-11-20T10:00:00Z", 10), "2036-12-31");
  assert.equal(giftVoucherExpiryDate("2026-11-20T10:00:00Z", 0), null);
  assert.equal(giftVoucherExpiryDate("2026-11-20T10:00:00Z", -1), null);
  assert.equal(giftVoucherExpiryDate("2026-11-20T10:00:00Z", Number.NaN), null);
  assert.equal(giftVoucherExpiryDate("garbage", 3), null);
});

test("voucher number: G-<Berlin year>-<id padded to 5>, parsed back to the id", () => {
  assert.equal(formatGiftVoucherNumber(42, "2026-11-20T10:00:00Z"), "G-2026-00042");
  assert.equal(formatGiftVoucherNumber("7", "2026-12-31T23:30:00Z"), "G-2027-00007");
  assert.equal(formatGiftVoucherNumber(123456, "2026-03-01T10:00:00Z"), "G-2026-123456");
  assert.equal(formatGiftVoucherNumber(0, "2026-03-01T10:00:00Z"), null);
  assert.equal(formatGiftVoucherNumber(-3, "2026-03-01T10:00:00Z"), null);
  assert.equal(formatGiftVoucherNumber(1.5, "2026-03-01T10:00:00Z"), null);
  assert.equal(formatGiftVoucherNumber(42, "nope"), null);
  assert.equal(parseGiftVoucherNumber("G-2026-00042"), 42);
  assert.equal(parseGiftVoucherNumber(" g-2026-42 "), 42);
  assert.equal(parseGiftVoucherNumber("G 2026 00042"), 42);
  assert.equal(parseGiftVoucherNumber("G2026-123456"), 123456);
  assert.equal(parseGiftVoucherNumber(formatGiftVoucherNumber(987, "2027-05-05T05:05:05Z")), 987);
  for (const bad of ["2026-00042", "G-26-00042", "G-2026-", "G-2026-00000", "X-2026-00042", "G-2026-00042x", "", null, 42]) {
    assert.equal(parseGiftVoucherNumber(bad), null, String(bad));
  }
});

test("decimalToCents: exact for Shopify decimals and numbers, null for junk", () => {
  assert.equal(decimalToCents("50.00"), 5000);
  assert.equal(decimalToCents("50"), 5000);
  assert.equal(decimalToCents("49.9"), 4990);
  assert.equal(decimalToCents(50), 5000);
  assert.equal(decimalToCents(49.9), 4990);
  assert.equal(decimalToCents(0.1 + 0.2), 30);
  assert.equal(decimalToCents("0.01"), 1);
  assert.equal(decimalToCents("0.00"), 0);
  assert.equal(decimalToCents("-0.00"), 0);
  assert.equal(decimalToCents(-0), 0);
  assert.equal(decimalToCents("-10.0"), -1000);
  assert.equal(decimalToCents("+12.5"), 1250);
  assert.equal(decimalToCents(" 7.50 "), 750);
  assert.equal(decimalToCents("050.00"), 5000);
  assert.equal(decimalToCents("50.000"), 5000, "extra zero decimals are exact");
  assert.equal(decimalToCents("1000000.00"), 100000000);
  for (const junk of ["50.001", "0.005", "1e3", "50,00", "1,000.00", "", " ", "abc", "50.", ".5", "--5", "5-", "NaN", "Infinity"]) {
    assert.equal(decimalToCents(junk), null, JSON.stringify(junk));
  }
  for (const junk of [0.005, 1.234, Number.NaN, Infinity, -Infinity, 1e300, null, undefined, true, {}, [], "99999999999999999999"]) {
    assert.equal(decimalToCents(junk), null, String(junk));
  }
});

test("centsToDecimalString and formatEuro", () => {
  assert.equal(centsToDecimalString(5000), "50.00");
  assert.equal(centsToDecimalString(4990), "49.90");
  assert.equal(centsToDecimalString(5), "0.05");
  assert.equal(centsToDecimalString(0), "0.00");
  assert.equal(centsToDecimalString(-1050), "-10.50");
  assert.equal(centsToDecimalString(4999.6), "50.00");
  assert.equal(centsToDecimalString(Number.NaN), "0.00");
  assert.equal(centsToDecimalString("5000"), "0.00");
  assert.equal(decimalToCents(centsToDecimalString(123456)), 123456);

  assert.equal(formatEuro(5000), "50,00 €");
  assert.equal(formatEuro(5000, "de"), "50,00 €");
  assert.equal(formatEuro(5000, "en"), "€50.00");
  assert.equal(formatEuro(123456, "de"), "1.234,56 €");
  assert.equal(formatEuro(123456, "en"), "€1,234.56");
  assert.equal(formatEuro(100000000, "de"), "1.000.000,00 €");
  assert.equal(formatEuro(-550, "de"), "-5,50 €");
  assert.equal(formatEuro(-550, "en"), "-€5.50");
  assert.equal(formatEuro(5000, "de", { compact: true }), "50 €");
  assert.equal(formatEuro(4990, "de", { compact: true }), "49,90 €");
  assert.equal(formatEuro(250000, "en", { compact: true }), "€2,500");
  assert.equal(formatEuro(5000, "fr"), "50,00 €", "unknown locales format German");
  assert.equal(formatEuro(null), "0,00 €");
});

test("isPlausibleEmail", () => {
  for (const ok of ["lena@example.com", "a.b+c@sub.example.de"]) assert.ok(isPlausibleEmail(ok), ok);
  for (const bad of ["", "lena", "lena@", "@example.com", "lena@example", "lena@example.c", "le na@example.com", "a@b@c.de", null]) {
    assert.ok(!isPlausibleEmail(bad), String(bad));
  }
  assert.ok(!isPlausibleEmail(`${"a".repeat(250)}@example.com`));
});

// ── orders/paid ──────────────────────────────────────────────────────────────

const VOUCHER_PRODUCT = "9876543210001";
const PRINT_PRODUCT = "9876543210002";
const OTHER_PRODUCT = "9876543219999";
const TOKEN_A = "AbCdEfGhIjKlMnOpQrStUvWx12_-";
const TOKEN_B = "ZyXwVuTsRqPoNmLkJiHgFeDcBa98";
const PRODUCTS = { voucherProductIds: [VOUCHER_PRODUCT], printProductIds: [PRINT_PRODUCT] };

function money(amount, presentment = amount, currency = "EUR", presentmentCurrency = currency) {
  return {
    shop_money: { amount, currency_code: currency },
    presentment_money: { amount: presentment, currency_code: presentmentCurrency },
  };
}

/** A realistic 2026-04 orders/paid payload (fields as in Shopify's sample). */
function paidOrder(overrides = {}) {
  return {
    id: 6512345678901,
    admin_graphql_api_id: "gid://shopify/Order/6512345678901",
    name: "#1042",
    email: "Jonas.Muster@Example.com",
    contact_email: "jonas.muster@example.com",
    created_at: "2026-11-20T10:00:00+01:00",
    currency: "EUR",
    presentment_currency: "EUR",
    customer_locale: "de-DE",
    financial_status: "paid",
    cancelled_at: null,
    cancel_reason: null,
    test: false,
    total_discounts: "0.00",
    discount_codes: [],
    note_attributes: [{ name: "_mo", value: "MS5-ABCD" }],
    payment_gateway_names: ["shopify_payments"],
    customer: {
      id: 7712345678901,
      admin_graphql_api_id: "gid://shopify/Customer/7712345678901",
      email: "jonas.muster@example.com",
      first_name: "Jonas",
      last_name: "Muster",
    },
    billing_address: { first_name: "Jonas", last_name: "Muster", name: "Jonas Muster", country_code: "DE" },
    line_items: [
      {
        id: 15123456789001,
        admin_graphql_api_id: "gid://shopify/LineItem/15123456789001",
        product_id: Number(VOUCHER_PRODUCT),
        variant_id: 48123456789001,
        title: "Designgutschein",
        variant_title: "50 €",
        quantity: 2,
        current_quantity: 2,
        price: "50.00",
        price_set: money("50.00"),
        total_discount: "0.00",
        total_discount_set: money("0.00"),
        discount_allocations: [],
        gift_card: false,
        requires_shipping: false,
        taxable: false,
        properties: [
          { name: "Gutschein für", value: "Lena" },
          { name: "Motiv", value: "Geburtstag" },
          { name: "Versand", value: "Premium-Karte per Post" },
          { name: "_mo_gv", value: TOKEN_A },
        ],
      },
      {
        id: 15123456789002,
        admin_graphql_api_id: "gid://shopify/LineItem/15123456789002",
        product_id: Number(PRINT_PRODUCT),
        variant_id: 48123456789002,
        title: "Gutschein-Premiumkarte",
        variant_title: null,
        quantity: 1,
        price: "4.90",
        price_set: money("4.90"),
        discount_allocations: [],
        properties: [
          { name: "Für Gutschein an", value: "Lena" },
          { name: "_mo_gv", value: TOKEN_A },
        ],
      },
      {
        id: 15123456789003,
        admin_graphql_api_id: "gid://shopify/LineItem/15123456789003",
        product_id: Number(OTHER_PRODUCT),
        variant_id: 48123456789003,
        title: "Kettlebell 16 kg",
        quantity: 1,
        price: "39.90",
        price_set: money("39.90"),
        discount_allocations: [],
        properties: [],
      },
    ],
    refunds: [],
    ...overrides,
  };
}

test("extractGiftVoucherOrder: a realistic paid order — order info, voucher and print lines", () => {
  const r = extractGiftVoucherOrder(paidOrder(), PRODUCTS);
  assert.ok(r);
  assert.deepEqual(r.order, {
    id: "6512345678901",
    gid: "gid://shopify/Order/6512345678901",
    name: "#1042",
    email: "jonas.muster@example.com",
    test: false,
    financialStatus: "paid",
    cancelledAt: null,
    shopifyCustomerId: "7712345678901",
    customerName: "Jonas Muster",
    currency: "EUR",
    presentmentCurrency: "EUR",
    locale: "de",
  });
  assert.deepEqual(r.vouchers, [
    {
      lineItemId: "15123456789001",
      productId: VOUCHER_PRODUCT,
      variantId: "48123456789001",
      title: "Designgutschein",
      variantTitle: "50 €",
      quantity: 2,
      unitCents: 5000,
      discountCents: 0,
      draftToken: TOKEN_A,
    },
  ]);
  assert.deepEqual(r.prints, [{ lineItemId: "15123456789002", quantity: 1, unitCents: 490, draftToken: TOKEN_A }]);
  assert.deepEqual(r.unmatchedDraftLines, [], "the kettlebell carries no draft");
});

test("extractGiftVoucherOrder: no voucher product → no lines; junk → null", () => {
  const r = extractGiftVoucherOrder(paidOrder(), { voucherProductIds: ["111"], printProductIds: [] });
  assert.deepEqual(r?.vouchers, []);
  assert.deepEqual(r?.prints, []);
  assert.equal(extractGiftVoucherOrder(null, PRODUCTS), null);
  assert.equal(extractGiftVoucherOrder("x", PRODUCTS), null);
  assert.equal(extractGiftVoucherOrder({ name: "#1" }, PRODUCTS), null);
  assert.deepEqual(extractGiftVoucherOrder({ id: 5 })?.vouchers, [], "no product ids → nothing matches");
});

test("extractGiftVoucherOrder: product ids may be numbers, strings or GIDs; Sets work", () => {
  const r = extractGiftVoucherOrder(paidOrder(), {
    voucherProductIds: new Set([`gid://shopify/Product/${VOUCHER_PRODUCT}`]),
    printProductIds: [Number(PRINT_PRODUCT)],
  });
  assert.equal(r?.vouchers.length, 1);
  assert.equal(r?.prints.length, 1);
});

test("extractGiftVoucherOrder: discounts from discount_allocations (shop money), else the line total", () => {
  const order = paidOrder();
  order.line_items[0].discount_allocations = [
    { amount: "10.00", amount_set: money("10.00", "10.80", "EUR", "CHF"), discount_application_index: 0 },
    { amount: "2.50", discount_application_index: 1 },
  ];
  assert.equal(extractGiftVoucherOrder(order, PRODUCTS)?.vouchers[0].discountCents, 1250);

  const deprecatedOnly = paidOrder();
  delete deprecatedOnly.line_items[0].discount_allocations;
  deprecatedOnly.line_items[0].total_discount = "5.00";
  delete deprecatedOnly.line_items[0].total_discount_set;
  assert.equal(extractGiftVoucherOrder(deprecatedOnly, PRODUCTS)?.vouchers[0].discountCents, 500);

  const emptyAllocationsButTotal = paidOrder();
  emptyAllocationsButTotal.line_items[0].total_discount_set = money("7.00");
  assert.equal(extractGiftVoucherOrder(emptyAllocationsButTotal, PRODUCTS)?.vouchers[0].discountCents, 700, "the larger signal wins");
});

test("extractGiftVoucherOrder: price from price_set shop money (never presentment), price as fallback", () => {
  // A 50 € voucher paid as CHF 46.90: Shopify back-converts shop money at the live rate, so it is
  // rarely the face value (the record plan takes the variant's own price — gift-voucher-issue-core).
  const chf = paidOrder({ presentment_currency: "chf" });
  chf.line_items[0].price_set = money("50.14", "46.90", "EUR", "CHF");
  chf.line_items[0].price = "46.90";
  const r = extractGiftVoucherOrder(chf, PRODUCTS);
  assert.equal(r?.vouchers[0].unitCents, 5014, "shop money, never the presentment price");
  assert.equal(r?.order.currency, "EUR", "REST currency = the shop currency");
  assert.equal(r?.order.presentmentCurrency, "CHF", "what the buyer paid in, upper-case");
  assert.equal(extractGiftVoucherOrder(paidOrder({ presentment_currency: undefined }), PRODUCTS)?.order.presentmentCurrency, null);

  const plain = paidOrder();
  delete plain.line_items[0].price_set;
  plain.line_items[0].price = "25.00";
  assert.equal(extractGiftVoucherOrder(plain, PRODUCTS)?.vouchers[0].unitCents, 2500);

  const junk = paidOrder();
  delete junk.line_items[0].price_set;
  junk.line_items[0].price = "free";
  assert.equal(extractGiftVoucherOrder(junk, PRODUCTS)?.vouchers[0].unitCents, null);
});

test("extractGiftVoucherOrder: amounts never come from properties; the token must be valid", () => {
  const order = paidOrder();
  order.line_items[0].properties.push({ name: "amount", value: "500.00" }, { name: "_price", value: "1000" });
  assert.equal(extractGiftVoucherOrder(order, PRODUCTS)?.vouchers[0].unitCents, 5000);

  const badToken = paidOrder();
  badToken.line_items[0].properties = [{ name: "_mo_gv", value: "<script>" }];
  assert.equal(extractGiftVoucherOrder(badToken, PRODUCTS)?.vouchers[0].draftToken, null);

  const objectProps = paidOrder();
  objectProps.line_items[0].properties = { _mo_gv: ` ${TOKEN_B} `, "Gutschein für": "Max" };
  assert.equal(extractGiftVoucherOrder(objectProps, PRODUCTS)?.vouchers[0].draftToken, TOKEN_B);

  const none = paidOrder();
  none.line_items[0].properties = null;
  assert.equal(extractGiftVoucherOrder(none, PRODUCTS)?.vouchers[0].draftToken, null);
});

test("extractGiftVoucherOrder: test, cancelled, financial status, English locale", () => {
  const r = extractGiftVoucherOrder(
    paidOrder({ test: true, cancelled_at: "2026-11-21T09:00:00+01:00", financial_status: "PARTIALLY_REFUNDED", customer_locale: "en-US" }),
    PRODUCTS
  );
  assert.equal(r?.order.test, true);
  assert.equal(r?.order.cancelledAt, "2026-11-21T09:00:00+01:00");
  assert.equal(r?.order.financialStatus, "partially_refunded");
  assert.equal(r?.order.locale, "en");
  assert.equal(extractGiftVoucherOrder(paidOrder({ test: "true" }), PRODUCTS)?.order.test, false, "only a real true");
  assert.equal(extractGiftVoucherOrder(paidOrder({ customer_locale: null }), PRODUCTS)?.order.locale, "de");
});

test("extractGiftVoucherOrder: guest checkout — e-mail and name fallbacks", () => {
  const guest = paidOrder({ customer: null, email: "", contact_email: "Gast@Example.org" });
  const r = extractGiftVoucherOrder(guest, PRODUCTS);
  assert.equal(r?.order.shopifyCustomerId, null);
  assert.equal(r?.order.email, "gast@example.org");
  assert.equal(r?.order.customerName, "Jonas Muster", "from the billing address");
  const fromCustomer = extractGiftVoucherOrder(paidOrder({ email: null, contact_email: null }), PRODUCTS);
  assert.equal(fromCustomer?.order.email, "jonas.muster@example.com");
  const noMail = extractGiftVoucherOrder(paidOrder({ email: "kein-mail", contact_email: null, customer: { id: 5 } }), PRODUCTS);
  assert.equal(noMail?.order.email, null);
  assert.equal(noMail?.order.shopifyCustomerId, "5");
});

test("extractGiftVoucherOrder: exact ids from the GraphQL ids even beyond 2^53", () => {
  const order = paidOrder({ id: 820982911946154508, admin_graphql_api_id: "gid://shopify/Order/820982911946154508" });
  order.line_items[0].id = 487817672276298554;
  order.line_items[0].admin_graphql_api_id = "gid://shopify/LineItem/487817672276298554";
  const r = extractGiftVoucherOrder(order, PRODUCTS);
  assert.equal(r?.order.id, "820982911946154508");
  assert.equal(r?.vouchers[0].lineItemId, "487817672276298554");
});

test("extractGiftVoucherOrder: units are the quantity the line still holds (current_quantity)", () => {
  // Vorkasse: 2 × 50 € ordered, one removed by an order edit before the money came — never paid.
  const edited = paidOrder();
  edited.line_items[0].current_quantity = 1;
  edited.line_items[1].quantity = 2;
  edited.line_items[1].current_quantity = 1;
  const r = extractGiftVoucherOrder(edited, PRODUCTS);
  assert.equal(r?.vouchers[0].quantity, 1);
  assert.equal(r?.prints[0].quantity, 1, "print lines follow the same rule");
  // Everything removed → the line is skipped; a current_quantity above the quantity never adds units.
  const removed = paidOrder();
  removed.line_items[0].current_quantity = 0;
  removed.line_items[1].current_quantity = 0;
  assert.deepEqual(extractGiftVoucherOrder(removed, PRODUCTS)?.vouchers, []);
  assert.deepEqual(extractGiftVoucherOrder(removed, PRODUCTS)?.prints, []);
  const more = paidOrder();
  more.line_items[0].current_quantity = 5;
  assert.equal(extractGiftVoucherOrder(more, PRODUCTS)?.vouchers[0].quantity, 2);
  // Missing or junk current_quantity → the ordered quantity.
  for (const junk of [undefined, null, "1", -1, 1.5]) {
    const o = paidOrder();
    o.line_items[0].current_quantity = junk;
    assert.equal(extractGiftVoucherOrder(o, PRODUCTS)?.vouchers[0].quantity, 2, String(junk));
  }
});

test("extractGiftVoucherOrder: a draft token on a product Mo does not know is listed, never a voucher", () => {
  // The theme sells another product than Mo's handle names (a duplicate, a re-created product):
  // the line keeps its draft token but is neither the voucher nor the print product.
  const voucherElsewhere = paidOrder();
  voucherElsewhere.line_items[0].product_id = Number(OTHER_PRODUCT) - 1;
  const a = extractGiftVoucherOrder(voucherElsewhere, PRODUCTS);
  assert.deepEqual(a?.vouchers, []);
  assert.deepEqual(a?.unmatchedDraftLines, ["15123456789001"]);
  assert.equal(a?.prints.length, 1, "the add-on is still recognised");
  // The paid Premium-Karte on another add-on product: the voucher stays, the card line is listed.
  const printElsewhere = paidOrder();
  printElsewhere.line_items[1].product_id = Number(OTHER_PRODUCT) - 2;
  const b = extractGiftVoucherOrder(printElsewhere, PRODUCTS);
  assert.equal(b?.vouchers.length, 1);
  assert.deepEqual(b?.prints, []);
  assert.deepEqual(b?.unmatchedDraftLines, ["15123456789002"]);
  // No product id at all, a token on a removed line, an invalid token, no token: nothing listed.
  const noProduct = paidOrder();
  delete noProduct.line_items[0].product_id;
  assert.deepEqual(extractGiftVoucherOrder(noProduct, PRODUCTS)?.unmatchedDraftLines, ["15123456789001"]);
  const gone = paidOrder();
  gone.line_items[0].product_id = 1;
  gone.line_items[0].current_quantity = 0;
  assert.deepEqual(extractGiftVoucherOrder(gone, PRODUCTS)?.unmatchedDraftLines, []);
  const junkToken = paidOrder();
  junkToken.line_items[2].properties = [{ name: "_mo_gv", value: "<script>" }];
  assert.deepEqual(extractGiftVoucherOrder(junkToken, PRODUCTS)?.unmatchedDraftLines, []);
});

test("extractGiftVoucherOrder: lines without id or quantity are skipped", () => {
  const order = paidOrder();
  order.line_items[0].quantity = 0;
  order.line_items[1].admin_graphql_api_id = null;
  order.line_items[1].id = null;
  const r = extractGiftVoucherOrder(order, PRODUCTS);
  assert.deepEqual(r?.vouchers, []);
  assert.deepEqual(r?.prints, []);
});

test("pairPrintLines: a print line covers up to its quantity of units with the same token, in order", () => {
  const r = pairPrintLines(
    [
      { lineItemId: "v1", quantity: 2, draftToken: TOKEN_A },
      { lineItemId: "v2", quantity: 1, draftToken: TOKEN_B },
    ],
    [{ lineItemId: "p1", quantity: 1, draftToken: TOKEN_A }]
  );
  assert.deepEqual(r.units, [
    { lineItemId: "v1", unitIndex: 0, printLineItemId: "p1" },
    { lineItemId: "v1", unitIndex: 1, printLineItemId: null },
    { lineItemId: "v2", unitIndex: 0, printLineItemId: null },
  ]);
  assert.deepEqual(r.unmatchedPrints, []);
});

test("pairPrintLines: two print lines, surplus and token-less print lines are reported", () => {
  const r = pairPrintLines(
    [
      { lineItemId: "v1", quantity: 1, draftToken: TOKEN_A },
      { lineItemId: "v2", quantity: 2, draftToken: TOKEN_B },
      { lineItemId: "v3", quantity: 1, draftToken: null },
    ],
    [
      { lineItemId: "p1", quantity: 3, draftToken: TOKEN_B },
      { lineItemId: "p2", quantity: 1, draftToken: TOKEN_A },
      { lineItemId: "p3", quantity: 2, draftToken: null },
    ]
  );
  assert.deepEqual(r.units, [
    { lineItemId: "v1", unitIndex: 0, printLineItemId: "p2" },
    { lineItemId: "v2", unitIndex: 0, printLineItemId: "p1" },
    { lineItemId: "v2", unitIndex: 1, printLineItemId: "p1" },
    { lineItemId: "v3", unitIndex: 0, printLineItemId: null },
  ]);
  assert.deepEqual(r.unmatchedPrints, [
    { lineItemId: "p1", missing: 1 },
    { lineItemId: "p3", missing: 2 },
  ]);
});

test("pairPrintLines: a print line without any voucher; empty input", () => {
  assert.deepEqual(pairPrintLines([], [{ lineItemId: "p1", quantity: 1, draftToken: TOKEN_A }]), {
    units: [],
    unmatchedPrints: [{ lineItemId: "p1", missing: 1 }],
  });
  assert.deepEqual(pairPrintLines([], []), { units: [], unmatchedPrints: [] });
  assert.deepEqual(pairPrintLines(undefined, undefined), { units: [], unmatchedPrints: [] });
});

test("pairPrintLines works on extractGiftVoucherOrder output", () => {
  const r = extractGiftVoucherOrder(paidOrder(), PRODUCTS);
  assert.ok(r);
  const paired = pairPrintLines(r.vouchers, r.prints);
  assert.deepEqual(paired.units, [
    { lineItemId: "15123456789001", unitIndex: 0, printLineItemId: "15123456789002" },
    { lineItemId: "15123456789001", unitIndex: 1, printLineItemId: null },
  ]);
});

test("refundedQuantities: sums refund_line_items per line over every refund", () => {
  const payload = paidOrder({
    refunds: [
      {
        id: 1,
        refund_line_items: [
          { id: 11, quantity: 1, line_item_id: 15123456789001, line_item: { admin_graphql_api_id: "gid://shopify/LineItem/15123456789001" } },
          { id: 12, quantity: 1, line_item_id: 15123456789003 },
        ],
      },
      { id: 2, refund_line_items: [{ id: 13, quantity: 1, line_item_id: 15123456789001 }] },
      { id: 3, refund_line_items: [{ id: 14, quantity: 0, line_item_id: 15123456789002 }, { id: 15, quantity: "1", line_item_id: 1 }] },
      { id: 4 },
    ],
  });
  const m = refundedQuantities(payload);
  assert.equal(m.get("15123456789001"), 2);
  assert.equal(m.get("15123456789003"), 1);
  assert.equal(m.has("15123456789002"), false);
  assert.equal(m.size, 2);
  assert.equal(refundedQuantities(null).size, 0);
  assert.equal(refundedQuantities({ refunds: "x" }).size, 0);
});

// ── decisions ────────────────────────────────────────────────────────────────

const LIMITS = { minCents: 500, maxCents: 50000, dailyLimitCents: 250000 };
function issueInput(overrides = {}) {
  const base = {
    enabled: true,
    allowTestOrders: false,
    order: { test: false, cancelled: false, fullyPaid: true, financialStatus: "PAID", currency: "EUR", riskLevel: "LOW", riskRecommendation: "ACCEPT" },
    line: { unitCents: 5000, discountCents: 0 },
    limits: LIMITS,
    issuedTodayCents: 0,
    riskWaitExpired: false,
  };
  return {
    ...base,
    ...overrides,
    order: { ...base.order, ...(overrides.order ?? {}) },
    line: { ...base.line, ...(overrides.line ?? {}) },
    limits: { ...base.limits, ...(overrides.limits ?? {}) },
  };
}

test("decideGiftVoucherIssue: a clean paid order issues", () => {
  assert.deepEqual(decideGiftVoucherIssue(issueInput()), { action: "issue", reason: null });
  assert.deepEqual(decideGiftVoucherIssue(issueInput({ order: { riskLevel: "MEDIUM", riskRecommendation: "NONE" } })), { action: "issue", reason: null });
  assert.deepEqual(decideGiftVoucherIssue(issueInput({ order: { riskLevel: null, riskRecommendation: null } })), { action: "issue", reason: null });
  assert.deepEqual(decideGiftVoucherIssue(issueInput({ order: { test: true }, allowTestOrders: true })), { action: "issue", reason: null });
});

test("decideGiftVoucherIssue: every branch, one at a time", () => {
  const d = (o) => decideGiftVoucherIssue(issueInput(o));
  assert.deepEqual(d({ order: { cancelled: true } }), { action: "cancel", reason: "order_cancelled" });
  assert.deepEqual(d({ enabled: false }), { action: "hold", reason: "disabled" });
  assert.deepEqual(d({ order: { test: true } }), { action: "hold", reason: "test_order" });
  assert.deepEqual(d({ order: { fullyPaid: false } }), { action: "defer", reason: "not_paid" });
  assert.deepEqual(d({ order: { currency: "CHF" } }), { action: "hold", reason: "currency" });
  assert.deepEqual(d({ line: { discountCents: 1 } }), { action: "hold", reason: "discounted" });
  assert.deepEqual(d({ line: { unitCents: 499 } }), { action: "hold", reason: "amount" });
  assert.deepEqual(d({ line: { unitCents: 50001 } }), { action: "hold", reason: "amount" });
  assert.deepEqual(d({ line: { unitCents: null } }), { action: "hold", reason: "amount" });
  assert.deepEqual(d({ order: { riskLevel: "HIGH" } }), { action: "hold", reason: "risk" });
  assert.deepEqual(d({ order: { riskRecommendation: "CANCEL" } }), { action: "hold", reason: "risk" });
  assert.deepEqual(d({ order: { riskRecommendation: "INVESTIGATE" } }), { action: "hold", reason: "risk" });
  assert.deepEqual(d({ order: { riskLevel: "PENDING" } }), { action: "defer", reason: "risk_pending" });
  assert.deepEqual(d({ order: { riskLevel: "PENDING" }, riskWaitExpired: true }), { action: "issue", reason: null });
  assert.deepEqual(d({ issuedTodayCents: 245001 }), { action: "hold", reason: "daily_limit" });
  assert.deepEqual(d({ issuedTodayCents: 245000 }), { action: "issue", reason: null }, "exactly at the limit is fine");
  assert.deepEqual(d({ issuedTodayCents: 10_000_000, limits: { dailyLimitCents: 0 } }), { action: "issue", reason: null }, "0 = no daily limit");
  // Boundaries of the amount limits are inclusive.
  assert.deepEqual(d({ line: { unitCents: 500 } }), { action: "issue", reason: null });
  assert.deepEqual(d({ line: { unitCents: 50000 } }), { action: "issue", reason: null });
});

test("decideGiftVoucherIssue: the checks run in the documented order", () => {
  const everythingWrong = issueInput({
    enabled: false,
    order: { cancelled: true, test: true, fullyPaid: false, currency: "USD", riskLevel: "HIGH" },
    line: { unitCents: 1, discountCents: 100 },
    issuedTodayCents: 99_999_999,
  });
  const steps = [
    ["cancel", "order_cancelled", (i) => { i.order.cancelled = false; }],
    ["hold", "disabled", (i) => { i.enabled = true; }],
    ["hold", "test_order", (i) => { i.order.test = false; }],
    ["defer", "not_paid", (i) => { i.order.fullyPaid = true; }],
    ["hold", "currency", (i) => { i.order.currency = "eur"; }],
    ["hold", "discounted", (i) => { i.line.discountCents = 0; }],
    ["hold", "amount", (i) => { i.line.unitCents = 5000; }],
    ["hold", "risk", (i) => { i.order.riskLevel = "PENDING"; }],
    ["defer", "risk_pending", (i) => { i.riskWaitExpired = true; }],
    ["hold", "daily_limit", (i) => { i.issuedTodayCents = 0; }],
    ["issue", null, () => {}],
  ];
  for (const [action, reason, fix] of steps) {
    assert.deepEqual(decideGiftVoucherIssue(everythingWrong), { action, reason });
    fix(everythingWrong);
  }
});

test("decideGiftVoucherIssue: payment state falls back to the financial status; missing input holds", () => {
  const d = (order) => decideGiftVoucherIssue(issueInput({ order: { fullyPaid: null, ...order } }));
  assert.equal(d({ financialStatus: "paid" }).action, "issue");
  assert.equal(d({ financialStatus: "PARTIALLY_REFUNDED" }).action, "issue");
  assert.deepEqual(d({ financialStatus: "authorized" }), { action: "defer", reason: "not_paid" });
  assert.deepEqual(d({ financialStatus: "pending" }), { action: "defer", reason: "not_paid" });
  assert.deepEqual(d({ financialStatus: null }), { action: "defer", reason: "not_paid" });
  assert.deepEqual(decideGiftVoucherIssue(undefined), { action: "hold", reason: "disabled" });
});

test("decideManualGiftVoucher: amounts, reasons, deliveries", () => {
  const base = { amountCents: 2500, reason: "kulanz", delivery: "pdf", adminMaxCents: 25000, printCountries: ["DE"] };
  assert.deepEqual(decideManualGiftVoucher(base), { ok: true });
  const fail = (o) => decideManualGiftVoucher({ ...base, ...o });
  for (const amountCents of [0, 99, 25001, 12.5, "2500", null]) {
    const r = fail({ amountCents });
    assert.equal(r.ok, false, String(amountCents));
    assert.equal(r.field, "amountCents");
    assert.equal(r.message, "Bitte einen Betrag zwischen 1,00 € und 250,00 € angeben.");
  }
  assert.deepEqual(fail({ amountCents: 25000 }), { ok: true });
  assert.deepEqual(fail({ amountCents: 100 }), { ok: true });
  assert.equal(fail({ amountCents: 300, minCents: 500 }).ok, false);
  assert.equal(fail({ reason: "verkauf" }).field, "reason", "a sale only comes from the shop");
  assert.equal(fail({ reason: "spende" }).field, "reason");
  assert.equal(fail({ delivery: "fax" }).field, "delivery");
  assert.equal(fail({ designKey: "neon" }).field, "designKey");
  assert.equal(fail({ designKey: "photo" }).field, "designKey");
  assert.deepEqual(fail({ designKey: "christmas" }), { ok: true });
});

test("decideManualGiftVoucher: marketing is PDF only; e-mail needs an address; print needs a postal address", () => {
  const base = { amountCents: 2500, reason: "marketing", delivery: "pdf", adminMaxCents: 25000, printCountries: ["DE"] };
  assert.deepEqual(decideManualGiftVoucher(base), { ok: true });
  for (const delivery of ["email", "print"]) {
    const r = decideManualGiftVoucher({ ...base, delivery, recipientEmail: "lena@example.com" });
    assert.equal(r.ok, false);
    assert.equal(r.field, "delivery");
    assert.match(r.message, /nur als PDF/);
  }
  const email = { ...base, reason: "gewinnspiel", delivery: "email" };
  assert.equal(decideManualGiftVoucher({ ...email, recipientEmail: "kein@" }).field, "recipientEmail");
  assert.equal(decideManualGiftVoucher({ ...email }).field, "recipientEmail");
  assert.deepEqual(decideManualGiftVoucher({ ...email, recipientEmail: " Lena@Example.com " }), { ok: true });
  const print = { ...base, reason: "firmengeschenk", delivery: "print" };
  assert.equal(decideManualGiftVoucher({ ...print, address: null }).field, "address");
  assert.equal(decideManualGiftVoucher({ ...print, address: { name: "Lena", line1: "Musterweg", postalCode: "12345", city: "Musterstadt" } }).field, "address.line1");
  assert.deepEqual(
    decideManualGiftVoucher({ ...print, address: { name: "Lena", line1: "Musterweg 1", postalCode: "12345", city: "Musterstadt", country: "DE" } }),
    { ok: true }
  );
});

test("planGiftVoucherRetry: 1, 2, 5, 15, 30, 60, 120, 240, 480, 720 minutes, then give up", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(planGiftVoucherRetry), [1, 2, 5, 15, 30, 60, 120, 240, 480, 720]);
  assert.equal(planGiftVoucherRetry(11), null);
  assert.equal(planGiftVoucherRetry(50), null);
  assert.equal(planGiftVoucherRetry(0), 1);
  assert.equal(planGiftVoucherRetry(-3), 1);
  assert.equal(planGiftVoucherRetry(Number.NaN), 1);
});

test("canAdvancePrintJobStatus: forward only, finals frozen, done only from review/queued/failed", () => {
  assert.deepEqual(Object.keys(PRINT_JOB_STATUS_RANK).sort(), [...PRINT_JOB_STATUSES].sort());
  const forward = ["review", "queued", "submitting", "submitted", "printing", "sent"];
  for (let i = 0; i < forward.length; i++) {
    for (let j = 0; j < forward.length; j++) {
      assert.equal(canAdvancePrintJobStatus(forward[i], forward[j]), j > i, `${forward[i]} → ${forward[j]}`);
    }
  }
  for (const from of ["review", "queued", "submitting", "submitted", "printing"]) {
    assert.ok(canAdvancePrintJobStatus(from, "failed"), from);
    assert.ok(canAdvancePrintJobStatus(from, "cancelled"), from);
  }
  for (const from of PRINT_JOB_FINAL_STATUSES) {
    for (const to of PRINT_JOB_STATUSES) {
      const expected = to === "done" && from === "failed";
      assert.equal(canAdvancePrintJobStatus(from, to), expected, `${from} → ${to}`);
    }
  }
  assert.ok(canAdvancePrintJobStatus("review", "done"));
  assert.ok(canAdvancePrintJobStatus("queued", "done"));
  assert.ok(!canAdvancePrintJobStatus("submitted", "done"), "a job at the provider is not printed in-house");
  assert.ok(!canAdvancePrintJobStatus("printing", "submitted"), "a late webhook never moves back");
  assert.ok(!canAdvancePrintJobStatus("queued", "posted"));
  assert.ok(!canAdvancePrintJobStatus(undefined, "queued"));
  assert.ok(isFinalPrintJobStatus("sent"));
  assert.ok(!isFinalPrintJobStatus("printing"));
});

// ── text hygiene ─────────────────────────────────────────────────────────────

test("sanitizeGiftVoucherText: emoji are removed and reported", () => {
  assert.deepEqual(sanitizeGiftVoucherText("Alles Gute 🎉🎂", { max: 350, maxLines: 8 }), {
    text: "Alles Gute",
    removed: true,
    truncated: false,
  });
  // Variation selector, ZWJ sequence, skin tone and flags all go (written
  // with escapes so the invisible joiners are visible here).
  const r = sanitizeGiftVoucherText(
    "Für dich \u{2764}\u{fe0f} \u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467} \u{1f44d}\u{1f3fd} \u{1f1e9}\u{1f1ea} Danke",
    { max: 350 }
  );
  assert.equal(r.text, "Für dich Danke");
  assert.equal(r.removed, true);
  // Other scripts the fonts cannot draw are removed too.
  assert.deepEqual(sanitizeGiftVoucherText("Привет Lena", { max: 40 }), { text: "Lena", removed: true, truncated: false });
});

test("sanitizeGiftVoucherText: the printable repertoire stays untouched", () => {
  const ok = "Für Jürgen & Zoë — „50 €“ ‚danke‘, l’été… • ½ · ß ŁŚŻ ‹ok› «ja» © Žižek";
  assert.deepEqual(sanitizeGiftVoucherText(ok, { max: 350 }), { text: ok, removed: false, truncated: false });
});

test("sanitizeGiftVoucherText: the long s ſ (U+017F, no glyph in Caveat) is removed and reported", () => {
  assert.deepEqual(sanitizeGiftVoucherText("Waſſer", { max: 40 }), { text: "Waer", removed: true, truncated: false });
  assert.deepEqual(sanitizeGiftVoucherText("Liebe Grüße\nDein ſtefan", { max: 350, maxLines: 8 }), {
    text: "Liebe Grüße\nDein tefan",
    removed: true,
    truncated: false,
  });
});

test("sanitizeGiftVoucherText: controls and invisible characters go silently; look-alikes map", () => {
  const raw = "Lena\u{200b}\u{feff}\u{ad}\u{0}\u{7}\u{9f}!\tHallo\u{a0}du\u{2009}da \u{2011}x\u{2212}y\u{202e}";
  assert.deepEqual(sanitizeGiftVoucherText(raw, { max: 100 }), { text: "Lena! Hallo du da -x-y", removed: false, truncated: false });
  assert.deepEqual(sanitizeGiftVoucherText("e\u{301}te\u{301}", { max: 10 }), { text: "été", removed: false, truncated: false }, "NFC");
});

test("sanitizeGiftVoucherText: single-line fields turn newlines into spaces and collapse", () => {
  assert.deepEqual(sanitizeGiftVoucherText("  Lena \r\n  und\n\n Max  ", { max: 40 }), { text: "Lena und Max", removed: false, truncated: false });
});

test("sanitizeGiftVoucherText: messages keep lines, at most one empty line, trimmed ends", () => {
  const r = sanitizeGiftVoucherText("\n\nLiebe Lena,  \r\n\r\n\r\n   alles Gute!\u{2028}Dein Jonas\n\n\n", { max: 350, maxLines: 8 });
  assert.deepEqual(r, { text: "Liebe Lena,\n\nalles Gute!\nDein Jonas", removed: false, truncated: false });
});

test("sanitizeGiftVoucherText: lines beyond maxLines are joined onto the last one", () => {
  const r = sanitizeGiftVoucherText("1\n2\n3\n4\n5\n6\n7\n8\n9\n\n10", { max: 350, maxLines: 8 });
  assert.equal(r.text, "1\n2\n3\n4\n5\n6\n7\n8 9 10");
  assert.equal(r.text.split("\n").length, 8);
  assert.equal(r.truncated, false);
});

test("sanitizeGiftVoucherText: cut to max code points, never inside a pair", () => {
  assert.deepEqual(sanitizeGiftVoucherText("x".repeat(45), { max: 40 }), { text: "x".repeat(40), removed: false, truncated: true });
  assert.deepEqual(sanitizeGiftVoucherText("ÄÖÜ€ßéèê", { max: 5 }), { text: "ÄÖÜ€ß", removed: false, truncated: true });
  // Decomposed umlauts count once after NFC.
  assert.equal(sanitizeGiftVoucherText("A\u{308}".repeat(40), { max: 40 }).text, "Ä".repeat(40));
  assert.equal(sanitizeGiftVoucherText("A\u{308}".repeat(40), { max: 40 }).truncated, false);
  // A lone surrogate is not printable: removed, never cut in half.
  const lone = sanitizeGiftVoucherText("ab\u{d83d}cd", { max: 3 });
  assert.equal(lone.text, "abc");
  assert.equal(lone.removed, true);
  for (const ch of lone.text) assert.ok(ch.codePointAt(0) < 0xd800 || ch.codePointAt(0) > 0xdfff);
  // A cut that ends on a space is trimmed.
  assert.equal(sanitizeGiftVoucherText("abc def", { max: 4 }).text, "abc");
  assert.equal(sanitizeGiftVoucherText("abc", { max: 0 }).text, "");
});

test("sanitizeGiftVoucherText: non-strings and empty", () => {
  for (const v of [undefined, null, 5, {}, ""]) {
    assert.deepEqual(sanitizeGiftVoucherText(v), { text: "", removed: false, truncated: false });
  }
  assert.deepEqual(sanitizeGiftVoucherText("🎉"), { text: "", removed: true, truncated: false });
});

// ── addresses ────────────────────────────────────────────────────────────────

const ADDRESS = { name: "Lena Muster", line1: "Musterweg 12a", line2: "c/o Studio 3", postalCode: "80331", city: "München", country: "DE" };

test("validatePostalAddress: camelCase in, snake_case out (customers.postal_address shape)", () => {
  assert.deepEqual(validatePostalAddress(ADDRESS), {
    ok: true,
    address: {
      name: "Lena Muster",
      address_line_1: "Musterweg 12a",
      address_line_2: "c/o Studio 3",
      postal_code: "80331",
      city: "München",
      country: "DE",
    },
  });
  const snake = validatePostalAddress({
    name: " Lena Muster ", address_line_1: "Musterweg 12a", address_line_2: "", postal_code: "803 31", city: "München", country: "de",
  });
  assert.ok(snake.ok);
  assert.equal(snake.address.address_line_2, null);
  assert.equal(snake.address.postal_code, "80331");
  assert.equal(snake.address.country, "DE");
  const noCountry = validatePostalAddress({ ...ADDRESS, country: undefined });
  assert.ok(noCountry.ok && noCountry.address.country === "DE", "the only allowed country is the default");
});

test("validatePostalAddress: each field's errors, German and English", () => {
  const f = (o, opts) => validatePostalAddress({ ...ADDRESS, ...o }, opts);
  assert.deepEqual(validatePostalAddress(null), { ok: false, field: "address", message: "Bitte eine Adresse angeben." });
  assert.equal(f({ name: " " }).field, "address.name");
  assert.equal(f({ name: "x".repeat(61) }).field, "address.name");
  assert.equal(f({ name: "x".repeat(60) }).ok, true);
  assert.deepEqual(f({ line1: "Musterweg" }), { ok: false, field: "address.line1", message: "Bitte Straße und Hausnummer angeben." });
  assert.equal(f({ line1: "" }).field, "address.line1");
  assert.equal(f({ line1: `${"x".repeat(80)}1` }).field, "address.line1");
  assert.equal(f({ line2: "y".repeat(81) }).field, "address.line2");
  assert.equal(f({ postalCode: "8033" }).field, "address.postalCode");
  assert.equal(f({ postalCode: "80331x" }).field, "address.postalCode");
  assert.equal(f({ postalCode: 80331 }).field, "address.postalCode", "a number would lose leading zeros");
  assert.equal(f({ city: "" }).field, "address.city");
  assert.equal(f({ city: "z".repeat(61) }).field, "address.city");
  assert.deepEqual(f({ country: "AT" }), {
    ok: false,
    field: "address.country",
    message: "Die Karte kann nur innerhalb Deutschlands verschickt werden.",
  });
  assert.equal(f({ country: "AT" }, { locale: "en" }).message, "We can only send the card within Germany.");
  assert.equal(f({ line1: "Musterweg" }, { locale: "en" }).message, "Please enter the street and house number.");
  assert.deepEqual(f({ name: "Lena 🎉" }), {
    ok: false,
    field: "address.name",
    message: "Die Adresse enthält Zeichen, die wir nicht drucken können.",
  });
});

test("validatePostalAddress: other countries when allowed", () => {
  const at = validatePostalAddress({ ...ADDRESS, postalCode: "1010", city: "Wien", country: "AT" }, { countries: ["DE", "AT"] });
  assert.ok(at.ok);
  assert.equal(at.address.postal_code, "1010");
  const nl = validatePostalAddress({ ...ADDRESS, postalCode: "1234  ab", country: "NL" }, { countries: ["nl"] });
  assert.ok(nl.ok);
  assert.equal(nl.address.postal_code, "1234 AB");
  assert.equal(validatePostalAddress({ ...ADDRESS, country: "FR" }, { countries: ["DE", "AT"] }).message, "In dieses Land können wir die Karte nicht verschicken.");
  assert.equal(validatePostalAddress({ ...ADDRESS, country: undefined }, { countries: ["DE", "AT"] }).field, "address.country");
  assert.ok(validatePostalAddress(ADDRESS, { countries: [] }).ok, "an empty list means DE");
});

test("address JSON ⇄ store fields", () => {
  const json = { name: "Lena", address_line_1: "Musterweg 1", address_line_2: null, postal_code: "12345", city: "Musterstadt", country: "de" };
  assert.deepEqual(giftVoucherAddressFromJson(json), {
    name: "Lena", addressLine1: "Musterweg 1", addressLine2: null, postalCode: "12345", city: "Musterstadt", country: "DE",
  });
  assert.equal(giftVoucherAddressFromJson({ ...json, city: "" }), null);
  assert.equal(giftVoucherAddressFromJson(null), null);
  assert.deepEqual(giftVoucherAddressToJson({ name: "Lena", addressLine1: "Musterweg 1", addressLine2: "Hinterhaus", postalCode: "12345", city: "Musterstadt", country: "DE" }), {
    name: "Lena", address_line_1: "Musterweg 1", address_line_2: "Hinterhaus", postal_code: "12345", city: "Musterstadt", country: "DE",
  });
  assert.deepEqual(giftVoucherAddressToJson(json), { ...json, country: "DE" });
  assert.equal(giftVoucherAddressToJson({ name: "Lena" }), null);
});

// ── drafts and previews ──────────────────────────────────────────────────────

const DRAFT = {
  designKey: "birthday",
  amountCents: 5000,
  recipientName: "Lena",
  senderName: "Jonas",
  message: "Alles Gute zum Geburtstag!\nDein Jonas",
  delivery: "pdf",
  locale: "de",
};

test("validateGiftVoucherDraftInput: a PDF draft", () => {
  assert.deepEqual(validateGiftVoucherDraftInput(DRAFT), {
    ok: true,
    value: {
      designKey: "birthday",
      amountCents: 5000,
      recipientName: "Lena",
      senderName: "Jonas",
      message: "Alles Gute zum Geburtstag!\nDein Jonas",
      photoId: null,
      delivery: "pdf",
      address: null,
      locale: "de",
      textRemoved: false,
    },
  });
});

test("validateGiftVoucherDraftInput: defaults, empty texts and emoji", () => {
  const r = validateGiftVoucherDraftInput({ designKey: "classic", recipientName: "  ", senderName: null, message: "Viel Spaß 💪", locale: "fr" });
  assert.ok(r.ok);
  assert.equal(r.value.delivery, "pdf");
  assert.equal(r.value.amountCents, null);
  assert.equal(r.value.recipientName, null);
  assert.equal(r.value.senderName, null);
  assert.equal(r.value.message, "Viel Spaß");
  assert.equal(r.value.textRemoved, true);
  assert.equal(r.value.locale, "de");
  assert.equal(r.value.address, null);
});

test("validateGiftVoucherDraftInput: the Premium-Karte needs the print option and an address", () => {
  const print = { ...DRAFT, delivery: "print", address: ADDRESS };
  const r = validateGiftVoucherDraftInput(print, { allowPrint: true, countries: ["DE"] });
  assert.ok(r.ok);
  assert.equal(r.value.delivery, "print");
  assert.deepEqual(r.value.address, validatePostalAddress(ADDRESS).address);
  assert.deepEqual(validateGiftVoucherDraftInput(print, { allowPrint: false }), {
    ok: false,
    field: "delivery",
    message: "Die Premium-Karte ist gerade nicht verfügbar — bitte wähle den Versand als PDF.",
  });
  assert.equal(validateGiftVoucherDraftInput({ ...print, address: undefined }).field, "address");
  assert.equal(validateGiftVoucherDraftInput({ ...print, address: { ...ADDRESS, postalCode: "1" } }).field, "address.postalCode");
  assert.equal(
    validateGiftVoucherDraftInput({ ...print, locale: "en", address: { ...ADDRESS, postalCode: "1" } }).message,
    "Please enter a valid postcode (5 digits)."
  );
  const pdfWithAddress = validateGiftVoucherDraftInput({ ...DRAFT, address: ADDRESS });
  assert.ok(pdfWithAddress.ok && pdfWithAddress.value.address === null, "a PDF draft never keeps an address");
});

test("validateGiftVoucherDraftInput: the photo design needs a valid photo id while photos are allowed", () => {
  const photoId = "abcdefghijklmnopqrstuv";
  const ok = validateGiftVoucherDraftInput({ ...DRAFT, designKey: "photo", photoId });
  assert.ok(ok.ok && ok.value.photoId === photoId);
  assert.equal(validateGiftVoucherDraftInput({ ...DRAFT, designKey: "photo" }).field, "photoId");
  assert.equal(validateGiftVoucherDraftInput({ ...DRAFT, designKey: "photo", photoId: "../x" }).field, "photoId");
  assert.deepEqual(validateGiftVoucherDraftInput({ ...DRAFT, designKey: "photo", photoId }, { allowPhoto: false }), {
    ok: false,
    field: "designKey",
    message: "Eigene Fotos sind gerade nicht möglich — bitte ein anderes Motiv wählen.",
  });
  const other = validateGiftVoucherDraftInput({ ...DRAFT, photoId });
  assert.ok(other.ok && other.value.photoId === null, "a photo id without the photo design is ignored");
});

test("validateGiftVoucherDraftInput: rejects bad designs, amounts, deliveries and texts", () => {
  const f = (o, opts) => validateGiftVoucherDraftInput({ ...DRAFT, ...o }, opts);
  assert.deepEqual(validateGiftVoucherDraftInput(null), { ok: false, field: "body", message: "Ungültige Anfrage." });
  assert.deepEqual(validateGiftVoucherDraftInput([]), { ok: false, field: "body", message: "Ungültige Anfrage." });
  assert.equal(f({ designKey: "neon" }).field, "designKey");
  assert.equal(f({ designKey: undefined }).field, "designKey");
  assert.equal(f({ designKey: "neon", locale: "en" }).message, "Please choose a design.");
  for (const amountCents of [0, -5, 12.5, "5000", 1_000_001]) assert.equal(f({ amountCents }).field, "amountCents", String(amountCents));
  assert.equal(f({ delivery: "email" }).field, "delivery", "a shop draft is never e-mailed to someone else");
  assert.equal(f({ delivery: "fax" }).field, "delivery");
  assert.equal(f({ recipientName: 42 }).field, "recipientName");
  assert.equal(f({ recipientName: "x".repeat(41) }).field, "recipientName");
  assert.equal(f({ recipientName: "x".repeat(40) }).ok, true);
  assert.equal(f({ senderName: "y".repeat(41) }).field, "senderName");
  assert.deepEqual(f({ message: "z".repeat(351) }), { ok: false, field: "message", message: "Die Nachricht darf höchstens 350 Zeichen haben." });
  assert.equal(f({ message: "z".repeat(350) }).ok, true);
  assert.equal(f({ message: `${"z".repeat(350)}🎉` }).ok, true, "removed emoji do not count");
});

test("giftVoucherPreviewInput: the draft fields without delivery and address, plus the layout", () => {
  const r = giftVoucherPreviewInput({ ...DRAFT, delivery: "print", address: { junk: true }, layout: "square" });
  assert.deepEqual(r, {
    ok: true,
    value: {
      designKey: "birthday",
      amountCents: 5000,
      recipientName: "Lena",
      senderName: "Jonas",
      message: "Alles Gute zum Geburtstag!\nDein Jonas",
      photoId: null,
      locale: "de",
      textRemoved: false,
      layout: "square",
    },
  });
  const landscape = giftVoucherPreviewInput({ designKey: "thanks", layout: "diagonal" });
  assert.ok(landscape.ok && landscape.value.layout === "landscape");
  assert.equal(giftVoucherPreviewInput({ designKey: "photo" }).field, "photoId");
  assert.equal(giftVoucherPreviewInput({ designKey: "photo", photoId: "abcdefghijklmnopqrstuv" }, { allowPhoto: false }).field, "designKey");
  assert.equal(giftVoucherPreviewInput("x").field, "body");
});
