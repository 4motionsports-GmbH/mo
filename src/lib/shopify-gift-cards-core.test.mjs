import { test } from "node:test";
import assert from "node:assert/strict";
import { isMutation } from "./shopify-retry.mjs";
import { giftVoucherProductHandles } from "./gift-voucher-flags.mjs";
import {
  ACCESS_SCOPES_QUERY,
  FULFILLMENT_CREATE_MUTATION,
  FULFILLMENT_ORDERS_QUERY,
  GIFT_CARD_BY_ID_QUERY,
  GIFT_CARD_CONFIGURATION_QUERY,
  GIFT_CARD_CREATE_MUTATION,
  GIFT_CARD_DEACTIVATE_MUTATION,
  GIFT_CARDS_BY_CODE_QUERY,
  GIFT_VOUCHER_OPTIONAL_SCOPES,
  GIFT_VOUCHER_PRODUCTS_QUERY,
  GIFT_VOUCHER_REQUIRED_SCOPES,
  ORDER_SNAPSHOT_QUERY,
  centsToShopifyDecimal,
  classifyGiftCardUserErrors,
  describeAdminGraphqlError,
  describeGiftVoucherProductIssues,
  evaluateGiftVoucherScopes,
  extractOrderRisk,
  fulfillmentUserErrorMessage,
  giftCardDeactivateErrorMessage,
  giftCardGid,
  giftCardLastFour,
  giftCardMutationFailure,
  giftCardSearchQuery,
  giftVoucherCatalogHandles,
  hasScope,
  isGiftVoucherCatalogHandle,
  isIsoCalendarDate,
  isRetryableAdminError,
  isTemporaryFulfillmentBlock,
  lineItemGid,
  maskGiftCardCode,
  moneyAmountToCents,
  normalizeGiftCardCode,
  orderGid,
  parseGiftCardConfiguration,
  parseGiftCardNode,
  parseGiftVoucherProduct,
  parseOrderSnapshot,
  pickGiftCardByCode,
  planGiftVoucherFulfillment,
  scrubSecret,
  shopifyGid,
} from "./shopify-gift-cards-core.mjs";

// A Mo-style code (16 symbols of the voucher alphabet) and how Shopify echoes it.
const CODE = "K7QM2XWP9RTD4HVB";
const CODE_LOWER = CODE.toLowerCase();

// Realistic GiftCard node (GIFT_CARD_FIELDS) — Shopify answers amounts as Decimal strings
// with one decimal and the last characters lower-case.
const CARD_NODE = {
  id: "gid://shopify/GiftCard/1063936324",
  lastCharacters: "d4vb",
  balance: { amount: "50.0", currencyCode: "EUR" },
  initialValue: { amount: "50.0", currencyCode: "EUR" },
  expiresOn: "2029-12-31",
  enabled: true,
  deactivatedAt: null,
  createdAt: "2026-11-20T10:15:02Z",
};

// ── GraphQL documents ────────────────────────────────────────────────────────

const DOCUMENTS = {
  GIFT_CARD_CREATE_MUTATION,
  GIFT_CARD_DEACTIVATE_MUTATION,
  FULFILLMENT_CREATE_MUTATION,
  GIFT_CARD_BY_ID_QUERY,
  GIFT_CARDS_BY_CODE_QUERY,
  GIFT_CARD_CONFIGURATION_QUERY,
  ACCESS_SCOPES_QUERY,
  GIFT_VOUCHER_PRODUCTS_QUERY,
  ORDER_SNAPSHOT_QUERY,
  FULFILLMENT_ORDERS_QUERY,
};

test("documents: every mutation starts with the mutation keyword, every read is a named query", () => {
  // adminGraphql auto-retries anything isMutation() does not recognise on a transport
  // error — a giftCardCreate retried blindly could issue a second card.
  for (const doc of [GIFT_CARD_CREATE_MUTATION, GIFT_CARD_DEACTIVATE_MUTATION, FULFILLMENT_CREATE_MUTATION]) {
    assert.equal(isMutation(doc), true, doc);
  }
  for (const doc of [
    GIFT_CARD_BY_ID_QUERY,
    GIFT_CARDS_BY_CODE_QUERY,
    GIFT_CARD_CONFIGURATION_QUERY,
    ACCESS_SCOPES_QUERY,
    GIFT_VOUCHER_PRODUCTS_QUERY,
    ORDER_SNAPSHOT_QUERY,
    FULFILLMENT_ORDERS_QUERY,
  ]) {
    assert.equal(isMutation(doc), false);
    assert.match(doc.trim(), /^query GiftVoucher\w+/);
  }
});

test("documents: braces and parentheses are balanced (no typo slips into a request)", () => {
  for (const [name, doc] of Object.entries(DOCUMENTS)) {
    let depth = 0;
    let paren = 0;
    for (const ch of doc) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (ch === "(") paren++;
      if (ch === ")") paren--;
      assert.ok(depth >= 0 && paren >= 0, name);
    }
    assert.equal(depth, 0, name);
    assert.equal(paren, 0, name);
    assert.doesNotMatch(doc, /\$\{/, `${name}: unresolved interpolation`);
  }
});

test("documents: the create never sets a customer or recipient, selects code + typed userErrors", () => {
  // customerId / recipientAttributes would let Shopify mail the code itself.
  assert.doesNotMatch(GIFT_CARD_CREATE_MUTATION, /customerId|recipientAttributes|recipient/);
  assert.match(GIFT_CARD_CREATE_MUTATION, /giftCardCreate\(input: \$input\)/);
  assert.match(GIFT_CARD_CREATE_MUTATION, /giftCardCode/);
  assert.match(GIFT_CARD_CREATE_MUTATION, /userErrors \{ code field message \}/);
  for (const field of ["lastCharacters", "balance", "initialValue", "expiresOn", "enabled", "deactivatedAt", "createdAt"]) {
    assert.match(GIFT_CARD_CREATE_MUTATION, new RegExp(field));
    assert.match(GIFT_CARD_BY_ID_QUERY, new RegExp(field));
    assert.match(GIFT_CARDS_BY_CODE_QUERY, new RegExp(field));
  }
  // fulfillmentCreate's userErrors are the plain UserError — `code` would be a schema error.
  assert.match(FULFILLMENT_CREATE_MUTATION, /userErrors \{ field message \}/);
  assert.doesNotMatch(FULFILLMENT_CREATE_MUTATION, /\bcode\b/);
});

