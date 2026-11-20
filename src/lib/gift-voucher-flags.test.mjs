import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isGiftVouchersEnabled,
  giftVoucherProductHandles,
  giftVoucherValidityYears,
  giftVoucherLimits,
  isGiftVoucherTestOrdersAllowed,
  giftVoucherRiskWaitMinutes,
  giftVoucherPageUrl,
  giftVoucherTermsUrl,
  giftVoucherIssuerLine,
  isGiftVoucherPrintSendsApproved,
  configuredGiftVoucherPrintProvider,
  giftVoucherPrintCountries,
  isGiftVoucherFulfillOrdersEnabled,
  printOneApiKey,
  printOneTemplateId,
  printOneWebhookSecret,
  isPrintOneConfiguredEnv,
  printOneFinish,
  printOneBillingId,
  printOneCardCostCents,
  printOneFrontSide,
  printOneApiBase,
  giftVoucherFlagSummary,
  DEFAULT_GIFT_VOUCHER_PAGE_URL,
  DEFAULT_GIFT_VOUCHER_TERMS_URL,
  DEFAULT_GIFT_VOUCHER_ISSUER_LINE,
} from "./gift-voucher-flags.mjs";

const FLAGS = [
  ["GIFT_VOUCHERS_ENABLED", isGiftVouchersEnabled],
  ["GIFT_VOUCHER_ALLOW_TEST_ORDERS", isGiftVoucherTestOrdersAllowed],
  ["GIFT_VOUCHER_PRINT_SENDS_APPROVED", isGiftVoucherPrintSendsApproved],
  ["GIFT_VOUCHER_FULFILL_ORDERS", isGiftVoucherFulfillOrdersEnabled],
];

test("flags default to FALSE (fail-closed) when unset, blank or unknown", () => {
  for (const [name, read] of FLAGS) {
    assert.equal(read({}), false, name);
    for (const v of ["", " ", "0", "false", "no", "off", "nope", "TRUE!", "2"]) assert.equal(read({ [name]: v }), false, `${name}=${v}`);
  }
});

test("flags are on only for 1 / true / yes / on (any case, trimmed)", () => {
  for (const [name, read] of FLAGS) {
    for (const v of ["1", "true", "TRUE", " yes ", "On"]) assert.equal(read({ [name]: v }), true, `${name}=${v}`);
  }
});

test("the legal print gate is independent of the master switch", () => {
  assert.equal(isGiftVoucherPrintSendsApproved({ GIFT_VOUCHERS_ENABLED: "true" }), false);
  assert.equal(isGiftVouchersEnabled({ GIFT_VOUCHER_PRINT_SENDS_APPROVED: "true" }), false);
  assert.equal(isGiftVoucherPrintSendsApproved({ PHYSICAL_MAIL_SENDS_APPROVED: "true" }), false, "the Pingen gate does not open it");
});

test("product handles: defaults, lower-cased, invalid → default", () => {
  assert.deepEqual(giftVoucherProductHandles({}), { voucher: "designgutschein", print: "gutschein-premiumkarte" });
  assert.deepEqual(
    giftVoucherProductHandles({ GIFT_VOUCHER_PRODUCT_HANDLE: " Mein-Gutschein ", GIFT_VOUCHER_PRINT_PRODUCT_HANDLE: "karte-2" }),
    { voucher: "mein-gutschein", print: "karte-2" }
  );
  assert.deepEqual(
    giftVoucherProductHandles({ GIFT_VOUCHER_PRODUCT_HANDLE: "bad handle!", GIFT_VOUCHER_PRINT_PRODUCT_HANDLE: "-x" }),
    { voucher: "designgutschein", print: "gutschein-premiumkarte" }
  );
});

test("validity years: default 3, 0 = never, capped at 10, junk → 3", () => {
  assert.equal(giftVoucherValidityYears({}), 3);
  assert.equal(giftVoucherValidityYears({ GIFT_VOUCHER_VALIDITY_YEARS: "0" }), 0);
  assert.equal(giftVoucherValidityYears({ GIFT_VOUCHER_VALIDITY_YEARS: "5" }), 5);
  assert.equal(giftVoucherValidityYears({ GIFT_VOUCHER_VALIDITY_YEARS: "25" }), 10);
  for (const v of ["", "-1", "2.5", "drei"]) assert.equal(giftVoucherValidityYears({ GIFT_VOUCHER_VALIDITY_YEARS: v }), 3, v);
});

