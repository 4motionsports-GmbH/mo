import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRINTONE_MERGE_VARIABLES,
  PRINTONE_ORDER_STATUS_MAP,
  PRINTONE_SQ14_SPREAD,
  PRINTONE_TEMPLATE_FORMAT,
  buildPrintOneOrderBody,
  buildPrintOneTemplateBody,
  canCleanPrintJobAssets,
  classifyPrintOneFailure,
  decideGiftVoucherPrintSubmission,
  describePrintOneFailure,
  describePrintOneOrderFailure,
  giftVoucherPrintAssetFile,
  giftVoucherPrintAssetPathname,
  giftVoucherPrintAssetUrl,
  giftVoucherPrintGlobalBlock,
  giftVoucherPrintIdempotencyKey,
  isPrintOneOrderId,
  isValidPrintAssetToken,
  mapPrintOneOrderStatus,
  parseGiftVoucherPrintAssetFile,
  parsePrintOneError,
  parsePrintOneOrder,
  parsePrintOneOrderList,
  parsePrintOneTemplate,
  planPrintJobRetryMinutes,
  printOneApiUrl,
  printOneCancelPath,
  printOneKeyLooksLive,
  printOneOrderListQuery,
  printOneOrderPath,
  printOneOrderUsesAssetToken,
  printOnePreviewPath,
  printOneRecipientFromAddress,
  printOneTemplateIssues,
  printOneTemplatePageHtml,
  publicHttpsBaseUrl,
} from "./printone-core.mjs";
import { GIFT_VOUCHER_PRINT_HELD_MESSAGE } from "./gift-voucher-issue-core.mjs";
import { canAdvancePrintJobStatus, isPrintJobStatus, newOpaqueToken, planGiftVoucherRetry } from "./gift-voucher-core.mjs";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"; // 32 characters, like newOpaqueToken(24)
const BASE = "https://mo.example.de";
const OUTSIDE = `${BASE}/api/gift-vouchers/print-asset/${TOKEN}-outside.jpg`;
const INSIDE = `${BASE}/api/gift-vouchers/print-asset/${TOKEN}-inside.jpg`;

/** The stored JSONB (recipient_postal_address) — snake_case like customers.postal_address. */
const ADDRESS_JSON = {
  name: "Lena Muster",
  address_line_1: "Musterstraße 12",
  address_line_2: "Hinterhaus",
  postal_code: "10115",
  city: "Berlin",
  country: "de",
};

/** A CreateOrderResponse as the v2 OpenAPI schema describes it (201 / GET / cancel / webhook data). */
function orderFixture(overrides = {}) {
  return {
    id: "ord_1234567890",
    companyId: "1234567890",
    templateId: "tmpl_1234567890",
    templateVersion: 1,
    finish: "MATTE",
    format: "GREETINGCARD_SQ14",
    mergeVariables: { outside_url: OUTSIDE, inside_url: INSIDE },
    doubleSided: true,
    sender: { name: "x", address: "x", postalCode: "x", city: "x", country: "NL" },
    recipient: { name: "Lena Muster", address: "Musterstraße 12", postalCode: "10115", city: "Berlin", country: "DE" },
    definitiveCountryId: "DE",
    region: "EUROPE",
    deliverySpeed: "FAST",
    billingId: "Gutscheine",
    isBillable: false,
    status: "order_created",
    friendlyStatus: "Success",
    errors: [],
    warnings: [],
    metadata: {},
    sendDate: "2026-11-21T00:00:00.000Z",
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:01.000Z",
    anonymizedAt: null,
    csvOrderId: null,
    ...overrides,
  };
}

// ── URLs, ids, keys ──────────────────────────────────────────────────────────

test("printOneApiUrl joins base, path and query (empty values dropped)", () => {
  assert.equal(printOneApiUrl("https://api.print.one/", "/v2/orders"), "https://api.print.one/v2/orders");
  assert.equal(
    printOneApiUrl("https://api.print.one", "/v2/orders", { page: 1, limit: 100, x: null, y: undefined, z: "" }),
    "https://api.print.one/v2/orders?page=1&limit=100"
  );
  assert.equal(
    printOneApiUrl("https://api.print.one", "/v2/orders", { "filter.billingId": "$eq:Gutscheine" }),
    "https://api.print.one/v2/orders?filter.billingId=%24eq%3AGutscheine"
  );
  assert.equal(printOneApiUrl("", "/v2/countries"), "https://api.print.one/v2/countries");
});

test("order ids: only safe path segments become paths", () => {
  assert.equal(isPrintOneOrderId("ord_1234567890"), true);
  assert.equal(printOneOrderPath("ord_abc-DEF_1"), "/v2/orders/ord_abc-DEF_1");
  assert.equal(printOneCancelPath("ord_1"), "/v2/orders/ord_1/cancel");
  assert.equal(printOnePreviewPath("ord_1"), "/v2/storage/order/preview/ord_1");
  for (const bad of ["", "../x", "ord_1/cancel", "ord 1", "ord_1?x=1", 42, null, "a".repeat(129)]) {
    assert.equal(isPrintOneOrderId(bad), false, String(bad));
    assert.equal(printOneOrderPath(bad), null);
    assert.equal(printOneCancelPath(bad), null);
  }
});