test("documents: products by handle (not the deprecated productByHandle), risk, fulfilment orders", () => {
  assert.match(GIFT_VOUCHER_PRODUCTS_QUERY, /voucher: productByIdentifier\(identifier: \{ handle: \$voucher \}\)/);
  assert.match(GIFT_VOUCHER_PRODUCTS_QUERY, /print: productByIdentifier\(identifier: \{ handle: \$print \}\)/);
  assert.doesNotMatch(GIFT_VOUCHER_PRODUCTS_QUERY, /productByHandle/);
  for (const field of ["isGiftCard", "legacyResourceId", "taxable", "requiresShipping", "price"]) {
    assert.match(GIFT_VOUCHER_PRODUCTS_QUERY, new RegExp(field));
  }
  for (const field of ["test", "cancelledAt", "displayFinancialStatus", "fullyPaid", "email", "currencyCode", "recommendation", "riskLevel"]) {
    assert.match(ORDER_SNAPSHOT_QUERY, new RegExp(`\\b${field}\\b`));
  }
  assert.match(FULFILLMENT_ORDERS_QUERY, /displayable: true/);
  assert.match(FULFILLMENT_ORDERS_QUERY, /supportedActions \{ action \}/);
  assert.match(FULFILLMENT_ORDERS_QUERY, /remainingQuantity/);
  assert.match(GIFT_CARDS_BY_CODE_QUERY, /giftCards\(first: 5, query: \$query\)/);
  assert.match(ACCESS_SCOPES_QUERY, /currentAppInstallation \{\s+accessScopes \{ handle \}/);
  assert.match(GIFT_CARD_CONFIGURATION_QUERY, /issueLimit \{ amount currencyCode \}/);
});

// ── Money and dates ──────────────────────────────────────────────────────────

test("moneyAmountToCents: exact for Shopify Decimal strings and plain numbers", () => {
  assert.equal(moneyAmountToCents("100.0"), 10000);
  assert.equal(moneyAmountToCents("27.84"), 2784);
  assert.equal(moneyAmountToCents("50"), 5000);
  assert.equal(moneyAmountToCents("0.01"), 1);
  assert.equal(moneyAmountToCents(" 12.30 "), 1230);
  assert.equal(moneyAmountToCents("-10.0"), -1000); // a debit transaction
  assert.equal(moneyAmountToCents("-0.00"), 0);
  assert.equal(moneyAmountToCents(50), 5000);
  assert.equal(moneyAmountToCents(49.9), 4990);
  assert.equal(moneyAmountToCents(0.1 + 0.2), 30); // no float drift
  assert.equal(moneyAmountToCents("19.999"), 2000); // half away from zero on the third decimal
  assert.equal(moneyAmountToCents("0.005"), 1);
  assert.equal(moneyAmountToCents("0.0049"), 0);
});

test("moneyAmountToCents: junk is null", () => {
  for (const junk of ["", " ", "abc", "1,00", "1.2.3", "1e3", ".5", "+5", "99999999999999999", null, undefined, NaN, Infinity, {}, []]) {
    assert.equal(moneyAmountToCents(junk), null, String(junk));
  }
});

test("centsToShopifyDecimal: positive whole cents → Decimal string, else null", () => {
  assert.equal(centsToShopifyDecimal(5000), "50.00");
  assert.equal(centsToShopifyDecimal(1), "0.01");
  assert.equal(centsToShopifyDecimal(100), "1.00");
  assert.equal(centsToShopifyDecimal(123456), "1234.56");
  for (const bad of [0, -1, 1.5, NaN, Infinity, "5000", null, undefined]) {
    assert.equal(centsToShopifyDecimal(bad), null, String(bad));
  }
});

test("isIsoCalendarDate: real calendar dates only", () => {
  assert.equal(isIsoCalendarDate("2029-12-31"), true);
  assert.equal(isIsoCalendarDate("2028-02-29"), true);
  assert.equal(isIsoCalendarDate("2029-02-29"), false);
  assert.equal(isIsoCalendarDate("2029-13-01"), false);
  assert.equal(isIsoCalendarDate("2029-00-10"), false);
  assert.equal(isIsoCalendarDate("2029-1-01"), false);
  assert.equal(isIsoCalendarDate("2029-12-31T00:00:00Z"), false);
  assert.equal(isIsoCalendarDate(null), false);
});

// ── Codes ────────────────────────────────────────────────────────────────────

test("normalizeGiftCardCode: what Shopify accepts (8–20 ASCII letters/digits), upper-case", () => {
  assert.equal(normalizeGiftCardCode("k7qm 2xwp 9rtd 4hvb"), CODE);
  assert.equal(normalizeGiftCardCode("K7QM-2XWP-9RTD-4HVB"), CODE);
  assert.equal(normalizeGiftCardCode("K7QM.2XWP.9RTD.4HVB"), CODE);
  assert.equal(normalizeGiftCardCode(" K7QM2XWP9RTD4HVB\n"), CODE);
  assert.equal(normalizeGiftCardCode("ABCDEFGH"), "ABCDEFGH");
  assert.equal(normalizeGiftCardCode("A".repeat(20)), "A".repeat(20));
  assert.equal(normalizeGiftCardCode("ABCDEFG"), null);
  assert.equal(normalizeGiftCardCode("A".repeat(21)), null);
  assert.equal(normalizeGiftCardCode("STRAßE1234"), null); // ß would upper-case to SS
  assert.equal(normalizeGiftCardCode("ÄBCDEFGH"), null);
  assert.equal(normalizeGiftCardCode("ABCD_EFGH"), null);
  assert.equal(normalizeGiftCardCode(12345678), null);
  assert.equal(normalizeGiftCardCode(null), null);
});

test("code helpers: last four, search term, mask", () => {
  assert.equal(giftCardLastFour(CODE_LOWER), "4HVB");
  assert.equal(giftCardLastFour("short"), null);
  assert.equal(giftCardSearchQuery("K7QM 2XWP 9RTD 4HVB"), CODE_LOWER);
  assert.equal(giftCardSearchQuery('x" OR status:enabled'), null); // never a search injection
  assert.equal(maskGiftCardCode(CODE), "•••• •••• •••• 4HVB");
  assert.equal(maskGiftCardCode("nope"), "••••");
});

test("scrubSecret: the code disappears in any spelling, other text stays", () => {
  const msg = `Variable $input … value {"code":"${CODE_LOWER}"} — also ${CODE} and k7qm 2xwp 9rtd 4hvb and K7QM-2XWP-9RTD-4HVB`;
  const out = scrubSecret(msg, CODE);
  assert.doesNotMatch(out, /k7qm|K7QM|4hvb|4HVB/i);
  assert.match(out, /^Variable \$input … value \{"code":"•••"\} — also ••• and ••• and •••$/);
  assert.equal(scrubSecret("nothing secret", CODE), "nothing secret");
  assert.equal(scrubSecret("abc", "ab"), "abc"); // too short to be a code
  assert.equal(scrubSecret("text", null), "text");
  assert.equal(scrubSecret(null, CODE), "");
});

// ── Ids ──────────────────────────────────────────────────────────────────────

test("gids: numeric or same-type gid → canonical gid; other types and junk → null", () => {
  assert.equal(giftCardGid("1063936324"), "gid://shopify/GiftCard/1063936324");
  assert.equal(giftCardGid(1063936324), "gid://shopify/GiftCard/1063936324");
  assert.equal(giftCardGid("gid://shopify/GiftCard/1063936324"), "gid://shopify/GiftCard/1063936324");
  assert.equal(orderGid("820982911946154508"), "gid://shopify/Order/820982911946154508");
  assert.equal(orderGid("gid://shopify/Order/450789469?x=1"), "gid://shopify/Order/450789469");
  assert.equal(orderGid("gid://shopify/GiftCard/1"), null);
  assert.equal(lineItemGid("gid://shopify/LineItem/866550311766439020"), "gid://shopify/LineItem/866550311766439020");
  assert.equal(lineItemGid("#1001"), null);
  assert.equal(shopifyGid("Order", ""), null);
  assert.equal(shopifyGid("Order", null), null);
});

// ── Gift cards ───────────────────────────────────────────────────────────────

test("parseGiftCardNode: a giftCardCreate / giftCard node → cents, upper-case last characters", () => {
  assert.deepEqual(parseGiftCardNode(CARD_NODE), {
    id: "gid://shopify/GiftCard/1063936324",
    lastCharacters: "D4VB",
    balanceCents: 5000,
    initialCents: 5000,
    currency: "EUR",
    expiresOn: "2029-12-31",
    enabled: true,
    deactivatedAt: null,
    createdAt: "2026-11-20T10:15:02Z",
  });
  // partly redeemed, deactivated, never expiring
  const used = parseGiftCardNode({
    ...CARD_NODE,
    balance: { amount: "12.5", currencyCode: "EUR" },
    expiresOn: null,
    enabled: false,
    deactivatedAt: "2026-12-01T08:00:00Z",
  });
  assert.equal(used?.balanceCents, 1250);
  assert.equal(used?.expiresOn, null);
  assert.equal(used?.enabled, false);
  assert.equal(used?.deactivatedAt, "2026-12-01T08:00:00Z");
});

test("parseGiftCardNode: a node missing a non-null field is unreadable", () => {
  assert.equal(parseGiftCardNode(null), null);
  assert.equal(parseGiftCardNode({ ...CARD_NODE, id: "" }), null);
  assert.equal(parseGiftCardNode({ ...CARD_NODE, balance: null }), null);
  assert.equal(parseGiftCardNode({ ...CARD_NODE, initialValue: { amount: "x" } }), null);
  assert.equal(parseGiftCardNode({ ...CARD_NODE, lastCharacters: undefined }), null);
  assert.equal(parseGiftCardNode({ ...CARD_NODE, enabled: undefined }), null);
  assert.equal(parseGiftCardNode({ ...CARD_NODE, expiresOn: "soon" })?.expiresOn, null);
});

test("pickGiftCardByCode: adopt only the one card whose last characters match", () => {
  const ours = { ...CARD_NODE, lastCharacters: "4hvb" };
  const other = { ...CARD_NODE, id: "gid://shopify/GiftCard/2", lastCharacters: "zz99" };
  assert.equal(pickGiftCardByCode([other, ours], CODE).card?.id, "gid://shopify/GiftCard/1063936324");
  assert.deepEqual(pickGiftCardByCode([other], CODE), { card: null, ambiguous: false });
  assert.deepEqual(pickGiftCardByCode([], CODE), { card: null, ambiguous: false });
  assert.equal(pickGiftCardByCode([ours, { ...ours }], CODE).card?.lastCharacters, "4HVB"); // same node twice
  const twin = { ...ours, id: "gid://shopify/GiftCard/3" };
  assert.deepEqual(pickGiftCardByCode([ours, twin], CODE), { card: null, ambiguous: true });
  assert.deepEqual(pickGiftCardByCode([ours], "bad"), { card: null, ambiguous: false });
  assert.deepEqual(pickGiftCardByCode(null, CODE), { card: null, ambiguous: false });
});

test("classifyGiftCardUserErrors: TAKEN, limit, internal, invalid", () => {
  assert.equal(classifyGiftCardUserErrors([], CODE), null);
  assert.equal(classifyGiftCardUserErrors(undefined, CODE), null);

  const taken = classifyGiftCardUserErrors(
    [{ code: "TAKEN", field: ["input", "code"], message: `Code ${CODE_LOWER} has already been taken` }],
    CODE
  );
  assert.equal(taken?.kind, "taken");
  assert.equal(taken?.retryable, true);
  assert.doesNotMatch(taken?.message ?? "", /4hvb/i);

  const limit = classifyGiftCardUserErrors(
    [{ code: "GIFT_CARD_LIMIT_EXCEEDED", field: ["input", "initialValue"], message: "Initial value exceeds the limit" }],
    CODE
  );
  assert.equal(limit?.kind, "limit");
  assert.equal(limit?.retryable, false);

  const internal = classifyGiftCardUserErrors([{ code: "INTERNAL_ERROR", field: null, message: "Unexpected internal error happened." }], CODE);
  assert.equal(internal?.kind, "unknown");
  assert.equal(internal?.retryable, true);

  const invalid = classifyGiftCardUserErrors(
    [{ code: "INVALID", field: ["input", "code"], message: `Code '${CODE_LOWER}' is invalid` }, { code: "INTERNAL_ERROR", message: "x" }],
    CODE
  );
  assert.equal(invalid?.kind, "invalid");
  assert.equal(invalid?.retryable, false);
  assert.deepEqual(invalid?.codes, ["INVALID", "INTERNAL_ERROR"]);
  assert.match(invalid?.message ?? "", /^Shopify lehnt die Geschenkkarte ab: Code '•••' is invalid; x \(INVALID, INTERNAL_ERROR\)$/);

  // TAKEN wins: the card with this code exists — maybe it is ours.
  assert.equal(classifyGiftCardUserErrors([{ code: "TOO_LONG", message: "x" }, { code: "TAKEN", message: "y" }], CODE)?.kind, "taken");
  assert.equal(classifyGiftCardUserErrors([{ message: "Something" }], CODE)?.kind, "invalid");
});

test("deactivate / fulfilment userError messages", () => {
  assert.equal(
    giftCardDeactivateErrorMessage([{ code: "GIFT_CARD_NOT_FOUND", field: ["id"], message: "Gift card not found" }]),
    "Shopify kennt diese Geschenkkarte nicht (GIFT_CARD_NOT_FOUND)."
  );
  assert.match(giftCardDeactivateErrorMessage([{ message: "Nope" }]), /^Shopify kann die Geschenkkarte nicht sperren: Nope$/);
  assert.match(
    fulfillmentUserErrorMessage([{ field: ["fulfillment"], message: "Fulfillment order is not in a fulfillable state" }]),
    /nicht als erledigt markieren: Fulfillment order is not in a fulfillable state$/
  );
  assert.match(fulfillmentUserErrorMessage(null), /ohne Begründung$/);
});

// ── Errors thrown by adminGraphql ────────────────────────────────────────────

const graphqlError = (errors) => new Error(`Shopify GraphQL errors: ${JSON.stringify(errors)}`);

test("describeAdminGraphqlError: a missing scope names the scope (ACCESS_DENIED)", () => {
  const denied = describeAdminGraphqlError(
    graphqlError([
      {
        message: "Access denied for giftCardCreate field. Required access: `write_gift_cards` access scope.",
        locations: [{ line: 3, column: 5 }],
        path: ["giftCardCreate"],
        extensions: {
          code: "ACCESS_DENIED",
          documentation: "https://shopify.dev/api/usage/access-scopes",
          requiredAccess: "`write_gift_cards` access scope.",
        },
      },
    ])
  );
  assert.equal(denied.kind, "denied");
  assert.equal(denied.scope, "write_gift_cards");
  assert.deepEqual(denied.codes, ["ACCESS_DENIED"]);
  assert.match(denied.message, /Berechtigung write_gift_cards fehlt/);
  // No extension code, only the text (the shape the showroom saw for read_themes).
  const plain = describeAdminGraphqlError(
    new Error('Shopify GraphQL errors: [{"message":"Access denied for giftCards field. Required access: `read_gift_cards` access scope."}]')
  );
  assert.equal(plain.kind, "denied");
  assert.equal(plain.scope, "read_gift_cards");
  // Alternatives listed: Mo's own scope is named.
  const fo = describeAdminGraphqlError(
    graphqlError([
      {
        message:
          "Access denied for fulfillmentOrders field. Required access: `read_assigned_fulfillment_orders` access scope or `read_merchant_managed_fulfillment_orders` access scope or `read_third_party_fulfillment_orders` access scope.",
        extensions: { code: "ACCESS_DENIED" },
      },
    ])
  );
  assert.equal(fo.scope, "read_merchant_managed_fulfillment_orders");
  // Unparseable list, still recognisable.
  assert.equal(describeAdminGraphqlError(new Error("Shopify GraphQL errors: ACCESS_DENIED")).kind, "denied");
});

test("describeAdminGraphqlError: throttle, timeout, configuration, token, HTTP", () => {
  const throttled = Object.assign(new Error("Shopify GraphQL throttled after 5 retries"), { name: "ShopifyThrottledError" });
  assert.equal(describeAdminGraphqlError(throttled).kind, "throttled");
  assert.equal(describeAdminGraphqlError(new Error("Shopify GraphQL throttled (no retry requested)")).kind, "throttled");
  assert.equal(describeAdminGraphqlError(graphqlError([{ message: "Throttled", extensions: { code: "THROTTLED" } }])).kind, "throttled");
  assert.equal(describeAdminGraphqlError(new DOMException("The operation was aborted due to timeout", "TimeoutError")).kind, "timeout");
  assert.equal(describeAdminGraphqlError(new DOMException("This operation was aborted", "AbortError")).kind, "timeout");

  const env = describeAdminGraphqlError(new Error("Missing env var SHOPIFY_STORE_DOMAIN"));
  assert.equal(env.kind, "unconfigured");
  assert.match(env.message, /SHOPIFY_STORE_DOMAIN fehlt/);

  const token = describeAdminGraphqlError(
    new Error('Shopify token exchange failed: HTTP 401 Unauthorized — {"error":"invalid_client"}')
  );
  assert.equal(token.kind, "denied");
  assert.equal(token.httpStatus, 401);
  assert.equal(describeAdminGraphqlError(new Error("Shopify token exchange failed: HTTP 503 Service Unavailable — down")).kind, "http_transient");
  assert.equal(describeAdminGraphqlError(new Error("Shopify token response missing access_token: {}")).kind, "denied");

  assert.equal(describeAdminGraphqlError(new Error('Shopify GraphQL 401 Unauthorized: {"errors":"[API] Invalid API key or access token"}')).kind, "denied");
  assert.equal(describeAdminGraphqlError(new Error("Shopify GraphQL 403 Forbidden: ")).kind, "denied");
  const bad = describeAdminGraphqlError(new Error("Shopify GraphQL 502 Bad Gateway: <html>"));
  assert.equal(bad.kind, "http_transient");
  assert.equal(bad.httpStatus, 502);
  assert.equal(describeAdminGraphqlError(new Error("Shopify GraphQL 504 Gateway Timeout: ")).kind, "http_transient");
  assert.equal(describeAdminGraphqlError(new Error("Shopify GraphQL 429 Too Many Requests: ")).kind, "throttled");
  const notFound = describeAdminGraphqlError(new Error("Shopify GraphQL 404 Not Found: no such version"));
  assert.equal(notFound.kind, "http_client");
  assert.equal(notFound.message, "Shopify antwortet mit HTTP 404.");
  assert.equal(
    describeAdminGraphqlError(new Error("Shopify GraphQL 404 Not Found: no such version"), { detail: true }).message,
    "Shopify antwortet mit HTTP 404. — Not Found: no such version"
  );
});

test("describeAdminGraphqlError: internal, schema errors, no data, network, unknown", () => {
  const internal = describeAdminGraphqlError(
    graphqlError([
      {
        message: "Internal error. Looks like something went wrong on our end.\nRequest ID: 1b355a21 (include this in support requests).",
        extensions: { code: "INTERNAL_SERVER_ERROR", requestId: "1b355a21" },
      },
    ])
  );
  assert.equal(internal.kind, "graphql_internal");
  assert.match(internal.message, /INTERNAL_SERVER_ERROR/);

  const schema = describeAdminGraphqlError(
    graphqlError([{ message: "Field 'nope' doesn't exist on type 'GiftCard'", extensions: { code: "undefinedField" } }])
  );
  assert.equal(schema.kind, "graphql");
  assert.equal(schema.message, "Shopify lehnt die Anfrage ab (UNDEFINEDFIELD).");

  assert.equal(describeAdminGraphqlError(new Error("Shopify GraphQL returned no data")).kind, "no_data");
  assert.equal(describeAdminGraphqlError(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })).kind, "network");
  assert.equal(describeAdminGraphqlError(new Error("connect ETIMEDOUT 23.227.38.33:443")).kind, "network");

  const boom = describeAdminGraphqlError(new Error("boom"));
  assert.equal(boom.kind, "unknown");
  assert.equal(boom.message, "Unerwarteter Fehler bei der Shopify-Anfrage.");
  assert.match(describeAdminGraphqlError(new Error("boom"), { detail: true }).message, /— boom$/);
  assert.equal(describeAdminGraphqlError(null).kind, "unknown");
  assert.equal(describeAdminGraphqlError("Missing env var SHOPIFY_API_VERSION").kind, "unconfigured");
});

