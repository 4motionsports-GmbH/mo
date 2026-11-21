import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNTRY_NAMES,
  DEFAULT_ADMIN_SENDER,
  GUTSCHEINE_PAGE_SIZE,
  GUTSCHEINE_STATUS_FILTERS,
  GUTSCHEIN_ACTIONS,
  MANUAL_REASON_OPTIONS,
  actionErrorStatus,
  PRINT_ADDRESS_REFUSALS,
  PRINT_BLOB_MISSING,
  activeGutscheineFilterCount,
  attentionHint,
  attentionLabel,
  buildGutscheineSetup,
  clearAttentionConfirm,
  clearAttentionToast,
  countryName,
  deliveryLabel,
  groupNotices,
  gutscheineFilterParams,
  gutscheineStoreFilter,
  hasAchtung,
  holdReasonHint,
  isPendingRevocation,
  isPrintOfferedInShop,
  issuedToast,
  manualPrintRoute,
  parseEuroInput,
  parseGutscheinAction,
  parseGutscheineFilter,
  printJobActions,
  printOneHold,
  printStatusTone,
  setupCounts,
  shopifyAdminOrderUrl,
  validateIssueInput,
  voucherActions,
  voucherAttentionView,
  voucherOriginLabel,
  voucherStatusLabel,
  voucherStatusTone,
} from "./gutscheine-core.mjs";
import { GIFT_VOUCHER_STATUSES } from "../../../lib/gift-voucher-core.mjs";

test("parseGutscheineFilter keeps known values and drops junk", () => {
  assert.deepEqual(parseGutscheineFilter(), { status: "", quelle: "", q: "", page: 1 });
  assert.deepEqual(parseGutscheineFilter({ status: "held", quelle: "hand", q: "  G-2026-00042 ", seite: "3" }), {
    status: "held",
    quelle: "hand",
    q: "G-2026-00042",
    page: 3,
  });
  assert.equal(parseGutscheineFilter({ status: "ACHTUNG" }).status, "achtung");
  assert.equal(parseGutscheineFilter({ status: "druck" }).status, "druck");
  assert.equal(parseGutscheineFilter({ status: ["issued", "held"] }).status, "issued");
  assert.equal(parseGutscheineFilter({ status: "bogus" }).status, "");
  assert.equal(parseGutscheineFilter({ quelle: "admin" }).quelle, "");
  assert.equal(parseGutscheineFilter({ seite: "0" }).page, 1);
  assert.equal(parseGutscheineFilter({ seite: "-2" }).page, 1);
  assert.equal(parseGutscheineFilter({ seite: "abc" }).page, 1);
  assert.equal(parseGutscheineFilter({ seite: "99999999" }).page, 10_000);
  assert.equal(parseGutscheineFilter({ q: "x".repeat(300) }).q.length, 100);
  assert.equal(parseGutscheineFilter({ status: 42 }).status, "");
});

test("every voucher status can be filtered, plus „Achtung“, „Druck offen“ and „Alle“", () => {
  const values = GUTSCHEINE_STATUS_FILTERS.map((o) => o.value);
  for (const s of GIFT_VOUCHER_STATUSES) assert.ok(values.includes(s), s);
  assert.ok(values.includes("achtung"));
  assert.equal(GUTSCHEINE_STATUS_FILTERS.find((o) => o.value === "druck")?.label, "Druck offen");
  assert.equal(values[0], "");
  assert.equal(new Set(values).size, values.length);
});

test("the filter maps to URL parameters and the store filter", () => {
  const f = parseGutscheineFilter({ status: "achtung", quelle: "hand", q: "lena", seite: "2" });
  assert.deepEqual(gutscheineFilterParams(f, { gutschein: "7" }), {
    status: "achtung",
    quelle: "hand",
    q: "lena",
    seite: "2",
    gutschein: "7",
  });
  assert.deepEqual(gutscheineStoreFilter(f), {
    status: null,
    source: "admin",
    attention: true,
    print: false,
    printOneHeld: false,
    q: "lena",
    page: 2,
    pageSize: GUTSCHEINE_PAGE_SIZE,
  });
  const d = parseGutscheineFilter({});
  assert.deepEqual(gutscheineFilterParams(d), { status: undefined, quelle: undefined, q: undefined, seite: undefined });
  assert.deepEqual(gutscheineStoreFilter(parseGutscheineFilter({ status: "issued", quelle: "shop" })), {
    status: "issued",
    source: "shop",
    attention: false,
    print: false,
    printOneHeld: false,
    q: null,
    page: 1,
    pageSize: GUTSCHEINE_PAGE_SIZE,
  });
  // „Druck offen“ is no voucher status; print.one's waiting cards join it while print.one takes none.
  const druck = gutscheineStoreFilter(parseGutscheineFilter({ status: "druck" }), { printOneHeld: true });
  assert.equal(druck.status, null);
  assert.equal(druck.print, true);
  assert.equal(druck.attention, false);
  assert.equal(druck.printOneHeld, true);
  assert.equal(gutscheineStoreFilter(parseGutscheineFilter({ status: "druck" })).printOneHeld, false);
  assert.equal(activeGutscheineFilterCount(d), 0);
  assert.equal(activeGutscheineFilterCount(f), 3);
});

test("labels and tones fall back instead of throwing", () => {
  assert.equal(voucherStatusLabel("held"), "Zu prüfen");
  assert.equal(voucherStatusLabel("weird"), "weird");
  assert.equal(voucherStatusLabel(null), "—");
  assert.equal(voucherStatusTone("issued"), "success");
  assert.equal(voucherStatusTone("failed"), "destructive");
  assert.equal(voucherStatusTone("nope"), "neutral");
  assert.equal(printStatusTone("review"), "warning");
  assert.equal(printStatusTone(undefined), "neutral");
  assert.equal(deliveryLabel("print"), "Premium-Karte");
  assert.equal(voucherOriginLabel({ source: "shop", reason: "verkauf" }), "Shop");
  assert.equal(voucherOriginLabel({ source: "admin", reason: "kulanz" }), "Kulanz");
  assert.equal(attentionLabel("print_without_address"), "Druck bezahlt, aber keine Adresse");
  assert.match(attentionHint("refund_after_use"), /sperrt ihn nicht von selbst/);
  assert.equal(attentionHint("unknown_key"), "unknown_key");
  assert.equal(attentionHint(null), "");
  assert.match(holdReasonHint("risk"), /riskant/);
  assert.match(holdReasonHint("refunded"), /erstattet, bevor der Gutschein ausgestellt war/);
  assert.match(attentionHint("unknown_product_line"), /GIFT_VOUCHER_PRODUCT_HANDLE \/ GIFT_VOUCHER_PRINT_PRODUCT_HANDLE/);
  assert.equal(attentionLabel("refund_after_use_ok"), "Erstattet, eingelöst — geklärt");
  assert.match(attentionHint("cancelled_after_use_ok"), /als geklärt markiert/);
  assert.equal(MANUAL_REASON_OPTIONS.map((o) => o.value).join(","), "kulanz,marketing,gewinnspiel,firmengeschenk,sonstiges");
  assert.equal(MANUAL_REASON_OPTIONS[0].label, "Kulanz");
});