test("giftVoucherPrintIdempotencyKey: gift-voucher-print-<jobId>-<created ms>, positive integers only", () => {
  const created = "2026-11-20T10:00:00.5+00:00";
  const ms = Date.parse("2026-11-20T10:00:00.500Z");
  assert.equal(giftVoucherPrintIdempotencyKey(42, created), `gift-voucher-print-42-${ms}`);
  assert.equal(giftVoucherPrintIdempotencyKey(42, created), giftVoucherPrintIdempotencyKey(42, new Date(ms)), "stable for every attempt of the job");
  assert.notEqual(giftVoucherPrintIdempotencyKey(1, "2026-11-20T10:00:00Z"), giftVoucherPrintIdempotencyKey(1, "2026-11-22T10:00:00Z"), "job 1 of another database");
  assert.equal(giftVoucherPrintIdempotencyKey(42, undefined), "gift-voucher-print-42-0");
  assert.ok(giftVoucherPrintIdempotencyKey(Number.MAX_SAFE_INTEGER, created).length <= 255);
  for (const bad of [0, -1, 1.5, NaN, "42", null, undefined]) assert.equal(giftVoucherPrintIdempotencyKey(bad, created), null);
});

test("canCleanPrintJobAssets: only a finished job loses its print files", () => {
  for (const status of ["sent", "done", "cancelled", "failed"]) assert.equal(canCleanPrintJobAssets({ status, assetToken: TOKEN }), true, status);
  // An open job keeps them however old it is: the token finds an order whose answer was lost.
  for (const status of ["review", "queued", "submitting", "submitted", "printing"]) {
    assert.equal(canCleanPrintJobAssets({ status, assetToken: TOKEN }), false, status);
  }
  assert.equal(canCleanPrintJobAssets({ status: "sent", assetToken: null }), false, "nothing to clean");
  assert.equal(canCleanPrintJobAssets(null), false);
});

test("publicHttpsBaseUrl: https only (http to localhost on request), no query, no trailing slash", () => {
  assert.equal(publicHttpsBaseUrl("https://mo.motionsports.de/"), "https://mo.motionsports.de");
  assert.equal(publicHttpsBaseUrl("  https://mo.motionsports.de/base//  "), "https://mo.motionsports.de/base");
  assert.equal(publicHttpsBaseUrl("http://mo.motionsports.de"), null);
  assert.equal(publicHttpsBaseUrl("http://localhost:3000"), null);
  assert.equal(publicHttpsBaseUrl("http://localhost:3000", { localHttp: true }), "http://localhost:3000");
  assert.equal(publicHttpsBaseUrl("http://example.com", { localHttp: true }), null);
  assert.equal(publicHttpsBaseUrl("https://mo.example?x=1"), null);
  assert.equal(publicHttpsBaseUrl("https://user:pw@mo.example"), null);
  for (const bad of ["", "   ", "mo.example", "ftp://mo.example", null, undefined, 42]) assert.equal(publicHttpsBaseUrl(bad), null);
});

// ── print files ──────────────────────────────────────────────────────────────

test("asset names: build and parse round-trip with a real opaque token", () => {
  const token = newOpaqueToken(24);
  assert.equal(isValidPrintAssetToken(token), true);
  for (const side of ["outside", "inside"]) {
    const file = giftVoucherPrintAssetFile(token, side);
    assert.equal(file, `${token}-${side}.jpg`);
    assert.deepEqual(parseGiftVoucherPrintAssetFile(file), { token, side });
    assert.equal(giftVoucherPrintAssetPathname(token, side), `gift-voucher-print/${token}-${side}.jpg`);
  }
  // a token may itself contain "-": the side is always the last segment
  const dashed = "abc-outside-0123456789012345";
  assert.deepEqual(parseGiftVoucherPrintAssetFile(`${dashed}-inside.jpg`), { token: dashed, side: "inside" });
});

test("parseGiftVoucherPrintAssetFile rejects everything but <token>-<outside|inside>.jpg", () => {
  const bad = [
    "",
    `${TOKEN}.jpg`,
    `${TOKEN}-front.jpg`,
    `${TOKEN}-outside.JPG`,
    `${TOKEN}-outside.jpeg`,
    `${TOKEN}-outside.png`,
    `${TOKEN}-outside.jpg.png`,
    `${TOKEN}-outside.jpg/`,
    `../${TOKEN}-outside.jpg`,
    `..%2F${TOKEN}-outside.jpg`,
    `${TOKEN}%2Doutside.jpg`,
    `x/${TOKEN}-outside.jpg`,
    `${TOKEN}-outside.jpg\u0000`,
    ` ${TOKEN}-outside.jpg`,
    `short-outside.jpg`,
    `${"A".repeat(65)}-outside.jpg`,
    `${TOKEN.slice(0, 20)}=+-outside.jpg`,
    null,
    undefined,
    42,
  ];
  for (const f of bad) assert.equal(parseGiftVoucherPrintAssetFile(f), null, JSON.stringify(f));
  assert.equal(giftVoucherPrintAssetFile("short", "outside"), null);
  assert.equal(giftVoucherPrintAssetFile(TOKEN, "front"), null);
  assert.equal(giftVoucherPrintAssetPathname(TOKEN, "../x"), null);
});

