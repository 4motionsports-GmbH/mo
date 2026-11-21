// Pure core of the Shopify side of the Geschenkgutscheine (docs/GIFT_VOUCHERS.md): the
// GraphQL documents, response parsing, money → cents, error classification, order risk,
// scope evaluation, fulfilment line selection and the catalog exclusion of the two
// voucher products. No I/O and no clock — lib/shopify-gift-cards.ts runs the calls
// through adminGraphql, scripts/verify-gift-vouchers.mjs through its own fetch.
//
// Built against the Admin GraphQL API 2026-04 (shopify.dev, checked 2026-11-20):
//   giftCardCreate(input: GiftCardCreateInput!) → { giftCard, giftCardCode, userErrors: [GiftCardUserError {code field message}] }
//     input: initialValue (Decimal!, shop currency), code (8–20 letters/digits, not case
//     sensitive), expiresOn (Date; absent = never expires), note (not shown to the customer).
//     NOT customerId / recipientAttributes: those make Shopify send its own mail with the code.
//   GiftCardErrorCode: CUSTOMER_NOT_FOUND, GIFT_CARD_LIMIT_EXCEEDED, GREATER_THAN, INTERNAL_ERROR,
//     INVALID, MISSING_ARGUMENT, RECIPIENT_NOT_FOUND, TAKEN, TOO_BIG, TOO_LONG, TOO_SHORT
//   giftCardDeactivate(id) → { giftCard, userErrors: [GiftCardDeactivateUserError {code: GIFT_CARD_NOT_FOUND}] } — irreversible
//   giftCards(query:) — the default free-text term matches the code (and the last characters)
//   GiftCard { id lastCharacters balance initialValue expiresOn enabled deactivatedAt createdAt } —
//     the full code can never be read back, only the last four characters
//   Money / Decimal amounts are strings ("100.0", "27.84", "-10.0")
//   Order.risk { recommendation: ACCEPT|CANCEL|INVESTIGATE|NONE, assessments[].riskLevel: HIGH|MEDIUM|LOW|NONE|PENDING }
//   Order.fulfillmentOrders → FulfillmentOrder { status, supportedActions[].action, lineItems { id remainingQuantity lineItem { id } } }
//   fulfillmentCreate → userErrors is the plain UserError (field, message — selecting `code` is a schema error)
//   productByIdentifier(identifier: { handle }) — productByHandle is deprecated
//
// SECURITY: a gift-card code is bearer value. Nothing here returns it inside a message:
// every text that may echo a request (Shopify's INVALID_VARIABLE errors carry the input in
// `extensions.value`) is either dropped or scrubbed with scrubSecret().

import { numericShopifyId } from "./shopify-customer-map.mjs";

/** The Admin API version the documents below are written against. */
export const GIFT_VOUCHER_SHOPIFY_API_VERSION = "2026-04";

/** A gift-card code as Shopify accepts it (after normalizeGiftCardCode). */
export const GIFT_CARD_CODE_RE = /^[A-Z0-9]{8,20}$/;

/** Issue, read and deactivate cards — `write_gift_cards` also grants `read_gift_cards`. */
export const GIFT_VOUCHER_REQUIRED_SCOPES = Object.freeze(["write_gift_cards"]);

/** Nice to have: the redemption history, and marking voucher lines fulfilled. */
export const GIFT_VOUCHER_OPTIONAL_SCOPES = Object.freeze([
  "read_gift_card_transactions",
  "write_merchant_managed_fulfillment_orders",
]);

// ── GraphQL documents ────────────────────────────────────────────────────────
// Every mutation starts with the `mutation` keyword: adminGraphql (shopify-retry.mjs
// isMutation) auto-retries anything else on a transport error, and a retried
// giftCardCreate must never run twice blindly (the test guards this).

const GIFT_CARD_FIELDS = `
      id
      lastCharacters
      balance { amount currencyCode }
      initialValue { amount currencyCode }
      expiresOn
      enabled
      deactivatedAt
      createdAt`;

const PRODUCT_FIELDS = `
      id
      legacyResourceId
      handle
      title
      status
      isGiftCard
      variants(first: 50) {
        nodes {
          id
          legacyResourceId
          title
          price
          taxable
          inventoryItem { requiresShipping }
        }
      }`;

export const GIFT_CARD_CREATE_MUTATION = /* GraphQL */ `
  mutation GiftVoucherCardCreate($input: GiftCardCreateInput!) {
    giftCardCreate(input: $input) {
      giftCard {${GIFT_CARD_FIELDS}
      }
      giftCardCode
      userErrors { code field message }
    }
  }
`;

export const GIFT_CARD_DEACTIVATE_MUTATION = /* GraphQL */ `
  mutation GiftVoucherCardDeactivate($id: ID!) {
    giftCardDeactivate(id: $id) {
      giftCard { id enabled deactivatedAt }
      userErrors { code field message }
    }
  }
`;

export const GIFT_CARD_BY_ID_QUERY = /* GraphQL */ `
  query GiftVoucherCard($id: ID!) {
    giftCard(id: $id) {${GIFT_CARD_FIELDS}
    }
  }
`;

export const GIFT_CARDS_BY_CODE_QUERY = /* GraphQL */ `
  query GiftVoucherCardsByCode($query: String!) {
    giftCards(first: 5, query: $query) {
      nodes {${GIFT_CARD_FIELDS}
      }
    }
  }
`;

export const GIFT_CARD_CONFIGURATION_QUERY = /* GraphQL */ `
  query GiftVoucherCardConfiguration {
    giftCardConfiguration {
      issueLimit { amount currencyCode }
      purchaseLimit { amount currencyCode }
      expirationConfiguration { expirationUnit expirationValue }
    }
  }
`;

export const ACCESS_SCOPES_QUERY = /* GraphQL */ `
  query GiftVoucherAccessScopes {
    currentAppInstallation {
      accessScopes { handle }
    }
  }
`;

export const GIFT_VOUCHER_PRODUCTS_QUERY = /* GraphQL */ `
  query GiftVoucherProducts($voucher: String!, $print: String!) {
    voucher: productByIdentifier(identifier: { handle: $voucher }) {${PRODUCT_FIELDS}
    }
    print: productByIdentifier(identifier: { handle: $print }) {${PRODUCT_FIELDS}
    }
  }
`;

