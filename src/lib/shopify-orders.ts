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