test("giftVoucherPrintAssetUrl: <base>/api/gift-vouchers/print-asset/<token>-<side>.jpg", () => {
  assert.equal(giftVoucherPrintAssetUrl(`${BASE}/`, TOKEN, "outside"), OUTSIDE);
  assert.equal(giftVoucherPrintAssetUrl(BASE, TOKEN, "inside"), INSIDE);
  assert.equal(giftVoucherPrintAssetUrl("http://localhost:3000", TOKEN, "inside"), `http://localhost:3000/api/gift-vouchers/print-asset/${TOKEN}-inside.jpg`);
  assert.equal(giftVoucherPrintAssetUrl("", TOKEN, "inside"), null);
  assert.equal(giftVoucherPrintAssetUrl(BASE, "bad", "inside"), null);
  assert.equal(giftVoucherPrintAssetUrl(BASE, TOKEN, "back"), null);
});

// ── address mapping + body ───────────────────────────────────────────────────

test("printOneRecipientFromAddress: snake_case JSONB → print.one AddressDto", () => {
  assert.deepEqual(printOneRecipientFromAddress(ADDRESS_JSON), {
    name: "Lena Muster",
    address: "Musterstraße 12",
    postalCode: "10115",
    city: "Berlin",
    country: "DE",
    addressLine2: "Hinterhaus",
  });
});

test("printOneRecipientFromAddress: camelCase store shape, empty line 2 left out", () => {
  const r = printOneRecipientFromAddress({
    name: "Lena Muster",
    addressLine1: "Musterstraße 12",
    addressLine2: null,
    postalCode: "10115",
    city: "Berlin",
    country: "DE",
  });
  assert.deepEqual(r, { name: "Lena Muster", address: "Musterstraße 12", postalCode: "10115", city: "Berlin", country: "DE" });
  assert.equal("addressLine2" in r, false);
  const blank = printOneRecipientFromAddress({ ...ADDRESS_JSON, address_line_2: "   " });
  assert.equal("addressLine2" in blank, false);
});

test("printOneRecipientFromAddress: missing required parts → null", () => {
  for (const key of ["name", "address_line_1", "postal_code", "city", "country"]) {
    assert.equal(printOneRecipientFromAddress({ ...ADDRESS_JSON, [key]: "" }), null, key);
  }
  for (const bad of [null, undefined, "Berlin", 42, []]) assert.equal(printOneRecipientFromAddress(bad), null);
});

