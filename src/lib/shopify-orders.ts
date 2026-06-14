// "Chatted but not purchased" check via the Shopify Admin GraphQL orders query.
//
// ⚠️ Shopify's APIs changed recently — this was written against CURRENT docs,
// not memory:
//   Query:   orders(first, query, sortKey, reverse)
//   Docs:    https://shopify.dev/docs/api/admin-graphql/latest/queries/orders
//   Search:  https://shopify.dev/docs/api/usage/search-syntax
//   Verified: 2026-06-04 against API version SHOPIFY_API_VERSION (current stable,
//             e.g. 2026-04 — we target the configured version, not "latest").
//   Scope:   read_orders. NOTE: the order `email` is protected customer data;
//            an app querying it may also need Protected Customer Data access
//            approved in the Partner Dashboard. We only read existence + minimal
//            fields and never persist the order email.
//
// Search syntax used: `email` is a tokenized field, so the address is quoted as
// a phrase for an exact match, combined (implicit AND) with a created_at range:
//   email:"foo@bar.com" created_at:>=2026-01-01T00:00:00Z

import { adminGraphql, isShopifyConfigured } from "./shopify";
import { normalizeEmail } from "./email-capture-store";
import { chooseLawfulAddress } from "./postal-address.mjs";
import { isCompletedPurchaseStatus } from "./bestandskunden.mjs";
import { reportError } from "./observability";

const ORDERS_BY_EMAIL = /* GraphQL */ `
  query MarketingOrdersByEmail($query: String!) {
    orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        createdAt
        displayFinancialStatus
      }
    }
  }
`;

interface OrdersResponse {
  orders: {
    nodes: Array<{
      id: string;
      name: string;
      createdAt: string;
      displayFinancialStatus: string | null;
    }>;
  };
}

function orderLookbackDays(): number {
  const raw = process.env.MARKETING_ORDER_LOOKBACK_DAYS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 180;
}

export type PurchaseCheck =
  | { status: "purchased"; orderCount: number; latestOrderName: string | null }
  | { status: "no_purchase" }
  // Shopify not configured or the query failed — we don't know, so we DON'T
  // flag (the flag is a positive marketing signal; "unknown" must not masquerade
  // as "not purchased").
  | { status: "unknown" };

/**
 * Look for an order placed by `email` within the lookback window. Returns
 * `no_purchase` (→ the "chatted but not purchased" marketing flag) only when the
 * query succeeds and finds nothing; any error/misconfiguration is `unknown`.
 * Never throws.
 */
export async function checkRecentPurchase(email: string): Promise<PurchaseCheck> {
  if (!isShopifyConfigured()) return { status: "unknown" };
  const e = normalizeEmail(email);
  if (!e) return { status: "unknown" };

  const since = new Date(Date.now() - orderLookbackDays() * 86_400_000)
    .toISOString();
  // Quote the email (tokenized field → exact phrase match); AND the date range.
  const query = `email:"${e}" created_at:>=${since}`;

  try {
    const data = await adminGraphql<OrdersResponse>(ORDERS_BY_EMAIL, { query });
    const nodes = data.orders?.nodes ?? [];
    if (nodes.length === 0) return { status: "no_purchase" };
    return {
      status: "purchased",
      orderCount: nodes.length,
      latestOrderName: nodes[0]?.name ?? null,
    };
  } catch (err) {
    reportError(err, { route: "lib/shopify-orders", phase: "checkRecentPurchase" });
    return { status: "unknown" };
  }
}

// ---------------------------------------------------------------------------
// Purchased line items — backs the "recommendation → purchase" KPI loop.
// ---------------------------------------------------------------------------
//
// Same query shape and protected-customer-data caveats as checkRecentPurchase,
// but pulls the line items so we can compare what was BOUGHT to what was
// RECOMMENDED in the chat. We read only the handle/title needed to match against
// the catalog and never persist the order email.

const ORDER_ITEMS_BY_EMAIL = /* GraphQL */ `
  query MarketingOrderItemsByEmail($query: String!) {
    orders(first: 10, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        lineItems(first: 50) {
          nodes {
            title
            product { id handle title }
          }
        }
      }
    }
  }
`;

interface OrderItemsResponse {
  orders: {
    nodes: Array<{
      id: string;
      lineItems: {
        nodes: Array<{
          title: string | null;
          product: { id: string; handle: string | null; title: string | null } | null;
        }>;
      };
    }>;
  };
}

export interface PurchasedItem {
  /** Storefront product handle (the reliable match key against our catalog id). */
  handle: string | null;
  title: string | null;
}

