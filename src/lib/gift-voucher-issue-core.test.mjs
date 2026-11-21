import { test } from "node:test";
import assert from "node:assert/strict";
import { extractGiftVoucherOrder } from "./gift-voucher-core.mjs";
import {
  GIFT_VOUCHER_REVOKE_ATTENTION,
  GIFT_VOUCHER_REVOKE_REASON_TEXT,
  adoptableGiftCard,
  giftCardNote,
  giftVoucherOrderChangeFacts,
  giftVoucherOrderHint,
  giftVoucherRevocationDecision,
  isRevocationLookupConclusive,
  isRiskWaitExpired,
  nextStepAfterCreateFailure,
  pickRevocationsToResolve,
  planGiftVoucherDeferral,
  planGiftVoucherFulfilment,
  planGiftVoucherIssueRetry,
  planGiftVoucherOrderChange,
  planGiftVoucherOrderRecord,
  revokeReasonOf,
} from "./gift-voucher-issue-core.mjs";

const VOUCHER_PRODUCT = "1001";
const PRINT_PRODUCT = "2002";
const TOKEN_A = "draftTokenAAAAAAAAAAAAAAAAAAAAAA";
const TOKEN_B = "draftTokenBBBBBBBBBBBBBBBBBBBBBB";
const NOW = Date.parse("2026-11-20T10:00:00Z");

/** A REST orders/paid payload in Shopify's shape. */
function payload(over = {}) {
  return {
    id: 5550001,
    admin_graphql_api_id: "gid://shopify/Order/5550001",
    name: "#1001",
    email: "Kaeufer@Example.de",
    test: false,
    financial_status: "paid",
    currency: "EUR",
    customer_locale: "de-DE",
    customer: { id: 777, first_name: "Kim", last_name: "Käufer", email: "kim@example.de" },
    line_items: [
      {
        id: 9001,
        admin_graphql_api_id: "gid://shopify/LineItem/9001",
        product_id: Number(VOUCHER_PRODUCT),
        variant_id: 31,
        title: "Designgutschein",
        quantity: 1,
        price: "50.00",
        price_set: { shop_money: { amount: "50.00", currency_code: "EUR" } },
        total_discount: "0.00",
        discount_allocations: [],
        properties: [{ name: "_mo_gv", value: TOKEN_A }],
      },
      {
        id: 9002,
        admin_graphql_api_id: "gid://shopify/LineItem/9002",
        product_id: Number(PRINT_PRODUCT),
        variant_id: 32,
        title: "Premium-Karte",
        quantity: 1,
        price: "4.90",
        price_set: { shop_money: { amount: "4.90", currency_code: "EUR" } },
        properties: [{ name: "_mo_gv", value: TOKEN_A }],
      },
      { id: 9003, product_id: 3003, title: "Hantel", quantity: 2, price: "20.00" },
    ],
    ...over,
  };
}

function extract(p = payload()) {
  const e = extractGiftVoucherOrder(p, { voucherProductIds: [VOUCHER_PRODUCT], printProductIds: [PRINT_PRODUCT] });
  assert.ok(e);
  return e;
}

const ADDRESS = { name: "Lena Muster", addressLine1: "Hauptstr. 1", addressLine2: null, postalCode: "12345", city: "Musterstadt", country: "DE" };

function draft(over = {}) {
  return {
    id: 11,
    token: TOKEN_A,
    designKey: "birthday",
    recipientName: "Lena",
    senderName: "Jonas",
    message: "Alles Gute!",
    photoPathname: null,
    address: ADDRESS,
    ...over,
  };
}

function plan(over = {}) {
  return planGiftVoucherOrderRecord({
    extract: extract(),
    drafts: [draft()],
    enabled: true,
    allowTestOrders: false,
    limits: { minCents: 500, maxCents: 50000 },
    reviewPrintWithPhoto: true,
    ...over,
  });
}

// ── the revocation flag ──────────────────────────────────────────────────────

