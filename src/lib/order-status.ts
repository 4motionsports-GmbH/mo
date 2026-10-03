// Order status in the chat (`get_order_status`) — I/O.
//
// The pure rules (who may see order data, the states, the model-facing shape
// and its privacy whitelist) live in order-status-core.mjs. This file reads:
//
//   1. the switch (CHAT_ORDER_STATUS_ENABLED, default off),
//   2. the session's link — it must be the Customer Account sign-in
//      ('customer_account') IN THIS SESSION (resolveSignedInLink),
//   3. a live access token for that customer (getValidAccessToken) — a
//      signed-out or expired account sees nothing,
//   4. the customer's own orders from the ledger (customer_orders),
//   5. optionally, for at most MAX_LIVE_ENRICHMENTS orders that are not
//      cancelled, a short live read from the Admin API (fulfillment progress,
//      carrier name, delivery dates) — bounded by LIVE_TIMEOUT_MS and checked
//      for ownership; anything late, failing or foreign is dropped and the
//      answer stays ledger-only.
//
// Marketing consent is not required (customer service, Art. 6 (1) b). Every
// step fails soft to a status the model can explain ("sign_in_required",
// "unavailable"); a lookup never throws into the chat stream.
// docs/ANWALTSDOSSIER.md §16, docs/CUSTOMER_ACCOUNT.md §8.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { resolveSignedInLink } from "./customer-session-link.mjs";
import { getValidAccessToken } from "./customer-oauth-store";
import { listCustomerOrders, type LedgerOrder } from "./customer-orders-store";
import { adminGraphql, isShopifyConfigured } from "./shopify";
import { isChatOrderStatusEnabled } from "./platform-flags.mjs";
import { KPI_ORDER_STATUS_LOOKUP, recordKpiEvent } from "./kpi-events";
import {
  LIVE_TIMEOUT_MS,
  MAX_LIVE_ENRICHMENTS,
  ORDERS_FOR_MATCH,
  accountOrdersUrl,
  buildOrderStatusForModel,
  decideOrderAccess,
  normalizeTopic,
  parseLiveOrder,
  selectOrders,
  wantsLiveRead,
} from "./order-status-core.mjs";

export type OrderStatusTopic = "status" | "shipping" | "return" | "cancellation" | "refund";

export type OrderStatusResult = ReturnType<typeof buildOrderStatusForModel>;

type LiveOrder = NonNullable<ReturnType<typeof parseLiveOrder>>;

/** The outcome of the access gate, resolved once per chat request. */
export type OrderAccess =
  | { access: "ok"; customerId: number; shopifyCustomerId: string }
  | { access: "disabled" | "sign_in_required" | "unavailable" };

// The one live read. Only the fields the core whitelists are requested —
// tracking numbers and URLs, addresses, amounts and the order name are not
// even fetched. `customer { id }` is the ownership check.
const LIVE_ORDER_QUERY = /* GraphQL */ `
  query MoChatOrderStatus($id: ID!) {
    order(id: $id) {
      customer { id }
      cancelledAt
      displayFinancialStatus
      displayFulfillmentStatus
      fulfillments(first: 5) {
        status
        displayStatus
        inTransitAt
        deliveredAt
        estimatedDeliveryAt
        trackingInfo(first: 3) { company }
      }
    }
  }
`;

/**
 * Resolve whether this session may see order data. Never throws; the token
 * read (which may refresh and rotate the customer's tokens) runs only for a
 * Customer Account link.
 */
export async function resolveOrderAccess(
  sessionId: string | null,
  sql: Sql | null = getSql()
): Promise<OrderAccess> {
  const flagOn = isChatOrderStatusEnabled();
  if (!flagOn) return { access: "disabled" };
  const sid = sessionId?.trim() || null;
  if (!sid) return { access: "sign_in_required" };
  if (!sql) return { access: "unavailable" };
  try {
    const link = await resolveSignedInLink(sql, sid);
    const linkKind = link?.linkKind ?? null;
    const token =
      link && linkKind === "customer_account" ? await getValidAccessToken(link.customerId, sql) : null;
    const decision = decideOrderAccess({ flagOn, sessionId: sid, linkKind, hasToken: Boolean(token) });
    if (decision !== "ok" || !link) return { access: decision === "ok" ? "sign_in_required" : decision };
    return { access: "ok", customerId: link.customerId, shopifyCustomerId: link.shopifyCustomerId };
  } catch (err) {
    reportError(err, { route: "lib/order-status", phase: "resolveOrderAccess" });
    return { access: "unavailable" };
  }
}