export const ORDER_SNAPSHOT_QUERY = /* GraphQL */ `
  query GiftVoucherOrderSnapshot($id: ID!) {
    order(id: $id) {
      id
      legacyResourceId
      name
      test
      cancelledAt
      displayFinancialStatus
      fullyPaid
      email
      currencyCode
      risk {
        recommendation
        assessments { riskLevel }
      }
    }
  }
`;

/** Page sizes of FULFILLMENT_ORDERS_QUERY (requested cost ≈ 520 of the 1000 ceiling). */
export const FULFILLMENT_ORDERS_PAGE = 5;
export const FULFILLMENT_LINE_ITEMS_PAGE = 50;

export const FULFILLMENT_ORDERS_QUERY = /* GraphQL */ `
  query GiftVoucherFulfillmentOrders($id: ID!) {
    order(id: $id) {
      id
      fulfillmentOrders(first: ${FULFILLMENT_ORDERS_PAGE}, displayable: true) {
        pageInfo { hasNextPage }
        nodes {
          id
          status
          supportedActions { action }
          lineItems(first: ${FULFILLMENT_LINE_ITEMS_PAGE}) {
            pageInfo { hasNextPage }
            nodes {
              id
              remainingQuantity
              lineItem { id }
            }
          }
        }
      }
    }
  }
`;

export const FULFILLMENT_CREATE_MUTATION = /* GraphQL */ `
  mutation GiftVoucherFulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

// ── Small helpers ────────────────────────────────────────────────────────────

/** @param {unknown} v */
function str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** @param {unknown} v */
function upper(v) {
  return typeof v === "string" ? v.trim().toUpperCase() : "";
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Collapse whitespace, redact e-mail addresses and cut to `max` characters — for the
 * few Shopify texts that may reach an admin message.
 * @param {string} text
 * @param {number} max
 */
function shortText(text, max) {
  const s = String(text ?? "").replace(EMAIL_RE, "[E-Mail]").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ── Money ────────────────────────────────────────────────────────────────────

/**
 * A Shopify Money / Decimal amount ("100.0", "27.84", "-10.0", "50") → integer cents,
 * exact (string arithmetic, no float rounding). More than two decimals are rounded half
 * away from zero on the third. Numbers are accepted too. Junk → null.
 * @param {unknown} value
 * @returns {number | null}
 */
export function moneyAmountToCents(value) {
  let s;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    s = String(value);
  } else if (typeof value === "string") {
    s = value.trim();
  } else {
    return null;
  }
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const digits = `${m[3] ?? ""}000`.slice(0, 3);
  let cents = Number(m[2]) * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] && cents !== 0 ? -cents : cents;
}

/**
 * Positive integer cents → the Decimal string giftCardCreate takes ("50.00"); anything
 * else → null (Mo never issues a card of zero, negative or fractional cents).
 * @param {unknown} cents
 * @returns {string | null}
 */
export function centsToShopifyDecimal(cents) {
  if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) return null;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * True for a real calendar date "YYYY-MM-DD" (the GraphQL Date scalar).
 * @param {unknown} value
 */
export function isIsoCalendarDate(value) {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// ── Codes ────────────────────────────────────────────────────────────────────

/**
 * A code as Shopify takes it: spaces, dots and hyphens dropped, upper-case, 8–20 ASCII
 * letters/digits — otherwise null.
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizeGiftCardCode(input) {
  if (typeof input !== "string") return null;
  const compact = input.replace(/[\s.-]+/g, "");
  if (!/^[A-Za-z0-9]{8,20}$/.test(compact)) return null;
  return compact.toUpperCase();
}

/**
 * The last four characters (upper-case) — what Shopify reports as `lastCharacters`.
 * @param {unknown} code
 */
export function giftCardLastFour(code) {
  const c = normalizeGiftCardCode(code);
  return c ? c.slice(-4) : null;
}

/**
 * The giftCards(query:) term that finds a card by its full code: the bare code, lower-case
 * (Shopify stores codes lower-case; the search is case-insensitive). Letters and digits
 * only, so it needs no quoting. Null for an invalid code.
 * @param {unknown} code
 */
export function giftCardSearchQuery(code) {
  const c = normalizeGiftCardCode(code);
  return c ? c.toLowerCase() : null;
}

/**
 * „•••• •••• •••• WXYZ“ — the only form of a code that may be printed or logged.
 * @param {unknown} code
 */
export function maskGiftCardCode(code) {
  const last = giftCardLastFour(code);
  return last ? `•••• •••• •••• ${last}` : "••••";
}

/**
 * Replace every occurrence of `secret` in `text` (any case, with or without spaces, dots or
 * hyphens between the characters) by „•••“.
 * @param {unknown} text
 * @param {unknown} secret
 * @returns {string}
 */
export function scrubSecret(text, secret) {
  const s = typeof text === "string" ? text : "";
  const code = typeof secret === "string" ? secret.replace(/[\s.-]+/g, "") : "";
  if (!s || code.length < 6) return s;
  const pattern = code
    .split("")
    .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s.-]?");
  return s.replace(new RegExp(pattern, "gi"), "•••");
}

// ── Ids ──────────────────────────────────────────────────────────────────────

/**
 * A numeric id or a gid of `type` → the canonical gid; a gid of another type or junk → null.
 * @param {string} type e.g. "GiftCard", "Order", "LineItem"
 * @param {unknown} value
 * @returns {string | null}
 */
export function shopifyGid(type, value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return `gid://shopify/${type}/${s}`;
  const m = /^gid:\/\/shopify\/(\w+)\/(\d+)(?:\?.*)?$/.exec(s);
  return m && m[1] === type ? `gid://shopify/${type}/${m[2]}` : null;
}

/** @param {unknown} value */
export function giftCardGid(value) {
  return shopifyGid("GiftCard", value);
}

/** @param {unknown} value */
export function orderGid(value) {
  return shopifyGid("Order", value);
}

/** @param {unknown} value */
export function lineItemGid(value) {
  return shopifyGid("LineItem", value);
}

// ── Gift cards ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} ShopifyGiftCardInfo
 * @property {string} id               gid://shopify/GiftCard/…
 * @property {string} lastCharacters   last four characters of the code, upper-case
 * @property {number} balanceCents
 * @property {number} initialCents
 * @property {string} currency         shop currency, e.g. "EUR"
 * @property {string | null} expiresOn "YYYY-MM-DD", null = never expires
 * @property {boolean} enabled
 * @property {string | null} deactivatedAt
 * @property {string} createdAt
 */