test("revocation flag: keys, reasons and texts", () => {
  assert.equal(GIFT_VOUCHER_REVOKE_ATTENTION.cancelled, "cancelled_after_use");
  assert.equal(GIFT_VOUCHER_REVOKE_ATTENTION.refunded, "refund_after_use");
  assert.equal(revokeReasonOf("cancelled_after_use"), "cancelled");
  assert.equal(revokeReasonOf("refund_after_use"), "refunded");
  assert.equal(revokeReasonOf("deactivate_failed"), null);
  assert.equal(revokeReasonOf(null), null);
  assert.equal(GIFT_VOUCHER_REVOKE_REASON_TEXT.cancelled, "Bestellung storniert");
  assert.equal(GIFT_VOUCHER_REVOKE_REASON_TEXT.refunded, "Erstattet");
});

test("giftVoucherRevocationDecision: untouched → deactivate, spent → used, off in Shopify → record", () => {
  const card = { enabled: true, deactivatedAt: null, balanceCents: 5000, initialCents: 5000 };
  assert.equal(giftVoucherRevocationDecision(card), "deactivate");
  assert.equal(giftVoucherRevocationDecision({ ...card, balanceCents: 4999 }), "used");
  assert.equal(giftVoucherRevocationDecision({ ...card, balanceCents: 0 }), "used");
  assert.equal(giftVoucherRevocationDecision({ ...card, enabled: false }), "already_deactivated");
  assert.equal(giftVoucherRevocationDecision({ ...card, deactivatedAt: "2026-11-20T10:00:00Z" }), "already_deactivated");
});

test("pickRevocationsToResolve: issued + revoke flag + card, not yet found used", () => {
  const base = { status: "issued", attention: "refund_after_use", shopifyGiftCardId: "gid://shopify/GiftCard/1", balanceCents: 5000, amountCents: 5000 };
  const rows = [
    { ...base, id: 1 },
    { ...base, id: 2, balanceCents: null },
    { ...base, id: 3, balanceCents: 1200 }, // checked: used → stays for the operator
    { ...base, id: 4, attention: "print_cancel_too_late" },
    { ...base, id: 5, status: "deactivated" },
    { ...base, id: 6, shopifyGiftCardId: null },
    { ...base, id: 7, attention: "cancelled_after_use" },
  ];
  assert.deepEqual(pickRevocationsToResolve(rows).map((r) => r.id), [1, 2, 7]);
  assert.deepEqual(pickRevocationsToResolve(rows, 2).map((r) => r.id), [1, 2]);
});

test("isRevocationLookupConclusive: only two minutes after the last write", () => {
  assert.equal(isRevocationLookupConclusive({ updatedAt: new Date(NOW - 60_000).toISOString(), now: NOW }), false);
  assert.equal(isRevocationLookupConclusive({ updatedAt: new Date(NOW - 120_000).toISOString(), now: NOW }), true);
  assert.equal(isRevocationLookupConclusive({ updatedAt: null, now: NOW }), false);
});

// ── orders/paid ──────────────────────────────────────────────────────────────

test("giftVoucherOrderHint: order id and a valid draft property", () => {
  assert.deepEqual(giftVoucherOrderHint(payload()), { orderId: "5550001", hasDraftProperty: true });
  const plain = payload({ line_items: [{ id: 1, product_id: 3003, quantity: 1, properties: [{ name: "Gravur", value: "x" }] }] });
  assert.deepEqual(giftVoucherOrderHint(plain), { orderId: "5550001", hasDraftProperty: false });
  const junkToken = payload({ line_items: [{ id: 1, properties: [{ name: "_mo_gv", value: "short" }] }] });
  assert.equal(giftVoucherOrderHint(junkToken).hasDraftProperty, false);
  const mapShape = payload({ line_items: [{ id: 1, properties: { _mo_gv: ` ${TOKEN_B} ` } }] });
  assert.equal(giftVoucherOrderHint(mapShape).hasDraftProperty, true);
  assert.deepEqual(giftVoucherOrderHint(null), { orderId: null, hasDraftProperty: false });
  assert.deepEqual(giftVoucherOrderHint({ id: "x" }), { orderId: null, hasDraftProperty: false });
});

