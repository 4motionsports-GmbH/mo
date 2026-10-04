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
//   4. the customer's own orders from the ledger (customer_orders, rows
//      Shopify reports for THIS Shopify customer, linked or not yet linked) —
//      only while SHOPIFY_CUSTOMER_SYNC_ENABLED keeps it current and the first
//      order import has finished, else "unavailable",
//   5. optionally, for at most MAX_LIVE_ENRICHMENTS orders that are not
//      cancelled, a short live read from the Admin API (fulfillment progress,
//      carrier name, delivery dates) — bounded by LIVE_TIMEOUT_MS and checked
//      for ownership; anything late or failing stays ledger-only, an order
//      Shopify reports for ANOTHER customer is dropped entirely,
//   6. "no orders" / "not found" only when a live read of the customer's
//      newest orders confirms that the ledger is not behind
//      (confirmLedgerAnswer), else "unavailable".
//
// At most LOOKUPS_PER_REQUEST distinct lookups per chat request; repeats are
// served from the request's cache (the Admin API bucket is shared with the
// sync and the webhooks).
//
// Marketing consent is not required (customer service, Art. 6 (1) b). Every
// step fails soft to a status the model can explain ("sign_in_required",
// "unavailable"); a lookup never throws into the chat stream.
// docs/ANWALTSDOSSIER.md §16, docs/CUSTOMER_ACCOUNT.md §8.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { resolveSignedInLink } from "./customer-session-link.mjs";
import { getValidAccessToken } from "./customer-oauth-store";
import { findCustomerOrders, type LedgerOrder } from "./customer-orders-store";
import { adminGraphql, isShopifyConfigured } from "./shopify";
import {
  chatOrderStatusTestCustomers,
  isChatOrderStatusEnabled,
  isShopifyCustomerSyncEnabled,
} from "./platform-flags.mjs";
import { isOrderImportDone } from "./shopify-sync";
import { KPI_ORDER_STATUS_LOOKUP, recordKpiEvent } from "./kpi-events";
import {
  LIVE_CONFIRM_ORDERS,
  LIVE_TIMEOUT_MS,
  LOOKUPS_PER_REQUEST,
  MAX_LIVE_ENRICHMENTS,
  confirmLedgerAnswer,
  withoutForeignOrders,
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
  | { access: "disabled" | "sign_in_required" | "unavailable" | "ledger_off" };

/** The access step (link + token refresh) may not stall the chat stream. */
const ACCESS_TIMEOUT_MS = 5000;

/** The customer's newest order ids, for confirmLedgerAnswer. */
const LIVE_CUSTOMER_ORDERS_QUERY = /* GraphQL */ `
  query MoChatOrderConfirm($q: String!, $n: Int!) {
    orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) {
      nodes { id }
    }
  }
`;

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
 * While CHAT_ORDER_STATUS_ENABLED is off: is this session signed in (Customer
 * Account, this session) as one of CHAT_ORDER_STATUS_TEST_CUSTOMERS? Then the
 * order status works for it alone — the live check before switching it on for
 * everyone. False without a list, on any error, and for the shop-recognised
 * (App Proxy) link, which never sees order data. Never throws.
 */
export async function isOrderStatusTestSession(
  sessionId: string | null,
  sql: Sql | null = getSql()
): Promise<boolean> {
  const testers = chatOrderStatusTestCustomers();
  const sid = sessionId?.trim() || null;
  if (testers.size === 0 || !sid || !sql) return false;
  try {
    const link = await resolveSignedInLink(sql, sid);
    return Boolean(link && link.linkKind === "customer_account" && testers.has(String(link.shopifyCustomerId)));
  } catch (err) {
    reportError(err, { route: "lib/order-status", phase: "isOrderStatusTestSession" });
    return false;
  }
}

/** The switch for everyone, or the test list for this session. */
export async function isOrderStatusEnabledFor(
  sessionId: string | null,
  sql: Sql | null = getSql()
): Promise<boolean> {
  return isChatOrderStatusEnabled() || (await isOrderStatusTestSession(sessionId, sql));
}

/**
 * Resolve whether this session may see order data. Never throws; the token
 * read (which may refresh and rotate the customer's tokens) runs only for a
 * Customer Account link.
 */
export async function resolveOrderAccess(
  sessionId: string | null,
  sql: Sql | null = getSql()
): Promise<OrderAccess> {
  const flagOn = await isOrderStatusEnabledFor(sessionId, sql);
  if (!flagOn) return { access: "disabled" };
  const sid = sessionId?.trim() || null;
  if (!sid) return { access: "sign_in_required" };
  if (!sql) return { access: "unavailable" };
  // Without the customer sync the ledger is not kept current (its order
  // webhooks are acknowledged without writing) — never answer from a stale
  // copy. Checked BEFORE the token refresh, which may rotate the tokens.
  if (!isShopifyCustomerSyncEnabled()) return { access: "ledger_off" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<OrderAccess>((resolve) => {
    timer = setTimeout(() => resolve({ access: "unavailable" }), ACCESS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([resolveSignedInAccess(sql, sid, flagOn), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveSignedInAccess(sql: Sql, sid: string, flagOn: boolean): Promise<OrderAccess> {
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
): Promise<{ found: Map<string, LiveOrder>; foreign: Set<string> }> {
  const found = new Map<string, LiveOrder>();
  const foreign = new Set<string>();
  if (!isShopifyConfigured()) return { found, foreign };
  const targets = orders
    .filter((o) => wantsLiveRead(o) && /^\d+$/.test(o.shopifyOrderId))
    .slice(0, MAX_LIVE_ENRICHMENTS);
  if (targets.length === 0) return { found, foreign };

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
          // otherwise (e.g. reassigned) — the order is not shown at all.
          foreign.add(order.shopifyOrderId);
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
  return { found: new Map(found), foreign: new Set(foreign) };
}

/**
 * The customer's newest order ids straight from Shopify (confirmLedgerAnswer).
 * `ok: false` when Shopify is not configured, the read fails or is late.
 */
async function readLiveOrderIds(shopifyCustomerId: string): Promise<{ ok: boolean; orderIds: string[] }> {
  if (!isShopifyConfigured() || !/^\d+$/.test(shopifyCustomerId)) return { ok: false, orderIds: [] };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ ok: boolean; orderIds: string[] }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, orderIds: [] }), LIVE_TIMEOUT_MS);
  });
  const read = (async () => {
    try {
      const data = await adminGraphql<{ orders?: { nodes?: Array<{ id?: string }> } }>(LIVE_CUSTOMER_ORDERS_QUERY, {
        q: `customer_id:${shopifyCustomerId}`,
        n: LIVE_CONFIRM_ORDERS,
      });
      if (!data?.orders || !Array.isArray(data.orders.nodes)) return { ok: false, orderIds: [] };
      const orderIds = data.orders.nodes
        .map((n) => /(\d+)$/.exec(String(n?.id ?? ""))?.[1] ?? null)
        .filter((x): x is string => x != null);
      return { ok: true, orderIds };
    } catch (err) {
      reportError(err, { route: "lib/order-status", phase: "live-confirm" });
      return { ok: false, orderIds: [] };
    }
  })();
  try {
    return await Promise.race([read, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
    } else if ((await isOrderImportDone(sql)) !== true) {
      // Before the first order import the ledger can be empty for someone who
      // ordered — never "you have no orders" from that.
      outcome = "ledger_incomplete";
      result = buildOrderStatusForModel({ status: "unavailable", ordersPageUrl });
    } else {
      const ledger = await findCustomerOrders(
        access.customerId,
        access.shopifyCustomerId,
        { limit: ORDERS_FOR_MATCH },
        sql
      );
      if (!ledger) {
        // A database error must never read as "you have no orders".
        outcome = "unavailable";
        result = buildOrderStatusForModel({ status: "unavailable", ordersPageUrl });
      } else {
        let orders = ledger;
        let selection = selectOrders(orders, input.orderRef ?? null);
        let live = new Map<string, LiveOrder>();
        if (selection.selected.length > 0) {
          const read = await readLiveOrders(selection.selected, access.shopifyCustomerId);
          live = read.found;
          if (read.foreign.size > 0) {
            // Shopify reports these for another customer: drop them and select
            // again (a matched order that is foreign becomes "not found").
            orders = withoutForeignOrders(orders, read.foreign);
            selection = selectOrders(orders, input.orderRef ?? null);
          }
        }
        if (live.size > 0) source = "ledger+live";
        const status = confirmLedgerAnswer({
          status: selection.status,
          ledgerOrderIds: ledger.map((o) => o.shopifyOrderId),
          live:
            selection.status === "no_orders" || selection.status === "not_found"
              ? await readLiveOrderIds(access.shopifyCustomerId)
              : null,
        });
        outcome = status === "unavailable" ? "ledger_behind" : status;
        result =
          status === "unavailable"
            ? buildOrderStatusForModel({ status: "unavailable", ordersPageUrl })
            : buildOrderStatusForModel({
                status: selection.status,
                matched: selection.matched,
                orders: selection.selected,
                live,
                ordersPageUrl,
              });
      }
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
  const cache = new Map<string, Promise<OrderStatusResult>>();
  return (input: { orderRef?: string | null; topic?: string | null }) => {
    const key = `${(input.orderRef ?? "").trim().toLowerCase()}|${normalizeTopic(input.topic)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (cache.size >= LOOKUPS_PER_REQUEST) {
      // Enough lookups for one answer — the model gets "unavailable" and
      // points to the account page instead of hammering the Admin API.
      return Promise.resolve(buildOrderStatusForModel({ status: "unavailable", ordersPageUrl: accountOrdersUrl() }));
    }
    access ??= resolveOrderAccess(sessionId);
    const pending = lookupOrderStatus({ sessionId, orderRef: input.orderRef, topic: input.topic, access });
    cache.set(key, pending);
    return pending;
  };
}
