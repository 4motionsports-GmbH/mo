// Order status in the chat (`get_order_status`) — the PURE core.
//
// A customer who signed in with the Customer Account IN THE SAME chat session
// asks Mo "Wo ist meine Bestellung?" and Mo answers from real data instead of
// handing over to the contact form. Returns, cancellations and complaints stay
// with the contact form — Mo states facts, it never acts on an order.
//
// This module decides WHO may see order data (decideOrderAccess), turns the
// ledger (customer_orders) plus an optional live Shopify read into a small set
// of states, and builds the ONE object the model receives
// (buildOrderStatusForModel). Kept in .mjs (no I/O) so the privacy contract is
// unit-tested; the I/O lives in lib/order-status.ts.
//
// PRIVACY CONTRACT (docs/ANWALTSDOSSIER.md §7.1, §16): the model output never
// contains the order name/number, amounts or currency, discount codes,
// tracking numbers or URLs, addresses, Shopify ids (numeric or gid://) or an
// e-mail. Orders are told apart by a letter (A, B, …), the order date and
// their items. The output is built from an explicit whitelist of keys, and a
// regression test serialises it and searches for every forbidden value.

import { numericShopifyId } from "./shopify-customer-map.mjs";

/** What the customer may ask about (the tool's `topic`, also the KPI split). */
export const ORDER_TOPICS = ["status", "shipping", "return", "cancellation", "refund"];

/** Normalised order states the model is told about. */
export const ORDER_STATES = [
  "not_shipped",
  "being_prepared",
  "partially_shipped",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "delivery_problem",
  "on_hold",
  "cancelled",
];

/** Normalised payment states. */
export const PAYMENT_STATES = ["paid", "pending", "refunded_partial", "refunded_full", "voided"];

/** Orders read from the ledger to match an order number against. */
export const ORDERS_FOR_MATCH = 25;
/** Orders shown to the model without (or with an unmatched) order number. */
export const MAX_ORDERS_SHOWN = 5;
/** Item lines per order. */
export const MAX_ITEMS_PER_ORDER = 6;
/** Orders per lookup that get a live Shopify read (not delivered / cancelled). */
export const MAX_LIVE_ENRICHMENTS = 3;
/** Hard cap on the live Shopify read; past it the answer is ledger-only. */
export const LIVE_TIMEOUT_MS = 4000;
/** Hard cap on orderRef (the tool's input schema says the same). */
export const ORDER_REF_MAX = 40;

export const DEFAULT_ACCOUNT_ORDERS_URL = "https://www.motionsports.de/account";

const REF_LETTERS = "ABCDEFGHIJ";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** @param {unknown} v */
function upper(v) {
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  return s || null;
}

