// Geschenkgutscheine — switches and configuration from the environment (pure,
// no I/O; every reader takes `env = process.env` so node:test covers it,
// gift-voucher-flags.test.mjs). Documented in .env.example („Gift vouchers“).
//
// Truthy flags are 1 / true / yes / on (case-insensitive); anything else —
// absent, empty, unknown — is false. The two switches with consequences fail
// CLOSED:
//
//   GIFT_VOUCHERS_ENABLED              — master switch: the storefront page
//                                        sells, paid orders are issued. Off:
//                                        orders are still recorded and held
//                                        („Gutscheine sind ausgeschaltet“).
//   GIFT_VOUCHER_PRINT_SENDS_APPROVED  — LEGAL GATE: recipient addresses go to
//                                        the print partner (print.one, a new
//                                        processor — DPA first). Off: print
//                                        jobs wait in the admin queue.
//
// Numbers and texts fall back to their documented default when absent or
// invalid. The retention windows live in retention-options.mjs, the
// operator settings (Verkauf im Shop, KI-Texte, Fotos, Druckprüfung) in
// admin_settings (gift-voucher-settings.mjs).

import { decimalToCents } from "./gift-voucher-core.mjs";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** @typedef {Record<string, string | undefined>} Env */

/** @param {string | undefined} raw */
function parseFlag(raw) {
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/** @param {string | undefined} raw @returns {string | null} */
function trimmed(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t ? t : null;
}

/**
 * A whole number from the env: absent / invalid / below `min` → fallback,
 * above `max` → max.
 * @param {string | undefined} raw @param {number} fallback @param {number} min @param {number} max
 */
function intInRange(raw, fallback, min, max) {
  if (typeof raw !== "string" || !/^\s*\d+\s*$/.test(raw)) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < min) return fallback;
  return Math.min(n, max);
}

/**
 * Euros from the env ("5", "2500", "4.99") as cents: absent / invalid / below
 * `minCents` → fallback.
 * @param {string | undefined} raw @param {number} fallbackCents @param {number} minCents
 */
function euroCents(raw, fallbackCents, minCents) {
  const cents = typeof raw === "string" ? decimalToCents(raw) : null;
  return cents != null && cents >= minCents ? cents : fallbackCents;
}

/**
 * An absolute https URL without a trailing slash, or null. `localHttp` also
 * accepts plain http to localhost (a test server — never a key over the net).
 * @param {string | undefined} raw @param {{ localHttp?: boolean }} [o]
 */