test("describeAdminGraphqlError: never leaks the code Shopify echoes in an INVALID_VARIABLE error", () => {
  const echo = graphqlError([
    {
      message: "Variable $input of type GiftCardCreateInput! was provided invalid value for initialValue (Could not coerce value)",
      extensions: {
        value: { initialValue: "x", code: CODE, note: "Mo-Geschenkgutschein G-2026-00042" },
        problems: [{ path: ["initialValue"], explanation: "Could not coerce value" }],
      },
    },
  ]);
  const plain = describeAdminGraphqlError(echo);
  assert.equal(plain.kind, "graphql");
  assert.doesNotMatch(JSON.stringify(plain), /K7QM|4HVB/i);
  // Even with detail (not allowed for code-bearing calls, but defended anyway).
  const detailed = describeAdminGraphqlError(new Error(`boom ${CODE_LOWER} for anna@example.com`), { detail: true, secret: CODE });
  assert.doesNotMatch(detailed.message, /k7qm|4hvb|anna@example\.com/i);
  assert.match(detailed.message, /boom ••• for \[E-Mail\]$/);
});

test("isRetryableAdminError / giftCardMutationFailure: an open outcome is 'unknown'", () => {
  const kinds = {
    denied: ["denied", true],
    unconfigured: ["unconfigured", true],
    graphql: ["invalid", false],
    http_client: ["invalid", false],
    throttled: ["unknown", true],
    timeout: ["unknown", true],
    network: ["unknown", true],
    http_transient: ["unknown", true],
    graphql_internal: ["unknown", true],
    no_data: ["unknown", true],
    unknown: ["unknown", true],
  };
  for (const [kind, [mapped, retryable]] of Object.entries(kinds)) {
    const desc = { kind, httpStatus: null, codes: [], scope: null, message: "m" };
    const failure = giftCardMutationFailure(desc);
    assert.equal(failure.kind, mapped, kind);
    assert.equal(failure.retryable, retryable, kind);
    assert.equal(isRetryableAdminError(desc), retryable, kind);
  }
  assert.match(
    giftCardMutationFailure({ kind: "timeout", httpStatus: null, codes: [], scope: null, message: "Zeit." }).message,
    /^Zeit\. Ergebnis offen — Mo sucht die Karte über den Code\.$/
  );
});