const base = {
  status: "issued",
  hasCode: true,
  shopifyGiftCardId: "gid://shopify/GiftCard/1",
  source: "shop",
  delivery: "pdf",
  buyerEmail: "kauf@example.com",
  recipientEmail: null,
  attention: null,
};

test("voucherActions offers what fits the status", () => {
  const issued = voucherActions(base);
  assert.equal(issued.pdf, true);
  assert.equal(issued.resendMail, true);
  assert.equal(issued.deactivate, true);
  assert.equal(issued.syncBalance, true);
  assert.equal(issued.revealCode, true);
  assert.equal(issued.issueHeld, false);
  assert.equal(issued.retry, false);
  assert.equal(issued.clearAttention, false);

  const held = voucherActions({ ...base, status: "held", hasCode: false, shopifyGiftCardId: null });
  assert.equal(held.issueHeld, true);
  assert.equal(held.reject, true);
  assert.equal(held.pdf, false);
  assert.equal(held.revealCode, false);
  assert.equal(held.deactivate, false);
  assert.equal(held.syncBalance, false);

  const failed = voucherActions({ ...base, status: "failed", attention: "deactivate_failed" });
  assert.equal(failed.retry, true);
  assert.equal(failed.reject, true);
  assert.equal(failed.clearAttention, true);

  // Admin vouchers: only an e-mail delivery has someone to mail again.
  assert.equal(voucherActions({ ...base, source: "admin", delivery: "pdf", buyerEmail: null }).resendMail, false);
  assert.equal(voucherActions({ ...base, source: "admin", delivery: "email", buyerEmail: null, recipientEmail: "r@example.com" }).resendMail, true);
  assert.equal(voucherActions({ ...base, buyerEmail: null }).resendMail, false);

  const deactivated = voucherActions({ ...base, status: "deactivated" });
  assert.equal(deactivated.pdf, false);
  assert.equal(deactivated.deactivate, false);
  assert.equal(deactivated.syncBalance, true);
});

test("a revocation Mo still carries out is no operator's „Als geklärt markieren“ (mirrors the issue library)", () => {
  const card = { id: 33, status: "issued", shopifyGiftCardId: "gid://shopify/GiftCard/33", amountCents: 6500 };
  // Untouched or not read yet: the sweep deactivates it.
  assert.equal(isPendingRevocation({ ...card, attention: "cancelled_after_use", balanceCents: 6500 }), true);
  assert.equal(isPendingRevocation({ ...card, attention: "refund_after_use", balanceCents: null }), true);
  // Found (partly) spent: the operator's.
  assert.equal(isPendingRevocation({ ...card, attention: "refund_after_use", balanceCents: 1000 }), false);
  // No card yet: the issuing step looks it up.
  for (const status of ["pending", "held", "failed", "issuing"]) {
    assert.equal(isPendingRevocation({ ...card, status, shopifyGiftCardId: null, attention: "cancelled_after_use", balanceCents: null }), true, status);
  }
  // Ended units, other flags, acknowledged flags: nothing under way.
  assert.equal(isPendingRevocation({ ...card, status: "deactivated", attention: "refund_after_use", balanceCents: 6500 }), false);
  assert.equal(isPendingRevocation({ ...card, attention: "print_without_address", balanceCents: 6500 }), false);
  assert.equal(isPendingRevocation({ ...card, attention: "refund_after_use_ok", balanceCents: 1000 }), false);

  assert.equal(hasAchtung("refund_after_use"), true);
  assert.equal(hasAchtung("print_without_address"), true);
  assert.equal(hasAchtung("refund_after_use_ok"), false);
  assert.equal(hasAchtung("cancelled_after_use_ok"), false);
  assert.equal(hasAchtung(null), false);
  assert.equal(hasAchtung(""), false);
});

test("voucherAttentionView: „Achtung“, a revocation under way, or an acknowledged note", () => {
  const card = { id: 33, status: "issued", shopifyGiftCardId: "gid://shopify/GiftCard/33", amountCents: 6500 };
  assert.equal(voucherAttentionView({ ...card, attention: null, balanceCents: 6500 }), null);

  const pending = voucherAttentionView({ ...card, attention: "cancelled_after_use", balanceCents: 6500 });
  assert.equal(pending?.kind, "revoking");
  assert.equal(pending?.text, "Bestellung storniert — Mo sperrt die Karte automatisch, sobald Shopify antwortet.");
  assert.doesNotMatch(`${pending?.title} ${pending?.text}`, /eingelöst/, "an untouched card is not called spent");
  const refund = voucherAttentionView({ ...card, attention: "refund_after_use", balanceCents: null });
  assert.equal(refund?.text, "Bestellung erstattet — Mo sperrt die Karte automatisch, sobald Shopify antwortet.");
  const noCard = voucherAttentionView({ ...card, status: "issuing", shopifyGiftCardId: null, attention: "refund_after_use", balanceCents: null });
  assert.equal(noCard?.kind, "revoking");
  assert.match(noCard?.text ?? "", /storniert den Gutschein automatisch/);

  const spent = voucherAttentionView({ ...card, attention: "refund_after_use", balanceCents: 1000 });
  assert.equal(spent?.kind, "achtung");
  assert.equal(spent?.title, "Achtung: Erstattet, aber schon (teilweise) eingelöst");
  assert.match(spent?.text ?? "", /sperrt ihn nicht von selbst/);

  const ok = voucherAttentionView({ ...card, attention: "refund_after_use_ok", balanceCents: 1000 });
  assert.equal(ok?.kind, "acknowledged");
  assert.equal(ok?.title, "Erstattet, eingelöst — geklärt");
  assert.doesNotMatch(ok?.title ?? "", /Achtung/);
  assert.match(ok?.text ?? "", /bleibt aktiv/);

  const note = voucherAttentionView({ ...card, attention: "print_without_address", balanceCents: 6500 });
  assert.equal(note?.kind, "achtung");
  assert.match(note?.text ?? "", /„Adresse eingeben“/);
});

