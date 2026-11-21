import { test } from "node:test";
import assert from "node:assert/strict";
import { extractGiftVoucherOrder } from "./gift-voucher-core.mjs";
import {
  GIFT_VOUCHER_REVOKE_ACK_ATTENTION,
  GIFT_VOUCHER_REVOKE_ATTENTION,
  GIFT_VOUCHER_REVOKE_REASON_TEXT,
  adoptableGiftCard,
  giftCardNote,
  giftVoucherOrderChangeFacts,
  giftVoucherOrderHint,
  giftVoucherRevocationDecision,
  isAcknowledgedRevocation,
  isLiveGiftVoucherUnit,
  isRevocationLookupConclusive,
  isRiskWaitExpired,
  nextStepAfterCreateFailure,
  pickRevocationsToResolve,
  planClearGiftVoucherAttention,
  planGiftVoucherDeferral,
  planGiftVoucherFulfilment,
  planGiftVoucherIssueRetry,
  planGiftVoucherOrderChange,
  planGiftVoucherOrderChangeWrites,
  planGiftVoucherOrderRecord,
  revocationSiblingCandidates,
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
  // The acknowledged form is no revocation any more.
  assert.deepEqual({ ...GIFT_VOUCHER_REVOKE_ACK_ATTENTION }, { cancelled: "cancelled_after_use_ok", refunded: "refund_after_use_ok" });
  assert.equal(revokeReasonOf("refund_after_use_ok"), null);
  assert.equal(isAcknowledgedRevocation("refund_after_use_ok"), true);
  assert.equal(isAcknowledgedRevocation("cancelled_after_use_ok"), true);
  assert.equal(isAcknowledgedRevocation("refund_after_use"), false);
  assert.equal(isAcknowledgedRevocation(null), false);
});

test("revocationSiblingCandidates: issued units of the same line with a card, no flag, the same value", () => {
  const unit = { id: 2, status: "issued", attention: "refund_after_use", shopifyGiftCardId: "gc2", shopifyLineItemId: "L1", unitIndex: 1, amountCents: 5000 };
  const units = [
    { id: 1, status: "issued", attention: null, shopifyGiftCardId: "gc1", shopifyLineItemId: "L1", unitIndex: 0, amountCents: 5000 },
    unit,
    { id: 3, status: "issued", attention: null, shopifyGiftCardId: "gc3", shopifyLineItemId: "L1", unitIndex: 2, amountCents: 5000 },
    { id: 4, status: "issued", attention: "print_cancel_too_late", shopifyGiftCardId: "gc4", shopifyLineItemId: "L1", unitIndex: 3, amountCents: 5000 },
    { id: 5, status: "deactivated", attention: null, shopifyGiftCardId: "gc5", shopifyLineItemId: "L1", unitIndex: 4, amountCents: 5000 },
    { id: 6, status: "issued", attention: null, shopifyGiftCardId: "gc6", shopifyLineItemId: "L2", unitIndex: 0, amountCents: 5000 },
    { id: 7, status: "issued", attention: null, shopifyGiftCardId: null, shopifyLineItemId: "L1", unitIndex: 5, amountCents: 5000 },
    { id: 8, status: "issued", attention: null, shopifyGiftCardId: "gc8", shopifyLineItemId: "L1", unitIndex: 6, amountCents: 2500 },
  ];
  assert.deepEqual(revocationSiblingCandidates(unit, units).map((u) => u.id), [3, 1], "highest unit first");
  assert.deepEqual(revocationSiblingCandidates({ ...unit, shopifyLineItemId: null }, units), []);
});