// ── Orders ───────────────────────────────────────────────────────────────────

test("extractOrderRisk: the deciding level — HIGH > PENDING > MEDIUM > LOW > NONE", () => {
  assert.deepEqual(
    extractOrderRisk({ recommendation: "ACCEPT", assessments: [{ riskLevel: "LOW" }, { riskLevel: "NONE" }] }),
    { riskLevel: "LOW", riskRecommendation: "ACCEPT" }
  );
  assert.equal(extractOrderRisk({ assessments: [{ riskLevel: "PENDING" }, { riskLevel: "HIGH" }] }).riskLevel, "HIGH");
  assert.equal(extractOrderRisk({ assessments: [{ riskLevel: "MEDIUM" }, { riskLevel: "PENDING" }] }).riskLevel, "PENDING");
  assert.equal(extractOrderRisk({ assessments: [{ riskLevel: "medium" }] }).riskLevel, "MEDIUM");
  assert.deepEqual(extractOrderRisk({ recommendation: "INVESTIGATE", assessments: [] }), {
    riskLevel: null,
    riskRecommendation: "INVESTIGATE",
  });
  assert.deepEqual(extractOrderRisk({ recommendation: "PANIC", assessments: [{ riskLevel: "CRITICAL" }, { riskLevel: "constructor" }] }), {
    riskLevel: null,
    riskRecommendation: null,
  });
  assert.deepEqual(extractOrderRisk(null), { riskLevel: null, riskRecommendation: null });
});

