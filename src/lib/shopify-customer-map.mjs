// Shopify customer + order payloads → the rows Mo mirrors (pure, no I/O).
//
// Three sources deliver the same facts in different shapes, and all three are
// normalised here so the store writes ONE shape:
//   * Admin GraphQL nodes — the bulk import and the nightly reconciliation
//     (camelCase, GIDs, money as MoneyBag, enums in UPPER_CASE),
//   * REST webhook payloads — customers/*, orders/* (snake_case, numeric ids,
//     money as decimal strings, enums in lower_case).
//
// Minimisation is enforced HERE: only the fields listed in the typedefs leave
// this module. Addresses (beyond the country code), phone numbers, notes and
// payment details are dropped. See docs/CUSTOMER_PLATFORM_PLAN.md §6.2–§6.3.

/**
 * @typedef {"subscribed" | "pending" | "unsubscribed" | "not_subscribed"} ConsentState
 * @typedef {"confirmed_opt_in" | "single_opt_in" | "unknown"} ConsentLevel
 *
 * @typedef {Object} ShopifyConsent
 * @property {ConsentState | "redacted" | "invalid"} state
 * @property {ConsentLevel | null} level
 * @property {string | null} at            ISO consentUpdatedAt (null = unknown)
 *
 * @typedef {Object} MirrorCustomer
 * @property {string} shopifyId            numeric id as a string
 * @property {string} gid                  gid://shopify/Customer/<id>
 * @property {string | null} email         normalised (trim + lower), null when absent
 * @property {string | null} firstName
 * @property {string | null} lastName
 * @property {string | null} locale
 * @property {string | null} countryCode
 * @property {string | null} state         ENABLED | DISABLED | INVITED | DECLINED
 * @property {string[]} tags
 * @property {string | null} createdAt
 * @property {string | null} updatedAt
 * @property {ShopifyConsent | null} consent
 *
 * @typedef {Object} MirrorLineItem
 * @property {string | null} id            numeric line-item id (dedupe key)
 * @property {string} title
 * @property {string | null} variantTitle
 * @property {number} quantity
 * @property {number | null} unitPrice     decimal in the shop currency
 * @property {string | null} handle        storefront handle (catalog id), when known
 * @property {string | null} productId     numeric
 * @property {string | null} variantId     numeric
 *
 * @typedef {Object} MirrorOrder
 * @property {string} shopifyOrderId
 * @property {string | null} shopifyCustomerId
 * @property {string | null} name
 * @property {string} processedAt
 * @property {string | null} financialStatus  UPPER_CASE (GraphQL displayFinancialStatus)
 * @property {string | null} fulfillmentStatus
 * @property {string | null} cancelledAt
 * @property {string | null} currency
 * @property {number | null} subtotalCents
 * @property {number} totalCents
 * @property {number} refundedCents
 * @property {string[]} discountCodes
 * @property {string | null} sourceName
 * @property {string | null} updatedAt
 * @property {MirrorLineItem[]} lineItems
 */

/** "gid://shopify/Customer/123" | 123 | "123" → "123"; anything else → null. */
export function numericShopifyId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/^gid:\/\/shopify\/\w+\/(\d+)(?:\?.*)?$/);
  return m ? m[1] : null;
}

/** Numeric customer id → its GID. */
export function customerGid(numericId) {
  return `gid://shopify/Customer/${numericId}`;
}

/** Trim + lower-case, or null for blanks / non-addresses. */
export function normalizeMirrorEmail(value) {
  if (typeof value !== "string") return null;
  const e = value.trim().toLowerCase();
  return e.includes("@") && e.length <= 320 ? e : null;
}