test("buildPrintOneOrderBody: exact v2 CreateOrderRequest with both merge variables", () => {
  const res = buildPrintOneOrderBody({
    templateId: "tmpl_1234567890",
    finish: "MATTE",
    billingId: "Gutscheine",
    address: ADDRESS_JSON,
    outsideUrl: OUTSIDE,
    insideUrl: INSIDE,
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.body, {
    templateId: "tmpl_1234567890",
    finish: "MATTE",
    recipient: {
      name: "Lena Muster",
      address: "Musterstraße 12",
      postalCode: "10115",
      city: "Berlin",
      country: "DE",
      addressLine2: "Hinterhaus",
    },
    mergeVariables: { outside_url: OUTSIDE, inside_url: INSIDE },
    billingId: "Gutscheine",
  });
  // every merge variable is a string, nothing else is sent (no sender, sendDate, metadata)
  assert.deepEqual(Object.keys(res.body.mergeVariables).sort(), [PRINTONE_MERGE_VARIABLES.inside, PRINTONE_MERGE_VARIABLES.outside]);
  for (const v of Object.values(res.body.mergeVariables)) assert.equal(typeof v, "string");
  assert.deepEqual(Object.keys(res.body), ["templateId", "finish", "recipient", "mergeVariables", "billingId"]);
  assert.ok(Buffer.byteLength(JSON.stringify(res.body.mergeVariables)) < 16 * 1024);
});

test("buildPrintOneOrderBody is deterministic (the Idempotency-Key needs identical bytes)", () => {
  const input = { templateId: " tmpl_1 ", finish: "glossy", billingId: "Gutscheine", address: ADDRESS_JSON, outsideUrl: OUTSIDE, insideUrl: INSIDE };
  const a = JSON.stringify(buildPrintOneOrderBody(input).body);
  const b = JSON.stringify(buildPrintOneOrderBody({ ...input, address: { ...ADDRESS_JSON } }).body);
  assert.equal(a, b);
  const body = buildPrintOneOrderBody(input).body;
  assert.equal(body.templateId, "tmpl_1");
  assert.equal(body.finish, "GLOSSY");
});

test("buildPrintOneOrderBody: defaults and refusals", () => {
  const base = { templateId: "tmpl_1", address: ADDRESS_JSON, outsideUrl: OUTSIDE, insideUrl: INSIDE };
  const noExtras = buildPrintOneOrderBody(base);
  assert.equal(noExtras.body.finish, "MATTE");
  assert.equal("billingId" in noExtras.body, false);
  assert.equal(buildPrintOneOrderBody({ ...base, finish: "SHINY" }).body.finish, "MATTE");
  assert.deepEqual(buildPrintOneOrderBody({ ...base, templateId: "" }), { ok: false, reason: "template" });
  assert.deepEqual(buildPrintOneOrderBody({ ...base, templateId: null }), { ok: false, reason: "template" });
  assert.deepEqual(buildPrintOneOrderBody({ ...base, address: null }), { ok: false, reason: "address" });
  assert.deepEqual(buildPrintOneOrderBody({ ...base, outsideUrl: "http://mo.example/x.jpg" }), { ok: false, reason: "urls" });
  assert.deepEqual(buildPrintOneOrderBody({ ...base, insideUrl: "" }), { ok: false, reason: "urls" });
  assert.deepEqual(buildPrintOneOrderBody({ ...base, insideUrl: "data:image/jpeg;base64,AAAA" }), { ok: false, reason: "urls" });
});

// ── statuses ─────────────────────────────────────────────────────────────────

test("mapPrintOneOrderStatus: the seven documented statuses (spec §10)", () => {
  const expected = {
    order_created: "submitted",
    order_pdf_queued: "printing",
    order_pdf_created: "printing",
    order_scheduled: "submitted",
    order_pdf_delivered: "sent",
    order_cancelled: "cancelled",
    order_failed: "failed",
  };
  assert.deepEqual({ ...PRINTONE_ORDER_STATUS_MAP }, expected);
  for (const [raw, status] of Object.entries(expected)) {
    assert.equal(mapPrintOneOrderStatus(raw), status, raw);
    assert.equal(mapPrintOneOrderStatus(raw.toUpperCase()), status);
    assert.equal(isPrintJobStatus(status), true);
  }
});

test("mapPrintOneOrderStatus: friendlyStatus fallback, unknown → null", () => {
  assert.equal(mapPrintOneOrderStatus("order_something_new", "Sent"), "sent");
  assert.equal(mapPrintOneOrderStatus(null, "Failed"), "failed");
  assert.equal(mapPrintOneOrderStatus(undefined, "Cancelled"), "cancelled");
  assert.equal(mapPrintOneOrderStatus("", "Processing"), "submitted");
  assert.equal(mapPrintOneOrderStatus("order_created", "Failed"), "submitted"); // the raw status wins
  assert.equal(mapPrintOneOrderStatus("order_something_new", "Mystery"), null);
  assert.equal(mapPrintOneOrderStatus("__proto__"), null);
  assert.equal(mapPrintOneOrderStatus("constructor", "toString"), null);
  assert.equal(mapPrintOneOrderStatus(42), null);
});

test("status mapping + canAdvancePrintJobStatus: the usual life cycle moves forward, late events do not move back", () => {
  let status = "submitting";
  for (const raw of ["order_created", "order_pdf_queued", "order_pdf_created", "order_pdf_delivered"]) {
    const next = mapPrintOneOrderStatus(raw);
    if (canAdvancePrintJobStatus(status, next)) status = next;
  }
  assert.equal(status, "sent");
  // a late order_scheduled / order_created after printing changes nothing
  assert.equal(canAdvancePrintJobStatus("printing", mapPrintOneOrderStatus("order_scheduled")), false);
  assert.equal(canAdvancePrintJobStatus("sent", mapPrintOneOrderStatus("order_cancelled")), false);
  assert.equal(canAdvancePrintJobStatus("printing", mapPrintOneOrderStatus("order_failed")), true);
});

// ── orders ───────────────────────────────────────────────────────────────────

test("parsePrintOneOrder: the fields Mo uses from a CreateOrderResponse", () => {
  const order = parsePrintOneOrder(orderFixture());
  assert.deepEqual(order, {
    id: "ord_1234567890",
    status: "order_created",
    friendlyStatus: "Success",
    jobStatus: "submitted",
    errors: [],
    warnings: [],
    isBillable: false,
    format: "GREETINGCARD_SQ14",
    templateId: "tmpl_1234567890",
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:01.000Z",
    sendDate: "2026-11-21T00:00:00.000Z",
    mergeVariables: { outside_url: OUTSIDE, inside_url: INSIDE },
  });
});

test("parsePrintOneOrder: failed order with errors, string booleans, junk", () => {
  const failed = parsePrintOneOrder(
    orderFixture({ status: "order_failed", friendlyStatus: "Failed", errors: ["Image could not be loaded\n(404)", { message: "x" }, 7], isBillable: "true" })
  );
  assert.equal(failed.jobStatus, "failed");
  assert.deepEqual(failed.errors, ["Image could not be loaded (404)", "x"]);
  assert.equal(failed.isBillable, true);
  assert.equal(parsePrintOneOrder({ ...orderFixture(), id: "../evil" }), null);
  assert.equal(parsePrintOneOrder({ status: "order_created" }), null);
  for (const bad of [null, undefined, "ord_1", [], 42]) assert.equal(parsePrintOneOrder(bad), null);
  const sparse = parsePrintOneOrder({ id: "ord_2" });
  assert.equal(sparse.status, null);
  assert.equal(sparse.jobStatus, null);
  assert.equal(sparse.isBillable, null);
  assert.deepEqual(sparse.mergeVariables, {});
});

test("parsePrintOneOrderList + printOneOrderUsesAssetToken find Mo's order again", () => {
  const page = {
    page: 1,
    pages: 2,
    pageSize: 3,
    total: 4,
    data: [
      orderFixture({ id: "ord_other", mergeVariables: { outside_url: `${BASE}/api/gift-vouchers/print-asset/${"Z".repeat(32)}-outside.jpg` } }),
      { nonsense: true },
      orderFixture({ id: "ord_mine" }),
    ],
    nextUrl: "https://api.print.one/v2/orders?page=2",
  };
  const { orders, hasMore } = parsePrintOneOrderList(page);
  assert.equal(orders.length, 2);
  assert.equal(hasMore, true);
  assert.equal(orders.find((o) => printOneOrderUsesAssetToken(o, TOKEN))?.id, "ord_mine");
  assert.equal(printOneOrderUsesAssetToken(orders[0], TOKEN), false);
  assert.equal(printOneOrderUsesAssetToken(orders[1], "bad"), false);
  assert.equal(printOneOrderUsesAssetToken(null, TOKEN), false);
  // only the inside variable left → still recognised
  const insideOnly = parsePrintOneOrder(orderFixture({ mergeVariables: { inside_url: INSIDE } }));
  assert.equal(printOneOrderUsesAssetToken(insideOnly, TOKEN), true);
  // last page, a bare array, garbage
  assert.equal(parsePrintOneOrderList({ page: 2, pages: 2, data: [], nextUrl: null }).hasMore, false);
  assert.equal(parsePrintOneOrderList([orderFixture()]).orders.length, 1);
  assert.deepEqual(parsePrintOneOrderList(null), { orders: [], hasMore: false });
});

test("printOneOrderListQuery: newest first, optional billing filter", () => {
  assert.deepEqual(printOneOrderListQuery({ page: 2, limit: 500, billingId: "Gutscheine" }), {
    page: "2",
    limit: "200",
    sortBy: "createdAt:DESC",
    "filter.billingId": "$eq:Gutscheine",
  });
  assert.deepEqual(printOneOrderListQuery(), { page: "1", limit: "100", sortBy: "createdAt:DESC" });
  assert.deepEqual(printOneOrderListQuery({ page: 0, limit: 0, billingId: " " }), { page: "1", limit: "1", sortBy: "createdAt:DESC" });
});

// ── errors ───────────────────────────────────────────────────────────────────

test("parsePrintOneError: v2 shape (message array)", () => {
  const e = parsePrintOneError(400, {
    statusCode: 400,
    message: ["recipient.property excessProperty should not exist", "recipient.name should not be empty", "recipient.name should not be empty"],
  });
  assert.deepEqual(e, {
    status: 400,
    code: null,
    messages: ["recipient.property excessProperty should not exist", "recipient.name should not be empty"],
  });
});

test("parsePrintOneError: v2 shape with a string message (NestJS default) and 412", () => {
  assert.deepEqual(parsePrintOneError(404, { statusCode: 404, message: "Order not found", error: "Not Found" }), {
    status: 404,
    code: null,
    messages: ["Order not found"],
  });
  assert.deepEqual(parsePrintOneError(412, { statusCode: 412, message: ["Order is not cancellable anymore"] }).messages, [
    "Order is not cancellable anymore",
  ]);
  assert.deepEqual(parsePrintOneError(404, { statusCode: 404, error: "Not Found" }).messages, ["Not Found"]);
});

test("parsePrintOneError: v3 shape with code and nested errors", () => {
  assert.deepEqual(
    parsePrintOneError(404, { status: 404, message: "Country 'Unknown' does not exist", code: 10006, uri: "https://api.print.one/v3/x" }),
    { status: 404, code: "10006", messages: ["Country 'Unknown' does not exist"] }
  );
  const nested = parsePrintOneError(400, {
    status: 400,
    message: "Validation failed",
    code: "10017",
    uri: "https://api.print.one/v2/orders",
    errors: [{ code: 10018, status: 3, message: "mergeVariables.outside_url must be a string", errors: [{ code: 1, message: "deep" }] }, "plain"],
  });
  assert.equal(nested.code, "10017");
  assert.deepEqual(nested.messages, ["Validation failed", "mergeVariables.outside_url must be a string", "deep", "plain"]);
  assert.equal(parsePrintOneError(402, { status: 402, message: "Insufficient funds", code: 10078 }).code, "10078");
});

test("parsePrintOneError: text, HTML, empty and junk bodies never throw", () => {
  assert.deepEqual(parsePrintOneError(502, "<html><body>Bad gateway</body></html>"), { status: 502, code: null, messages: [] });
  assert.deepEqual(parsePrintOneError(500, "upstream\tconnect error"), { status: 500, code: null, messages: ["upstream connect error"] });
  assert.deepEqual(parsePrintOneError(null, null), { status: null, code: null, messages: [] });
  assert.deepEqual(parsePrintOneError(400, [1, 2]), { status: 400, code: null, messages: [] });
  const long = parsePrintOneError(400, { message: ["x".repeat(500), "a", "b", "c", "d", "e", "f"] });
  assert.equal(long.messages.length, 5);
  assert.ok(long.messages[0].length <= 200);
});

test("classifyPrintOneFailure: network, server, auth, funds, conflict, not_found, invalid, cancel 412", () => {
  const c = (status, body, op) => classifyPrintOneFailure(parsePrintOneError(status, body), op);
  assert.equal(c(null, null), "network");
  for (const s of [500, 502, 503, 504, 408, 425, 429]) assert.equal(c(s, null), "server", String(s));
  assert.equal(c(401, { statusCode: 401, message: "Unauthorized" }), "auth");
  assert.equal(c(403, { statusCode: 403, message: "Forbidden" }), "auth");
  assert.equal(c(402, null), "funds");
  assert.equal(c(400, { status: 400, message: "InsufficientFunds", code: 10078 }), "funds");
  assert.equal(c(400, { statusCode: 400, message: ["Insufficient balance to create this order"] }), "funds");
  assert.equal(c(409, null), "conflict");
  assert.equal(c(422, { statusCode: 422, message: ["Idempotency key was already used with a different body"] }), "conflict");
  assert.equal(c(404, { statusCode: 404, message: ["Template not found"] }), "not_found");
  assert.equal(c(400, { statusCode: 400, message: ["recipient.name should not be empty"] }), "invalid");
  assert.equal(c(412, { statusCode: 412, message: ["Order is not cancellable yet"] }, "cancel"), "not_cancellable_yet");
  assert.equal(c(412, { statusCode: 412, message: ["Order is not cancellable anymore"] }, "cancel"), "not_cancellable");
  assert.equal(c(412, null, "cancel"), "not_cancellable");
  assert.equal(c(412, null, "create"), "invalid");
});

test("describePrintOneFailure: German admin texts with print.one's details", () => {
  const invalid = parsePrintOneError(400, { statusCode: 400, message: ["recipient.name should not be empty"] });
  assert.equal(describePrintOneFailure("invalid", invalid), "print.one hat die Anfrage abgelehnt (HTTP 400): recipient.name should not be empty.");
  assert.equal(describePrintOneFailure("network", null), "print.one ist nicht erreichbar (Zeitüberschreitung oder Netzwerkfehler).");
  assert.match(describePrintOneFailure("auth", parsePrintOneError(401, null)), /PRINTONE_API_KEY prüfen/);
  assert.match(describePrintOneFailure("not_found", parsePrintOneError(404, null), "create"), /PRINTONE_TEMPLATE_ID/);
  assert.match(describePrintOneFailure("not_found", parsePrintOneError(404, null), "read"), /kennt diesen Auftrag nicht/);
  assert.match(describePrintOneFailure("funds", parsePrintOneError(402, null)), /aufladen/);
  assert.match(describePrintOneFailure("not_cancellable", parsePrintOneError(412, null), "cancel"), /nicht mehr stornieren/);
  assert.match(describePrintOneFailure("unconfigured", null), /nicht eingerichtet/);
  const huge = parsePrintOneError(400, { message: Array.from({ length: 5 }, () => "y".repeat(200)) });
  assert.ok(describePrintOneFailure("invalid", huge).length <= 480);
  assert.equal(
    describePrintOneOrderFailure(parsePrintOneOrder(orderFixture({ status: "order_failed", errors: ["Image could not be loaded"] }))),
    "print.one meldet den Auftrag als fehlgeschlagen: Image could not be loaded."
  );
  assert.equal(describePrintOneOrderFailure(parsePrintOneOrder(orderFixture({ errors: [] }))), "print.one meldet den Auftrag als fehlgeschlagen.");
});

test("planPrintJobRetryMinutes: the voucher plan, then every 12 hours — never gives up", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => planPrintJobRetryMinutes(n, planGiftVoucherRetry)),
    [1, 2, 5, 15, 30, 60, 120, 240, 480, 720]
  );
  assert.equal(planPrintJobRetryMinutes(11, planGiftVoucherRetry), 720);
  assert.equal(planPrintJobRetryMinutes(500, planGiftVoucherRetry), 720);
  assert.equal(planPrintJobRetryMinutes(0, planGiftVoucherRetry), 1);
  assert.equal(planPrintJobRetryMinutes(NaN, planGiftVoucherRetry), 1);
});