test("parseOrderSnapshot: the order re-read before issuing", () => {
  const node = {
    id: "gid://shopify/Order/820982911946154508",
    legacyResourceId: "820982911946154508",
    name: "#1042",
    test: false,
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    fullyPaid: true,
    email: "kaeufer@example.com",
    currencyCode: "EUR",
    risk: { recommendation: "ACCEPT", assessments: [{ riskLevel: "LOW" }] },
  };
  assert.deepEqual(parseOrderSnapshot(node), {
    id: "820982911946154508",
    gid: "gid://shopify/Order/820982911946154508",
    name: "#1042",
    test: false,
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    fullyPaid: true,
    email: "kaeufer@example.com",
    currencyCode: "EUR",
    riskLevel: "LOW",
    riskRecommendation: "ACCEPT",
  });
  const test_ = parseOrderSnapshot({
    id: "gid://shopify/Order/5",
    test: true,
    cancelledAt: "2026-11-20T12:00:00Z",
    fullyPaid: false,
    displayFinancialStatus: "PENDING",
  });
  assert.equal(test_?.id, "5"); // from the gid when legacyResourceId is absent
  assert.equal(test_?.test, true);
  assert.equal(test_?.fullyPaid, false);
  assert.equal(test_?.email, null);
  assert.equal(test_?.riskLevel, null);
  assert.equal(parseOrderSnapshot({ id: "gid://shopify/Customer/5" }), null);
  assert.equal(parseOrderSnapshot(null), null);
});