/**
 * A GiftCard node (GIFT_CARD_FIELDS) → ShopifyGiftCardInfo, or null when a non-null field
 * of the schema is missing or unreadable.
 * @param {unknown} node
 * @returns {ShopifyGiftCardInfo | null}
 */
export function parseGiftCardNode(node) {
  if (!node || typeof node !== "object") return null;
  const n = /** @type {Record<string, any>} */ (node);
  const id = str(n.id);
  const lastCharacters = upper(n.lastCharacters);
  const balanceCents = moneyAmountToCents(n.balance?.amount);
  const initialCents = moneyAmountToCents(n.initialValue?.amount);
  if (!id || !lastCharacters || balanceCents == null || initialCents == null || typeof n.enabled !== "boolean") {
    return null;
  }
  return {
    id,
    lastCharacters,
    balanceCents,
    initialCents,
    currency: str(n.balance?.currencyCode) ?? str(n.initialValue?.currencyCode) ?? "",
    expiresOn: isIsoCalendarDate(n.expiresOn) ? n.expiresOn : null,
    enabled: n.enabled,
    deactivatedAt: str(n.deactivatedAt),
    createdAt: str(n.createdAt) ?? "",
  };
}

/**
 * The card a giftCards(query: <code>) search found: the one whose last characters match
 * the code. Two different matching cards → `ambiguous` (never adopt a card blindly; Mo
 * cannot read a code back to tell them apart).
 * @param {unknown} nodes
 * @param {unknown} code
 * @returns {{ card: ShopifyGiftCardInfo | null, ambiguous: boolean }}
 */
export function pickGiftCardByCode(nodes, code) {
  const last = giftCardLastFour(code);
  if (!last || !Array.isArray(nodes)) return { card: null, ambiguous: false };
  /** @type {Map<string, ShopifyGiftCardInfo>} */
  const byId = new Map();
  for (const node of nodes) {
    const card = parseGiftCardNode(node);
    if (card && card.lastCharacters === last) byId.set(card.id, card);
  }
  if (byId.size === 1) return { card: [...byId.values()][0], ambiguous: false };
  return { card: null, ambiguous: byId.size > 1 };
}

/**
 * @typedef {"taken" | "limit" | "invalid" | "unknown"} GiftCardUserErrorKind
 * @typedef {{ kind: GiftCardUserErrorKind, retryable: boolean, codes: string[], message: string }} GiftCardUserErrorClass
 */

/**
 * Classify giftCardCreate userErrors (null when there are none):
 *   TAKEN                     → taken   (retryable: the card may be ours from an attempt whose answer got lost — search by code)
 *   GIFT_CARD_LIMIT_EXCEEDED  → limit   (the shop's issue limit; not retryable)
 *   only INTERNAL_ERROR       → unknown (Shopify's own hiccup; outcome open — search by code, retry)
 *   anything else             → invalid (the input as such is refused; not retryable)
 * Shopify's messages are scrubbed of the code (`secret`).
 * @param {unknown} userErrors
 * @param {unknown} [secret]
 * @returns {GiftCardUserErrorClass | null}
 */
export function classifyGiftCardUserErrors(userErrors, secret) {
  const list = (Array.isArray(userErrors) ? userErrors : []).filter((e) => e && typeof e === "object");
  if (list.length === 0) return null;
  const codes = [...new Set(list.map((e) => upper(e.code)).filter(Boolean))];
  if (codes.includes("TAKEN")) {
    return { kind: "taken", retryable: true, codes, message: "Shopify: Dieser Gutscheincode ist schon vergeben (TAKEN)." };
  }
  if (codes.includes("GIFT_CARD_LIMIT_EXCEEDED")) {
    return {
      kind: "limit",
      retryable: false,
      codes,
      message: "Shopify: Der Wert überschreitet das Limit des Shops für Geschenkkarten (GIFT_CARD_LIMIT_EXCEEDED).",
    };
  }
  if (codes.length > 0 && codes.every((c) => c === "INTERNAL_ERROR")) {
    return {
      kind: "unknown",
      retryable: true,
      codes,
      message: "Shopify: interner Fehler beim Anlegen der Karte (INTERNAL_ERROR) — Ergebnis offen.",
    };
  }
  const detail = shortText(
    list
      .map((e) => scrubSecret(String(e.message ?? ""), secret))
      .filter(Boolean)
      .join("; "),
    200
  );
  return {
    kind: "invalid",
    retryable: false,
    codes,
    message: `Shopify lehnt die Geschenkkarte ab: ${detail || "ohne Begründung"}${codes.length ? ` (${codes.join(", ")})` : ""}`,
  };
}

/**
 * German message for giftCardDeactivate userErrors (GIFT_CARD_NOT_FOUND, …).
 * @param {unknown} userErrors
 */
export function giftCardDeactivateErrorMessage(userErrors) {
  const list = (Array.isArray(userErrors) ? userErrors : []).filter((e) => e && typeof e === "object");
  const codes = [...new Set(list.map((e) => upper(e.code)).filter(Boolean))];
  const detail = shortText(list.map((e) => String(e.message ?? "")).filter(Boolean).join("; "), 200);
  if (codes.includes("GIFT_CARD_NOT_FOUND")) return "Shopify kennt diese Geschenkkarte nicht (GIFT_CARD_NOT_FOUND).";
  return `Shopify kann die Geschenkkarte nicht sperren: ${detail || "ohne Begründung"}${codes.length ? ` (${codes.join(", ")})` : ""}`;
}

/**
 * German message for fulfillmentCreate userErrors (plain UserError: field + message).
 * @param {unknown} userErrors
 */
export function fulfillmentUserErrorMessage(userErrors) {
  const list = (Array.isArray(userErrors) ? userErrors : []).filter((e) => e && typeof e === "object");
  const detail = shortText(list.map((e) => String(e.message ?? "")).filter(Boolean).join("; "), 200);
  return `Shopify kann die Gutschein-Positionen nicht als erledigt markieren: ${detail || "ohne Begründung"}`;
}

// ── Errors thrown by adminGraphql ────────────────────────────────────────────

/**
 * @typedef {"denied" | "throttled" | "timeout" | "network" | "unconfigured" | "http_transient"
 *   | "http_client" | "graphql_internal" | "graphql" | "no_data" | "unknown"} AdminErrorKind
 * @typedef {object} AdminErrorDescription
 * @property {AdminErrorKind} kind
 * @property {number | null} httpStatus
 * @property {string[]} codes   GraphQL `extensions.code` values
 * @property {string | null} scope  the missing access scope Shopify named, if any
 * @property {string} message   German, safe for logs and the admin (never the raw error)
 */