// ── the gate ─────────────────────────────────────────────────────────────────

const READY = {
  job: { provider: "printone", status: "queued" },
  voucher: { status: "issued" },
  gateApproved: true,
  printOneConfigured: true,
  configuredProvider: "printone",
  baseUrl: BASE,
  address: ADDRESS_JSON,
  countries: ["DE"],
};

test("decideGiftVoucherPrintSubmission: submit only when every gate is open", () => {
  assert.deepEqual(decideGiftVoucherPrintSubmission(READY), { action: "submit" });
  assert.deepEqual(decideGiftVoucherPrintSubmission({ ...READY, address: { name: "Lena", addressLine1: "Weg 1", postalCode: "10115", city: "Berlin", country: "DE" } }), {
    action: "submit",
  });
});

test("decideGiftVoucherPrintSubmission: the blockers, in spec order", () => {
  const d = (patch) => decideGiftVoucherPrintSubmission({ ...READY, ...patch });
  const pick = (r) => (r.action === "block" ? [r.code, r.scope] : [r.action]);
  assert.deepEqual(pick(d({ job: null })), ["not_found", "job"]);
  assert.deepEqual(pick(d({ job: { provider: "manual", status: "queued" } })), ["manual", "job"]);
  assert.deepEqual(pick(d({ gateApproved: false })), ["gate_off", "global"]);
  assert.deepEqual(pick(d({ printOneConfigured: false })), ["not_configured", "global"]);
  assert.deepEqual(pick(d({ configuredProvider: "manual" })), ["manual", "global"]);
  assert.deepEqual(pick(d({ baseUrl: null })), ["not_configured", "global"]);
  assert.deepEqual(pick(d({ job: { provider: "printone", status: "review" } })), ["review", "job"]);
  assert.deepEqual(pick(d({ job: { provider: "printone", status: "submitting" } })), ["not_ready", "job"]);
  for (const s of ["failed", "cancelled", "done"]) assert.deepEqual(pick(d({ job: { provider: "printone", status: s } })), ["not_ready", "job"], s);
  assert.deepEqual(pick(d({ voucher: null })), ["not_found", "job"]);
  for (const s of ["pending", "held", "issuing", "failed"]) assert.deepEqual(pick(d({ voucher: { status: s } })), ["not_ready", "job"], s);
  for (const s of ["deactivated", "cancelled", "rejected"]) assert.deepEqual(pick(d({ voucher: { status: s } })), ["not_ready", "voucher_ended"], s);
  assert.deepEqual(pick(d({ address: null })), ["not_ready", "job"]);
  assert.deepEqual(pick(d({ address: { ...ADDRESS_JSON, postal_code: "123" } })), ["not_ready", "job"]);
  assert.deepEqual(pick(d({ address: { ...ADDRESS_JSON, country: "AT" } })), ["not_ready", "job"]);
  assert.deepEqual(pick(d({ address: { ...ADDRESS_JSON, country: "AT", postal_code: "1010" }, countries: ["DE", "AT"] })), ["submit"]);
  // the legal gate is checked before anything about the job's data
  assert.deepEqual(pick(d({ gateApproved: false, voucher: { status: "held" }, address: null })), ["gate_off", "global"]);
});