/** @param {unknown} v */
function isoOrNull(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * One-line, bounded, link- and address-free text for the model.
 * @param {unknown} v @param {number} max
 */
function cleanText(v, max) {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\S+@\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const BERLIN_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar day of a timestamp in Europe/Berlin, as "YYYY-MM-DD" (the shop's
 * day — an order placed at 00:30 Berlin time belongs to that day, not the UTC
 * day before). Null for anything unparseable.
 * @param {unknown} value
 */
export function berlinDay(value) {
  const iso = isoOrNull(value);
  if (!iso) return null;
  const parts = Object.fromEntries(
    BERLIN_DAY.formatToParts(new Date(iso)).map((p) => [p.type, p.value])
  );
  if (!parts.year || !parts.month || !parts.day) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * The generic "Meine Bestellungen" page (SHOPIFY_ACCOUNT_ORDERS_URL), https
 * only; anything else falls back to the shop's account page.
 */
export function accountOrdersUrl(env = process.env) {
  const raw =
    typeof env.SHOPIFY_ACCOUNT_ORDERS_URL === "string" ? env.SHOPIFY_ACCOUNT_ORDERS_URL.trim() : "";
  if (!raw) return DEFAULT_ACCOUNT_ORDERS_URL;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : DEFAULT_ACCOUNT_ORDERS_URL;
  } catch {
    return DEFAULT_ACCOUNT_ORDERS_URL;
  }
}

/** The tool's topic, defaulting to "status" for anything unknown. @param {unknown} topic */
export function normalizeTopic(topic) {
  return typeof topic === "string" && ORDER_TOPICS.includes(topic) ? topic : "status";
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * Who may see order data. Fail closed: the switch must be on, the session
 * must be linked by the Customer Account sign-in ('customer_account' — an App
 * Proxy link or a typed e-mail is not enough) and the customer must still hold
 * a live access token. Marketing consent is NOT required: answering the
 * customer's own question about their order is customer service (Art. 6 (1) b).
 *
 * @param {{ flagOn: boolean, sessionId: unknown, linkKind: unknown, hasToken: boolean }} input
 * @returns {"ok" | "disabled" | "sign_in_required"}
 */
export function decideOrderAccess({ flagOn, sessionId, linkKind, hasToken }) {
  if (flagOn !== true) return "disabled";
  if (typeof sessionId !== "string" || !sessionId.trim()) return "sign_in_required";
  if (linkKind !== "customer_account") return "sign_in_required";
  if (hasToken !== true) return "sign_in_required";
  return "ok";
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/**
 * Order-level fulfillment status → state. The ledger holds REST values
 * upper-cased from the webhooks (null = unfulfilled, PARTIAL, FULFILLED,
 * RESTOCKED) and GraphQL displayFulfillmentStatus from the import/reconcile
 * (UNFULFILLED, PARTIALLY_FULFILLED, FULFILLED, IN_PROGRESS, ON_HOLD, OPEN,
 * SCHEDULED, PENDING_FULFILLMENT, RESTOCKED, REQUEST_DECLINED). Anything Mo
 * cannot explain (RESTOCKED, REQUEST_DECLINED, unknown) reads as on_hold — the
 * prompt sends that to the contact form instead of guessing.
 * @param {unknown} fulfillmentStatus
 */
function orderLevelState(fulfillmentStatus) {
  switch (upper(fulfillmentStatus)) {
    case null:
    case "UNFULFILLED":
    case "OPEN":
    case "SCHEDULED":
      return "not_shipped";
    case "PENDING_FULFILLMENT":
    case "IN_PROGRESS":
      return "being_prepared";
    case "PARTIAL":
    case "PARTIALLY_FULFILLED":
      return "partially_shipped";
    case "FULFILLED":
      return "shipped";
    case "ON_HOLD":
    default:
      return "on_hold";
  }
}

const SHIPMENT_PROGRESS = {
  being_prepared: 1,
  shipped: 2,
  in_transit: 3,
  out_for_delivery: 4,
  delivered: 5,
};

/**
 * One live fulfillment → state, or null when it does not count as a shipment
 * (cancelled, failed request, voided label).
 * @param {{ status?: unknown, displayStatus?: unknown, inTransitAt?: unknown, deliveredAt?: unknown }} f
 */
function fulfillmentState(f) {
  if (!f || typeof f !== "object") return null;
  const status = upper(f.status);
  const display = upper(f.displayStatus);
  if (status === "CANCELLED" || status === "ERROR" || status === "FAILURE") return null;
  if (display === "CANCELED" || display === "LABEL_VOIDED") return null;
  if (display === "FAILURE" || display === "ATTEMPTED_DELIVERY" || display === "NOT_DELIVERED") {
    return "delivery_problem";
  }
  if (display === "DELIVERED" || display === "PICKED_UP" || isoOrNull(f.deliveredAt)) return "delivered";
  if (display === "OUT_FOR_DELIVERY") return "out_for_delivery";
  if (
    display === "IN_TRANSIT" ||
    display === "DELAYED" ||
    display === "CARRIER_PICKED_UP" ||
    isoOrNull(f.inTransitAt)
  ) {
    return "in_transit";
  }
  if (display === "LABEL_PRINTED" || display === "LABEL_PURCHASED" || display === "SUBMITTED") {
    return "being_prepared";
  }
  // FULFILLED, MARKED_AS_FULFILLED, CONFIRMED, READY_FOR_PICKUP, unknown.
  return "shipped";
}

/**
 * The order's state. `cancelledAt` wins. Without live fulfillments the
 * order-level status decides; with them, the shipments refine it: any delivery
 * problem shows, a partially fulfilled order stays partially_shipped, else the
 * LEAST advanced shipment decides (one parcel delivered, one under way → in
 * transit).
 *
 * @param {{
 *   fulfillmentStatus?: unknown,
 *   financialStatus?: unknown,
 *   cancelledAt?: unknown,
 *   fulfillments?: Array<{ status?: unknown, displayStatus?: unknown, inTransitAt?: unknown, deliveredAt?: unknown }> | null,
 * }} input  financialStatus is accepted for symmetry and reported separately (normalizePayment)
 * @returns {typeof ORDER_STATES[number]}
 */
export function normalizeOrderState({ fulfillmentStatus, cancelledAt, fulfillments }) {
  if (isoOrNull(cancelledAt)) return "cancelled";
  const orderLevel = orderLevelState(fulfillmentStatus);
  if (!Array.isArray(fulfillments)) return orderLevel;
  const states = fulfillments.map(fulfillmentState).filter((s) => s != null);
  if (states.length === 0) return orderLevel;
  if (states.includes("delivery_problem")) return "delivery_problem";
  if (orderLevel === "partially_shipped") return "partially_shipped";
  let least = "delivered";
  for (const s of states) {
    if (SHIPMENT_PROGRESS[s] < SHIPMENT_PROGRESS[least]) least = s;
  }
  return /** @type {typeof ORDER_STATES[number]} */ (least);
}

/**
 * The payment side. `totalCents` is the ledger's CURRENT total (Shopify's
 * current_total_price — after refunds), so a full refund leaves it at 0.
 * Null when the status says nothing usable (the field is then left out).
 *
 * @param {unknown} financialStatus  REST or GraphQL value (any case)
 * @param {unknown} refundedCents
 * @param {unknown} totalCents
 * @returns {typeof PAYMENT_STATES[number] | null}
 */
export function normalizePayment(financialStatus, refundedCents, totalCents) {
  const fs = upper(financialStatus);
  const refunded = Number(refundedCents) > 0 ? Number(refundedCents) : 0;
  const total = Number.isFinite(Number(totalCents)) ? Number(totalCents) : 0;
  if (fs === "VOIDED" || fs === "EXPIRED") return "voided";
  if (fs === "REFUNDED") return "refunded_full";
  if (refunded > 0 && total <= 0) return "refunded_full";
  if (fs === "PARTIALLY_REFUNDED" || refunded > 0) return "refunded_partial";
  if (fs === "PAID" || fs === "AUTHORIZED") return "paid";
  if (fs === "PENDING" || fs === "PARTIALLY_PAID") return "pending";
  return null;
}

// ---------------------------------------------------------------------------
// Matching an order reference
// ---------------------------------------------------------------------------

/**
 * The order-number digit groups of what the customer typed ("#1234", "1234",
 * "Bestellung 1234", "MS-1234"). Groups shorter than 3 digits are ignored (a
 * day or month is no order number). Leading zeros are dropped.
 * @param {unknown} ref
 * @returns {string[]}
 */
export function orderRefDigits(ref) {
  if (typeof ref !== "string") return [];
  const groups = ref.slice(0, ORDER_REF_MAX).match(/\d+/g) ?? [];
  return groups
    .map((g) => g.replace(/^0+/, ""))
    .filter((g) => g.length >= 3);
}

/**
 * Find the order the customer means among THEIR OWN orders (the caller only
 * ever passes the signed-in customer's ledger rows) by the digits of the order
 * name. Never matches on Shopify's internal id. Null when nothing matches.
 *
 * @template {{ name?: string | null }} O
 * @param {O[]} orders
 * @param {unknown} ref
 * @returns {O | null}
 */
export function matchOrderRef(orders, ref) {
  const wanted = orderRefDigits(ref);
  if (wanted.length === 0 || !Array.isArray(orders)) return null;
  for (const order of orders) {
    const digits = typeof order?.name === "string" ? order.name.replace(/\D/g, "").replace(/^0+/, "") : "";
    if (digits && wanted.includes(digits)) return order;
  }
  return null;
}

/**
 * Which orders answer the question. With an order number that matches: just
 * that order. With one that does not: "not_found" plus the most recent orders
 * (so Mo can ask "meinst du eine davon?"). Without a number: the most recent
 * orders.
 *
 * @template {{ name?: string | null }} O
 * @param {O[]} orders  the customer's ledger orders, newest first
 * @param {unknown} orderRef
 * @returns {{ status: "ok" | "no_orders" | "not_found", matched?: boolean, selected: O[] }}
 */
export function selectOrders(orders, orderRef) {
  const list = Array.isArray(orders) ? orders : [];
  if (list.length === 0) return { status: "no_orders", selected: [] };
  if (orderRefDigits(orderRef).length > 0) {
    const hit = matchOrderRef(list, orderRef);
    if (hit) return { status: "ok", matched: true, selected: [hit] };
    return { status: "not_found", matched: false, selected: list.slice(0, MAX_ORDERS_SHOWN) };
  }
  return { status: "ok", selected: list.slice(0, MAX_ORDERS_SHOWN) };
}

/**
 * Whether a ledger order is worth a live read: not cancelled and not already
 * known as delivered. (The ledger cannot know "delivered" — the live read is
 * where that comes from — so in practice: every order that is not cancelled.)
 * @param {{ cancelledAt?: unknown }} order
 */
export function wantsLiveRead(order) {
  return !isoOrNull(order?.cancelledAt);
}

// ---------------------------------------------------------------------------
// Live Shopify read
// ---------------------------------------------------------------------------

/**
 * A carrier's company name, or null when it looks like anything else (a
 * tracking number, a link, an address). Only this name may reach the model.
 * @param {unknown} raw
 */
export function carrierName(raw) {
  const s = cleanText(raw, 40);
  if (!s) return null;
  if (/https?:|www\.|@|\d{5,}/i.test(s)) return null;
  return s;
}

/**
 * The Admin GraphQL `order` node → the live facts, or null when the order
 * does not belong to the signed-in customer (ownership check: the order's
 * customer id must equal the session's shopifyCustomerId) or is unusable.
 * Only whitelisted fields survive; tracking numbers and URLs are never read.
 *
 * @param {any} node
 * @param {unknown} shopifyCustomerId  the session's (numeric or gid)
 */
export function parseLiveOrder(node, shopifyCustomerId) {
  if (!node || typeof node !== "object") return null;
  const owner = numericShopifyId(node.customer?.id);
  const expected = numericShopifyId(shopifyCustomerId);
  if (!owner || !expected || owner !== expected) return null;
  const fulfillments = (Array.isArray(node.fulfillments) ? node.fulfillments : [])
    .slice(0, 5)
    .filter((f) => f && typeof f === "object")
    .map((f) => ({
      status: upper(f.status),
      displayStatus: upper(f.displayStatus),
      inTransitAt: isoOrNull(f.inTransitAt),
      deliveredAt: isoOrNull(f.deliveredAt),
      estimatedDeliveryAt: isoOrNull(f.estimatedDeliveryAt),
      carriers: (Array.isArray(f.trackingInfo) ? f.trackingInfo : [])
        .map((t) => carrierName(t?.company))
        .filter((c) => c != null),
    }));
  return {
    cancelledAt: isoOrNull(node.cancelledAt),
    displayFinancialStatus: upper(node.displayFinancialStatus),
    displayFulfillmentStatus: upper(node.displayFulfillmentStatus),
    fulfillments,
  };
}

// ---------------------------------------------------------------------------
// The model-facing result
// ---------------------------------------------------------------------------

/** @param {any} li */
function itemLine(li) {
  if (!li || typeof li !== "object") return null;
  const title = cleanText(li.title, 80);
  if (!title) return null;
  const qty = Math.max(1, Math.floor(Number(li.quantity) || 1));
  const variant = cleanText(li.variantTitle, 40);
  const suffix = variant && variant.toLowerCase() !== "default title" ? ` (${variant})` : "";
  return `${qty}× ${title}${suffix}`;
}

/**
 * @param {any} order  a ledger order (lib/customer-orders-store LedgerOrder)
 * @param {number} index
 * @param {ReturnType<typeof parseLiveOrder>} live
 */
function renderOrder(order, index, live) {
  const fulfillments = live ? live.fulfillments : null;
  const state = normalizeOrderState({
    fulfillmentStatus: live?.displayFulfillmentStatus ?? order.fulfillmentStatus,
    cancelledAt: order.cancelledAt ?? live?.cancelledAt ?? null,
    fulfillments,
  });
  const payment = normalizePayment(
    live?.displayFinancialStatus ?? order.financialStatus,
    order.refundedCents,
    order.totalCents
  );
  const lines = (Array.isArray(order.lineItems) ? order.lineItems : []).map(itemLine).filter(Boolean);

  /** @type {Record<string, unknown>} */
  const out = {
    ref: REF_LETTERS[index] ?? String(index + 1),
    placedOn: berlinDay(order.processedAt),
    items: lines.slice(0, MAX_ITEMS_PER_ORDER),
    state,
  };
  if (lines.length > MAX_ITEMS_PER_ORDER) out.moreItems = lines.length - MAX_ITEMS_PER_ORDER;
  if (payment) out.payment = payment;

  if (fulfillments && state !== "cancelled") {
    const active = fulfillments.filter((f) => fulfillmentState(f) != null);
    const carriers = [...new Set(active.flatMap((f) => f.carriers))];
    if (carriers.length > 0) out.carrier = carriers.slice(0, 2).join(" / ");
    if (state === "delivered") {
      const delivered = active.map((f) => f.deliveredAt).filter(Boolean).sort();
      const day = berlinDay(delivered[delivered.length - 1]);
      if (day) out.deliveredOn = day;
    } else {
      const estimates = active
        .filter((f) => fulfillmentState(f) !== "delivered")
        .map((f) => f.estimatedDeliveryAt)
        .filter(Boolean)
        .sort();
      const day = berlinDay(estimates[estimates.length - 1]);
      if (day) out.estimatedDelivery = day;
    }
  }
  return out;
}

/**
 * The ONE object the model receives from get_order_status. Built from a
 * whitelist — never the order name/number, amounts, currency, discount codes,
 * tracking numbers or URLs, addresses, Shopify ids or an e-mail.
 *
 * @param {{
 *   status: "ok" | "no_orders" | "not_found" | "sign_in_required" | "unavailable",
 *   matched?: boolean,
 *   orders?: any[],
 *   live?: Map<string, ReturnType<typeof parseLiveOrder>>,
 *   ordersPageUrl: string,
 * }} input
 */
export function buildOrderStatusForModel({ status, matched, orders = [], live, ordersPageUrl }) {
  const showOrders = status === "ok" || status === "not_found";
  const list = showOrders && Array.isArray(orders) ? orders.slice(0, MAX_ORDERS_SHOWN) : [];
  /** @type {Record<string, unknown>} */
  const out = { status };
  if (showOrders && typeof matched === "boolean") out.matched = matched;
  out.orders = list.map((order, i) =>
    renderOrder(order, i, live instanceof Map ? live.get(String(order?.shopifyOrderId)) ?? null : null)
  );
  out.ordersPageUrl = ordersPageUrl;
  return out;
}