const PREFIX_GRAPHQL_ERRORS = "Shopify GraphQL errors:";
const TRANSIENT_GRAPHQL_CODES = new Set(["INTERNAL_SERVER_ERROR", "INTERNAL_ERROR", "SERVICE_UNAVAILABLE", "TIMEOUT"]);
const SCOPE_RE = /\b((?:read|write)_[a-z_]+)\b/g;
// When Shopify lists alternatives („`read_assigned_fulfillment_orders` access scope or
// `read_merchant_managed_fulfillment_orders` …“) name the one Mo asks for.
const MO_SCOPES = new Set([
  ...GIFT_VOUCHER_REQUIRED_SCOPES,
  ...GIFT_VOUCHER_OPTIONAL_SCOPES,
  "read_gift_cards",
  "read_merchant_managed_fulfillment_orders",
]);

/**
 * The access scope a denial names — Mo's own one when several are listed.
 * @param {string} text
 * @returns {string | null}
 */
function deniedScope(text) {
  const found = [...text.matchAll(SCOPE_RE)].map((m) => m[1]);
  return found.find((s) => MO_SCOPES.has(s)) ?? found[0] ?? null;
}

/**
 * The `errors` array behind "Shopify GraphQL errors: [...]" (adminGraphql's message).
 * @param {string} raw
 * @returns {Array<{ message: string, code: string, requiredAccess: string }>}
 */
function parseGraphqlErrorList(raw) {
  try {
    const parsed = JSON.parse(raw.slice(PREFIX_GRAPHQL_ERRORS.length).trim());
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e === "object")
      .map((e) => ({
        message: typeof e.message === "string" ? e.message : "",
        code: upper(e.extensions?.code),
        requiredAccess: typeof e.extensions?.requiredAccess === "string" ? e.extensions.requiredAccess : "",
      }));
  } catch {
    return [];
  }
}

/**
 * Describe an error thrown by adminGraphql (lib/shopify.ts) — or the token exchange behind
 * it, a fetch abort, a network failure — as a kind plus a SAFE German message. The raw
 * message is never copied unless `detail` is set (and then scrubbed of `secret` and e-mail
 * addresses and cut short): Shopify echoes request variables in some errors, so a call
 * that carries a gift-card code must not use `detail`.
 *
 * @param {unknown} err
 * @param {{ detail?: boolean, secret?: string | null }} [opts]
 * @returns {AdminErrorDescription}
 */
export function describeAdminGraphqlError(err, opts = {}) {
  const e = /** @type {any} */ (err);
  const name = typeof e?.name === "string" ? e.name : "";
  const raw = typeof err === "string" ? err : typeof e?.message === "string" ? e.message : "";
  const causeCode = typeof e?.cause?.code === "string" ? e.cause.code : "";
  const withDetail = (/** @type {string} */ message, /** @type {string} */ text) => {
    if (!opts.detail) return message;
    const d = shortText(scrubSecret(text, opts.secret ?? null), 160);
    return d ? `${message} — ${d}` : message;
  };
  /** @type {(kind: AdminErrorKind, message: string, extra?: Partial<AdminErrorDescription>) => AdminErrorDescription} */
  const out = (kind, message, extra = {}) => ({ kind, httpStatus: null, codes: [], scope: null, message, ...extra });

  if (name === "ShopifyThrottledError" || /^Shopify GraphQL throttled/i.test(raw)) {
    return out("throttled", "Shopify ist gerade ausgelastet (Rate-Limit) — später erneut versuchen.");
  }
  if (name === "TimeoutError" || name === "AbortError" || /aborted due to timeout|operation was aborted/i.test(raw)) {
    return out("timeout", "Shopify hat nicht rechtzeitig geantwortet (Zeitüberschreitung).");
  }
  const missingEnv = /^Missing env var (\w+)/.exec(raw);
  if (missingEnv) return out("unconfigured", `Shopify ist nicht konfiguriert (${missingEnv[1]} fehlt).`);

  const token = /^Shopify token exchange failed: HTTP (\d{3})/.exec(raw);
  if (token) {
    const status = Number(token[1]);
    if (status >= 500 || status === 408 || status === 429) {
      return out("http_transient", `Shopify-Anmeldung vorübergehend gestört (Token, HTTP ${status}).`, { httpStatus: status });
    }
    return out(
      "denied",
      `Shopify-Anmeldung fehlgeschlagen (Token, HTTP ${status}) — SHOPIFY_CLIENT_ID/SECRET und die App-Installation prüfen.`,
      { httpStatus: status }
    );
  }
  if (/^Shopify token (endpoint|response)/.test(raw)) {
    return out("denied", "Shopify-Anmeldung lieferte kein gültiges Zugriffstoken.");
  }

  const http = /^Shopify GraphQL (\d{3})\b/.exec(raw);
  if (http) {
    const status = Number(http[1]);
    if (status === 401 || status === 403) {
      return out("denied", `Shopify lehnt den Zugriff ab (HTTP ${status}) — Zugangsdaten und Berechtigungen der App prüfen.`, {
        httpStatus: status,
      });
    }
    if (status === 429) return out("throttled", "Shopify ist gerade ausgelastet (HTTP 429) — später erneut versuchen.", { httpStatus: status });
    if (status === 408 || status >= 500) {
      return out("http_transient", `Shopify antwortet mit HTTP ${status} (vorübergehender Fehler).`, { httpStatus: status });
    }
    return out("http_client", withDetail(`Shopify antwortet mit HTTP ${status}.`, raw.replace(/^Shopify GraphQL \d{3}\s*/, "")), {
      httpStatus: status,
    });
  }

  if (raw.startsWith(PREFIX_GRAPHQL_ERRORS)) {
    const list = parseGraphqlErrorList(raw);
    const codes = [...new Set(list.map((x) => x.code).filter(Boolean))];
    const texts = list.length ? list.map((x) => `${x.message} ${x.requiredAccess}`).join(" ") : raw;
    if (codes.includes("ACCESS_DENIED") || /access[ _]denied|required access/i.test(texts)) {
      const scope = deniedScope(list.length ? list.map((x) => `${x.requiredAccess} ${x.message}`).join(" ") : raw);
      return out(
        "denied",
        scope
          ? `Shopify verweigert den Zugriff — Berechtigung ${scope} fehlt (Scope in der App ergänzen und die App neu installieren).`
          : "Shopify verweigert den Zugriff (ACCESS_DENIED) — Berechtigungen der App prüfen.",
        { codes, scope }
      );
    }
    if (codes.includes("THROTTLED")) {
      return out("throttled", "Shopify ist gerade ausgelastet (Rate-Limit) — später erneut versuchen.", { codes });
    }
    if (codes.some((c) => TRANSIENT_GRAPHQL_CODES.has(c))) {
      return out("graphql_internal", `Shopify meldet einen internen Fehler (${codes.join(", ")}) — später erneut versuchen.`, { codes });
    }
    return out(
      "graphql",
      withDetail(`Shopify lehnt die Anfrage ab (${codes.length ? codes.join(", ") : "GraphQL-Fehler"}).`, list[0]?.message ?? ""),
      { codes }
    );
  }

  if (/^Shopify GraphQL returned no data/.test(raw)) return out("no_data", "Shopify hat keine Daten geliefert.");
  if (
    (name === "TypeError" && /fetch failed/i.test(raw)) ||
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|UND_ERR|socket hang up/i.test(`${raw} ${causeCode}`)
  ) {
    return out("network", "Shopify war nicht erreichbar (Netzwerkfehler).");
  }
  return out("unknown", withDetail("Unerwarteter Fehler bei der Shopify-Anfrage.", raw));
}