test("decideGiftVoucherPrintSubmission: a card is held while its voucher carries a revoke flag", () => {
  // A refund or cancellation is open (the card may be deactivated in a moment, or a refund stayed
  // on a spent card for the operator): not submitted, the job stays queued and is tried again.
  const held = decideGiftVoucherPrintSubmission({ ...READY, voucher: { status: "issued", revoking: true } });
  assert.deepEqual(held, { action: "block", code: "not_ready", scope: "job", message: GIFT_VOUCHER_PRINT_HELD_MESSAGE });
  assert.match(held.message, /Stornierung oder Erstattung offen/);
  // Settled (no flag, or its acknowledged form — the gift-voucher-print.ts caller passes false): submitted.
  for (const revoking of [false, undefined]) {
    assert.deepEqual(decideGiftVoucherPrintSubmission({ ...READY, voucher: { status: "issued", revoking } }), { action: "submit" }, String(revoking));
  }
  // An ended voucher stays "voucher_ended" (the sweep cancels the job), whatever the flag.
  assert.equal(decideGiftVoucherPrintSubmission({ ...READY, voucher: { status: "deactivated", revoking: true } }).scope, "voucher_ended");
  // The global gates come first.
  assert.equal(decideGiftVoucherPrintSubmission({ ...READY, gateApproved: false, voucher: { status: "issued", revoking: true } }).code, "gate_off");
});