test("planGiftVoucherOrderRecord: a voucher with its Premium-Karte", () => {
  const p = plan({ reviewPrintWithPhoto: false });
  assert.equal(p.units.length, 1);
  const { row, print } = p.units[0];
  assert.deepEqual(row, {
    amountCents: 5000,
    currency: "EUR",
    shopifyOrderId: "5550001",
    shopifyOrderName: "#1001",
    shopifyLineItemId: "9001",
    unitIndex: 0,
    shopifyCustomerId: "777",
    buyerEmail: "kaeufer@example.de",
    buyerName: "Kim Käufer",
    draftId: 11,
    designKey: "birthday",
    recipientName: "Lena",
    senderName: "Jonas",
    message: "Alles Gute!",
    photoPathname: null,
    delivery: "print",
    locale: "de",
    status: "pending",
    holdReason: null,
    attention: null,
    mailStatus: "pending",
  });
  assert.deepEqual(print, { status: "queued", address: ADDRESS, paidLineItemId: "9002" });
  assert.deepEqual(p.draftIds, [11]);
  assert.deepEqual(p.unmatchedPrints, []);
  assert.deepEqual(p.skipped, []);
});

test("planGiftVoucherOrderRecord: photo cards wait for review when the setting says so", () => {
  const photo = plan({ drafts: [draft({ designKey: "photo", photoPathname: "gift-voucher-photos/abcdefghijklmnopqrstuv.jpg" })] });
  assert.equal(photo.units[0].print?.status, "review");
  const off = plan({
    reviewPrintWithPhoto: false,
    drafts: [draft({ designKey: "photo", photoPathname: "gift-voucher-photos/abcdefghijklmnopqrstuv.jpg" })],
  });
  assert.equal(off.units[0].print?.status, "queued");
});

test("planGiftVoucherOrderRecord: a paid card without an address → review + attention", () => {
  const p = plan({ drafts: [draft({ address: null })] });
  assert.equal(p.units[0].print?.status, "review");
  assert.equal(p.units[0].print?.address, null);
  assert.equal(p.units[0].row.attention, "print_without_address");
  assert.equal(p.units[0].row.delivery, "print");
});

test("planGiftVoucherOrderRecord: no draft → design defaults, order locale, PDF", () => {
  const lines = payload().line_items.filter((l) => l.id === 9001).map((l) => ({ ...l, properties: [] }));
  const p = planGiftVoucherOrderRecord({
    extract: extract(payload({ line_items: lines, customer_locale: "en-GB" })),
    drafts: [],
    enabled: true,
    allowTestOrders: false,
    limits: { minCents: 500, maxCents: 50000 },
    reviewPrintWithPhoto: true,
  });
  assert.equal(p.units.length, 1);
  assert.equal(p.units[0].row.designKey, "classic");
  assert.equal(p.units[0].row.draftId, null);
  assert.equal(p.units[0].row.recipientName, null);
  assert.equal(p.units[0].row.locale, "en");
  assert.equal(p.units[0].row.delivery, "pdf");
  assert.equal(p.units[0].print, null);
  assert.deepEqual(p.draftIds, []);
});

test("planGiftVoucherOrderRecord: one row per unit; the print line covers as many units as it pays for", () => {
  const p0 = payload();
  p0.line_items[0].quantity = 3;
  p0.line_items[1].quantity = 2;
  const p = plan({ extract: extract(p0), reviewPrintWithPhoto: false });
  assert.deepEqual(p.units.map((u) => [u.row.unitIndex, u.row.delivery, u.print?.paidLineItemId ?? null]), [
    [0, "print", "9002"],
    [1, "print", "9002"],
    [2, "pdf", null],
  ]);
});