test("„Als geklärt markieren“: a revoke flag is confirmed, the toast says what happened", () => {
  assert.equal(clearAttentionConfirm({ attention: "print_without_address" }), null);
  assert.match(clearAttentionConfirm({ attention: "refund_after_use" })?.description ?? "", /unbenutzte Karte derselben Bestellposition/);
  assert.match(clearAttentionConfirm({ attention: "cancelled_after_use" })?.description ?? "", /bleibt aktiv/);

  const refund = { status: "issued", attention: "refund_after_use" };
  assert.equal(clearAttentionToast(refund, { status: "deactivated", attention: null }).title, "Karte gesperrt");
  assert.match(clearAttentionToast(refund, { status: "deactivated", attention: null }).description ?? "", /Erstattung/);
  const moved = clearAttentionToast(refund, { status: "issued", attention: null });
  assert.equal(moved.title, "Erstattung verschoben");
  assert.match(moved.description ?? "", /unbenutzte Karte derselben Bestellposition übernimmt die Erstattung/);
  const acked = clearAttentionToast(refund, { status: "issued", attention: "refund_after_use_ok" });
  assert.equal(acked.title, "Als geklärt markiert");
  assert.match(acked.description ?? "", /bleibt aktiv/);
  const cancelAck = clearAttentionToast({ status: "issued", attention: "cancelled_after_use" }, { status: "issued", attention: "cancelled_after_use_ok" });
  assert.match(cancelAck.description ?? "", /bleibt aktiv/);
  assert.deepEqual(clearAttentionToast({ status: "issued", attention: "print_without_address" }, { status: "issued", attention: null }), {
    title: "Als geklärt markiert",
  });
  assert.deepEqual(clearAttentionToast(refund, null), { title: "Als geklärt markiert" });
});

const ADDRESS = { name: "Lena Muster", addressLine1: "Lindenstraße 14", addressLine2: null, postalCode: "80331", city: "München", country: "DE" };

test("printJobActions: print.one submits while it takes cards, hand printing offers files and done", () => {
  const open = { gateBlock: null, blobConfigured: true };
  const issued = { status: "issued" };
  const queued = printJobActions({ status: "queued", provider: "printone", address: ADDRESS }, issued, open);
  assert.equal(queued.submit, true);
  assert.equal(queued.submitBlocked, null);
  assert.equal(queued.files, false);
  assert.equal(queued.done, false);
  assert.equal(queued.cancel, true);
  assert.equal(queued.address, true, "the address can be corrected before print.one has the files");
  assert.equal(printJobActions({ status: "queued", provider: "printone", address: ADDRESS, hasAssets: true }, issued, open).address, false);

  const notIssued = printJobActions({ status: "queued", provider: "printone", address: ADDRESS }, { status: "pending" }, open);
  assert.match(notIssued.submitBlocked ?? "", /noch nicht ausgestellt/);

  const review = printJobActions({ status: "review", provider: "printone", address: ADDRESS }, issued, open);
  assert.equal(review.release, true);
  assert.equal(review.submit, false);
  assert.equal(review.files, false, "print.one prints it once released");
  assert.equal(review.address, true);

  const manual = printJobActions({ status: "queued", provider: "manual", address: ADDRESS }, issued, open);
  assert.equal(manual.submit, false);
  assert.equal(manual.files, true);
  assert.equal(manual.done, true);
  assert.equal(manual.cancel, true);
  assert.equal(manual.address, true);
  const manualNotIssued = printJobActions({ status: "queued", provider: "manual", address: ADDRESS }, { status: "held" }, open);
  assert.equal(manualNotIssued.files, false);
  assert.equal(manualNotIssued.done, false);

  const failedPrintOne = printJobActions({ status: "failed", provider: "printone", address: ADDRESS }, issued, open);
  assert.equal(failedPrintOne.files, true);
  assert.equal(failedPrintOne.done, true);
  assert.equal(failedPrintOne.cancel, false);
  assert.equal(failedPrintOne.address, false);

  const sent = printJobActions({ status: "sent", provider: "printone", address: ADDRESS }, issued, open);
  assert.deepEqual(sent, {
    release: false,
    submit: false,
    submitBlocked: null,
    held: null,
    address: false,
    files: false,
    done: false,
    cancel: false,
  });
  const submitted = printJobActions({ status: "submitted", provider: "printone", address: ADDRESS }, issued, open);
  assert.equal(submitted.cancel, true);
  assert.equal(submitted.files, false);
  assert.equal(submitted.address, false);
  assert.equal(printJobActions({ status: "cancelled", provider: "manual", address: ADDRESS }, issued, open).files, false);
});

test("printJobActions: a waiting print.one card print.one does not take, or without an address, is printed by hand", () => {
  const issued = { status: "issued" };
  const gateOff = "Der Kartendruck über print.one ist noch nicht freigegeben (GIFT_VOUCHER_PRINT_SENDS_APPROVED).";
  const baseUrl = "PUBLIC_BASE_URL fehlt oder ist keine https-Adresse — print.one könnte die Druckdateien nicht laden.";
  for (const ctx of [
    { gateBlock: gateOff, blobConfigured: true },
    { gateBlock: baseUrl, blobConfigured: true },
    { gateBlock: null, blobConfigured: false },
  ]) {
    const queued = printJobActions({ status: "queued", provider: "printone", address: ADDRESS }, issued, ctx);
    assert.equal(queued.submit, true);
    assert.equal(queued.submitBlocked, ctx.gateBlock ?? PRINT_BLOB_MISSING);
    assert.equal(queued.held, ctx.gateBlock ?? PRINT_BLOB_MISSING);
    assert.equal(queued.files, true, "in-house while print.one takes no card");
    assert.equal(queued.done, true);
    const review = printJobActions({ status: "review", provider: "printone", address: ADDRESS }, issued, ctx);
    assert.equal(review.release, true);
    assert.equal(review.files, true);
    assert.equal(review.done, true);
    assert.equal(review.held, ctx.gateBlock ?? PRINT_BLOB_MISSING);
    assert.equal(printJobActions({ status: "failed", provider: "printone", address: ADDRESS }, issued, ctx).held, null);
  }
  // A review card without an address: no „Freigeben“ (print.one would refuse) — address or in-house.
  const open = { gateBlock: null, blobConfigured: true };
  const noAddress = printJobActions({ status: "review", provider: "printone", address: null }, issued, open);
  assert.equal(noAddress.release, false);
  assert.equal(noAddress.address, true);
  assert.equal(noAddress.files, true);
  assert.equal(noAddress.done, true);
  // The manual provider is never held by print.one's gate.
  const manual = printJobActions({ status: "queued", provider: "manual", address: ADDRESS }, issued, { gateBlock: gateOff, blobConfigured: false });
  assert.equal(manual.submitBlocked, null);
  assert.equal(manual.held, null);
  assert.equal(manual.files, true);
});