test("giftVoucherPrintGlobalBlock: the gates in front of every submission", () => {
  const open = { gateApproved: true, printOneConfigured: true, configuredProvider: "printone", baseUrl: BASE };
  assert.equal(giftVoucherPrintGlobalBlock(open), null);
  assert.equal(giftVoucherPrintGlobalBlock({ ...open, gateApproved: false }).code, "gate_off");
  assert.match(giftVoucherPrintGlobalBlock({ ...open, gateApproved: false }).message, /GIFT_VOUCHER_PRINT_SENDS_APPROVED/);
  assert.equal(giftVoucherPrintGlobalBlock({ ...open, printOneConfigured: false }).code, "not_configured");
  assert.equal(giftVoucherPrintGlobalBlock({ ...open, configuredProvider: "manual" }).code, "manual");
  assert.match(giftVoucherPrintGlobalBlock({ ...open, baseUrl: null }).message, /PUBLIC_BASE_URL/);
  // fail-closed: everything off → the legal gate is named first
  assert.equal(giftVoucherPrintGlobalBlock({ gateApproved: false, printOneConfigured: false, configuredProvider: "manual", baseUrl: null }).code, "gate_off");
});

test("decideGiftVoucherPrintSubmission: already at print.one is reported, a lost 'submitting' job is recovered by the sweep", () => {
  for (const s of ["submitted", "printing", "sent"]) {
    assert.deepEqual(decideGiftVoucherPrintSubmission({ ...READY, gateApproved: false, job: { provider: "printone", status: s } }), {
      action: "already",
      status: s,
    });
  }
  assert.deepEqual(decideGiftVoucherPrintSubmission({ ...READY, job: { provider: "printone", status: "submitting" }, recovering: true }), {
    action: "submit",
  });
  const blocked = decideGiftVoucherPrintSubmission({ ...READY, address: { ...ADDRESS_JSON, postal_code: "1" } });
  assert.match(blocked.message, /Postleitzahl/);
});