function urlOrNull(raw, { localHttp = false } = {}) {
  const t = trimmed(raw);
  if (!t) return null;
  try {
    const u = new URL(t);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol !== "https:" && !(localHttp && local && u.protocol === "http:")) return null;
    return t.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

// ── master switch and products ───────────────────────────────────────────────

/**
 * GIFT_VOUCHERS_ENABLED (default false): the storefront sells vouchers and
 * paid orders are issued automatically. Off: orders are recorded and held.
 * @param {Env} [env]
 */
export function isGiftVouchersEnabled(env = process.env) {
  return parseFlag(env.GIFT_VOUCHERS_ENABLED);
}

export const DEFAULT_GIFT_VOUCHER_PRODUCT_HANDLE = "designgutschein";
export const DEFAULT_GIFT_VOUCHER_PRINT_PRODUCT_HANDLE = "gutschein-premiumkarte";

/** @param {string | undefined} raw @param {string} fallback */
function handleOr(raw, fallback) {
  const t = trimmed(raw)?.toLowerCase() ?? "";
  return /^[a-z0-9][a-z0-9-]{0,254}$/.test(t) ? t : fallback;
}

/**
 * The Shopify product handles of the voucher (amount variants) and of the
 * Premium-Karte add-on: GIFT_VOUCHER_PRODUCT_HANDLE (default
 * "designgutschein"), GIFT_VOUCHER_PRINT_PRODUCT_HANDLE (default
 * "gutschein-premiumkarte"). Lines are recognised by these products' ids.
 * @param {Env} [env]
 * @returns {{ voucher: string, print: string }}
 */
export function giftVoucherProductHandles(env = process.env) {
  return {
    voucher: handleOr(env.GIFT_VOUCHER_PRODUCT_HANDLE, DEFAULT_GIFT_VOUCHER_PRODUCT_HANDLE),
    print: handleOr(env.GIFT_VOUCHER_PRINT_PRODUCT_HANDLE, DEFAULT_GIFT_VOUCHER_PRINT_PRODUCT_HANDLE),
  };
}

// ── validity and limits ──────────────────────────────────────────────────────

/**
 * GIFT_VOUCHER_VALIDITY_YEARS (default 3, 0 = never expires, at most 10): a
 * voucher is valid until 31 December of the Berlin year it is issued (its
 * code stored — giftVoucherExpiryDate) + this.
 * @param {Env} [env]
 */
export function giftVoucherValidityYears(env = process.env) {
  return intInRange(env.GIFT_VOUCHER_VALIDITY_YEARS, 3, 0, 10);
}

/**
 * The money limits, in cents:
 *   minCents / maxCents — GIFT_VOUCHER_MIN_EUR / GIFT_VOUCHER_MAX_EUR
 *     (5 / 500): a shop voucher outside is held („Betrag außerhalb“);
 *   dailyLimitCents — GIFT_VOUCHER_DAILY_LIMIT_EUR (2500, 0 = none): shop
 *     vouchers issued per Berlin day, beyond it they are held;
 *   adminMaxCents — GIFT_VOUCHER_ADMIN_MAX_EUR (250): highest voucher an
 *     operator may issue by hand.
 * A maximum below the minimum is raised to the minimum.
 * @param {Env} [env]
 * @returns {{ minCents: number, maxCents: number, dailyLimitCents: number, adminMaxCents: number }}
 */
export function giftVoucherLimits(env = process.env) {
  const minCents = euroCents(env.GIFT_VOUCHER_MIN_EUR, 500, 1);
  const maxCents = Math.max(euroCents(env.GIFT_VOUCHER_MAX_EUR, 50000, 1), minCents);
  return {
    minCents,
    maxCents,
    dailyLimitCents: euroCents(env.GIFT_VOUCHER_DAILY_LIMIT_EUR, 250000, 0),
    adminMaxCents: euroCents(env.GIFT_VOUCHER_ADMIN_MAX_EUR, 25000, 1),
  };
}

/**
 * GIFT_VOUCHER_ALLOW_TEST_ORDERS (default false): issue REAL gift cards for
 * Shopify test orders — only while testing the flow.
 * @param {Env} [env]
 */
export function isGiftVoucherTestOrdersAllowed(env = process.env) {
  return parseFlag(env.GIFT_VOUCHER_ALLOW_TEST_ORDERS);
}

/**
 * GIFT_VOUCHER_RISK_WAIT_MINUTES (default 30, 0 = no wait, at most 1440): how
 * long a voucher waits for Shopify's PENDING fraud assessment before it is
 * issued anyway.
 * @param {Env} [env]
 */
export function giftVoucherRiskWaitMinutes(env = process.env) {
  return intInRange(env.GIFT_VOUCHER_RISK_WAIT_MINUTES, 30, 0, 1440);
}

// ── texts and links printed on the voucher ───────────────────────────────────

export const DEFAULT_GIFT_VOUCHER_PAGE_URL = "https://www.motionsports.de/pages/gutschein";
export const DEFAULT_GIFT_VOUCHER_TERMS_URL = "https://www.motionsports.de/pages/gutscheinbedingungen";
export const DEFAULT_GIFT_VOUCHER_ISSUER_LINE = "4motionsports GmbH · Am Weidegrund 1 · 82194 Gröbenzell";

/**
 * GIFT_VOUCHER_PAGE_URL: the voucher page — QR target (+ "#guthaben") and the
 * link in the mail. https only, else the default.
 * @param {Env} [env]
 */
export function giftVoucherPageUrl(env = process.env) {
  return urlOrNull(env.GIFT_VOUCHER_PAGE_URL) ?? DEFAULT_GIFT_VOUCHER_PAGE_URL;
}

/**
 * GIFT_VOUCHER_TERMS_URL: the voucher terms, printed and linked. https only.
 * @param {Env} [env]
 */
export function giftVoucherTermsUrl(env = process.env) {
  return urlOrNull(env.GIFT_VOUCHER_TERMS_URL) ?? DEFAULT_GIFT_VOUCHER_TERMS_URL;
}

/**
 * GIFT_VOUCHER_ISSUER_LINE: the issuer printed on every voucher (one line,
 * at most 160 characters).
 * @param {Env} [env]
 */
export function giftVoucherIssuerLine(env = process.env) {
  const t = trimmed(env.GIFT_VOUCHER_ISSUER_LINE)?.replace(/\s+/g, " ") ?? "";
  return t && t.length <= 160 ? t : DEFAULT_GIFT_VOUCHER_ISSUER_LINE;
}

// ── printing ─────────────────────────────────────────────────────────────────

/**
 * GIFT_VOUCHER_PRINT_SENDS_APPROVED (default false) — LEGAL GATE: hand
 * recipient addresses to the print partner. print.one is a new processor and
 * needs its own DPA; until this is on, print jobs stay in the admin queue.
 * Only 1/true/yes/on enable it (fail-closed).
 * @param {Env} [env]
 */
export function isGiftVoucherPrintSendsApproved(env = process.env) {
  return parseFlag(env.GIFT_VOUCHER_PRINT_SENDS_APPROVED);
}

/**
 * GIFT_VOUCHER_PRINT_PROVIDER: "printone" (default — print.one prints and
 * posts the card) or "manual" (printed in-house from the admin print queue).
 * The effective provider also needs print.one configured
 * (lib/gift-voucher-print.ts giftVoucherPrintProvider).
 * @param {Env} [env]
 * @returns {"printone" | "manual"}
 */
export function configuredGiftVoucherPrintProvider(env = process.env) {
  return trimmed(env.GIFT_VOUCHER_PRINT_PROVIDER)?.toLowerCase() === "manual" ? "manual" : "printone";
}

/**
 * GIFT_VOUCHER_PRINT_COUNTRIES (default "DE"): comma list of ISO-2 codes the
 * card may be posted to. Invalid entries are dropped; none left → ["DE"].
 * @param {Env} [env]
 * @returns {string[]}
 */
export function giftVoucherPrintCountries(env = process.env) {
  const list = (trimmed(env.GIFT_VOUCHER_PRINT_COUNTRIES) ?? "")
    .split(/[\s,;]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  const unique = [...new Set(list)];
  return unique.length > 0 ? unique : ["DE"];
}

/**
 * GIFT_VOUCHER_FULFILL_ORDERS (default false): mark the voucher lines (and
 * the print add-on once posted) fulfilled in Shopify — needs the scope
 * write_merchant_managed_fulfillment_orders.
 * @param {Env} [env]
 */
export function isGiftVoucherFulfillOrdersEnabled(env = process.env) {
  return parseFlag(env.GIFT_VOUCHER_FULFILL_ORDERS);
}

// ── print.one ────────────────────────────────────────────────────────────────

/** PRINTONE_API_KEY (secret; a TEST key prints nothing). Never log it. @param {Env} [env] */
export function printOneApiKey(env = process.env) {
  return trimmed(env.PRINTONE_API_KEY);
}

/** PRINTONE_TEMPLATE_ID: the GREETINGCARD_SQ14 template with {{outside_url}} / {{inside_url}}. @param {Env} [env] */
export function printOneTemplateId(env = process.env) {
  return trimmed(env.PRINTONE_TEMPLATE_ID);
}

/** PRINTONE_WEBHOOK_SECRET (secret): the webhook HMAC key; without it the webhook answers 503. @param {Env} [env] */
export function printOneWebhookSecret(env = process.env) {
  return trimmed(env.PRINTONE_WEBHOOK_SECRET);
}

/** print.one can print an order: API key and template id are set. @param {Env} [env] */
export function isPrintOneConfiguredEnv(env = process.env) {
  return printOneApiKey(env) !== null && printOneTemplateId(env) !== null;
}

/** PRINTONE_FINISH: "MATTE" (default) | "GLOSSY". @param {Env} [env] @returns {"MATTE" | "GLOSSY"} */
export function printOneFinish(env = process.env) {
  return trimmed(env.PRINTONE_FINISH)?.toUpperCase() === "GLOSSY" ? "GLOSSY" : "MATTE";
}

/** PRINTONE_BILLING_ID: the cost centre on print.one's invoice (default "Gutscheine", ≤ 64 characters). @param {Env} [env] */
export function printOneBillingId(env = process.env) {
  const t = trimmed(env.PRINTONE_BILLING_ID);
  return t && t.length <= 64 ? t : "Gutscheine";
}

/**
 * PRINTONE_CARD_COST_CENTS (default 380 = 3.19 € net + 19 % VAT, rounded):
 * the cost estimate per card the admin shows before printing.
 * @param {Env} [env]
 */
export function printOneCardCostCents(env = process.env) {
  return intInRange(env.PRINTONE_CARD_COST_CENTS, 380, 0, 100000);
}

/**
 * PRINTONE_FRONT_SIDE: which half of the outside spread is the card front —
 * "right" (default) or "left"; verify with a TEST order.
 * @param {Env} [env]
 * @returns {"right" | "left"}
 */
export function printOneFrontSide(env = process.env) {
  return trimmed(env.PRINTONE_FRONT_SIDE)?.toLowerCase() === "left" ? "left" : "right";
}

/** PRINTONE_API_BASE (default https://api.print.one; plain http only to localhost, for tests). @param {Env} [env] */
export function printOneApiBase(env = process.env) {
  return urlOrNull(env.PRINTONE_API_BASE, { localHttp: true }) ?? "https://api.print.one";
}

// ── overview ─────────────────────────────────────────────────────────────────

/**
 * Every switch and setting at once, for the admin setup check and the
 * storefront config — booleans, numbers and public texts only, never a
 * secret (keys and the webhook secret appear as "is set").
 * @param {Env} [env]
 */
export function giftVoucherFlagSummary(env = process.env) {
  return {
    enabled: isGiftVouchersEnabled(env),
    productHandles: giftVoucherProductHandles(env),
    validityYears: giftVoucherValidityYears(env),
    limits: giftVoucherLimits(env),
    allowTestOrders: isGiftVoucherTestOrdersAllowed(env),
    riskWaitMinutes: giftVoucherRiskWaitMinutes(env),
    pageUrl: giftVoucherPageUrl(env),
    termsUrl: giftVoucherTermsUrl(env),
    issuerLine: giftVoucherIssuerLine(env),
    printSendsApproved: isGiftVoucherPrintSendsApproved(env),
    printProvider: configuredGiftVoucherPrintProvider(env),
    printCountries: giftVoucherPrintCountries(env),
    fulfillOrders: isGiftVoucherFulfillOrdersEnabled(env),
    printOne: {
      configured: isPrintOneConfiguredEnv(env),
      apiKeySet: printOneApiKey(env) !== null,
      templateIdSet: printOneTemplateId(env) !== null,
      webhookSecretSet: printOneWebhookSecret(env) !== null,
      finish: printOneFinish(env),
      billingId: printOneBillingId(env),
      cardCostCents: printOneCardCostCents(env),
      frontSide: printOneFrontSide(env),
    },
  };
}