test("printOneHold, isPrintOfferedInShop and manualPrintRoute follow the submission gate", () => {
  assert.equal(printOneHold({ gateBlock: null, blobConfigured: true }), null);
  assert.equal(printOneHold({ gateBlock: "Gesperrt.", blobConfigured: false }), "Gesperrt.");
  assert.equal(printOneHold({ gateBlock: null, blobConfigured: false }), PRINT_BLOB_MISSING);
  // The shop offers the card in-house, or with print.one only when its gate is open (features.print).
  assert.equal(isPrintOfferedInShop({ configuredPrintProvider: "manual", printGateBlock: "Gesperrt." }), true);
  assert.equal(isPrintOfferedInShop({ configuredPrintProvider: "printone", printGateBlock: null }), true);
  assert.equal(isPrintOfferedInShop({ configuredPrintProvider: "printone", printGateBlock: "PUBLIC_BASE_URL fehlt …" }), false);

  const env = { printProvider: "printone", printGateBlock: null, blobConfigured: true, cardCostCents: 380 };
  assert.equal(manualPrintRoute(env).route, "printone");
  assert.match(manualPrintRoute(env).text, /≈ 3,80\s€/);
  const held = manualPrintRoute({ ...env, printGateBlock: "Der Kartendruck über print.one ist noch nicht freigegeben (GIFT_VOUCHER_PRINT_SENDS_APPROVED)." });
  assert.equal(held.route, "held");
  assert.match(held.text, /noch nicht freigegeben .* „Druck offen“/);
  assert.equal(manualPrintRoute({ ...env, blobConfigured: false }).route, "held");
  assert.equal(manualPrintRoute({ ...env, printProvider: "manual", printGateBlock: "x" }).route, "hand");
});

test("shopifyAdminOrderUrl needs a myshopify domain and a numeric order id", () => {
  assert.equal(
    shopifyAdminOrderUrl("motion-sports.myshopify.com", "5123456789"),
    "https://admin.shopify.com/store/motion-sports/orders/5123456789"
  );
  assert.equal(
    shopifyAdminOrderUrl("https://Motion-Sports.myshopify.com/", "42"),
    "https://admin.shopify.com/store/motion-sports/orders/42"
  );
  assert.equal(shopifyAdminOrderUrl("www.motionsports.de", "42"), null);
  assert.equal(shopifyAdminOrderUrl("motion-sports.myshopify.com", "gid://shopify/Order/42"), null);
  assert.equal(shopifyAdminOrderUrl("motion-sports.myshopify.com", null), null);
  assert.equal(shopifyAdminOrderUrl(undefined, "42"), null);
  assert.equal(shopifyAdminOrderUrl("evil.com/x.myshopify.com", "42"), null);
});

test("countryName gives German names and falls back to the code", () => {
  assert.equal(countryName("DE"), "Deutschland");
  assert.equal(countryName("AT"), "Österreich");
  assert.equal(countryName("FR"), "FR");
  assert.equal(COUNTRY_NAMES.CH, "Schweiz");
});

test("parseEuroInput reads German amounts exactly", () => {
  assert.equal(parseEuroInput("25"), 2500);
  assert.equal(parseEuroInput("25,5"), 2550);
  assert.equal(parseEuroInput("25,50"), 2550);
  assert.equal(parseEuroInput(" 25,50 € "), 2550);
  assert.equal(parseEuroInput("25.50"), 2550);
  assert.equal(parseEuroInput("1.000"), 100000);
  assert.equal(parseEuroInput("1.000,00"), 100000);
  assert.equal(parseEuroInput("0,99"), 99);
  assert.equal(parseEuroInput(""), null);
  assert.equal(parseEuroInput("abc"), null);
  assert.equal(parseEuroInput("-5"), null);
  assert.equal(parseEuroInput("25,505"), null);
  assert.equal(parseEuroInput("1,000.00"), null);
  assert.equal(parseEuroInput(25), null);
});