// ── template ─────────────────────────────────────────────────────────────────

test("template body: GREETINGCARD_SQ14, page 1 outside, page 2 inside, nothing but the image", () => {
  const body = buildPrintOneTemplateBody();
  assert.equal(body.format, PRINTONE_TEMPLATE_FORMAT);
  assert.equal(body.pages.length, 2);
  assert.match(body.pages[0].content, /src="\{\{outside_url\}\}"/);
  assert.match(body.pages[1].content, /src="\{\{inside_url\}\}"/);
  for (const page of body.pages) {
    const vars = [...page.content.matchAll(/\{\{\{?\s*([^}\s]+)\s*\}?\}\}/g)].map((m) => m[1]);
    assert.equal(vars.length, 1);
    assert.match(page.content, /width:100%;height:100%;object-fit:cover/);
  }
  assert.equal(printOneTemplatePageHtml("inside_url").includes("{{inside_url}}"), true);
  assert.deepEqual(body.labels, ["Mo", "Geschenkgutschein"]);
  assert.ok(body.name.length > 0);
});

test("parsePrintOneTemplate + printOneTemplateIssues", () => {
  const good = parsePrintOneTemplate({
    id: "tmpl_1",
    name: "Mo",
    format: "GREETINGCARD_SQ14",
    version: 3,
    mergeVariables: ["outside_url", "inside_url"],
    pages: [{ orderingKey: 1, content: "x" }, { orderingKey: 2, content: "y" }],
  });
  assert.deepEqual(good, { id: "tmpl_1", name: "Mo", format: "GREETINGCARD_SQ14", version: 3, mergeVariables: ["outside_url", "inside_url"], pages: 2 });
  assert.deepEqual(printOneTemplateIssues(good), []);
  const bad = parsePrintOneTemplate({ id: "tmpl_2", format: "POSTCARD_SQ15", mergeVariables: ["outside_url", "first_name"], pages: [{}] });
  const issues = printOneTemplateIssues(bad);
  assert.equal(issues.length, 4);
  assert.match(issues.join(" "), /POSTCARD_SQ15/);
  assert.match(issues.join(" "), /inside_url/);
  assert.match(issues.join(" "), /first_name/);
  assert.deepEqual(printOneTemplateIssues(null), ["Vorlage nicht lesbar."]);
  assert.equal(parsePrintOneTemplate({ name: "no id" }), null);
});

test("geometry constants match the help center (SQ14 spread, bleed, circle)", () => {
  assert.equal(PRINTONE_SQ14_SPREAD.widthPx, 3378);
  assert.equal(PRINTONE_SQ14_SPREAD.heightPx, 1724);
  assert.equal(PRINTONE_SQ14_SPREAD.bleedPx, 35);
  assert.equal(PRINTONE_SQ14_SPREAD.foldX * 2, PRINTONE_SQ14_SPREAD.widthPx);
  assert.equal(PRINTONE_SQ14_SPREAD.addressCirclePx, 909);
});

test("printOneKeyLooksLive: only keys that say 'live'", () => {
  assert.equal(printOneKeyLooksLive("live_abc123"), true);
  assert.equal(printOneKeyLooksLive("pk_LIVE_abc"), true);
  assert.equal(printOneKeyLooksLive("test_abc123"), false);
  assert.equal(printOneKeyLooksLive("live-test-key"), false);
  assert.equal(printOneKeyLooksLive("a1b2c3"), false);
  assert.equal(printOneKeyLooksLive(null), false);
});