/**
 * Live facts for up to MAX_LIVE_ENRICHMENTS orders, keyed by shopifyOrderId.
 * Bounded by LIVE_TIMEOUT_MS: whatever has not arrived by then is left out
 * (the snapshot is taken at the deadline, so a late answer can never land in
 * a result that was already handed to the model). Never throws.
 */
async function readLiveOrders(
  orders: LedgerOrder[],
  shopifyCustomerId: string
): Promise<Map<string, LiveOrder>> {
  const found = new Map<string, LiveOrder>();
  if (!isShopifyConfigured()) return found;
  const targets = orders.filter(wantsLiveRead).slice(0, MAX_LIVE_ENRICHMENTS);
  if (targets.length === 0) return found;

  const reads = Promise.all(
    targets.map(async (order) => {
      try {
        const data = await adminGraphql<{ order: unknown }>(LIVE_ORDER_QUERY, {
          id: `gid://shopify/Order/${order.shopifyOrderId}`,
        });
        if (!data?.order) return; // deleted, or older than the app may read
        const live = parseLiveOrder(data.order, shopifyCustomerId);
        if (live) {
          found.set(order.shopifyOrderId, live);
        } else {
          // The ledger links the order to this customer, Shopify says
          // otherwise (e.g. reassigned) — keep the ledger facts only.
          reportError(new Error("order_status_live_owner_mismatch"), {
            route: "lib/order-status",
            phase: "live-ownership",
          });
        }
      } catch (err) {
        reportError(err, { route: "lib/order-status", phase: "live-read" });
      }
    })
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, LIVE_TIMEOUT_MS);
  });
  try {
    await Promise.race([reads.then(() => undefined), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return new Map(found);
}

/**
 * Answer get_order_status for the chat session. Returns the model-facing
 * object of order-status-core (never throws) and records one pseudonymous
 * KPI event. `access` lets the caller share one access resolution between
 * several calls of the same request (parallel tool calls must not refresh
 * the customer's token twice).
 */
export async function lookupOrderStatus(
  input: {
    sessionId: string | null;
    orderRef?: string | null;
    topic?: string | null;
    access?: Promise<OrderAccess>;
  },
  sql: Sql | null = getSql()
): Promise<OrderStatusResult> {
  const ordersPageUrl = accountOrdersUrl();
  const topic = normalizeTopic(input.topic);
  let outcome: string = "unavailable";
  let source: "ledger" | "ledger+live" = "ledger";
  let result: OrderStatusResult = buildOrderStatusForModel({ status: "unavailable", ordersPageUrl });

  try {
    const access = await (input.access ?? resolveOrderAccess(input.sessionId, sql));
    if (access.access !== "ok") {
      outcome = access.access;
      result = buildOrderStatusForModel({
        status: access.access === "sign_in_required" ? "sign_in_required" : "unavailable",
        ordersPageUrl,
      });
    } else {
      const { orders } = await listCustomerOrders(access.customerId, { limit: ORDERS_FOR_MATCH }, sql);
      const selection = selectOrders(orders, input.orderRef ?? null);
      const live =
        selection.selected.length > 0
          ? await readLiveOrders(selection.selected, access.shopifyCustomerId)
          : new Map<string, LiveOrder>();
      if (live.size > 0) source = "ledger+live";
      outcome = selection.status;
      result = buildOrderStatusForModel({
        status: selection.status,
        matched: selection.matched,
        orders: selection.selected,
        live,
        ordersPageUrl,
      });
    }
  } catch (err) {
    reportError(err, { route: "lib/order-status", phase: "lookupOrderStatus" });
    outcome = "unavailable";
    result = buildOrderStatusForModel({ status: "unavailable", ordersPageUrl });
  }

  // Pseudonymous, session-keyed; no order number, amount or id.
  await recordKpiEvent({
    sessionId: input.sessionId?.trim() || null,
    event: KPI_ORDER_STATUS_LOOKUP,
    data: { outcome, topic, source, orders: Array.isArray(result.orders) ? result.orders.length : 0 },
  });
  return result;
}

/**
 * One lookup function per chat request: the access gate (link + token) is
 * resolved at most once, however many get_order_status calls the model makes
 * in this request — parallel calls would otherwise refresh (and rotate) the
 * customer's token concurrently.
 */
export function createOrderStatusLookup(sessionId: string | null) {
  let access: Promise<OrderAccess> | null = null;
  return (input: { orderRef?: string | null; topic?: string | null }) => {
    access ??= resolveOrderAccess(sessionId);
    return lookupOrderStatus({ sessionId, orderRef: input.orderRef, topic: input.topic, access });
  };
}