test("limits: euros → cents with defaults 5 / 500 / 2500 / 250", () => {
  assert.deepEqual(giftVoucherLimits({}), { minCents: 500, maxCents: 50000, dailyLimitCents: 250000, adminMaxCents: 25000 });
  assert.deepEqual(
    giftVoucherLimits({
      GIFT_VOUCHER_MIN_EUR: "10",
      GIFT_VOUCHER_MAX_EUR: "300.50",
      GIFT_VOUCHER_DAILY_LIMIT_EUR: "0",
      GIFT_VOUCHER_ADMIN_MAX_EUR: "100",
    }),
    { minCents: 1000, maxCents: 30050, dailyLimitCents: 0, adminMaxCents: 10000 }
  );
  // Invalid or non-positive values fall back; 0 is only meaningful for the daily limit.
  assert.deepEqual(
    giftVoucherLimits({ GIFT_VOUCHER_MIN_EUR: "0", GIFT_VOUCHER_MAX_EUR: "abc", GIFT_VOUCHER_DAILY_LIMIT_EUR: "-5", GIFT_VOUCHER_ADMIN_MAX_EUR: "0" }),
    { minCents: 500, maxCents: 50000, dailyLimitCents: 250000, adminMaxCents: 25000 }
  );
  assert.equal(giftVoucherLimits({ GIFT_VOUCHER_MIN_EUR: "50", GIFT_VOUCHER_MAX_EUR: "20" }).maxCents, 5000, "max never below min");
  assert.equal(giftVoucherLimits({ GIFT_VOUCHER_MIN_EUR: "4,99" }).minCents, 500, "only a dot is a decimal separator");
});

test("risk wait minutes: default 30, 0 = issue at once, capped at a day", () => {
  assert.equal(giftVoucherRiskWaitMinutes({}), 30);
  assert.equal(giftVoucherRiskWaitMinutes({ GIFT_VOUCHER_RISK_WAIT_MINUTES: "0" }), 0);
  assert.equal(giftVoucherRiskWaitMinutes({ GIFT_VOUCHER_RISK_WAIT_MINUTES: "90" }), 90);
  assert.equal(giftVoucherRiskWaitMinutes({ GIFT_VOUCHER_RISK_WAIT_MINUTES: "99999" }), 1440);
  assert.equal(giftVoucherRiskWaitMinutes({ GIFT_VOUCHER_RISK_WAIT_MINUTES: "x" }), 30);
});

test("page, terms and issuer: defaults, https only, one line", () => {
  assert.equal(giftVoucherPageUrl({}), DEFAULT_GIFT_VOUCHER_PAGE_URL);
  assert.equal(DEFAULT_GIFT_VOUCHER_PAGE_URL, "https://www.motionsports.de/pages/gutschein");
  assert.equal(giftVoucherPageUrl({ GIFT_VOUCHER_PAGE_URL: "https://shop.example/pages/gift/" }), "https://shop.example/pages/gift");
  assert.equal(giftVoucherPageUrl({ GIFT_VOUCHER_PAGE_URL: "http://shop.example/pages/gift" }), DEFAULT_GIFT_VOUCHER_PAGE_URL);
  assert.equal(giftVoucherPageUrl({ GIFT_VOUCHER_PAGE_URL: "javascript:alert(1)" }), DEFAULT_GIFT_VOUCHER_PAGE_URL);
  assert.equal(giftVoucherTermsUrl({}), DEFAULT_GIFT_VOUCHER_TERMS_URL);
  assert.equal(DEFAULT_GIFT_VOUCHER_TERMS_URL, "https://www.motionsports.de/pages/gutscheinbedingungen");
  assert.equal(giftVoucherTermsUrl({ GIFT_VOUCHER_TERMS_URL: "not a url" }), DEFAULT_GIFT_VOUCHER_TERMS_URL);
  assert.equal(giftVoucherIssuerLine({}), DEFAULT_GIFT_VOUCHER_ISSUER_LINE);
  assert.equal(DEFAULT_GIFT_VOUCHER_ISSUER_LINE, "4motionsports GmbH · Am Weidegrund 1 · 82194 Gröbenzell");
  assert.equal(giftVoucherIssuerLine({ GIFT_VOUCHER_ISSUER_LINE: "  Muster GmbH \n · Weg 1  " }), "Muster GmbH · Weg 1");
  assert.equal(giftVoucherIssuerLine({ GIFT_VOUCHER_ISSUER_LINE: "x".repeat(161) }), DEFAULT_GIFT_VOUCHER_ISSUER_LINE);
});