/**
 * Flattened line items across this email's recent orders, or null when Shopify
 * is unconfigured / the email is blank / the query fails (i.e. "we don't know" —
 * never an empty array, which means "ordered nothing matching"). Never throws.
 */
export async function fetchPurchasedItemsByEmail(
  email: string
): Promise<PurchasedItem[] | null> {
  if (!isShopifyConfigured()) return null;
  const e = normalizeEmail(email);
  if (!e) return null;

  const since = new Date(Date.now() - orderLookbackDays() * 86_400_000).toISOString();
  const query = `email:"${e}" created_at:>=${since}`;

  try {
    const data = await adminGraphql<OrderItemsResponse>(ORDER_ITEMS_BY_EMAIL, { query });
    const items: PurchasedItem[] = [];
    for (const order of data.orders?.nodes ?? []) {
      for (const li of order.lineItems?.nodes ?? []) {
        items.push({
          handle: li.product?.handle ?? null,
          title: li.product?.title ?? li.title ?? null,
        });
      }
    }
    return items;
  } catch (err) {
    reportError(err, { route: "lib/shopify-orders", phase: "fetchPurchasedItemsByEmail" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Order history — the customer's "what did they buy" purchase memory.
// ---------------------------------------------------------------------------
//
// Same orders(query:) shape and protected-customer-data caveats as above, but
// WITHOUT the lookback window (purchase memory wants the full history) and
// with dates + totals + quantities. Field shapes re-checked against current
// docs 2026-06-11:
//   Order.currentTotalPriceSet: MoneyBag! → shopMoney { amount currencyCode }
//   (current* = after edits/refunds, i.e. what the customer actually paid)
//   LineItem.quantity: Int!
// NOTE: by default an app only reads orders from the LAST 60 DAYS; the full
// history additionally needs the read_all_orders scope approved by Shopify.
// The summary is cached on the customer row and refreshed on demand from the
// admin dashboard — this function does no caching itself.

const ORDER_HISTORY_MAX_ORDERS = 20;

const ORDER_HISTORY_BY_EMAIL = /* GraphQL */ `
  query CustomerOrderHistoryByEmail($query: String!) {
    orders(first: ${ORDER_HISTORY_MAX_ORDERS}, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        createdAt
        displayFinancialStatus
        currentTotalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        lineItems(first: 25) {
          nodes {
            title
            quantity
            product { id handle title }
          }
        }
      }
    }
  }
`;

interface OrderHistoryResponse {
  orders: {
    nodes: Array<{
      id: string;
      name: string;
      createdAt: string;
      displayFinancialStatus: string | null;
      currentTotalPriceSet: {
        shopMoney: { amount: string; currencyCode: string } | null;
      } | null;
      lineItems: {
        nodes: Array<{
          title: string | null;
          quantity: number;
          product: { id: string; handle: string | null; title: string | null } | null;
        }>;
      };
    }>;
  };
}

export interface OrderHistoryItem {
  title: string | null;
  /** Storefront product handle — the match key against our catalog. */
  handle: string | null;
  quantity: number;
}

export interface OrderHistoryEntry {
  /** Order name as shown in the shop admin, e.g. "#1042". */
  name: string;
  createdAt: string;
  /** Decimal string (GraphQL Money), what the customer actually paid. */
  totalAmount: string | null;
  currencyCode: string | null;
  financialStatus: string | null;
  items: OrderHistoryItem[];
}

/** Cached on customers.purchase_summary (jsonb). */
export interface OrderHistory {
  orders: OrderHistoryEntry[];
  /** True when the result may be truncated at ORDER_HISTORY_MAX_ORDERS. */
  truncated: boolean;
  fetchedAt: string;
}

/**
 * The full order history for an email: products purchased, dates, totals.
 * Returns null when Shopify is unconfigured / the email is blank / the query
 * fails ("we don't know" — distinct from `{orders: []}`, which means the query
 * succeeded and found no orders). Never throws.
 */
export async function fetchOrderHistoryByEmail(
  email: string
): Promise<OrderHistory | null> {
  if (!isShopifyConfigured()) return null;
  const e = normalizeEmail(email);
  if (!e) return null;

  // Quote the email (tokenized field → exact phrase match). No date range:
  // purchase memory wants everything the access scope lets us see.
  const query = `email:"${e}"`;

  try {
    const data = await adminGraphql<OrderHistoryResponse>(ORDER_HISTORY_BY_EMAIL, { query });
    const nodes = data.orders?.nodes ?? [];
    const orders: OrderHistoryEntry[] = nodes.map((o) => ({
      name: o.name,
      createdAt: o.createdAt,
      totalAmount: o.currentTotalPriceSet?.shopMoney?.amount ?? null,
      currencyCode: o.currentTotalPriceSet?.shopMoney?.currencyCode ?? null,
      financialStatus: o.displayFinancialStatus ?? null,
      items: (o.lineItems?.nodes ?? []).map((li) => ({
        title: li.product?.title ?? li.title ?? null,
        handle: li.product?.handle ?? null,
        quantity: Number(li.quantity) || 0,
      })),
    }));
    return {
      orders,
      truncated: nodes.length >= ORDER_HISTORY_MAX_ORDERS,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    reportError(err, { route: "lib/shopify-orders", phase: "fetchOrderHistoryByEmail" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Address acquisition (§4) — the LAWFUL postal address for physical mail.
// ---------------------------------------------------------------------------
//
// For an EMAIL-only (tier-2) customer with completed orders, the shipping
// address of a completed order is a purchase-derived lawful basis for outbound
// post. This is a SEPARATE, deliberate read — the address is NEVER added to
// OrderHistory (which feeds the profile model); it goes only to the dedicated
// customers.postal_address store. Same read_orders scope + protected-customer-
// data caveats as the history fetch.

const ORDER_SHIPPING_BY_EMAIL = /* GraphQL */ `
  query CustomerShippingAddressesByEmail($query: String!) {
    orders(first: 10, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        displayFinancialStatus
        shippingAddress {
          city
          countryCodeV2
          address1
          address2
          zip
          firstName
          lastName
          company
          name
        }
      }
    }
  }
`;

interface OrderShippingResponse {
  orders: {
    nodes: Array<{
      displayFinancialStatus: string | null;
      shippingAddress: Record<string, unknown> | null;
    }>;
  };
}

/**
 * The lawful postal address for an email-identified customer, from the shipping
 * address of their most recent COMPLETED order (basis 'purchase'). Returns null
 * when Shopify is unconfigured, the email is blank, the query fails, or no
 * completed order carries a COMPLETE address (never part-filled). Never throws.
 */
export async function fetchLawfulAddressByEmail(
  email: string
): Promise<{ address: Record<string, unknown>; source: string } | null> {
  if (!isShopifyConfigured()) return null;
  const e = normalizeEmail(email);
  if (!e) return null;
  const query = `email:"${e}"`;
  try {
    const data = await adminGraphql<OrderShippingResponse>(ORDER_SHIPPING_BY_EMAIL, { query });
    const nodes = data.orders?.nodes ?? [];
    // Newest-first, completed purchases only — their shipping address is the
    // purchase-derived basis.
    const orderShippingAddresses = nodes
      .filter((o) => isCompletedPurchaseStatus(o.displayFinancialStatus))
      .map((o) => o.shippingAddress);
    return chooseLawfulAddress({ orderShippingAddresses });
  } catch (err) {
    reportError(err, { route: "lib/shopify-orders", phase: "fetchLawfulAddressByEmail" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Discount-code redemption — backs the marketing funnel's "converted" step.
// ---------------------------------------------------------------------------
//
// Each marketing send mints a UNIQUE single-use code (usageLimit: 1). So "was
// this send's offer converted?" reduces to "does any order carry this code?".
// `discount_code` is a searchable order field in the Admin order search syntax
// (https://shopify.dev/docs/api/usage/search-syntax); we quote it as a phrase
// for an exact match. Same read_orders scope and protected-customer-data caveats
// as above; we read only existence (the order id) and never persist anything.

const ORDERS_BY_DISCOUNT_CODE = /* GraphQL */ `
  query MarketingOrdersByDiscountCode($query: String!) {
    orders(first: 1, query: $query) {
      nodes { id }
    }
  }
`;

interface OrdersIdResponse {
  orders: { nodes: Array<{ id: string }> };
}

/**
 * Whether the (unique, single-use) discount `code` was redeemed in any order.
 * Returns true/false when Shopify answers, or null when Shopify is unconfigured
 * / the code is blank / the query fails (i.e. "we don't know" — never silently
 * counted as "not redeemed"). Never throws.
 */
export async function wasDiscountCodeRedeemed(
  code: string
): Promise<boolean | null> {
  if (!isShopifyConfigured()) return null;
  const c = code.trim();
  if (!c) return null;

  // Quote the code (phrase match); searchable order field `discount_code`.
  const query = `discount_code:"${c}"`;
  try {
    const data = await adminGraphql<OrdersIdResponse>(ORDERS_BY_DISCOUNT_CODE, { query });
    return (data.orders?.nodes ?? []).length > 0;
  } catch (err) {
    reportError(err, { route: "lib/shopify-orders", phase: "wasDiscountCodeRedeemed" });
    return null;
  }
}