/**
 * Whether a call that failed this way may succeed later without a change to its input.
 * Only a request Shopify refused as such (schema / validation, a 4xx) is final; a missing
 * scope or missing configuration can be fixed by the operator.
 * @param {AdminErrorDescription} desc
 */
export function isRetryableAdminError(desc) {
  return desc.kind !== "graphql" && desc.kind !== "http_client";
}

/**
 * Map a thrown error of the giftCardCreate call to the result kinds of
 * createShopifyGiftCard. A transport failure, a timeout, a throttle or an internal Shopify
 * error leaves the outcome OPEN — "unknown": the caller searches the card by its code
 * before it tries again.
 * @param {AdminErrorDescription} desc
 * @returns {{ kind: "denied" | "unconfigured" | "invalid" | "unknown", retryable: boolean, message: string }}
 */
export function giftCardMutationFailure(desc) {
  if (desc.kind === "denied") return { kind: "denied", retryable: true, message: desc.message };
  if (desc.kind === "unconfigured") return { kind: "unconfigured", retryable: true, message: desc.message };
  if (desc.kind === "graphql" || desc.kind === "http_client") return { kind: "invalid", retryable: false, message: desc.message };
  return { kind: "unknown", retryable: true, message: `${desc.message} Ergebnis offen — Mo sucht die Karte über den Code.` };
}

// ── Orders ───────────────────────────────────────────────────────────────────

/**
 * @typedef {"HIGH" | "MEDIUM" | "LOW" | "NONE" | "PENDING"} RiskLevel
 * @typedef {"ACCEPT" | "CANCEL" | "INVESTIGATE" | "NONE"} RiskRecommendation
 */

// The level that decides: HIGH beats a pending assessment (hold at once), a PENDING one
// beats the settled lower levels (wait for it), then MEDIUM > LOW > NONE.
/** @type {Map<string, number>} */
const RISK_RANK = new Map([
  ["NONE", 0],
  ["LOW", 1],
  ["MEDIUM", 2],
  ["PENDING", 3],
  ["HIGH", 4],
]);
const RISK_RECOMMENDATIONS = new Set(["ACCEPT", "CANCEL", "INVESTIGATE", "NONE"]);

/**
 * Order.risk → the deciding risk level over all assessments (null without any) and the
 * recommendation. Unknown enum values are ignored.
 * @param {unknown} risk
 * @returns {{ riskLevel: RiskLevel | null, riskRecommendation: RiskRecommendation | null }}
 */
export function extractOrderRisk(risk) {
  const r = /** @type {Record<string, any> | null} */ (risk && typeof risk === "object" ? risk : null);
  const rec = upper(r?.recommendation);
  /** @type {RiskLevel | null} */
  let level = null;
  for (const a of Array.isArray(r?.assessments) ? r.assessments : []) {
    const l = upper(a?.riskLevel);
    const rank = RISK_RANK.get(l);
    if (rank === undefined) continue;
    if (level === null || rank > /** @type {number} */ (RISK_RANK.get(level))) level = /** @type {RiskLevel} */ (l);
  }
  return {
    riskLevel: level,
    riskRecommendation: RISK_RECOMMENDATIONS.has(rec) ? /** @type {RiskRecommendation} */ (rec) : null,
  };
}

/**
 * @typedef {object} GiftVoucherOrderSnapshot
 * @property {string} id       numeric order id
 * @property {string} gid
 * @property {string} name     "#1001"
 * @property {boolean} test
 * @property {string | null} cancelledAt
 * @property {string | null} displayFinancialStatus  PAID, PARTIALLY_REFUNDED, PENDING, …
 * @property {boolean} fullyPaid
 * @property {string | null} email
 * @property {string} currencyCode   shop currency of the order
 * @property {RiskLevel | null} riskLevel
 * @property {RiskRecommendation | null} riskRecommendation
 */

/**
 * The order node of ORDER_SNAPSHOT_QUERY → GiftVoucherOrderSnapshot (null when it is not
 * an order).
 * @param {unknown} node
 * @returns {GiftVoucherOrderSnapshot | null}
 */
export function parseOrderSnapshot(node) {
  if (!node || typeof node !== "object") return null;
  const o = /** @type {Record<string, any>} */ (node);
  const gid = orderGid(o.id);
  const id = numericShopifyId(o.legacyResourceId) ?? numericShopifyId(gid);
  if (!gid || !id) return null;
  const { riskLevel, riskRecommendation } = extractOrderRisk(o.risk);
  return {
    id,
    gid,
    name: str(o.name) ?? "",
    test: o.test === true,
    cancelledAt: str(o.cancelledAt),
    displayFinancialStatus: str(o.displayFinancialStatus),
    fullyPaid: o.fullyPaid === true,
    email: str(o.email),
    currencyCode: str(o.currencyCode) ?? "",
    riskLevel,
    riskRecommendation,
  };
}

// ── Products ─────────────────────────────────────────────────────────────────