test("print provider and countries", () => {
  assert.equal(configuredGiftVoucherPrintProvider({}), "printone");
  assert.equal(configuredGiftVoucherPrintProvider({ GIFT_VOUCHER_PRINT_PROVIDER: " Manual " }), "manual");
  assert.equal(configuredGiftVoucherPrintProvider({ GIFT_VOUCHER_PRINT_PROVIDER: "pingen" }), "printone");
  assert.deepEqual(giftVoucherPrintCountries({}), ["DE"]);
  assert.deepEqual(giftVoucherPrintCountries({ GIFT_VOUCHER_PRINT_COUNTRIES: "de, at;ch DE  nl" }), ["DE", "AT", "CH", "NL"]);
  assert.deepEqual(giftVoucherPrintCountries({ GIFT_VOUCHER_PRINT_COUNTRIES: "Deutschland, 49" }), ["DE"]);
});

test("print.one settings: secrets as set/unset, finish, billing, cost, front side, base URL", () => {
  assert.equal(printOneApiKey({}), null);
  assert.equal(printOneApiKey({ PRINTONE_API_KEY: "  test_abc  " }), "test_abc");
  assert.equal(printOneTemplateId({ PRINTONE_TEMPLATE_ID: "tmpl_1" }), "tmpl_1");
  assert.equal(printOneWebhookSecret({ PRINTONE_WEBHOOK_SECRET: " " }), null);
  assert.equal(isPrintOneConfiguredEnv({}), false);
  assert.equal(isPrintOneConfiguredEnv({ PRINTONE_API_KEY: "k" }), false);
  assert.equal(isPrintOneConfiguredEnv({ PRINTONE_API_KEY: "k", PRINTONE_TEMPLATE_ID: "t" }), true);
  assert.equal(printOneFinish({}), "MATTE");
  assert.equal(printOneFinish({ PRINTONE_FINISH: "glossy" }), "GLOSSY");
  assert.equal(printOneFinish({ PRINTONE_FINISH: "satin" }), "MATTE");
  assert.equal(printOneBillingId({}), "Gutscheine");
  assert.equal(printOneBillingId({ PRINTONE_BILLING_ID: "Marketing" }), "Marketing");
  assert.equal(printOneBillingId({ PRINTONE_BILLING_ID: "x".repeat(65) }), "Gutscheine");
  assert.equal(printOneCardCostCents({}), 384);
  assert.equal(printOneCardCostCents({ PRINTONE_CARD_COST_CENTS: "399" }), 399);
  assert.equal(printOneCardCostCents({ PRINTONE_CARD_COST_CENTS: "3.99" }), 384);
  assert.equal(printOneFrontSide({}), "right");
  assert.equal(printOneFrontSide({ PRINTONE_FRONT_SIDE: "LEFT" }), "left");
  assert.equal(printOneFrontSide({ PRINTONE_FRONT_SIDE: "top" }), "right");
  assert.equal(printOneApiBase({}), "https://api.print.one");
  assert.equal(printOneApiBase({ PRINTONE_API_BASE: "https://sandbox.example/" }), "https://sandbox.example");
  assert.equal(printOneApiBase({ PRINTONE_API_BASE: "http://localhost:4010" }), "http://localhost:4010", "a local test server");
  assert.equal(printOneApiBase({ PRINTONE_API_BASE: "http://api.print.one" }), "https://api.print.one", "never the key over plain http");
});

test("giftVoucherFlagSummary: everything at once, never a secret value", () => {
  const env = {
    GIFT_VOUCHERS_ENABLED: "true",
    PRINTONE_API_KEY: "live_secret_key_123",
    PRINTONE_TEMPLATE_ID: "tmpl_abc",
    PRINTONE_WEBHOOK_SECRET: "whsec_very_secret",
    GIFT_VOUCHER_PRINT_PROVIDER: "manual",
  };
  const s = giftVoucherFlagSummary(env);
  assert.equal(s.enabled, true);
  assert.equal(s.printSendsApproved, false);
  assert.equal(s.printProvider, "manual");
  assert.deepEqual(s.printCountries, ["DE"]);
  assert.equal(s.validityYears, 3);
  assert.deepEqual(s.limits, giftVoucherLimits({}));
  assert.deepEqual(s.printOne, {
    configured: true,
    apiKeySet: true,
    templateIdSet: true,
    webhookSecretSet: true,
    finish: "MATTE",
    billingId: "Gutscheine",
    cardCostCents: 384,
    frontSide: "right",
  });
  const json = JSON.stringify(s);
  for (const secret of ["live_secret_key_123", "whsec_very_secret", "tmpl_abc"]) assert.ok(!json.includes(secret), secret);
});

test("every reader works with process.env by default", () => {
  assert.equal(typeof isGiftVouchersEnabled(), "boolean");
  assert.equal(typeof giftVoucherLimits().minCents, "number");
  assert.ok(Array.isArray(giftVoucherPrintCountries()));
});