// ── Products ─────────────────────────────────────────────────────────────────

const VOUCHER_NODE = {
  id: "gid://shopify/Product/9012345678901",
  legacyResourceId: "9012345678901",
  handle: "designgutschein",
  title: "Geschenkgutschein",
  status: "ACTIVE",
  isGiftCard: false,
  variants: {
    nodes: [
      {
        id: "gid://shopify/ProductVariant/49000000000001",
        legacyResourceId: "49000000000001",
        title: "25 €",
        price: "25.00",
        taxable: false,
        inventoryItem: { requiresShipping: false },
      },
      {
        id: "gid://shopify/ProductVariant/49000000000002",
        legacyResourceId: "49000000000002",
        title: "50 €",
        price: "50.00",
        taxable: false,
        inventoryItem: { requiresShipping: false },
      },
      { id: "gid://shopify/ProductVariant/49000000000003", title: "kaputt", price: null },
    ],
  },
};
const PRINT_NODE = {
  id: "gid://shopify/Product/9012345678902",
  legacyResourceId: "9012345678902",
  handle: "gutschein-premiumkarte",
  title: "Premium-Karte per Post",
  status: "UNLISTED",
  isGiftCard: false,
  variants: {
    nodes: [
      {
        id: "gid://shopify/ProductVariant/49000000000010",
        legacyResourceId: "49000000000010",
        title: "Default Title",
        price: "4.90",
        taxable: true,
        inventoryItem: { requiresShipping: false },
      },
    ],
  },
};
const HANDLES = { voucher: "designgutschein", print: "gutschein-premiumkarte" };

test("parseGiftVoucherProduct: ids, prices in cents, taxable / shipping flags; bad variants skipped", () => {
  const p = parseGiftVoucherProduct(VOUCHER_NODE);
  assert.equal(p?.gid, "gid://shopify/Product/9012345678901");
  assert.equal(p?.numericId, "9012345678901");
  assert.equal(p?.handle, "designgutschein");
  assert.equal(p?.status, "ACTIVE");
  assert.equal(p?.isGiftCard, false);
  assert.deepEqual(p?.variants, [
    { gid: "gid://shopify/ProductVariant/49000000000001", numericId: "49000000000001", title: "25 €", priceCents: 2500, taxable: false, requiresShipping: false },
    { gid: "gid://shopify/ProductVariant/49000000000002", numericId: "49000000000002", title: "50 €", priceCents: 5000, taxable: false, requiresShipping: false },
  ]);
  // numeric id from the gid when legacyResourceId is missing
  assert.equal(parseGiftVoucherProduct({ ...PRINT_NODE, legacyResourceId: undefined })?.numericId, "9012345678902");
  assert.equal(parseGiftVoucherProduct({ ...VOUCHER_NODE, variants: undefined })?.variants.length, 0);
  assert.equal(parseGiftVoucherProduct(null), null); // productByIdentifier: no such handle
  assert.equal(parseGiftVoucherProduct({ id: "gid://shopify/Collection/1" }), null);
});

test("describeGiftVoucherProductIssues: a correct setup has none", () => {
  const issues = describeGiftVoucherProductIssues({
    voucher: parseGiftVoucherProduct(VOUCHER_NODE),
    print: parseGiftVoucherProduct(PRINT_NODE),
    handles: HANDLES,
  });
  assert.deepEqual(issues, []); // the print add-on may be taxable — it is a normal service
});