test("planGiftVoucherOrderRecord: what the payload decides is recorded as held", () => {
  const discounted = payload();
  discounted.line_items[0].discount_allocations = [{ amount: "10.00", amount_set: { shop_money: { amount: "10.00" } } }];
  assert.deepEqual(holdOf(plan({ extract: extract(discounted) })), ["held", "discounted"]);
  assert.deepEqual(holdOf(plan({ extract: extract(payload({ test: true })) })), ["held", "test_order"]);
  assert.deepEqual(holdOf(plan({ extract: extract(payload({ test: true })), allowTestOrders: true })), ["pending", null]);
  assert.deepEqual(holdOf(plan({ enabled: false })), ["held", "disabled"]);
  assert.deepEqual(holdOf(plan({ extract: extract(payload({ currency: "USD" })) })), ["held", "currency"]);
  assert.deepEqual(holdOf(plan({ limits: { minCents: 500, maxCents: 2500 } })), ["held", "amount"]);
  // Cancelled or unpaid payloads are left to the Shopify re-read at issue time.
  assert.deepEqual(holdOf(plan({ extract: extract(payload({ financial_status: "pending", cancelled_at: "2026-11-20T10:00:00Z" })) })), [
    "pending",
    null,
  ]);
});

/** @param {ReturnType<typeof plan>} p */
function holdOf(p) {
  return [p.units[0].row.status, p.units[0].row.holdReason];
}

test("planGiftVoucherOrderRecord: a line without a price is skipped, no buyer address → mail skipped", () => {
  const p0 = payload({ email: null, contact_email: null, customer: null });
  p0.line_items[0].price = "0.00";
  p0.line_items[0].price_set = { shop_money: { amount: "0.00" } };
  const p = plan({ extract: extract(p0) });
  assert.equal(p.units.length, 0);
  assert.deepEqual(p.skipped, [{ lineItemId: "9001", unitIndex: 0, reason: "no_price" }]);
  const noMail = plan({ extract: extract(payload({ email: null, contact_email: null, customer: null })) });
  assert.equal(noMail.units[0].row.mailStatus, "skipped");
  assert.equal(noMail.units[0].row.buyerEmail, null);
});

test("planGiftVoucherOrderRecord: a print line without a voucher flags the first unit", () => {
  const p0 = payload();
  p0.line_items[1].properties = [{ name: "_mo_gv", value: TOKEN_B }]; // a card for another draft
  const p = plan({ extract: extract(p0) });
  assert.deepEqual(p.unmatchedPrints, [{ lineItemId: "9002", missing: 1 }]);
  assert.equal(p.units[0].row.attention, "print_without_voucher");
  assert.equal(p.units[0].row.delivery, "pdf");
  // Only print lines: nothing to flag, the caller reports.
  const onlyPrint = payload({ line_items: [payload().line_items[1]] });
  const q = plan({ extract: extract(onlyPrint) });
  assert.equal(q.units.length, 0);
  assert.deepEqual(q.unmatchedPrints, [{ lineItemId: "9002", missing: 1 }]);
});

/** A CHF purchase of the 50 € voucher (variant 31): shop money back-converted at the live rate. */
function chfPayload(over = {}) {
  const p0 = payload({ presentment_currency: "CHF", ...over });
  p0.line_items[0].price = "46.90";
  p0.line_items[0].price_set = {
    shop_money: { amount: "50.14", currency_code: "EUR" },
    presentment_money: { amount: "46.90", currency_code: "CHF" },
  };
  return p0;
}
const VARIANT_PRICES = new Map([["31", 5000], ["99", 2500]]);

test("planGiftVoucherOrderRecord: another presentment currency → the variant's own price (the face value)", () => {
  const p = plan({ extract: extract(chfPayload()), variantPriceCents: VARIANT_PRICES, reviewPrintWithPhoto: false });
  assert.equal(p.units[0].row.amountCents, 5000, "not the back-converted 50,14 €");
  assert.equal(p.units[0].row.currency, "EUR");
  assert.deepEqual(holdOf(p), ["pending", null]);
  // The variant is not known (no map, or another variant): held `currency` with the shop money.
  for (const variantPriceCents of [undefined, new Map([["99", 2500]])]) {
    const q = plan({ extract: extract(chfPayload()), variantPriceCents });
    assert.deepEqual(holdOf(q), ["held", "currency"]);
    assert.equal(q.units[0].row.amountCents, 5014, "the operator decides on the shop money");
  }
  // The documented order holds before `currency` stay; later ones are replaced by it.
  assert.deepEqual(holdOf(plan({ extract: extract(chfPayload({ test: true })) })), ["held", "test_order"]);
  assert.deepEqual(holdOf(plan({ extract: extract(chfPayload()), enabled: false })), ["held", "disabled"]);
  assert.deepEqual(holdOf(plan({ extract: extract(chfPayload()), limits: { minCents: 500, maxCents: 2500 } })), ["held", "currency"]);
  // With the face value known, the limits judge the face value.
  assert.deepEqual(
    holdOf(plan({ extract: extract(chfPayload()), variantPriceCents: VARIANT_PRICES, limits: { minCents: 500, maxCents: 2500 } })),
    ["held", "amount"]
  );
  // Paid in the shop currency: shop money, the variant map is not used.
  const eur = plan({ extract: extract(payload({ presentment_currency: "EUR" })), variantPriceCents: new Map([["31", 9900]]) });
  assert.equal(eur.units[0].row.amountCents, 5000);
  assert.deepEqual(holdOf(eur), ["pending", null]);
});