/**
 * @typedef {object} GiftVoucherProductVariantInfo
 * @property {string} gid
 * @property {string} numericId   what /cart/add.js takes
 * @property {string} title
 * @property {number} priceCents
 * @property {boolean} taxable
 * @property {boolean} requiresShipping
 *
 * @typedef {object} GiftVoucherProductInfo
 * @property {string} gid
 * @property {string} numericId
 * @property {string} handle
 * @property {string} title
 * @property {string} status       ACTIVE | UNLISTED | DRAFT | ARCHIVED
 * @property {boolean} isGiftCard  must be false (a Shopify gift-card product issues its own card)
 * @property {GiftVoucherProductVariantInfo[]} variants
 */

/** @param {unknown} handle */
export function normalizeProductHandle(handle) {
  return typeof handle === "string" ? handle.trim().toLowerCase() : "";
}

/**
 * A productByIdentifier node (PRODUCT_FIELDS) → GiftVoucherProductInfo; null when there is
 * no product. Variants without a readable id or price are skipped.
 * @param {unknown} node
 * @returns {GiftVoucherProductInfo | null}
 */
export function parseGiftVoucherProduct(node) {
  if (!node || typeof node !== "object") return null;
  const p = /** @type {Record<string, any>} */ (node);
  const gid = shopifyGid("Product", p.id);
  const numericId = numericShopifyId(p.legacyResourceId) ?? numericShopifyId(gid);
  if (!gid || !numericId) return null;
  /** @type {GiftVoucherProductVariantInfo[]} */
  const variants = [];
  for (const v of Array.isArray(p.variants?.nodes) ? p.variants.nodes : []) {
    const vgid = shopifyGid("ProductVariant", v?.id);
    const vid = numericShopifyId(v?.legacyResourceId) ?? numericShopifyId(vgid);
    const priceCents = moneyAmountToCents(v?.price);
    if (!vgid || !vid || priceCents == null) continue;
    variants.push({
      gid: vgid,
      numericId: vid,
      title: str(v.title) ?? "",
      priceCents,
      taxable: v.taxable === true,
      requiresShipping: v.inventoryItem?.requiresShipping === true,
    });
  }
  return {
    gid,
    numericId,
    handle: normalizeProductHandle(p.handle),
    title: str(p.title) ?? "",
    status: upper(p.status),
    isGiftCard: p.isGiftCard === true,
    variants,
  };
}

/**
 * @typedef {{ level: "error" | "warning", product: "voucher" | "print" | "both", message: string }} GiftVoucherProductIssue
 */

const SELLABLE_STATUSES = new Set(["ACTIVE", "UNLISTED"]);

/**
 * What is wrong with the two voucher products for the setup check (verify script, admin):
 * errors block selling, warnings are decisions for the owner. German. `printOffered` = the
 * Premium-Karte can be booked (gift-voucher-storefront.mjs isGiftVoucherPrintOffered): a
 * missing print product is then an ERROR — the page sells the card with the add-on picked in
 * the theme, but Mo recognises a paid card only by its own product — else a warning.
 * @param {{ voucher: GiftVoucherProductInfo | null, print: GiftVoucherProductInfo | null,
 *   handles: { voucher: string, print: string }, printOffered?: boolean }} input
 * @returns {GiftVoucherProductIssue[]}
 */
export function describeGiftVoucherProductIssues({ voucher, print, handles, printOffered = false }) {
  /** @type {GiftVoucherProductIssue[]} */
  const issues = [];
  const vh = normalizeProductHandle(handles?.voucher);
  const ph = normalizeProductHandle(handles?.print);
  if (vh && vh === ph) {
    issues.push({ level: "error", product: "both", message: `Gutschein- und Druckprodukt haben denselben Handle „${vh}“.` });
  }
  if (!voucher) {
    issues.push({
      level: "error",
      product: "voucher",
      message: `Gutschein-Produkt „${vh}“ nicht gefunden — Produkt anlegen oder GIFT_VOUCHER_PRODUCT_HANDLE setzen.`,
    });
  } else {
    if (voucher.isGiftCard) {
      issues.push({
        level: "error",
        product: "voucher",
        message: `„${voucher.handle}“ ist ein Shopify-Geschenkkarten-Produkt — Mo braucht ein normales Produkt (sonst stellt Shopify eine zweite Karte aus, deren Code Mo nicht drucken kann).`,
      });
    }
    if (!SELLABLE_STATUSES.has(voucher.status)) {
      issues.push({ level: "warning", product: "voucher", message: `„${voucher.handle}“ ist nicht verkaufsbereit (Status ${voucher.status || "?"}).` });
    }
    if (voucher.variants.length === 0) {
      issues.push({ level: "error", product: "voucher", message: `„${voucher.handle}“ hat keine Variante mit Preis (die Varianten sind die Beträge).` });
    }
    const free = voucher.variants.filter((v) => v.priceCents <= 0).length;
    if (free) issues.push({ level: "error", product: "voucher", message: `${free} Variante(n) von „${voucher.handle}“ ohne Preis.` });
    const taxable = voucher.variants.filter((v) => v.taxable).length;
    if (taxable) {
      issues.push({
        level: "warning",
        product: "voucher",
        message: `${taxable} Variante(n) von „${voucher.handle}“ sind steuerpflichtig (taxable) — ein Mehrzweckgutschein wird erst bei der Einlösung besteuert; bitte mit dem Steuerberater klären.`,
      });
    }
    const shipping = voucher.variants.filter((v) => v.requiresShipping).length;
    if (shipping) {
      issues.push({
        level: "warning",
        product: "voucher",
        message: `${shipping} Variante(n) von „${voucher.handle}“ verlangen Versand — der Checkout fragt dann eine Lieferadresse ab und berechnet Versandkosten.`,
      });
    }
  }
  if (!print) {
    issues.push(
      printOffered
        ? {
            level: "error",
            product: "print",
            message: `Druck-Zusatzprodukt „${ph}“ nicht gefunden — Mo erkennt bezahlte Premium-Karten nur an diesem Produkt. Ist im Theme ein anderes Zusatzprodukt gewählt, verkauft die Seite die Karte trotzdem und Mo druckt sie nicht: Produkt mit diesem Handle anlegen, GIFT_VOUCHER_PRINT_PRODUCT_HANDLE setzen oder im Theme „Premium-Karte“ leeren.`,
          }
        : {
            level: "warning",
            product: "print",
            message: `Druck-Zusatzprodukt „${ph}“ nicht gefunden — „Premium-Karte per Post“ ist dann nicht buchbar.`,
          }
    );
  } else {
    if (print.isGiftCard) {
      issues.push({ level: "error", product: "print", message: `„${print.handle}“ ist ein Shopify-Geschenkkarten-Produkt — es muss ein normales Produkt sein.` });
    }
    if (!SELLABLE_STATUSES.has(print.status)) {
      issues.push({ level: "warning", product: "print", message: `„${print.handle}“ ist nicht verkaufsbereit (Status ${print.status || "?"}).` });
    }
    if (print.variants.length === 0) {
      issues.push({ level: "error", product: "print", message: `„${print.handle}“ hat keine Variante mit Preis.` });
    } else if (print.variants.length > 1) {
      issues.push({ level: "warning", product: "print", message: `„${print.handle}“ hat ${print.variants.length} Varianten — der Gutschein-Designer nutzt nur die erste.` });
    }
    if (print.variants.some((v) => v.requiresShipping)) {
      issues.push({
        level: "warning",
        product: "print",
        message: `„${print.handle}“ verlangt Versand — der Checkout fragt dann die Adresse des Käufers ab und berechnet Versandkosten (die Karte geht an die Adresse aus dem Designer).`,
      });
    }
  }
  if (voucher && print && voucher.gid === print.gid && vh !== ph) {
    issues.push({ level: "error", product: "both", message: "Gutschein- und Druckprodukt sind dasselbe Shopify-Produkt." });
  }
  return issues;
}

