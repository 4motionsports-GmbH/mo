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
  activeGutscheineFilterCount,
  attentionHint,
  attentionLabel,
  buildGutscheineSetup,
  countryName,
  deliveryLabel,
  groupNotices,
  gutscheineFilterParams,
  gutscheineStoreFilter,
  holdReasonHint,
  parseEuroInput,
  parseGutscheinAction,
  parseGutscheineFilter,
  printJobActions,
  printStatusTone,
  setupCounts,
  shopifyAdminOrderUrl,
  validateIssueInput,
  voucherActions,
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

test("every voucher status can be filtered, plus „Achtung“ and „Alle“", () => {
  const values = GUTSCHEINE_STATUS_FILTERS.map((o) => o.value);
  for (const s of GIFT_VOUCHER_STATUSES) assert.ok(values.includes(s), s);
  assert.ok(values.includes("achtung"));
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
    q: null,
    page: 1,
    pageSize: GUTSCHEINE_PAGE_SIZE,
  });
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

test("printJobActions: print.one submits behind the gate, hand printing offers files and done", () => {
  const open = { gateOpen: true, printOneConfigured: true };
  const issued = { status: "issued" };
  const queued = printJobActions({ status: "queued", provider: "printone" }, issued, open);
  assert.equal(queued.submit, true);
  assert.equal(queued.submitBlocked, null);
  assert.equal(queued.files, false);
  assert.equal(queued.done, false);
  assert.equal(queued.cancel, true);

  const gateClosed = printJobActions({ status: "queued", provider: "printone" }, issued, { gateOpen: false, printOneConfigured: true });
  assert.match(gateClosed.submitBlocked ?? "", /GIFT_VOUCHER_PRINT_SENDS_APPROVED/);
  const notConfigured = printJobActions({ status: "queued", provider: "printone" }, issued, { gateOpen: true, printOneConfigured: false });
  assert.match(notConfigured.submitBlocked ?? "", /print\.one/);
  const notIssued = printJobActions({ status: "queued", provider: "printone" }, { status: "pending" }, open);
  assert.match(notIssued.submitBlocked ?? "", /noch nicht ausgestellt/);

  const review = printJobActions({ status: "review", provider: "printone" }, issued, open);
  assert.equal(review.release, true);
  assert.equal(review.submit, false);

  const manual = printJobActions({ status: "queued", provider: "manual" }, issued, open);
  assert.equal(manual.submit, false);
  assert.equal(manual.files, true);
  assert.equal(manual.done, true);
  assert.equal(manual.cancel, true);
  const manualNotIssued = printJobActions({ status: "queued", provider: "manual" }, { status: "held" }, open);
  assert.equal(manualNotIssued.files, false);
  assert.equal(manualNotIssued.done, false);

  const failedPrintOne = printJobActions({ status: "failed", provider: "printone" }, issued, open);
  assert.equal(failedPrintOne.files, true);
  assert.equal(failedPrintOne.done, true);
  assert.equal(failedPrintOne.cancel, false);

  const sent = printJobActions({ status: "sent", provider: "printone" }, issued, open);
  assert.deepEqual(sent, { release: false, submit: false, submitBlocked: null, files: false, done: false, cancel: false });
  const submitted = printJobActions({ status: "submitted", provider: "printone" }, issued, open);
  assert.equal(submitted.cancel, true);
  assert.equal(printJobActions({ status: "cancelled", provider: "manual" }, issued, open).files, false);
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
});

test("actionErrorStatus maps library codes to HTTP statuses", () => {
  assert.equal(actionErrorStatus("not_found"), 404);
  assert.equal(actionErrorStatus("invalid"), 400);
  assert.equal(actionErrorStatus("not_implemented"), 503);
  assert.equal(actionErrorStatus("not_configured"), 503);
  assert.equal(actionErrorStatus("failed"), 502);
  assert.equal(actionErrorStatus("too_late"), 409);
  assert.equal(actionErrorStatus("gate_off"), 409);
  assert.equal(actionErrorStatus(undefined), 409);
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
  openPrintJobs: 0,
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
    openPrintJobs: 3,
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
  assert.ok(keys.includes("warning:printGate"));
  assert.ok(keys.includes("warning:issueLimit"));
  assert.match(notices.find((n) => n.key === "printGate")?.text ?? "", /3 Druckaufträge warten/);
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

test("buildGutscheineSetup: manual printing and the print gate", () => {
  const fallback = buildGutscheineSetup({ ...SETUP_OK, printProvider: "manual", printOneConfigured: false, printSendsApproved: false, openPrintJobs: 2 });
  const printone = fallback.notices.find((n) => n.key === "printone");
  assert.equal(printone?.level, "info");
  assert.match(printone?.text ?? "", /2 Karten werden von Hand gedruckt/);
  // The gate only matters when print.one gets the addresses.
  assert.equal(fallback.notices.find((n) => n.key === "printGate"), undefined);
  assert.equal(fallback.checks.find((c) => c.key === "printGate")?.state, "info");

  const chosenManual = buildGutscheineSetup({ ...SETUP_OK, printProvider: "manual", configuredPrintProvider: "manual" });
  assert.equal(chosenManual.notices.find((n) => n.key === "printone"), undefined);
  assert.match(chosenManual.checks.find((c) => c.key === "printProvider")?.detail ?? "", /GIFT_VOUCHER_PRINT_PROVIDER=manual/);

  const gateNoJobs = buildGutscheineSetup({ ...SETUP_OK, printSendsApproved: false, openPrintJobs: 0 });
  assert.equal(gateNoJobs.notices.find((n) => n.key === "printGate"), undefined);
  assert.equal(gateNoJobs.checks.find((c) => c.key === "printGate")?.state, "warn");

  const never = buildGutscheineSetup({ ...SETUP_OK, validityYears: 0, limits: { ...SETUP_OK.limits, dailyLimitCents: 0 } });
  assert.match(never.checks.find((c) => c.key === "validity")?.detail ?? "", /unbegrenzt/);
  assert.match(never.checks.find((c) => c.key === "shopLimits")?.detail ?? "", /kein Tageslimit/);
});