test("planGiftVoucherOrderRecord: a draft line on an unknown product flags the first unit without a flag", () => {
  // The paid Premium-Karte sits on another add-on product.
  const p0 = payload();
  p0.line_items[0].quantity = 2;
  p0.line_items[1].product_id = 2099;
  const p = plan({ extract: extract(p0), reviewPrintWithPhoto: false });
  assert.equal(p.units.length, 2);
  assert.deepEqual(p.units.map((u) => [u.row.delivery, u.row.attention]), [
    ["pdf", "unknown_product_line"],
    ["pdf", null],
  ]);
  // A unit that is flagged already keeps its flag; the next one takes the note.
  const q0 = payload();
  q0.line_items[0].quantity = 2;
  q0.line_items.push({ id: 9009, product_id: 2099, quantity: 1, price: "4.90", properties: [{ name: "_mo_gv", value: TOKEN_A }] });
  const q = plan({ extract: extract(q0), drafts: [draft({ address: null })] });
  assert.deepEqual(q.units.map((u) => u.row.attention), ["print_without_address", "unknown_product_line"]);
  // Every unit flagged: nothing is overwritten (the caller reports the line).
  const r0 = payload();
  r0.line_items.push({ id: 9009, product_id: 2099, quantity: 1, price: "4.90", properties: [{ name: "_mo_gv", value: TOKEN_A }] });
  const r = plan({ extract: extract(r0), drafts: [draft({ address: null })] });
  assert.deepEqual(r.units.map((u) => u.row.attention), ["print_without_address"]);
});

// ── order changes ────────────────────────────────────────────────────────────

test("giftVoucherOrderChangeFacts: id, cancellation, refunds, quantities", () => {
  const p = payload({
    refunds: [
      { refund_line_items: [{ line_item_id: 9001, quantity: 1 }] },
      { refund_line_items: [{ line_item: { admin_graphql_api_id: "gid://shopify/LineItem/9002" }, quantity: 1 }] },
    ],
  });
  const f = giftVoucherOrderChangeFacts(p, "orders/updated");
  assert.equal(f.orderId, "5550001");
  assert.equal(f.cancelled, false);
  assert.deepEqual([...f.refunded], [["9001", 1], ["9002", 1]]);
  assert.equal(f.lineQuantities.get("9001"), 1);
  assert.equal(f.lineQuantities.get("9003"), 2);
  assert.equal(giftVoucherOrderChangeFacts(payload(), "orders/cancelled").cancelled, true);
  assert.equal(giftVoucherOrderChangeFacts(payload({ cancelled_at: "2026-11-20T10:00:00Z" }), "orders/updated").cancelled, true);
  assert.equal(giftVoucherOrderChangeFacts(null, "orders/updated").orderId, null);
});

/** @param {Partial<import("./gift-voucher-issue-core.mjs").ChangeVoucher> & { id: number }} v */
function cv(v) {
  return { status: "issued", hasCode: true, shopifyLineItemId: "9001", unitIndex: 0, attention: null, ...v };
}