// ── The last good product lookup (orders/paid falls back on it) ─────────────

/** admin_settings key of the last good voucher-product lookup (gift-voucher-store.ts). */
export const GIFT_VOUCHER_PRODUCTS_SNAPSHOT_KEY = "gift_voucher_products";

/**
 * What orders/paid needs of the two products (a live lookup or the stored snapshot).
 * @typedef {object} GiftVoucherKnownProducts
 * @property {{ numericId: string, isGiftCard: boolean, variants: Array<{ numericId: string, priceCents: number }> } | null} voucher
 * @property {{ numericId: string } | null} print
 */

/**
 * The stored form of a good lookup: { voucherHandle, printHandle, voucher: { id, numericId,
 * isGiftCard, variants: [{ numericId, priceCents }] }, print: { id, numericId } | null } —
 * only what orders/paid needs, no titles. Null without a voucher product (nothing to fall
 * back on). Handles are stored normalised.
 * @param {{ handles: { voucher: string, print: string },
 *   voucher: GiftVoucherProductInfo | null, print: GiftVoucherProductInfo | null }} input
 */
export function giftVoucherProductsSnapshot({ handles, voucher, print }) {
  if (!voucher) return null;
  return {
    voucherHandle: normalizeProductHandle(handles?.voucher),
    printHandle: normalizeProductHandle(handles?.print),
    voucher: {
      id: voucher.gid,
      numericId: voucher.numericId,
      isGiftCard: voucher.isGiftCard === true,
      variants: voucher.variants.map((v) => ({ numericId: v.numericId, priceCents: v.priceCents })),
    },
    print: print ? { id: print.gid, numericId: print.numericId } : null,
  };
}

/** @param {unknown} v */
const digitsOrNull = (v) => (typeof v === "string" && /^\d{1,20}$/.test(v) ? v : null);

/**
 * A stored snapshot back as GiftVoucherKnownProducts — only when it is well formed and was
 * taken for the handles configured NOW (a changed GIFT_VOUCHER_*_PRODUCT_HANDLE never falls
 * back on the old products). Null otherwise.
 * @param {unknown} value
 * @param {{ voucher: string, print: string }} handles
 * @returns {GiftVoucherKnownProducts | null}
 */
export function giftVoucherProductsFromSnapshot(value, handles) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const s = /** @type {Record<string, any>} */ (value);
  if (normalizeProductHandle(s.voucherHandle) !== normalizeProductHandle(handles?.voucher)) return null;
  if (normalizeProductHandle(s.printHandle) !== normalizeProductHandle(handles?.print)) return null;
  const voucherId = digitsOrNull(s.voucher?.numericId);
  if (!voucherId) return null;
  /** @type {Array<{ numericId: string, priceCents: number }>} */
  const variants = [];
  for (const v of Array.isArray(s.voucher.variants) ? s.voucher.variants : []) {
    const id = digitsOrNull(v?.numericId);
    if (id && Number.isSafeInteger(v.priceCents) && v.priceCents >= 0) variants.push({ numericId: id, priceCents: v.priceCents });
  }
  const printId = s.print ? digitsOrNull(s.print.numericId) : null;
  if (s.print && !printId) return null;
  return {
    voucher: { numericId: voucherId, isGiftCard: s.voucher.isGiftCard === true, variants },
    print: printId ? { numericId: printId } : null,
  };
}

/**
 * giftCardConfiguration → cents and the default expiry (null when unreadable).
 * @param {unknown} config
 * @returns {{ issueLimitCents: number | null, purchaseLimitCents: number | null, currency: string | null,
 *   expiration: { unit: string, value: number } | null } | null}
 */
export function parseGiftCardConfiguration(config) {
  if (!config || typeof config !== "object") return null;
  const c = /** @type {Record<string, any>} */ (config);
  const unit = str(c.expirationConfiguration?.expirationUnit);
  const value = c.expirationConfiguration?.expirationValue;
  return {
    issueLimitCents: moneyAmountToCents(c.issueLimit?.amount),
    purchaseLimitCents: moneyAmountToCents(c.purchaseLimit?.amount),
    currency: str(c.issueLimit?.currencyCode) ?? str(c.purchaseLimit?.currencyCode),
    expiration: unit && Number.isInteger(value) ? { unit, value } : null,
  };
}

// ── Scopes ───────────────────────────────────────────────────────────────────

/**
 * Whether `granted` covers `scope` — a write_x scope also grants read_x.
 * @param {Set<string>} granted
 * @param {string} scope
 */
export function hasScope(granted, scope) {
  if (granted.has(scope)) return true;
  return scope.startsWith("read_") && granted.has(`write_${scope.slice("read_".length)}`);
}

/**
 * currentAppInstallation.accessScopes (handles or { handle } objects) → what the
 * Geschenkgutscheine need.
 * @param {unknown} accessScopes
 * @returns {{ granted: string[], missing: string[], optionalMissing: string[] }}
 */