test("parseGutscheinAction validates action, id, note and reason", () => {
  assert.deepEqual(parseGutscheinAction({ action: "issue_held", id: 5 }), {
    ok: true,
    action: "issue_held",
    id: 5,
    note: null,
    reason: null,
    address: null,
  });
  assert.equal(parseGutscheinAction({ action: "retry", id: "12" }).ok, true);
  assert.deepEqual(parseGutscheinAction({ action: "drop_table", id: 5 }), { ok: false, message: "Unbekannte Aktion." });
  assert.deepEqual(parseGutscheinAction({ action: "retry", id: 0 }), { ok: false, message: "Gutschein fehlt." });
  assert.deepEqual(parseGutscheinAction({ action: "retry", id: 1.5 }), { ok: false, message: "Gutschein fehlt." });
  assert.deepEqual(parseGutscheinAction(null), { ok: false, message: "Ungültige Anfrage." });
  assert.deepEqual(parseGutscheinAction([]), { ok: false, message: "Ungültige Anfrage." });

  const note = parseGutscheinAction({ action: "note", id: 3, note: "  Rückruf am Montag  " });
  assert.equal(note.ok && note.note, "Rückruf am Montag");
  const cleared = parseGutscheinAction({ action: "note", id: 3, note: "   " });
  assert.equal(cleared.ok && cleared.note, null);
  assert.equal(parseGutscheinAction({ action: "note", id: 3, note: "x".repeat(1001) }).ok, false);
  assert.equal(parseGutscheinAction({ action: "note", id: 3, note: 5 }).ok, false);
  const reject = parseGutscheinAction({ action: "reject", id: 3, note: "Betrug" });
  assert.equal(reject.ok && reject.note, "Betrug");

  assert.deepEqual(parseGutscheinAction({ action: "deactivate", id: 3 }), {
    ok: false,
    message: "Bitte einen Grund für das Sperren angeben.",
  });
  assert.equal(parseGutscheinAction({ action: "deactivate", id: 3, reason: "ab" }).ok, false);
  assert.equal(parseGutscheinAction({ action: "deactivate", id: 3, reason: "x".repeat(201) }).ok, false);
  const deact = parseGutscheinAction({ action: "deactivate", id: 3, reason: "  Erstattet   per  Mail " });
  assert.equal(deact.ok && deact.reason, "Erstattet per Mail");
  // Other actions ignore note and reason.
  const other = parseGutscheinAction({ action: "retry", id: 3, note: "x", reason: "y" });
  assert.equal(other.ok && other.note, null);
  assert.equal(other.ok && other.reason, null);
  assert.equal(GUTSCHEIN_ACTIONS.includes("reveal_code"), true);

  // „Als geklärt markieren“: any flag — except an acknowledged revocation (it is „geklärt“ and must
  // stay) and a revocation Mo still carries out (a card not found spent yet).
  const spent = { ...base, amountCents: 5000, balanceCents: 1500 };
  assert.equal(voucherActions({ ...spent, attention: "refund_after_use" }).clearAttention, true);
  assert.equal(voucherActions({ ...spent, attention: "cancelled_after_use" }).clearAttention, true);
  assert.equal(voucherActions({ ...base, amountCents: 5000, balanceCents: 5000, attention: "refund_after_use" }).clearAttention, false);
  assert.equal(voucherActions({ ...base, amountCents: 5000, balanceCents: null, attention: "cancelled_after_use" }).clearAttention, false);
  assert.equal(voucherActions({ ...base, attention: "print_without_address" }).clearAttention, true);
  assert.equal(voucherActions({ ...base, attention: "refund_after_use_ok" }).clearAttention, false);
  assert.equal(voucherActions({ ...base, attention: "cancelled_after_use_ok" }).clearAttention, false);

  // print_address: the card's recipient, checked like the issue dialog's (camelCase for the store).
  const addr = parseGutscheinAction(
    { action: "print_address", id: 4, address: { name: " Lena Muster ", line1: "Lindenstraße 14", postalCode: "80 331", city: "München" } },
    { printCountries: ["DE"] }
  );
  assert.deepEqual(addr.ok && addr.address, {
    name: "Lena Muster",
    addressLine1: "Lindenstraße 14",
    addressLine2: null,
    postalCode: "80331",
    city: "München",
    country: "DE",
  });
  const bad = parseGutscheinAction({ action: "print_address", id: 4, address: { name: "Lena", line1: "Lindenstraße", postalCode: "80331", city: "München" } });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.field, "address.line1");
  assert.equal(!parseGutscheinAction({ action: "print_address", id: 4 }).ok && "missing", "missing");
  assert.equal(
    parseGutscheinAction({ action: "print_address", id: 4, address: { ...ADDRESS, country: "AT" } }, { printCountries: ["DE"] }).ok,
    false,
    "only GIFT_VOUCHER_PRINT_COUNTRIES"
  );
  assert.equal(parseGutscheinAction({ action: "retry", id: 4, address: ADDRESS }).ok && "ignored", "ignored");
  assert.equal(PRINT_ADDRESS_REFUSALS.at_provider.status, 409);
  assert.equal(PRINT_ADDRESS_REFUSALS.error.status, 500);
});

test("actionErrorStatus maps library codes to HTTP statuses", () => {
  assert.equal(actionErrorStatus("not_found"), 404);
  assert.equal(actionErrorStatus("invalid"), 400);
  assert.equal(actionErrorStatus("not_implemented"), 503);
  assert.equal(actionErrorStatus("not_configured"), 503);
  assert.equal(actionErrorStatus("failed"), 502);
  assert.equal(actionErrorStatus("too_late"), 409);
  assert.equal(actionErrorStatus("gate_off"), 409);
  for (const code of ["busy", "revoking", "refunded", "purged"]) assert.equal(actionErrorStatus(code), 409, code);
  // The issue library's real codes: an upstream failure is 502, an internal one 500, an unusable key 503.
  for (const code of ["shopify", "send_failed"]) assert.equal(actionErrorStatus(code), 502, code);
  for (const code of ["db", "error", "internal_error"]) assert.equal(actionErrorStatus(code), 500, code);
  assert.equal(actionErrorStatus("code"), 503);
  for (const code of ["not_held", "not_failed", "revoked", "held", "deferred", "cancelled", "at_provider", "invalid_status", "address"]) {
    assert.equal(actionErrorStatus(code), 409, code);
  }
  assert.equal(actionErrorStatus(undefined), 409);
});

test("issuedToast: „ausgestellt“ only once the Shopify card exists", () => {
  assert.deepEqual(issuedToast({ number: "G-2026-00036", status: "issued", lastError: null }), {
    variant: "success",
    title: "Gutschein G-2026-00036 ausgestellt",
  });
  assert.deepEqual(issuedToast({ number: "G-2026-00036", status: "issuing", lastError: "Karte nicht auffindbar: Shopify war nicht erreichbar" }), {
    variant: "warning",
    title: "Gutschein G-2026-00036 angelegt — Shopify-Karte noch nicht erstellt",
    description: "Karte nicht auffindbar: Shopify war nicht erreichbar",
  });
  const pending = issuedToast({ number: null, status: "pending", lastError: null });
  assert.equal(pending.variant, "warning");
  assert.equal(pending.title, "Gutschein angelegt — Shopify-Karte noch nicht erstellt");
  assert.match(pending.description ?? "", /automatisch erneut/);
});

const ISSUE_OPTS = { adminMaxCents: 25000, printCountries: ["DE"] };
const issueBody = {
  amountCents: 2500,
  reason: "kulanz",
  designKey: "classic",
  recipientName: "  Lena ",
  senderName: DEFAULT_ADMIN_SENDER,
  message: "Danke für deine Geduld!\nViel Spaß beim Training.",
  delivery: "pdf",
  recipientEmail: "ignored@example.com",
  address: null,
  adminNote: "  Ticket 4711 ",
};

test("validateIssueInput accepts a complete PDF voucher and normalises it", () => {
  const r = validateIssueInput(issueBody, ISSUE_OPTS);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value, {
    amountCents: 2500,
    reason: "kulanz",
    designKey: "classic",
    recipientName: "Lena",
    senderName: "Dein motion sports Team",
    message: "Danke für deine Geduld!\nViel Spaß beim Training.",
    delivery: "pdf",
    recipientEmail: null,
    address: null,
    adminNote: "Ticket 4711",
  });
  const empty = validateIssueInput({ ...issueBody, recipientName: "", senderName: null, message: undefined, adminNote: "" }, ISSUE_OPTS);
  assert.equal(empty.ok, true);
  if (empty.ok) {
    assert.equal(empty.value.recipientName, null);
    assert.equal(empty.value.senderName, null);
    assert.equal(empty.value.message, null);
    assert.equal(empty.value.adminNote, null);
  }
});