function text(value, max = 200) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function iso(value) {
  if (value == null || value === "") return null;
  const t = new Date(String(value)).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function decimal(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cents(value) {
  const n = decimal(value);
  return n == null ? null : Math.round(n * 100);
}

function upper(value) {
  const s = text(value, 64);
  return s ? s.toUpperCase() : null;
}

const CONSENT_STATES = {
  SUBSCRIBED: "subscribed",
  PENDING: "pending",
  UNSUBSCRIBED: "unsubscribed",
  NOT_SUBSCRIBED: "not_subscribed",
  REDACTED: "redacted",
  INVALID: "invalid",
};

const CONSENT_LEVELS = {
  CONFIRMED_OPT_IN: "confirmed_opt_in",
  SINGLE_OPT_IN: "single_opt_in",
  UNKNOWN: "unknown",
};

/**
 * Shopify's emailMarketingConsent (GraphQL `{ marketingState,
 * marketingOptInLevel, consentUpdatedAt }` or REST `{ state, opt_in_level,
 * consent_updated_at }`) → the Mo vocabulary. Null when absent or unreadable.
 *
 * @param {any} raw
 * @returns {ShopifyConsent | null}
 */
export function mapShopifyConsent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const stateKey = upper(raw.marketingState ?? raw.state);
  const state = stateKey ? CONSENT_STATES[stateKey] : undefined;
  if (!state) return null;
  const levelKey = upper(raw.marketingOptInLevel ?? raw.opt_in_level);
  const level = levelKey ? CONSENT_LEVELS[levelKey] ?? "unknown" : null;
  return {
    state,
    level: state === "subscribed" ? level ?? "unknown" : level,
    at: iso(raw.consentUpdatedAt ?? raw.consent_updated_at),
  };
}

/** Mo state/level → Shopify's GraphQL enums (for the consent write). */
export function toShopifyConsentInput({ state, level }) {
  const marketingState =
    state === "subscribed"
      ? "SUBSCRIBED"
      : state === "pending"
        ? "PENDING"
        : state === "unsubscribed"
          ? "UNSUBSCRIBED"
          : "NOT_SUBSCRIBED";
  const marketingOptInLevel =
    level === "confirmed_opt_in"
      ? "CONFIRMED_OPT_IN"
      : level === "single_opt_in"
        ? "SINGLE_OPT_IN"
        : "UNKNOWN";
  return { marketingState, marketingOptInLevel };
}

function tagList(value) {
  if (Array.isArray(value)) {
    return value.map((t) => text(t, 80)).filter(Boolean).slice(0, 50);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((t) => text(t, 80))
      .filter(Boolean)
      .slice(0, 50);
  }
  return [];
}

/**
 * A customer from the Admin GraphQL API (bulk JSONL line or reconcile node)
 * or from a customers/* webhook payload. Null without a usable id.
 *
 * @param {any} node
 * @returns {MirrorCustomer | null}
 */
export function mapShopifyCustomer(node) {
  if (!node || typeof node !== "object") return null;
  const shopifyId = numericShopifyId(node.admin_graphql_api_id ?? node.id);
  if (!shopifyId) return null;
  const isRest = "first_name" in node || "email_marketing_consent" in node || "created_at" in node;
  const address = node.defaultAddress ?? node.default_address ?? null;
  return {
    shopifyId,
    gid: customerGid(shopifyId),
    email: normalizeMirrorEmail(node.email ?? node.emailAddress?.emailAddress),
    firstName: text(isRest ? node.first_name : node.firstName, 120),
    lastName: text(isRest ? node.last_name : node.lastName, 120),
    locale: text(node.locale, 16),
    countryCode: upper(address?.countryCodeV2 ?? address?.country_code) ?? null,
    state: upper(node.state),
    tags: tagList(node.tags),
    createdAt: iso(isRest ? node.created_at : node.createdAt),
    updatedAt: iso(isRest ? node.updated_at : node.updatedAt),
    consent: mapShopifyConsent(node.emailMarketingConsent ?? node.email_marketing_consent),
  };
}

/**
 * The customers_email_marketing_consent/update webhook payload
 * (`{ customer_id, email_address, email_marketing_consent }`) → id + consent.
 *
 * @param {any} payload
 * @returns {{ shopifyId: string, email: string | null, consent: ShopifyConsent } | null}
 */
export function mapConsentWebhook(payload) {
  if (!payload || typeof payload !== "object") return null;
  const shopifyId = numericShopifyId(payload.customer_id ?? payload.id);
  const consent = mapShopifyConsent(payload.email_marketing_consent ?? payload.emailMarketingConsent);
  if (!shopifyId || !consent) return null;
  return { shopifyId, email: normalizeMirrorEmail(payload.email_address ?? payload.email), consent };
}

function moneyAmount(set) {
  return set?.shopMoney?.amount ?? set?.presentmentMoney?.amount ?? null;
}

/**
 * One line item. GraphQL: `{ title, variantTitle, quantity,
 * originalUnitPriceSet, variant { id }, product { id handle } }`; REST:
 * `{ title, variant_title, quantity, price, variant_id, product_id }`.
 *
 * @param {any} li
 * @returns {MirrorLineItem | null}
 */
export function mapShopifyLineItem(li) {
  if (!li || typeof li !== "object") return null;
  const title = text(li.title ?? li.name, 300);
  if (!title) return null;
  const quantity = Math.max(1, Math.floor(decimal(li.quantity) ?? 1));
  return {
    id: numericShopifyId(li.admin_graphql_api_id ?? li.id),
    title,
    variantTitle: text(li.variantTitle ?? li.variant_title, 200),
    quantity,
    unitPrice: decimal(moneyAmount(li.originalUnitPriceSet) ?? li.price),
    handle: text(li.product?.handle, 255),
    productId: numericShopifyId(li.product?.id ?? li.product_id),
    variantId: numericShopifyId(li.variant?.id ?? li.variant_id),
  };
}

/**
 * An order from Admin GraphQL (bulk line / reconcile node; line items passed
 * separately for bulk JSONL) or an orders/* webhook payload. Null without an
 * id or a date.
 *
 * @param {any} node
 * @param {any[]} [lineItems] child line-item nodes (bulk JSONL); defaults to
 *   the node's own `lineItems.nodes` / `line_items`
 * @returns {MirrorOrder | null}
 */
export function mapShopifyOrder(node, lineItems) {
  if (!node || typeof node !== "object") return null;
  const shopifyOrderId = numericShopifyId(node.admin_graphql_api_id ?? node.id);
  if (!shopifyOrderId) return null;
  const isRest = "line_items" in node || "financial_status" in node || "processed_at" in node;
  const processedAt = iso(
    isRest ? node.processed_at ?? node.created_at : node.processedAt ?? node.createdAt
  );
  if (!processedAt) return null;

  const rawItems =
    lineItems ??
    (isRest
      ? node.line_items
      : Array.isArray(node.lineItems?.nodes)
        ? node.lineItems.nodes
        : (node.lineItems?.edges ?? []).map((e) => e?.node));
  const items = (Array.isArray(rawItems) ? rawItems : [])
    .map(mapShopifyLineItem)
    .filter(Boolean)
    .slice(0, 100);

  const discountCodes = isRest
    ? (Array.isArray(node.discount_codes) ? node.discount_codes : [])
        .map((d) => text(d?.code, 80))
        .filter(Boolean)
    : (Array.isArray(node.discountCodes) ? node.discountCodes : [])
        .map((d) => text(d, 80))
        .filter(Boolean);

  // REST carries the refunds as an array of refund objects with transactions;
  // total_refunded is not a top-level field, so sum the refund transactions.
  let refundedCents = 0;
  if (isRest) {
    for (const r of Array.isArray(node.refunds) ? node.refunds : []) {
      for (const t of Array.isArray(r?.transactions) ? r.transactions : []) {
        if (String(t?.kind ?? "").toLowerCase() === "refund" && String(t?.status ?? "success") === "success") {
          refundedCents += cents(t.amount) ?? 0;
        }
      }
    }
  } else {
    refundedCents = cents(moneyAmount(node.totalRefundedSet)) ?? 0;
  }

  return {
    shopifyOrderId,
    shopifyCustomerId: numericShopifyId(node.customer?.admin_graphql_api_id ?? node.customer?.id),
    name: text(node.name, 40),
    processedAt,
    financialStatus: upper(isRest ? node.financial_status : node.displayFinancialStatus),
    fulfillmentStatus: upper(isRest ? node.fulfillment_status : node.displayFulfillmentStatus),
    cancelledAt: iso(isRest ? node.cancelled_at : node.cancelledAt),
    currency: upper(isRest ? node.currency : node.currencyCode),
    subtotalCents: cents(isRest ? node.current_subtotal_price ?? node.subtotal_price : moneyAmount(node.subtotalPriceSet)),
    totalCents:
      cents(isRest ? node.current_total_price ?? node.total_price : moneyAmount(node.currentTotalPriceSet)) ?? 0,
    refundedCents,
    discountCodes,
    sourceName: text(isRest ? node.source_name : node.sourceName, 60),
    updatedAt: iso(isRest ? node.updated_at : node.updatedAt),
    lineItems: items,
  };
}

/**
 * Order line items carry no handle in webhook payloads: fill handle (and a
 * variant ref) from the catalog by variant id, then by the normalised title.
 * `match` is lib/order-attribution.mjs → matchOrderLineItems (injected to keep
 * this module free of catalog imports).
 *
 * @param {MirrorLineItem[]} items
 * @param {(items: any[]) => { items: Array<{ handle: string | null, ref?: string }> }} match
 * @returns {Array<MirrorLineItem & { ref?: string }>}
 */
export function withCatalogHandles(items, match) {
  const missing = items.some((li) => !li.handle);
  if (!missing) return items;
  const matched = match(
    items.map((li) => ({ title: li.title, quantity: li.quantity, price: li.unitPrice, variantId: li.variantId, productId: li.productId }))
  ).items;
  return items.map((li, i) => {
    if (li.handle) return li;
    const m = matched[i];
    return m?.handle ? { ...li, handle: m.handle, ...(m.ref && m.ref !== m.handle ? { ref: m.ref } : {}) } : li;
  });
}