export function evaluateGiftVoucherScopes(accessScopes) {
  const handles = (Array.isArray(accessScopes) ? accessScopes : [])
    .map((s) => (typeof s === "string" ? s : typeof s?.handle === "string" ? s.handle : ""))
    .map((s) => s.trim())
    .filter(Boolean);
  const granted = [...new Set(handles)].sort();
  const set = new Set(granted);
  return {
    granted,
    missing: GIFT_VOUCHER_REQUIRED_SCOPES.filter((s) => !hasScope(set, s)),
    optionalMissing: GIFT_VOUCHER_OPTIONAL_SCOPES.filter((s) => !hasScope(set, s)),
  };
}

// ── Fulfilment ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} GiftVoucherFulfillmentRequest
 * @property {string} fulfillmentOrderId
 * @property {Array<{ id: string, quantity: number }>} fulfillmentOrderLineItems
 * @property {string[]} lineItemIds   the order line items (gids) this request completes
 *
 * @typedef {object} GiftVoucherFulfillmentPlan
 * @property {GiftVoucherFulfillmentRequest[]} requests  one fulfillmentCreate per fulfillment order
 * @property {string[]} done      lines with nothing left to fulfil (or only in closed/cancelled orders)
 * @property {Array<{ lineItemId: string, status: string }>} blocked  remaining quantity sits in a
 *   fulfillment order that cannot be fulfilled right now (ON_HOLD, SCHEDULED, …)
 * @property {string[]} missing   in no fulfillment order (yet)
 * @property {boolean} truncated  a page was cut, so `missing` is not conclusive
 */

const FINAL_FULFILLMENT_STATUSES = new Set(["CANCELLED", "CLOSED", "INCOMPLETE"]);
// States that clear by themselves: a hold gets released, a scheduled date arrives, a
// fulfillment service finishes. An OPEN order without CREATE_FULFILLMENT (assigned to a
// fulfillment service, waiting for a fulfillment request) needs a person instead.
const TEMPORARY_BLOCK_STATUSES = new Set(["ON_HOLD", "SCHEDULED", "IN_PROGRESS"]);

/**
 * Whether a `blocked` line of planGiftVoucherFulfillment can be retried later as it is.
 * @param {unknown} status
 */
export function isTemporaryFulfillmentBlock(status) {
  return TEMPORARY_BLOCK_STATUSES.has(upper(status));
}

/**
 * Which fulfillment-order line items to fulfil so that exactly the given order line items
 * (the voucher lines — numeric ids or gids) are marked done. Re-planned from Shopify's
 * current `remainingQuantity` on every run, so a retry after a lost answer is a no-op.
 * Only fulfillment orders offering CREATE_FULFILLMENT are used.
 *
 * @param {unknown} fulfillmentOrders  order.fulfillmentOrders ({ pageInfo, nodes }) or the node list
 * @param {unknown} lineItemIds
 * @returns {GiftVoucherFulfillmentPlan}
 */
export function planGiftVoucherFulfillment(fulfillmentOrders, lineItemIds) {
  /** @type {Set<string>} */
  const targets = new Set();
  for (const id of Array.isArray(lineItemIds) ? lineItemIds : []) {
    const gid = lineItemGid(id);
    if (gid) targets.add(gid);
  }
  const conn = /** @type {Record<string, any> | null} */ (
    fulfillmentOrders && typeof fulfillmentOrders === "object" ? fulfillmentOrders : null
  );
  const nodes = Array.isArray(fulfillmentOrders) ? fulfillmentOrders : Array.isArray(conn?.nodes) ? conn.nodes : [];
  let truncated = conn?.pageInfo?.hasNextPage === true;
  /** @type {GiftVoucherFulfillmentRequest[]} */
  const requests = [];
  const seen = new Set();
  const requested = new Set();
  /** @type {Map<string, string>} */
  const waiting = new Map();
  for (const fo of nodes) {
    if (!fo || typeof fo !== "object" || typeof fo.id !== "string") continue;
    if (fo.lineItems?.pageInfo?.hasNextPage === true) truncated = true;
    const status = upper(fo.status);
    const actions = new Set((Array.isArray(fo.supportedActions) ? fo.supportedActions : []).map((a) => upper(a?.action)));
    const actionable = actions.has("CREATE_FULFILLMENT");
    /** @type {Array<{ id: string, quantity: number }>} */
    const items = [];
    const covered = new Set();
    for (const li of Array.isArray(fo.lineItems?.nodes) ? fo.lineItems.nodes : []) {
      const target = lineItemGid(li?.lineItem?.id);
      if (!target || !targets.has(target)) continue;
      seen.add(target);
      const qty = Number.isInteger(li.remainingQuantity) && li.remainingQuantity > 0 ? li.remainingQuantity : 0;
      if (qty === 0 || typeof li.id !== "string") continue;
      if (actionable) {
        items.push({ id: li.id, quantity: qty });
        covered.add(target);
      } else if (!FINAL_FULFILLMENT_STATUSES.has(status)) {
        waiting.set(target, status || "?");
      }
    }
    if (items.length) {
      for (const t of covered) requested.add(t);
      requests.push({ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: items, lineItemIds: [...covered] });
    }
  }
  const blocked = [...waiting].map(([lineItemId, status]) => ({ lineItemId, status }));
  const missing = [...targets].filter((t) => !seen.has(t));
  const done = [...targets].filter((t) => seen.has(t) && !requested.has(t) && !waiting.has(t));
  return { requests, done, blocked, missing, truncated };
}

// ── Catalog exclusion ────────────────────────────────────────────────────────

/**
 * The handles of the voucher product and its print add-on (normalized, blanks dropped):
 * sold through the shop but no training equipment, so they never enter Mo's chat
 * catalog (catalog-mapping.ts mapShopifyProducts, scripts/convert-catalog.mjs).
 * @param {{ voucher?: unknown, print?: unknown } | null | undefined} handles
 * @returns {Set<string>}
 */
export function giftVoucherCatalogHandles(handles) {
  const out = new Set();
  for (const h of [handles?.voucher, handles?.print]) {
    const n = normalizeProductHandle(h);
    if (n) out.add(n);
  }
  return out;
}

/**
 * @param {unknown} handle
 * @param {Set<string>} excluded  from giftVoucherCatalogHandles
 */
export function isGiftVoucherCatalogHandle(handle, excluded) {
  const n = normalizeProductHandle(handle);
  return n !== "" && excluded.has(n);
}