test("validateIssueInput enforces amount, reason, design and delivery rules", () => {
  const fail = (patch) => {
    const r = validateIssueInput({ ...issueBody, ...patch }, ISSUE_OPTS);
    assert.equal(r.ok, false);
    return r.ok ? null : r;
  };
  assert.equal(fail({ amountCents: 25001 })?.field, "amountCents");
  assert.equal(fail({ amountCents: 50 })?.field, "amountCents");
  assert.equal(fail({ amountCents: "2500" })?.field, "amountCents");
  assert.equal(fail({ reason: "verkauf" })?.field, "reason");
  assert.equal(fail({ designKey: "photo" })?.field, "designKey");
  assert.equal(fail({ designKey: undefined })?.field, "designKey");
  assert.equal(fail({ delivery: "fax" })?.field, "delivery");
  assert.equal(fail({ reason: "marketing", delivery: "email", recipientEmail: "a@example.com" })?.field, "delivery");
  assert.equal(fail({ delivery: "email", recipientEmail: "kein-at" })?.field, "recipientEmail");
  assert.equal(fail({ delivery: "print", address: { name: "Lena", line1: "Ohne Nummer", postalCode: "12345", city: "Ort" } })?.field, "address.line1");
  assert.equal(fail({ delivery: "print", address: { name: "Lena", line1: "Weg 1", postalCode: "1234", city: "Ort" } })?.field, "address.postalCode");
  assert.equal(fail({ recipientName: "Lena 🎉" })?.field, "recipientName");
  assert.equal(fail({ recipientName: "x".repeat(41) })?.field, "recipientName");
  assert.equal(fail({ senderName: "Zeile 1\nZeile 2" })?.field, "senderName");
  assert.equal(fail({ message: "a\nb\nc\nd\ne\nf\ng\nh\ni" })?.field, "message");
  assert.equal(fail({ message: "x".repeat(351) })?.field, "message");
  assert.equal(fail({ adminNote: "x".repeat(1001) })?.field, "adminNote");
  assert.equal(fail({ adminNote: 42 })?.field, "adminNote");
});

test("validateIssueInput: e-mail and card deliveries carry their target", () => {
  const mail = validateIssueInput({ ...issueBody, delivery: "email", recipientEmail: "  Lena@Example.com " }, ISSUE_OPTS);
  assert.equal(mail.ok && mail.value.recipientEmail, "lena@example.com");
  const card = validateIssueInput(
    {
      ...issueBody,
      delivery: "print",
      address: { name: "Lena Muster", line1: "Musterweg 12", line2: "", postalCode: "12 345", city: "Musterstadt", country: "de" },
    },
    ISSUE_OPTS
  );
  assert.equal(card.ok, true);
  if (card.ok) {
    assert.deepEqual(card.value.address, {
      name: "Lena Muster",
      addressLine1: "Musterweg 12",
      addressLine2: null,
      postalCode: "12345",
      city: "Musterstadt",
      country: "DE",
    });
    assert.equal(card.value.recipientEmail, null);
  }
  const abroad = validateIssueInput(
    { ...issueBody, delivery: "print", address: { name: "A", line1: "Weg 1", postalCode: "1010", city: "Wien", country: "AT" } },
    ISSUE_OPTS
  );
  assert.equal(abroad.ok ? "" : abroad.field, "address.country");
});

const GATE_OFF = "Der Kartendruck über print.one ist noch nicht freigegeben (GIFT_VOUCHER_PRINT_SENDS_APPROVED).";
const NOT_CONFIGURED = "print.one ist nicht eingerichtet (PRINTONE_API_KEY / PRINTONE_TEMPLATE_ID).";
const NO_BASE_URL = "PUBLIC_BASE_URL fehlt oder ist keine https-Adresse — print.one könnte die Druckdateien nicht laden.";

const SETUP_OK = {
  dbReady: true,
  tablesExist: true,
  enabled: true,
  salesEnabled: true,
  tokenKeyOk: true,
  emailConfigured: true,
  blobConfigured: true,
  shopifyConfigured: true,
  printSendsApproved: true,
  printProvider: "printone",
  configuredPrintProvider: "printone",
  printOneConfigured: true,
  printGateBlock: null,
  openPrintJobs: 0,
  printReviewCount: 0,
  printOpenCount: 0,
  handles: { voucher: "designgutschein", print: "gutschein-premiumkarte" },
  limits: { minCents: 500, maxCents: 50000, dailyLimitCents: 250000, adminMaxCents: 25000 },
  validityYears: 3,
  printCountries: ["DE"],
  cardCostCents: 384,
  shopify: {
    scopes: { ok: true, missing: [], optionalMissing: [] },
    products: {
      ok: true,
      voucher: {
        handle: "designgutschein",
        title: "Designgutschein",
        status: "ACTIVE",
        isGiftCard: false,
        variants: [
          { title: "50 €", priceCents: 5000, taxable: false, requiresShipping: false },
          { title: "25 €", priceCents: 2500, taxable: false, requiresShipping: false },
        ],
      },
      print: {
        handle: "gutschein-premiumkarte",
        title: "Premium-Karte",
        status: "ACTIVE",
        isGiftCard: false,
        variants: [{ title: "Default", priceCents: 490, taxable: true, requiresShipping: false }],
      },
      issues: [],
    },
    issueLimitCents: 100000,
  },
};

test("buildGutscheineSetup: everything configured → no notices, no errors", () => {
  const { checks, notices } = buildGutscheineSetup(SETUP_OK);
  assert.deepEqual(notices, []);
  assert.deepEqual(setupCounts(checks), { errors: 0, warnings: 0, pending: 0 });
  const voucher = checks.find((c) => c.key === "voucherProduct");
  assert.equal(voucher?.state, "ok");
  assert.match(voucher?.detail ?? "", /2 Beträge: 25,00\s€, 50,00\s€/);
  assert.match(checks.find((c) => c.key === "printProduct")?.detail ?? "", /4,90\s€/);
  assert.equal(checks.find((c) => c.key === "issueLimit")?.state, "info");
  assert.equal(checks.find((c) => c.key === "printCountries")?.detail, "Deutschland");
  assert.ok(checks.every((c) => ["Grundlagen", "Shopify", "Kartendruck", "Grenzen"].includes(c.group)));
  assert.equal(new Set(checks.map((c) => c.key)).size, checks.length);
});