test("planGiftVoucherOrderChange: a cancellation revokes every unit by status", () => {
  const vouchers = [
    cv({ id: 1, status: "pending", hasCode: false, unitIndex: 0 }),
    cv({ id: 2, status: "held", hasCode: true, unitIndex: 1 }),
    cv({ id: 3, status: "issuing", unitIndex: 2 }),
    cv({ id: 4, status: "issued", unitIndex: 3 }),
    cv({ id: 5, status: "rejected", hasCode: false, unitIndex: 4 }),
    cv({ id: 6, status: "deactivated", unitIndex: 5 }),
  ];
  const jobs = [
    { id: 21, voucherId: 1, status: "queued", paidLineItemId: "9002" },
    { id: 22, voucherId: 2, status: "review", paidLineItemId: "9002" },
    { id: 24, voucherId: 4, status: "submitted", paidLineItemId: "9002" },
  ];
  const facts = { cancelled: true, refunded: new Map(), lineQuantities: new Map([["9001", 6]]) };
  const p = planGiftVoucherOrderChange({ facts, vouchers, printJobs: jobs });
  assert.equal(p.reason, "cancelled");
  assert.equal(p.attention, "cancelled_after_use");
  assert.deepEqual(p.cancel, [1]);
  assert.deepEqual(p.recheck, [{ id: 2, from: "held" }]);
  assert.deepEqual(p.flagIssuing, [3]);
  assert.deepEqual(p.flagIssued, [4]);
  assert.equal(p.revoked, 4);
  // Unissued units' jobs go at once; the issued unit's job (with the
  // printer) is cancelled through the provider — the cancelled order paid
  // for no card.
  assert.deepEqual(p.cancelJobsNow.sort(), [21, 22]);
  assert.deepEqual(p.cancelJobsLater, [24]);
});

test("planGiftVoucherOrderChange: a refund revokes the highest units of the line only", () => {
  const vouchers = [cv({ id: 1, unitIndex: 0 }), cv({ id: 2, unitIndex: 1 }), cv({ id: 3, unitIndex: 2, shopifyLineItemId: "9005" })];
  const facts = { cancelled: false, refunded: new Map([["9001", 1]]), lineQuantities: new Map([["9001", 2], ["9005", 1]]) };
  const p = planGiftVoucherOrderChange({ facts, vouchers, printJobs: [] });
  assert.equal(p.reason, "refunded");
  assert.equal(p.attention, "refund_after_use");
  assert.deepEqual(p.flagIssued, [2]);
  assert.equal(p.revoked, 1);
  assert.deepEqual(p.cancel, []);
});

test("planGiftVoucherOrderChange: an existing flag is not set again; no refund → nothing", () => {
  const flagged = [cv({ id: 1, attention: "refund_after_use" })];
  const facts = { cancelled: false, refunded: new Map([["9001", 1]]), lineQuantities: new Map([["9001", 1]]) };
  const p = planGiftVoucherOrderChange({ facts, vouchers: flagged, printJobs: [] });
  assert.deepEqual(p.flagIssued, []);
  assert.equal(p.revoked, 1);
  // A full cancellation later replaces the refund flag with the cancel flag.
  const c = planGiftVoucherOrderChange({ facts: { ...facts, cancelled: true }, vouchers: flagged, printJobs: [] });
  assert.deepEqual(c.flagIssued, [1]);
  const none = planGiftVoucherOrderChange({
    facts: { cancelled: false, refunded: new Map(), lineQuantities: new Map([["9001", 1]]) },
    vouchers: flagged,
    printJobs: [],
  });
  assert.equal(none.revoked, 0);
  assert.deepEqual([...none.cancel, ...none.flagIssued, ...none.cancelJobsNow, ...none.cancelJobsLater], []);
});