test("planClearGiftVoucherAttention: what „Als geklärt markieren“ does", () => {
  const issued = { status: "issued", attention: "refund_after_use", balanceCents: 5000, amountCents: 5000 };
  assert.equal(planClearGiftVoucherAttention({ ...issued, attention: null }), "none");
  assert.equal(planClearGiftVoucherAttention({ ...issued, attention: "refund_after_use_ok" }), "keep");
  assert.equal(planClearGiftVoucherAttention({ ...issued, attention: "print_without_address" }), "clear");
  assert.equal(planClearGiftVoucherAttention({ ...issued, attention: "deactivate_failed" }), "clear");
  assert.equal(planClearGiftVoucherAttention(issued), "resolve", "not checked against Shopify yet");
  assert.equal(planClearGiftVoucherAttention({ ...issued, balanceCents: null }), "resolve");
  // A refund found spent already — maybe by a balance read BEFORE the refund:
  // still checked live (an untouched sibling may take it over; the card may
  // be deactivated in Shopify meanwhile), else acknowledged.
  assert.equal(planClearGiftVoucherAttention({ ...issued, balanceCents: 3000 }), "resolve");
  // A cancellation revokes every unit: no sibling can take it.
  assert.equal(planClearGiftVoucherAttention({ ...issued, attention: "cancelled_after_use", balanceCents: 0 }), "acknowledge");
  assert.equal(planClearGiftVoucherAttention({ ...issued, attention: "cancelled_after_use", balanceCents: 5000 }), "resolve");
  for (const status of ["pending", "held", "failed", "issuing"]) {
    assert.equal(planClearGiftVoucherAttention({ ...issued, status }), "revoking", status);
  }
  for (const status of ["cancelled", "rejected", "deactivated"]) {
    assert.equal(planClearGiftVoucherAttention({ ...issued, status }), "clear", status);
  }
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
  // A flag an order change set just now is checked whatever balance is stored:
  // a balance read before the refund is no check of it.
  assert.deepEqual(pickRevocationsToResolve(rows, Infinity, [3, 4, 5, 6]).map((r) => r.id), [1, 2, 3, 7]);
  assert.deepEqual(pickRevocationsToResolve(rows, Infinity, null).map((r) => r.id), [1, 2, 7]);
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

test("giftVoucherOrderChangeFacts: id, cancellation, revoked units per line, quantities", () => {
  const p = payload({
    refunds: [
      { refund_line_items: [{ line_item_id: 9001, quantity: 1 }] },
      { refund_line_items: [{ line_item: { admin_graphql_api_id: "gid://shopify/LineItem/9002" }, quantity: 1 }] },
    ],
  });
  const f = giftVoucherOrderChangeFacts(p, "orders/updated");
  assert.equal(f.orderId, "5550001");
  assert.equal(f.cancelled, false);
  assert.deepEqual([...f.revoked], [["9001", 1], ["9002", 1]]);
  assert.equal(f.lineQuantities.get("9001"), 1);
  assert.equal(f.lineQuantities.get("9003"), 2);
  assert.equal(giftVoucherOrderChangeFacts(payload(), "orders/cancelled").cancelled, true);
  assert.equal(giftVoucherOrderChangeFacts(payload({ cancelled_at: "2026-11-20T10:00:00Z" }), "orders/updated").cancelled, true);
  assert.equal(giftVoucherOrderChangeFacts(null, "orders/updated").orderId, null);
  assert.equal(giftVoucherOrderChangeFacts(payload(), "orders/updated").revoked.size, 0, "nothing refunded, nothing removed");
});

test("giftVoucherOrderChangeFacts: one rule per line — max(refunded, quantity − current_quantity)", () => {
  const lines = (current, refunds = []) => {
    const p = payload({ refunds });
    p.line_items[0].quantity = 3;
    p.line_items[0].current_quantity = current;
    return giftVoucherOrderChangeFacts(p, "orders/updated").revoked.get("9001") ?? 0;
  };
  assert.equal(lines(2), 1, "a unit removed by an order edit after payment");
  assert.equal(lines(3, [{ refund_line_items: [{ line_item_id: 9001, quantity: 2 }] }]), 2, "refund lines without a current_quantity change");
  assert.equal(lines(1, [{ refund_line_items: [{ line_item_id: 9001, quantity: 2 }] }]), 2, "the same two units — not four");
  assert.equal(lines(0, [{ refund_line_items: [{ line_item_id: 9001, quantity: 1 }] }]), 3);
  assert.equal(lines(undefined, [{ refund_line_items: [{ line_item_id: 9001, quantity: 5 }] }]), 3, "never more than the quantity");
  // A refund line of a line the payload does not list still counts.
  const orphan = giftVoucherOrderChangeFacts(payload({ refunds: [{ refund_line_items: [{ line_item_id: 9999, quantity: 1 }] }] }), "orders/updated");
  assert.equal(orphan.revoked.get("9999"), 1);
});

test("giftVoucherOrderChangeFacts: a refunded or voided order revokes every unit (an amount-only refund lists no lines)", () => {
  for (const status of ["refunded", "REFUNDED", "voided"]) {
    const f = giftVoucherOrderChangeFacts(payload({ financial_status: status, refunds: [{ refund_line_items: [] }] }), "orders/updated");
    assert.deepEqual([...f.revoked], [["9001", 1], ["9002", 1], ["9003", 2]], status);
    assert.equal(f.cancelled, false, "the reason stays a refund");
  }
  const partly = giftVoucherOrderChangeFacts(payload({ financial_status: "partially_refunded", refunds: [{ refund_line_items: [] }] }), "orders/updated");
  assert.equal(partly.revoked.size, 0, "an amount-only PARTIAL refund stays manual");
});

/** @param {Partial<import("./gift-voucher-issue-core.mjs").ChangeVoucher> & { id: number }} v */
function cv(v) {
  return { status: "issued", hasCode: true, shopifyLineItemId: "9001", unitIndex: 0, attention: null, amountCents: 5000, balanceCents: null, ...v };
}

/** An issued unit with its Shopify card (what every issued unit has in the database). */
function cvc(v) {
  return cv({ shopifyGiftCardId: `gid://shopify/GiftCard/${v.id}`, ...v });
}

/** Facts of a refund: revoked units per line, ordered quantities. */
function refundFacts(revoked, quantities) {
  return { cancelled: false, revoked: new Map(Object.entries(revoked)), lineQuantities: new Map(Object.entries(quantities)) };
}

test("isLiveGiftVoucherUnit: what an order may still pay for", () => {
  for (const status of ["pending", "held", "failed", "issuing", "issued"]) assert.equal(isLiveGiftVoucherUnit({ status, attention: null }), true, status);
  for (const status of ["cancelled", "rejected", "deactivated"]) assert.equal(isLiveGiftVoucherUnit({ status, attention: null }), false, status);
  for (const attention of ["refund_after_use", "cancelled_after_use", "refund_after_use_ok", "cancelled_after_use_ok", "deactivate_failed"]) {
    assert.equal(isLiveGiftVoucherUnit({ status: "issued", attention }), false, attention);
  }
  for (const attention of ["print_without_address", "print_cancel_too_late", "unknown_product_line"]) {
    assert.equal(isLiveGiftVoucherUnit({ status: "issued", attention }), true, attention);
  }
});

test("planGiftVoucherOrderChange: a cancellation revokes every live unit by status", () => {
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
  const facts = { cancelled: true, revoked: new Map(), lineQuantities: new Map([["9001", 6]]) };
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

test("planGiftVoucherOrderChange: refund 1 of 2 — one unit, units without a card first, else the highest", () => {
  const issued = [cv({ id: 1, unitIndex: 0 }), cv({ id: 2, unitIndex: 1 }), cv({ id: 3, unitIndex: 0, shopifyLineItemId: "9005" })];
  const p = planGiftVoucherOrderChange({ facts: refundFacts({ 9001: 1 }, { 9001: 2, 9005: 1 }), vouchers: issued, printJobs: [] });
  assert.equal(p.reason, "refunded");
  assert.equal(p.attention, "refund_after_use");
  assert.deepEqual(p.flagIssued, [2]);
  assert.equal(p.revoked, 1);
  assert.deepEqual(p.cancel, []);
  // A unit without a card goes first (nothing is lost), then one being issued.
  const mixed = [cv({ id: 1, unitIndex: 0, status: "held", hasCode: false }), cv({ id: 2, unitIndex: 1 }), cv({ id: 3, unitIndex: 2, status: "issuing" })];
  const m = planGiftVoucherOrderChange({ facts: refundFacts({ 9001: 2 }, { 9001: 3 }), vouchers: mixed, printJobs: [] });
  assert.deepEqual([m.cancel, m.flagIssuing, m.flagIssued], [[1], [3], []]);
});

test("planGiftVoucherOrderChange: a card the stored balance shows spent is revoked last", () => {
  // The daily balance sync read unit 1's card at 30 € before the refund of one unit.
  const synced = [cv({ id: 1, unitIndex: 0, balanceCents: 5000 }), cv({ id: 2, unitIndex: 1, balanceCents: 3000 })];
  const p = planGiftVoucherOrderChange({ facts: refundFacts({ 9001: 1 }, { 9001: 2 }), vouchers: synced, printJobs: [] });
  assert.deepEqual(p.flagIssued, [1], "the untouched card, not the highest unit");
  // Not read yet (null) counts as untouched; among the untouched the highest unit.
  const unread = [cv({ id: 1, unitIndex: 0, balanceCents: null }), cv({ id: 2, unitIndex: 1, balanceCents: 0 }), cv({ id: 3, unitIndex: 2, balanceCents: 5000 })];
  assert.deepEqual(planGiftVoucherOrderChange({ facts: refundFacts({ 9001: 1 }, { 9001: 3 }), vouchers: unread, printJobs: [] }).flagIssued, [3]);
  // Two of three: both untouched ones before the spent one.
  assert.deepEqual(
    planGiftVoucherOrderChange({ facts: refundFacts({ 9001: 2 }, { 9001: 3 }), vouchers: unread, printJobs: [] }).flagIssued.sort(),
    [1, 3]
  );
  // Every card spent: the highest unit (the Shopify step looks for an untouched sibling live).
  const allSpent = [cv({ id: 1, unitIndex: 0, balanceCents: 1000 }), cv({ id: 2, unitIndex: 1, balanceCents: 3000 })];
  assert.deepEqual(planGiftVoucherOrderChange({ facts: refundFacts({ 9001: 1 }, { 9001: 2 }), vouchers: allSpent, printJobs: [] }).flagIssued, [2]);
  // A unit without a card still goes first — whatever the balances say.
  const mixed = [cv({ id: 1, unitIndex: 0, balanceCents: 5000 }), cv({ id: 2, unitIndex: 1, status: "held", hasCode: false })];
  const m = planGiftVoucherOrderChange({ facts: refundFacts({ 9001: 1 }, { 9001: 2 }), vouchers: mixed, printJobs: [] });
  assert.deepEqual([m.cancel, m.flagIssued], [[2], []]);
});

test("planGiftVoucherOrderChange: a print line edited before payment — the card never created counts as gone", () => {
  // 2 vouchers + 2 Premium-Karten ordered, one card removed by an order edit
  // before payment: orders/paid recorded ONE job (current_quantity 1).
  const p0 = payload();
  p0.line_items[0].quantity = 2;
  p0.line_items[0].current_quantity = 2;
  p0.line_items[1].quantity = 2;
  p0.line_items[1].current_quantity = 1;
  const record = plan({ extract: extract(p0), reviewPrintWithPhoto: false });
  assert.deepEqual(record.units.map((u) => u.print?.paidLineItemId ?? null), ["9002", null]);
  const vouchers = [cv({ id: 1, unitIndex: 0 }), cv({ id: 2, unitIndex: 1 })];
  const jobs = [{ id: 100, voucherId: 1, status: "queued", paidLineItemId: "9002" }];
  // Any later orders/updated without a refund keeps the one PAID card.
  const later = planGiftVoucherOrderChange({ facts: giftVoucherOrderChangeFacts({ ...p0, tags: "later" }, "orders/updated"), vouchers, printJobs: jobs });
  assert.equal(later.revoked, 0);
  assert.deepEqual([later.cancelJobsNow, later.cancelJobsLater], [[], []]);
  // The same when a voucher and its card were removed (both lines 2 → 1).
  p0.line_items[0].current_quantity = 1;
  const both = planGiftVoucherOrderChange({
    facts: giftVoucherOrderChangeFacts(p0, "orders/updated"),
    vouchers: [cv({ id: 1, unitIndex: 0 })],
    printJobs: jobs,
  });
  assert.equal(both.revoked, 0);
  assert.deepEqual([both.cancelJobsNow, both.cancelJobsLater], [[], []]);
  // A refund of that card later (current_quantity 0) cancels its job.
  p0.line_items[0].current_quantity = 2;
  p0.line_items[1].current_quantity = 0;
  p0.refunds = [{ refund_line_items: [{ line_item_id: 9002, quantity: 1 }] }];
  const refunded = planGiftVoucherOrderChange({ facts: giftVoucherOrderChangeFacts(p0, "orders/updated"), vouchers, printJobs: jobs });
  assert.equal(refunded.revoked, 0, "the vouchers stay");
  assert.deepEqual(refunded.cancelJobsLater, [100]);
});

test("planGiftVoucherOrderChange: a card already cancelled or failed counts before a live one", () => {
  const vouchers = [cv({ id: 1, unitIndex: 0 }), cv({ id: 2, unitIndex: 1 }), cv({ id: 3, unitIndex: 2 })];
  for (const given of ["cancelled", "failed"]) {
    // The operator cancelled (or print.one failed) the card of unit 0; then one card is refunded.
    const jobs = [
      { id: 31, voucherId: 1, status: given, paidLineItemId: "9002" },
      { id: 32, voucherId: 2, status: "queued", paidLineItemId: "9002" },
      { id: 33, voucherId: 3, status: "queued", paidLineItemId: "9002" },
    ];
    const p = planGiftVoucherOrderChange({ facts: refundFacts({ 9002: 1 }, { 9001: 3, 9002: 3 }), vouchers, printJobs: jobs });
    assert.deepEqual([p.cancelJobsNow, p.cancelJobsLater], [[], []], given);
    // Two refunded: that card and the highest live one.
    const two = planGiftVoucherOrderChange({ facts: refundFacts({ 9002: 2 }, { 9001: 3, 9002: 3 }), vouchers, printJobs: jobs });
    assert.deepEqual(two.cancelJobsLater, [33], given);
  }
});

test("planGiftVoucherOrderChange: planned again after a refund moved to an untouched sibling, one paid card survives", () => {
  // 2 × (voucher + Premium-Karte); one voucher and one card refunded.
  const facts = refundFacts({ 9001: 1, 9002: 1 }, { 9001: 2, 9002: 2 });
  const jobs = [
    { id: 1, voucherId: 1, status: "queued", paidLineItemId: "9002" },
    { id: 2, voucherId: 2, status: "queued", paidLineItemId: "9002" },
  ];
  // At the webhook: unit 1 (highest, not known spent) is revoked — with its card.
  const before = planGiftVoucherOrderChange({ facts, vouchers: [cv({ id: 1, unitIndex: 0 }), cv({ id: 2, unitIndex: 1 })], printJobs: jobs });
  assert.deepEqual([before.flagIssued, before.cancelJobsLater], [[2], [2]]);
  // Unit 1's card was spent: the refund moved to unit 0 (deactivated, its card cancelled).
  const after = planGiftVoucherOrderChange({
    facts,
    vouchers: [cv({ id: 1, unitIndex: 0, status: "deactivated" }), cv({ id: 2, unitIndex: 1, balanceCents: 3000 })],
    printJobs: [{ ...jobs[0], status: "cancelled" }, jobs[1]],
  });
  assert.equal(after.revoked, 0);
  assert.deepEqual([after.cancelJobsNow, after.cancelJobsLater], [[], []], "unit 1 keeps its paid card");
  // Still flagged (Shopify did not answer): the flagged unit's card stays the one to go.
  const pending = planGiftVoucherOrderChange({
    facts,
    vouchers: [cv({ id: 1, unitIndex: 0 }), cv({ id: 2, unitIndex: 1, attention: "refund_after_use" })],
    printJobs: jobs,
  });
  assert.deepEqual([pending.revoked, pending.cancelJobsLater], [0, [2]]);
});

test("planGiftVoucherOrderChange: planned again on fresh rows after a stale write was refused — the rule converges", () => {
  // X1 — one refund delivered twice. Delivery A moved it from the spent unit 1 to the untouched unit 0
  // (deactivated); delivery B, whose flag write on unit 1 was refused (the row changed), plans again: nothing more.
  const oneOfTwo = refundFacts({ 9001: 1 }, { 9001: 2 });
  const afterA = [cvc({ id: 1, unitIndex: 0, status: "deactivated" }), cvc({ id: 2, unitIndex: 1, balanceCents: 3000 })];
  const b = planGiftVoucherOrderChange({ facts: oneOfTwo, vouchers: afterA, printJobs: [] });
  assert.deepEqual([b.revoked, b.flagIssued], [0, []]);
  // X4 — 3 units; refund 1 moved from the spent unit 2 to unit 1 (deactivated); refund 2 plans again on the
  // fresh rows: the untouched unit 0 — not unit 1 (gone already), not the known-spent unit 2.
  const twoOfThree = refundFacts({ 9001: 2 }, { 9001: 3 });
  const fresh = [cvc({ id: 1, unitIndex: 0, balanceCents: 5000 }), cvc({ id: 2, unitIndex: 1, status: "deactivated" }), cvc({ id: 3, unitIndex: 2, balanceCents: 3000 })];
  assert.deepEqual(planGiftVoucherOrderChange({ facts: twoOfThree, vouchers: fresh, printJobs: [] }).flagIssued, [1]);
  // The stale plan (read while unit 2 still carried refund 1) chose unit 1 — the unit that took refund 1 meanwhile.
  const stale = [cvc({ id: 1, unitIndex: 0 }), cvc({ id: 2, unitIndex: 1 }), cvc({ id: 3, unitIndex: 2, attention: "refund_after_use" })];
  assert.deepEqual(planGiftVoucherOrderChange({ facts: twoOfThree, vouchers: stale, printJobs: [] }).flagIssued, [2]);
});

test("planGiftVoucherOrderChange: units revoked in an earlier round count as gone, their cards still go", () => {
  // Round 1 cancelled the pending unit 2 (no card yet), then a later write found its row changed; round 2
  // plans on fresh rows. Only the voucher was refunded — the add-on line's rule cancels no card.
  const facts = refundFacts({ 9001: 1 }, { 9001: 2, 9002: 2 });
  const vouchers = [cvc({ id: 1, unitIndex: 0 }), cv({ id: 2, unitIndex: 1, status: "cancelled", hasCode: false })];
  const jobs = [
    { id: 11, voucherId: 1, status: "queued", paidLineItemId: "9002" },
    { id: 12, voucherId: 2, status: "queued", paidLineItemId: "9002" },
  ];
  const round2 = planGiftVoucherOrderChange({ facts, vouchers, printJobs: jobs, revokedEarlier: [2] });
  assert.equal(round2.revoked, 0, "not revoked twice");
  assert.deepEqual([round2.cancelJobsNow, round2.cancelJobsLater], [[12], []], "the card of the cancelled unit goes, as in round 1");
  // Without the earlier round the cancelled unit is just gone: its card is left to the print sweep.
  assert.deepEqual(planGiftVoucherOrderChange({ facts, vouchers, printJobs: jobs }).cancelJobsNow, []);
  // A unit revoked earlier that became a card meanwhile is no "never a card" unit.
  const issuedMeanwhile = [cvc({ id: 1, unitIndex: 0 }), cvc({ id: 2, unitIndex: 1, attention: "refund_after_use" })];
  assert.deepEqual(planGiftVoucherOrderChange({ facts, vouchers: issuedMeanwhile, printJobs: jobs, revokedEarlier: [2] }).cancelJobsNow, []);
});

test("planGiftVoucherOrderChangeWrites: every write compare-and-set on the row as the plan read it", () => {
  const vouchers = [
    cv({ id: 1, status: "pending", hasCode: false, unitIndex: 0 }),
    cv({ id: 2, status: "held", hasCode: true, unitIndex: 1 }),
    cv({ id: 3, status: "issuing", unitIndex: 2 }),
    cvc({ id: 4, status: "issued", unitIndex: 3 }),
    cv({ id: 5, status: "failed", hasCode: false, unitIndex: 4 }),
  ];
  const facts = { cancelled: true, revoked: new Map(), lineQuantities: new Map([["9001", 5]]) };
  const plan = planGiftVoucherOrderChange({ facts, vouchers, printJobs: [] });
  const read = vouchers.map((v) => ({
    ...v,
    rowVersion: `2026-11-21T08:00:00.00000${v.id}+00:00`,
    mailStatus: v.id === 1 ? "pending" : "skipped",
  }));
  assert.deepEqual(planGiftVoucherOrderChangeWrites(plan, read), [
    { op: "cancel", id: 1, version: "2026-11-21T08:00:00.000001+00:00", mailPending: true },
    { op: "cancel", id: 5, version: "2026-11-21T08:00:00.000005+00:00", mailPending: false },
    { op: "recheck", id: 2, from: "held", version: "2026-11-21T08:00:00.000002+00:00" },
    { op: "flag", id: 3, version: "2026-11-21T08:00:00.000003+00:00" },
    { op: "flag", id: 4, version: "2026-11-21T08:00:00.000004+00:00" },
  ]);
  // A planned unit read without its version: nothing may be written on that plan.
  for (const missing of [null, undefined, ""]) {
    const without = read.map((v) => (v.id === 4 ? { ...v, rowVersion: missing } : v));
    assert.equal(planGiftVoucherOrderChangeWrites(plan, without), null, String(missing));
  }
  // A unit the plan does not touch needs no version; an empty plan writes nothing.
  const refund = planGiftVoucherOrderChange({ facts: refundFacts({ 9001: 1 }, { 9001: 2 }), vouchers: [cvc({ id: 7, unitIndex: 0 }), cvc({ id: 8, unitIndex: 1 })], printJobs: [] });
  assert.deepEqual(planGiftVoucherOrderChangeWrites(refund, [{ id: 7 }, { id: 8, rowVersion: "v8" }]), [{ op: "flag", id: 8, version: "v8" }]);
  const none = planGiftVoucherOrderChange({ facts: refundFacts({}, { 9001: 1 }), vouchers: [cvc({ id: 9 })], printJobs: [] });
  assert.deepEqual(planGiftVoucherOrderChangeWrites(none, []), []);
});

test("planGiftVoucherOrderChange: a repeated webhook revokes nothing more", () => {
  const facts = refundFacts({ 9001: 1 }, { 9001: 2 });
  // The first delivery flagged unit 1; the flag may still be open or acknowledged, or the card deactivated.
  for (const second of [cv({ id: 2, unitIndex: 1, attention: "refund_after_use" }), cv({ id: 2, unitIndex: 1, attention: "refund_after_use_ok" }), cv({ id: 2, unitIndex: 1, status: "deactivated" }), cv({ id: 2, unitIndex: 1, attention: "deactivate_failed" })]) {
    const p = planGiftVoucherOrderChange({ facts, vouchers: [cv({ id: 1, unitIndex: 0 }), second], printJobs: [] });
    assert.equal(p.revoked, 0, `${second.status}/${second.attention}`);
    assert.deepEqual([...p.cancel, ...p.flagIssued, ...p.flagIssuing, ...p.cancelJobsNow, ...p.cancelJobsLater], []);
  }
  // The refund moved to an untouched sibling (unit 0 deactivated, unit 1 back to normal): still nothing.
  const moved = [cv({ id: 1, unitIndex: 0, status: "deactivated" }), cv({ id: 2, unitIndex: 1 })];
  assert.equal(planGiftVoucherOrderChange({ facts, vouchers: moved, printJobs: [] }).revoked, 0);
  // A cancellation later revokes the rest — an existing refund flag stays as it is.
  const later = planGiftVoucherOrderChange({
    facts: { ...facts, cancelled: true },
    vouchers: [cv({ id: 1, unitIndex: 0 }), cv({ id: 2, unitIndex: 1, attention: "refund_after_use" })],
    printJobs: [],
  });
  assert.deepEqual(later.flagIssued, [1]);
  assert.equal(later.attention, "cancelled_after_use");
});

test("planGiftVoucherOrderChange: a unit removed before payment was never created — a refund after it revokes nothing", () => {
  // 2 ordered, 1 removed by an order edit before payment: only unit 0 exists (current_quantity 1).
  const p0 = payload();
  p0.line_items[0].quantity = 2;
  p0.line_items[0].current_quantity = 1;
  // A later delivery lists one refunded unit — the removed one: current_quantity is still 1.
  p0.refunds = [{ refund_line_items: [{ line_item_id: 9001, quantity: 1 }] }];
  const facts = giftVoucherOrderChangeFacts(p0, "orders/updated");
  const p = planGiftVoucherOrderChange({ facts, vouchers: [cv({ id: 1, unitIndex: 0 })], printJobs: [] });
  assert.equal(p.revoked, 0, "the paid unit stays");
  // Removed after payment (both units exist): the removal revokes one.
  const q = planGiftVoucherOrderChange({ facts, vouchers: [cv({ id: 1, unitIndex: 0 }), cv({ id: 2, unitIndex: 1 })], printJobs: [] });
  assert.deepEqual(q.flagIssued, [2]);
});

test("planGiftVoucherOrderChange: an amount-only full refund revokes every unit", () => {
  const p0 = payload({ financial_status: "refunded", refunds: [{ refund_line_items: [], transactions: [{ kind: "refund", amount: "54.90" }] }] });
  p0.line_items[0].quantity = 2;
  const facts = giftVoucherOrderChangeFacts(p0, "orders/updated");
  const jobs = [{ id: 31, voucherId: 1, status: "queued", paidLineItemId: "9002" }];
  const p = planGiftVoucherOrderChange({ facts, vouchers: [cv({ id: 1, unitIndex: 0 }), cv({ id: 2, unitIndex: 1, status: "pending", hasCode: false })], printJobs: jobs });
  assert.equal(p.reason, "refunded");
  assert.deepEqual(p.cancel, [2]);
  assert.deepEqual(p.flagIssued, [1]);
  assert.equal(p.revoked, 2);
  assert.deepEqual(p.cancelJobsLater, [31], "the card of the issued unit goes through the provider");
});

test("planGiftVoucherOrderChange: no refund → nothing", () => {
  const none = planGiftVoucherOrderChange({ facts: refundFacts({}, { 9001: 1 }), vouchers: [cv({ id: 1 })], printJobs: [] });
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
  const onlyPrint = planGiftVoucherOrderChange({ facts: refundFacts({ 9002: 1 }, { 9001: 3, 9002: 3 }), vouchers, printJobs: jobs });
  assert.equal(onlyPrint.revoked, 0);
  assert.deepEqual(onlyPrint.cancelJobsNow, []);
  assert.deepEqual(onlyPrint.cancelJobsLater, []);
  // Two cards refunded → unit 2 (posted) and unit 1 (at the printer).
  const two = planGiftVoucherOrderChange({ facts: refundFacts({ 9002: 2 }, { 9001: 3, 9002: 3 }), vouchers, printJobs: jobs });
  assert.deepEqual(two.cancelJobsLater, [32]);
  assert.deepEqual(two.cancelJobsNow, []);
  // Voucher unit 0 and one card refunded → that unit's own card goes first.
  const paired = planGiftVoucherOrderChange({
    facts: refundFacts({ 9001: 1, 9002: 1 }, { 9001: 1, 9002: 1 }),
    vouchers: [cv({ id: 1, unitIndex: 0, status: "pending", hasCode: false })],
    printJobs: [jobs[0]],
  });
  assert.deepEqual(paired.cancel, [1]);
  assert.deepEqual(paired.cancelJobsNow, [31]);
  // The card of a unit revoked EARLIER also goes first (a stable choice across deliveries).
  const earlier = planGiftVoucherOrderChange({
    facts: refundFacts({ 9001: 1, 9002: 1 }, { 9001: 3, 9002: 3 }),
    vouchers: [cv({ id: 1, unitIndex: 0, status: "deactivated" }), cv({ id: 2, unitIndex: 1 }), cv({ id: 3, unitIndex: 2 })],
    printJobs: jobs,
  });
  assert.equal(earlier.revoked, 0);
  assert.deepEqual(earlier.cancelJobsLater, [31]);
  // The queued card of an ISSUED voucher may be in the print pipeline's
  // hands (a submit lease): cancelled through the provider, not directly.
  const issuedQueued = planGiftVoucherOrderChange({ facts: refundFacts({ 9002: 1 }, { 9001: 1, 9002: 1 }), vouchers: [cv({ id: 1, unitIndex: 0 })], printJobs: [jobs[0]] });
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