test("buildGutscheineSetup: missing pieces become errors, warnings and infos", () => {
  const { checks, notices } = buildGutscheineSetup({
    ...SETUP_OK,
    tablesExist: false,
    enabled: false,
    tokenKeyOk: false,
    emailConfigured: false,
    blobConfigured: false,
    printSendsApproved: false,
    printGateBlock: GATE_OFF,
    openPrintJobs: 3,
    printOpenCount: 3,
    shopify: {
      scopes: { ok: true, missing: ["write_gift_cards"], optionalMissing: ["read_gift_card_transactions"] },
      products: {
        ok: true,
        voucher: null,
        print: SETUP_OK.shopify.products.print,
        issues: [
          { level: "error", product: "voucher", message: "Gutschein-Produkt „designgutschein“ nicht gefunden." },
          { level: "warning", product: "print", message: "Druckprodukt verlangt Versand." },
        ],
      },
      issueLimitCents: 20000,
    },
  });
  const keys = notices.map((n) => `${n.level}:${n.key}`);
  assert.ok(keys.includes("error:migration"));
  assert.ok(keys.includes("error:key"));
  assert.ok(keys.includes("error:scope"));
  assert.ok(keys.includes("error:product0"));
  assert.ok(keys.includes("warning:product1"));
  assert.ok(keys.includes("warning:enabled"));
  assert.ok(keys.includes("warning:email"));
  assert.ok(keys.includes("warning:blob"));
  assert.ok(keys.includes("warning:printOffer"));
  assert.ok(keys.includes("warning:issueLimit"));
  const offer = notices.find((n) => n.key === "printOffer");
  assert.match(offer?.text ?? "", /noch nicht freigegeben .*Der Shop bietet die Premium-Karte deshalb nicht an; 3 Karten warten auf den Druck/);
  assert.equal(offer?.filter, "druck");
  // „Not found“ is the product row itself, not an extra issue row.
  assert.equal(checks.find((c) => c.key === "voucherProduct")?.state, "error");
  assert.equal(checks.filter((c) => c.key.startsWith("productIssue")).length, 1);
  assert.equal(checks.find((c) => c.key === "optionalScopes")?.state, "info");
  const grouped = groupNotices(notices);
  assert.deepEqual(
    grouped.map((g) => g.level),
    ["error", "warning"]
  );
  assert.ok(setupCounts(checks).errors >= 4);
});

test("buildGutscheineSetup: a missing print product row follows its issue (error while the card is offered)", () => {
  const missing = (issue) =>
    buildGutscheineSetup({
      ...SETUP_OK,
      shopify: { ...SETUP_OK.shopify, products: { ...SETUP_OK.shopify.products, print: null, issues: [issue] } },
    });
  const offered = missing({ level: "error", product: "print", message: "Druck-Zusatzprodukt „gutschein-premiumkarte“ nicht gefunden — Mo erkennt …" });
  const row = offered.checks.find((c) => c.key === "printProduct");
  assert.equal(row?.state, "error");
  assert.match(row?.detail ?? "", /Mo erkennt/);
  assert.deepEqual(offered.notices.map((n) => `${n.level}:${n.key}`), ["error:product0"]);
  assert.equal(offered.checks.filter((c) => c.key.startsWith("productIssue")).length, 0, "not found is the row itself");
  const off = missing({ level: "warning", product: "print", message: "Druck-Zusatzprodukt „gutschein-premiumkarte“ nicht gefunden — „Premium-Karte per Post“ ist dann nicht buchbar." });
  assert.equal(off.checks.find((c) => c.key === "printProduct")?.state, "warn");
});

test("buildGutscheineSetup: Shopify not loaded yet, not configured, or not checkable", () => {
  const loading = buildGutscheineSetup({ ...SETUP_OK, shopify: null });
  assert.equal(loading.checks.find((c) => c.key === "scope")?.state, "pending");
  assert.equal(setupCounts(loading.checks).pending, 3);
  assert.deepEqual(loading.notices, []);

  const off = buildGutscheineSetup({ ...SETUP_OK, shopifyConfigured: false, shopify: null });
  assert.equal(off.checks.find((c) => c.key === "shopify")?.state, "error");
  assert.equal(off.checks.find((c) => c.key === "scope"), undefined);
  assert.deepEqual(off.notices.map((n) => n.key), ["shopify"]);

  const broken = buildGutscheineSetup({
    ...SETUP_OK,
    shopify: { scopes: { ok: false, message: "Zeitüberschreitung" }, products: { ok: false, message: "Zeitüberschreitung" }, issueLimitCents: null },
  });
  assert.equal(broken.checks.find((c) => c.key === "scope")?.state, "warn");
  assert.equal(broken.checks.find((c) => c.key === "optionalScopes"), undefined);
  assert.equal(broken.checks.find((c) => c.key === "issueLimit"), undefined);
  assert.deepEqual(broken.notices.map((n) => n.key).sort(), ["products-check", "scope-check"]);

  const noDb = buildGutscheineSetup({ ...SETUP_OK, dbReady: false, tablesExist: false });
  assert.equal(noDb.notices[0].key, "db");
});