test("planGiftVoucherOrderChange: a refunded print add-on cancels its cards, revoked units' first", () => {
  const vouchers = [cv({ id: 1, unitIndex: 0 }), cv({ id: 2, unitIndex: 1 }), cv({ id: 3, unitIndex: 2 })];
  const jobs = [
    { id: 31, voucherId: 1, status: "queued", paidLineItemId: "9002" },
    { id: 32, voucherId: 2, status: "submitted", paidLineItemId: "9002" },
    { id: 33, voucherId: 3, status: "sent", paidLineItemId: "9002" },
  ];
  // Only the card of one unit refunded (the vouchers stay): the highest unit's
  // card is already posted (final) and counts; nothing else is cancelled.
  const onlyPrint = planGiftVoucherOrderChange({
    facts: { cancelled: false, refunded: new Map([["9002", 1]]), lineQuantities: new Map([["9001", 3], ["9002", 3]]) },
    vouchers,
    printJobs: jobs,
  });
  assert.equal(onlyPrint.revoked, 0);
  assert.deepEqual(onlyPrint.cancelJobsNow, []);
  assert.deepEqual(onlyPrint.cancelJobsLater, []);
  // Two cards refunded → unit 2 (posted) and unit 1 (at the printer).
  const two = planGiftVoucherOrderChange({
    facts: { cancelled: false, refunded: new Map([["9002", 2]]), lineQuantities: new Map([["9001", 3], ["9002", 3]]) },
    vouchers,
    printJobs: jobs,
  });
  assert.deepEqual(two.cancelJobsLater, [32]);
  assert.deepEqual(two.cancelJobsNow, []);
  // Voucher unit 0 and one card refunded → that unit's own card goes first.
  const paired = planGiftVoucherOrderChange({
    facts: { cancelled: false, refunded: new Map([["9001", 1], ["9002", 1]]), lineQuantities: new Map([["9001", 1], ["9002", 1]]) },
    vouchers: [cv({ id: 1, unitIndex: 0, status: "pending", hasCode: false })],
    printJobs: [jobs[0]],
  });
  assert.deepEqual(paired.cancel, [1]);
  assert.deepEqual(paired.cancelJobsNow, [31]);
  // The queued card of an ISSUED voucher may be in the print pipeline's
  // hands (a submit lease): cancelled through the provider, not directly.
  const issuedQueued = planGiftVoucherOrderChange({
    facts: { cancelled: false, refunded: new Map([["9002", 1]]), lineQuantities: new Map([["9001", 1], ["9002", 1]]) },
    vouchers: [cv({ id: 1, unitIndex: 0 })],
    printJobs: [jobs[0]],
  });
  assert.deepEqual(issuedQueued.cancelJobsNow, []);
  assert.deepEqual(issuedQueued.cancelJobsLater, [31]);
});

// ── issuing ──────────────────────────────────────────────────────────────────

test("planGiftVoucherIssueRetry: the retry plan, then hold `attempts`", () => {
  assert.deepEqual(planGiftVoucherIssueRetry({ attempts: 0, now: NOW }), { action: "retry", at: new Date(NOW + 60_000) });
  assert.deepEqual(planGiftVoucherIssueRetry({ attempts: 3, now: NOW }), { action: "retry", at: new Date(NOW + 15 * 60_000) });
  assert.deepEqual(planGiftVoucherIssueRetry({ attempts: 9, now: NOW }), { action: "retry", at: new Date(NOW + 720 * 60_000) });
  assert.deepEqual(planGiftVoucherIssueRetry({ attempts: 10, now: NOW }), { action: "hold", reason: "attempts" });
});

test("planGiftVoucherDeferral: risk in 5 minutes, unpaid every 30 minutes for 24 hours", () => {
  const risk = planGiftVoucherDeferral({ reason: "risk_pending", createdAt: new Date(NOW).toISOString(), now: NOW });
  assert.equal(risk.action, "retry");
  assert.equal(risk.action === "retry" && risk.at.getTime(), NOW + 5 * 60_000);
  const unpaid = planGiftVoucherDeferral({ reason: "not_paid", createdAt: new Date(NOW - 60 * 60_000).toISOString(), now: NOW });
  assert.equal(unpaid.action === "retry" && unpaid.at.getTime(), NOW + 30 * 60_000);
  const late = planGiftVoucherDeferral({ reason: "not_paid", createdAt: new Date(NOW - 25 * 60 * 60_000).toISOString(), now: NOW });
  assert.deepEqual(late, { action: "hold", reason: "not_paid" });
});