test("describeGiftVoucherProductIssues: errors and warnings the setup check shows", () => {
  const levels = (input) =>
    describeGiftVoucherProductIssues(input).map((i) => `${i.level}:${i.product}`);
  assert.deepEqual(levels({ voucher: null, print: null, handles: HANDLES }), ["error:voucher", "warning:print"]);
  const giftCard = parseGiftVoucherProduct({ ...VOUCHER_NODE, isGiftCard: true });
  const issues = describeGiftVoucherProductIssues({ voucher: giftCard, print: parseGiftVoucherProduct(PRINT_NODE), handles: HANDLES });
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /Geschenkkarten-Produkt — Mo braucht ein normales Produkt/);

  const taxedShipped = parseGiftVoucherProduct({
    ...VOUCHER_NODE,
    status: "DRAFT",
    variants: {
      nodes: [{ ...VOUCHER_NODE.variants.nodes[0], taxable: true, inventoryItem: { requiresShipping: true } }],
    },
  });
  const t = describeGiftVoucherProductIssues({ voucher: taxedShipped, print: parseGiftVoucherProduct(PRINT_NODE), handles: HANDLES });
  assert.deepEqual(t.map((i) => i.level), ["warning", "warning", "warning"]);
  assert.match(t[0].message, /nicht verkaufsbereit \(Status DRAFT\)/);
  assert.match(t[1].message, /1 Variante\(n\) .* steuerpflichtig/);
  assert.match(t[2].message, /verlangen Versand/);

  const empty = parseGiftVoucherProduct({ ...VOUCHER_NODE, variants: { nodes: [] } });
  assert.deepEqual(levels({ voucher: empty, print: parseGiftVoucherProduct(PRINT_NODE), handles: HANDLES }), ["error:voucher"]);

  const twoVariants = parseGiftVoucherProduct({
    ...PRINT_NODE,
    variants: { nodes: [PRINT_NODE.variants.nodes[0], { ...PRINT_NODE.variants.nodes[0], id: "gid://shopify/ProductVariant/7", inventoryItem: { requiresShipping: true } }] },
  });
  assert.deepEqual(levels({ voucher: parseGiftVoucherProduct(VOUCHER_NODE), print: twoVariants, handles: HANDLES }), [
    "warning:print",
    "warning:print",
  ]);

  const same = describeGiftVoucherProductIssues({
    voucher: parseGiftVoucherProduct(VOUCHER_NODE),
    print: parseGiftVoucherProduct(VOUCHER_NODE),
    handles: { voucher: "designgutschein", print: "Designgutschein " },
  });
  assert.equal(same[0].product, "both");
  assert.match(same[0].message, /denselben Handle/);
});

test("parseGiftCardConfiguration: limits in cents and the default expiry", () => {
  assert.deepEqual(
    parseGiftCardConfiguration({
      issueLimit: { amount: "2000.0", currencyCode: "EUR" },
      purchaseLimit: { amount: "1000.0", currencyCode: "EUR" },
      expirationConfiguration: { expirationUnit: "YEARS", expirationValue: 3 },
    }),
    { issueLimitCents: 200000, purchaseLimitCents: 100000, currency: "EUR", expiration: { unit: "YEARS", value: 3 } }
  );
  assert.deepEqual(parseGiftCardConfiguration({ issueLimit: { amount: "500.00", currencyCode: "EUR" }, expirationConfiguration: null }), {
    issueLimitCents: 50000,
    purchaseLimitCents: null,
    currency: "EUR",
    expiration: null,
  });
  assert.equal(parseGiftCardConfiguration(null), null);
});

// ── Scopes ───────────────────────────────────────────────────────────────────

test("scopes: write grants read; required and optional evaluated separately", () => {
  assert.deepEqual([...GIFT_VOUCHER_REQUIRED_SCOPES], ["write_gift_cards"]);
  assert.deepEqual([...GIFT_VOUCHER_OPTIONAL_SCOPES], ["read_gift_card_transactions", "write_merchant_managed_fulfillment_orders"]);
  assert.equal(hasScope(new Set(["write_gift_cards"]), "read_gift_cards"), true);
  assert.equal(hasScope(new Set(["read_gift_cards"]), "write_gift_cards"), false);
  assert.equal(hasScope(new Set(["write_gift_card_transactions"]), "read_gift_card_transactions"), true);

  assert.deepEqual(
    evaluateGiftVoucherScopes([{ handle: "read_products" }, { handle: "write_gift_cards" }, { handle: "read_orders" }, { handle: "write_gift_cards" }]),
    {
      granted: ["read_orders", "read_products", "write_gift_cards"],
      missing: [],
      optionalMissing: ["read_gift_card_transactions", "write_merchant_managed_fulfillment_orders"],
    }
  );
  assert.deepEqual(evaluateGiftVoucherScopes(["read_gift_cards", "write_merchant_managed_fulfillment_orders", "read_gift_card_transactions"]), {
    granted: ["read_gift_card_transactions", "read_gift_cards", "write_merchant_managed_fulfillment_orders"],
    missing: ["write_gift_cards"],
    optionalMissing: [],
  });
  assert.deepEqual(evaluateGiftVoucherScopes(null), {
    granted: [],
    missing: ["write_gift_cards"],
    optionalMissing: ["read_gift_card_transactions", "write_merchant_managed_fulfillment_orders"],
  });
});

// ── Fulfilment ───────────────────────────────────────────────────────────────

const VOUCHER_LINE = "gid://shopify/LineItem/866550311766439020";
const PRINT_LINE = "gid://shopify/LineItem/866550311766439021";
const GYM_LINE = "gid://shopify/LineItem/866550311766439022";