test("buildGutscheineSetup: the shop offers the Premium-Karte only when it can be printed (E3)", () => {
  const row = (r, key) => r.checks.find((c) => c.key === key);
  const ready = buildGutscheineSetup(SETUP_OK);
  assert.equal(row(ready, "printProvider")?.state, "ok");
  assert.equal(row(ready, "printOffer")?.detail, "Wird angeboten.");

  // print.one is the provider, but its keys are missing: not offered; cards issued by hand go to the in-house queue.
  const noKeys = buildGutscheineSetup({
    ...SETUP_OK,
    printProvider: "manual",
    printOneConfigured: false,
    printSendsApproved: false,
    printGateBlock: GATE_OFF,
    openPrintJobs: 2,
    printOpenCount: 2,
  });
  assert.equal(row(noKeys, "printProvider")?.state, "warn");
  assert.match(row(noKeys, "printProvider")?.detail ?? "", /nicht eingerichtet .*von Hand gedruckt \(Status „Druck offen“\)/);
  assert.equal(row(noKeys, "printOffer")?.state, "warn");
  assert.match(row(noKeys, "printOffer")?.detail ?? "", /^Wird nicht angeboten/);
  const offer = noKeys.notices.find((n) => n.key === "printOffer");
  assert.equal(offer?.level, "warning");
  assert.match(offer?.text ?? "", /bietet die Premium-Karte deshalb nicht an; 2 Karten warten/);
  assert.doesNotMatch(offer?.text ?? "", /werden von Hand gedruckt\.$/);
  assert.equal(noKeys.notices.find((n) => n.key === "printone"), undefined, "no „werden von Hand gedruckt“ notice any more");
  const keysOnly = buildGutscheineSetup({ ...SETUP_OK, printProvider: "manual", printOneConfigured: false, printGateBlock: NOT_CONFIGURED });
  assert.match(keysOnly.notices.find((n) => n.key === "printOffer")?.text ?? "", /^print\.one ist nicht eingerichtet .*deshalb nicht an\.$/);
  assert.equal(keysOnly.notices.find((n) => n.key === "printOffer")?.filter, undefined, "nothing waits — no link");

  // Gate closed: a warning even without waiting cards — the shop does not offer the card.
  const gateNoJobs = buildGutscheineSetup({ ...SETUP_OK, printSendsApproved: false, printGateBlock: GATE_OFF });
  assert.equal(row(gateNoJobs, "printGate")?.state, "warn");
  assert.match(row(gateNoJobs, "printGate")?.detail ?? "", /von Hand drucken \(Status „Druck offen“\)/);
  assert.equal(row(gateNoJobs, "printProvider")?.state, "info");
  assert.equal(gateNoJobs.notices.find((n) => n.key === "printOffer")?.level, "warning");

  // Approved and configured, but no https PUBLIC_BASE_URL (P4's gate): an error row, the shop does not offer it.
  const noBase = buildGutscheineSetup({ ...SETUP_OK, printGateBlock: NO_BASE_URL, printOpenCount: 1 });
  assert.equal(row(noBase, "printGate")?.state, "ok");
  assert.equal(row(noBase, "printProvider")?.state, "error");
  assert.equal(row(noBase, "printProvider")?.detail, NO_BASE_URL);
  assert.match(noBase.notices.find((n) => n.key === "printOffer")?.text ?? "", /PUBLIC_BASE_URL fehlt .*1 Karte wartet auf den Druck/);

  // No file store: print.one gets no files — an error row; the shop still offers the card.
  const noBlob = buildGutscheineSetup({ ...SETUP_OK, blobConfigured: false, printOpenCount: 2 });
  assert.equal(row(noBlob, "printProvider")?.state, "error");
  assert.match(row(noBlob, "printProvider")?.detail ?? "", /BLOB_READ_WRITE_TOKEN/);
  assert.equal(row(noBlob, "printOffer")?.state, "ok");
  const blob = noBlob.notices.find((n) => n.key === "blob");
  assert.match(blob?.text ?? "", /Bezahlte Premium-Karten warten/);
  assert.equal(blob?.filter, "druck");
  assert.equal(noBlob.notices.find((n) => n.key === "printOffer"), undefined);

  // GIFT_VOUCHER_PRINT_PROVIDER=manual: offered, printed in-house; the gate does not matter.
  const chosenManual = buildGutscheineSetup({
    ...SETUP_OK,
    printProvider: "manual",
    configuredPrintProvider: "manual",
    printSendsApproved: false,
    printGateBlock: GATE_OFF,
  });
  assert.equal(row(chosenManual, "printGate")?.state, "info");
  assert.match(row(chosenManual, "printProvider")?.detail ?? "", /GIFT_VOUCHER_PRINT_PROVIDER=manual/);
  assert.equal(row(chosenManual, "printOffer")?.detail, "Wird angeboten — gedruckt wird von Hand.");
  assert.deepEqual(chosenManual.notices, []);

  // Nothing points to a „Druckwarteschlange“ any more — the list filter is „Druck offen“.
  for (const r of [ready, noKeys, gateNoJobs, noBase, noBlob, chosenManual]) {
    for (const c of r.checks) assert.doesNotMatch(c.detail, /Druckwarteschlange/, c.key);
    for (const n of r.notices) assert.doesNotMatch(n.text, /Druckwarteschlange/, n.key);
  }
});

test("buildGutscheineSetup: cards waiting for „Freigeben“ get a notice with the „Druck offen“ link", () => {
  const one = buildGutscheineSetup({ ...SETUP_OK, printReviewCount: 1, printOpenCount: 1 });
  assert.deepEqual(one.notices, [{ key: "printReview", level: "info", text: "1 Premium-Karte wartet auf „Freigeben“.", filter: "druck" }]);
  const three = buildGutscheineSetup({ ...SETUP_OK, printReviewCount: 3 });
  assert.equal(three.notices[0]?.text, "3 Premium-Karten warten auf „Freigeben“.");
});

test("buildGutscheineSetup: the Shopify row says „Konfiguriert“ until Shopify answered", () => {
  const row = (r) => r.checks.find((c) => c.key === "shopify");
  const loading = row(buildGutscheineSetup({ ...SETUP_OK, shopify: null }));
  assert.equal(loading?.state, "ok");
  assert.equal(loading?.detail, "Konfiguriert (SHOPIFY_*).");
  assert.equal(row(buildGutscheineSetup(SETUP_OK))?.detail, "Verbunden.");
  const down = row(
    buildGutscheineSetup({
      ...SETUP_OK,
      shopify: { scopes: { ok: false, message: "Zeitüberschreitung" }, products: { ok: false, message: "Zeitüberschreitung" }, issueLimitCents: null },
    })
  );
  assert.equal(down?.state, "warn");
  assert.equal(down?.detail, "Nicht erreichbar: Zeitüberschreitung");
  // One check answered: Shopify is reachable.
  const partly = row(
    buildGutscheineSetup({ ...SETUP_OK, shopify: { ...SETUP_OK.shopify, scopes: { ok: false, message: "GraphQL-Fehler" } } })
  );
  assert.equal(partly?.state, "ok");
});

test("buildGutscheineSetup: validity and limits", () => {
  const never = buildGutscheineSetup({ ...SETUP_OK, validityYears: 0, limits: { ...SETUP_OK.limits, dailyLimitCents: 0 } });
  assert.match(never.checks.find((c) => c.key === "validity")?.detail ?? "", /unbegrenzt/);
  assert.match(never.checks.find((c) => c.key === "shopLimits")?.detail ?? "", /kein Tageslimit/);
  assert.match(buildGutscheineSetup(SETUP_OK).checks.find((c) => c.key === "validity")?.detail ?? "", /3\. Jahres nach der Ausstellung/);
});