test("isRiskWaitExpired: minutes since the unit was recorded", () => {
  const created = new Date(NOW - 31 * 60_000).toISOString();
  assert.equal(isRiskWaitExpired({ createdAt: created, riskWaitMinutes: 30, now: NOW }), true);
  assert.equal(isRiskWaitExpired({ createdAt: created, riskWaitMinutes: 45, now: NOW }), false);
  assert.equal(isRiskWaitExpired({ createdAt: created, riskWaitMinutes: 0, now: NOW }), true);
  assert.equal(isRiskWaitExpired({ createdAt: null, riskWaitMinutes: 30, now: NOW }), true);
});

test("nextStepAfterCreateFailure and adoptableGiftCard", () => {
  assert.equal(nextStepAfterCreateFailure("taken"), "lookup");
  assert.equal(nextStepAfterCreateFailure("unknown"), "lookup");
  assert.equal(nextStepAfterCreateFailure("denied"), "retry");
  assert.equal(nextStepAfterCreateFailure("unconfigured"), "retry");
  assert.equal(nextStepAfterCreateFailure("invalid"), "fail");
  assert.equal(nextStepAfterCreateFailure("limit"), "fail");
  const card = { enabled: true, deactivatedAt: null, initialCents: 5000 };
  assert.deepEqual(adoptableGiftCard(card, 5000), { ok: true });
  assert.equal(adoptableGiftCard(card, 2500).ok, false);
  assert.equal(adoptableGiftCard({ ...card, enabled: false }, 5000).ok, false);
});

test("giftCardNote: number + order for the shop, reason for an operator's voucher", () => {
  assert.equal(giftCardNote({ number: "G-2026-00042", source: "shop", orderName: "#1001" }), "Mo-Geschenkgutschein G-2026-00042 · Bestellung #1001");
  assert.equal(giftCardNote({ number: "G-2026-00042", source: "shop", orderName: null }), "Mo-Geschenkgutschein G-2026-00042");
  assert.equal(giftCardNote({ number: "G-2026-00043", source: "admin", reason: "kulanz" }), "Mo-Geschenkgutschein G-2026-00043 · Kulanz (von Hand)");
  assert.equal(giftCardNote({ number: "G-2026-00044", source: "admin", reason: "???" }), "Mo-Geschenkgutschein G-2026-00044 · Sonstiges (von Hand)");
});

// ── fulfilment ───────────────────────────────────────────────────────────────

test("planGiftVoucherFulfilment: lines whose units are all cards; print lines once with the printer", () => {
  const issued = "2026-11-20T10:00:00Z";
  const units = [
    { id: 1, shopifyLineItemId: "L1", issuedAt: issued, fulfilledAt: null },
    { id: 2, shopifyLineItemId: "L1", issuedAt: issued, fulfilledAt: null },
    { id: 3, shopifyLineItemId: "L2", issuedAt: issued, fulfilledAt: null },
    { id: 4, shopifyLineItemId: "L2", issuedAt: null, fulfilledAt: null }, // held → L2 stays open
    { id: 5, shopifyLineItemId: "L3", issuedAt: issued, fulfilledAt: null },
    { id: 6, shopifyLineItemId: "L4", issuedAt: issued, fulfilledAt: "2026-11-20T11:00:00Z" },
  ];
  const jobs = [
    { voucherId: 1, status: "submitted", paidLineItemId: "P1" },
    { voucherId: 2, status: "sent", paidLineItemId: "P1" },
    { voucherId: 5, status: "queued", paidLineItemId: "P2" }, // card not yet with the printer
  ];
  assert.deepEqual(planGiftVoucherFulfilment(units, jobs), { lineItemIds: ["L1", "P1"], voucherIds: [1, 2] });
  // A given-up card does not block its voucher.
  const givenUp = planGiftVoucherFulfilment(units, [...jobs.slice(0, 2), { voucherId: 5, status: "cancelled", paidLineItemId: "P2" }]);
  assert.deepEqual(givenUp, { lineItemIds: ["L1", "P1", "L3"], voucherIds: [1, 2, 5] });
  assert.deepEqual(planGiftVoucherFulfilment([], []), { lineItemIds: [], voucherIds: [] });
});