const FULFILLMENT_ORDERS = {
  pageInfo: { hasNextPage: false },
  nodes: [
    {
      id: "gid://shopify/FulfillmentOrder/1046000820",
      status: "OPEN",
      supportedActions: [{ action: "CREATE_FULFILLMENT" }, { action: "HOLD" }, { action: "MOVE" }],
      lineItems: {
        pageInfo: { hasNextPage: false },
        nodes: [
          { id: "gid://shopify/FulfillmentOrderLineItem/1001", remainingQuantity: 2, lineItem: { id: VOUCHER_LINE } },
          { id: "gid://shopify/FulfillmentOrderLineItem/1002", remainingQuantity: 1, lineItem: { id: GYM_LINE } },
        ],
      },
    },
    {
      id: "gid://shopify/FulfillmentOrder/1046000821",
      status: "ON_HOLD",
      supportedActions: [{ action: "RELEASE_HOLD" }],
      lineItems: {
        pageInfo: { hasNextPage: false },
        nodes: [{ id: "gid://shopify/FulfillmentOrderLineItem/1003", remainingQuantity: 1, lineItem: { id: PRINT_LINE } }],
      },
    },
  ],
};

test("planGiftVoucherFulfillment: only the voucher lines of fulfillable orders, gym products untouched", () => {
  const plan = planGiftVoucherFulfillment(FULFILLMENT_ORDERS, ["866550311766439020", PRINT_LINE, PRINT_LINE]);
  assert.deepEqual(plan.requests, [
    {
      fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1046000820",
      fulfillmentOrderLineItems: [{ id: "gid://shopify/FulfillmentOrderLineItem/1001", quantity: 2 }],
      lineItemIds: [VOUCHER_LINE],
    },
  ]);
  assert.deepEqual(plan.blocked, [{ lineItemId: PRINT_LINE, status: "ON_HOLD" }]);
  assert.deepEqual(plan.missing, []);
  assert.deepEqual(plan.done, []);
  assert.equal(plan.truncated, false);
});

test("planGiftVoucherFulfillment: a repeat after success plans nothing (remaining 0 → done)", () => {
  const after = structuredClone(FULFILLMENT_ORDERS);
  after.nodes[0].lineItems.nodes[0].remainingQuantity = 0;
  after.nodes[1].status = "CLOSED"; // print line ended in a closed order: nothing left to do
  const plan = planGiftVoucherFulfillment(after, [VOUCHER_LINE, PRINT_LINE]);
  assert.deepEqual(plan.requests, []);
  assert.deepEqual(plan.done, [VOUCHER_LINE, PRINT_LINE]);
  assert.deepEqual(plan.blocked, []);
});

test("planGiftVoucherFulfillment: missing lines, truncated pages, node-list input, junk", () => {
  const missing = planGiftVoucherFulfillment(FULFILLMENT_ORDERS.nodes, ["gid://shopify/LineItem/42"]);
  assert.deepEqual(missing.missing, ["gid://shopify/LineItem/42"]);
  assert.equal(missing.truncated, false);
  const cut = structuredClone(FULFILLMENT_ORDERS);
  cut.nodes[0].lineItems.pageInfo.hasNextPage = true;
  assert.equal(planGiftVoucherFulfillment(cut, [VOUCHER_LINE]).truncated, true);
  assert.equal(planGiftVoucherFulfillment({ ...FULFILLMENT_ORDERS, pageInfo: { hasNextPage: true } }, [VOUCHER_LINE]).truncated, true);
  assert.deepEqual(planGiftVoucherFulfillment(null, [VOUCHER_LINE]), {
    requests: [],
    done: [],
    blocked: [],
    missing: [VOUCHER_LINE],
    truncated: false,
  });
  assert.deepEqual(planGiftVoucherFulfillment(FULFILLMENT_ORDERS, ["#1", null]).requests, []);
});

test("planGiftVoucherFulfillment: a line at a fulfillment service blocks without clearing by itself", () => {
  const service = structuredClone(FULFILLMENT_ORDERS);
  service.nodes[1].status = "OPEN";
  service.nodes[1].supportedActions = [{ action: "REQUEST_FULFILLMENT" }];
  const plan = planGiftVoucherFulfillment(service, [PRINT_LINE]);
  assert.deepEqual(plan.blocked, [{ lineItemId: PRINT_LINE, status: "OPEN" }]);
  assert.equal(isTemporaryFulfillmentBlock("OPEN"), false);
  for (const status of ["ON_HOLD", "SCHEDULED", "IN_PROGRESS", "on_hold"]) assert.equal(isTemporaryFulfillmentBlock(status), true);
  assert.equal(isTemporaryFulfillmentBlock(undefined), false);
});

// ── Catalog exclusion ────────────────────────────────────────────────────────

test("catalog exclusion: both voucher handles (env or defaults), normalized", () => {
  const defaults = giftVoucherCatalogHandles(giftVoucherProductHandles({}));
  assert.deepEqual([...defaults], ["designgutschein", "gutschein-premiumkarte"]);
  assert.equal(isGiftVoucherCatalogHandle("designgutschein", defaults), true);
  assert.equal(isGiftVoucherCatalogHandle("Gutschein-Premiumkarte ", defaults), true);
  assert.equal(isGiftVoucherCatalogHandle("motion-sports-geschenkgutschein", defaults), false);
  assert.equal(isGiftVoucherCatalogHandle("", defaults), false);
  assert.equal(isGiftVoucherCatalogHandle(undefined, defaults), false);

  const custom = giftVoucherCatalogHandles(
    giftVoucherProductHandles({ GIFT_VOUCHER_PRODUCT_HANDLE: "gutschein", GIFT_VOUCHER_PRINT_PRODUCT_HANDLE: "karte" })
  );
  assert.deepEqual([...custom], ["gutschein", "karte"]);
  assert.equal(isGiftVoucherCatalogHandle("designgutschein", custom), false);
  assert.deepEqual([...giftVoucherCatalogHandles({ voucher: " ", print: null })], []);
  assert.deepEqual([...giftVoucherCatalogHandles(null)], []);
});
