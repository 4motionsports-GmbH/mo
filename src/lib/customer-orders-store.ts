// The local order ledger (customer_orders, 0062) — I/O.
//
// Written by the bulk import, the orders/* webhooks and the nightly
// reconciliation; read by the Kunden screen (Käufe), the facts job, the
// profile generator, drafts and the chat memory. Orders of erased people are
// never written (tombstones); an order whose customer is not mirrored yet is
// kept with its Shopify customer id and linked as soon as the customer arrives.
//
// loadPurchaseHistory keeps the shape every prompt builder already reads
// (OrderHistory from lib/shopify-orders.ts), so the switch from the per-e-mail
// Shopify read to the ledger is invisible to them. Until a customer is
// mirrored, the old cached purchase_summary is served (transition).

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { loadProductCatalog } from "./product-catalog";
import { matchOrderLineItems } from "./order-attribution.mjs";
import { withCatalogHandles, type MirrorOrder, type MirrorLineItem } from "./shopify-customer-map.mjs";
import type { OrderHistory } from "./shopify-orders";

export interface LedgerOrder {
  id: number;
  shopifyOrderId: string;
  name: string | null;
  processedAt: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
  currency: string | null;
  totalCents: number;
  refundedCents: number;
  discountCodes: string[];
  lineItems: Array<MirrorLineItem & { ref?: string }>;
}

function mapOrder(r: Record<string, unknown>): LedgerOrder {
  return {
    id: Number(r.id),
    shopifyOrderId: String(r.shopify_order_id),
    name: (r.order_name as string | null) ?? null,
    processedAt: new Date(String(r.processed_at)).toISOString(),
    financialStatus: (r.financial_status as string | null) ?? null,
    fulfillmentStatus: (r.fulfillment_status as string | null) ?? null,
    cancelledAt: r.cancelled_at ? new Date(String(r.cancelled_at)).toISOString() : null,
    currency: (r.currency as string | null) ?? null,
    totalCents: Number(r.total_cents ?? 0),
    refundedCents: Number(r.refunded_cents ?? 0),
    discountCodes: Array.isArray(r.discount_codes) ? (r.discount_codes as string[]) : [],
    lineItems: Array.isArray(r.line_items) ? (r.line_items as LedgerOrder["lineItems"]) : [],
  };
}

async function fillHandles(orders: MirrorOrder[]): Promise<MirrorOrder[]> {
  if (!orders.some((o) => o.lineItems.some((li) => !li.handle))) return orders;
  const catalog = await loadProductCatalog().catch(() => []);
  const match = (items: Parameters<typeof matchOrderLineItems>[0]) => matchOrderLineItems(items, catalog);
  return orders.map((o) => ({ ...o, lineItems: withCatalogHandles(o.lineItems, match) }));
}

export interface OrderUpsertResult {
  upserted: number;
  skipped: number;
  customerIds: number[];
}

/**
 * Upsert orders. `lineItems: "replace"` (webhook/reconcile — the payload is the
 * whole order) or `"keep"` (bulk import — the items follow as separate lines
 * and are appended by appendOrderLineItems). Never throws; null without a DB.
 */
export async function upsertMirrorOrders(
  input: MirrorOrder[],
  opts: { lineItems: "replace" | "keep" },
  sql: Sql | null = getSql()
): Promise<OrderUpsertResult | null> {
  if (!sql) return null;
  if (input.length === 0) return { upserted: 0, skipped: 0, customerIds: [] };
  try {
    const orders = opts.lineItems === "replace" ? await fillHandles(input) : input;
    const customerIds = [...new Set(orders.map((o) => o.shopifyCustomerId).filter((x): x is string => Boolean(x)))];
    const tomb = (await sql`
      SELECT shopify_customer_id FROM erasure_tombstones WHERE shopify_customer_id = ANY(${customerIds}::text[])
    `) as Array<{ shopify_customer_id: string }>;
    const tombstoned = new Set(tomb.map((t) => String(t.shopify_customer_id)));
    // Guest orders without a customer carry nothing to attach — not stored.
    const keep = orders.filter((o) => o.shopifyCustomerId && !tombstoned.has(o.shopifyCustomerId));
    if (keep.length === 0) return { upserted: 0, skipped: orders.length, customerIds: [] };

    const payload = keep.map((o) => ({
      shopify_order_id: o.shopifyOrderId,
      shopify_customer_id: o.shopifyCustomerId,
      order_name: o.name,
      processed_at: o.processedAt,
      financial_status: o.financialStatus,
      fulfillment_status: o.fulfillmentStatus,
      cancelled_at: o.cancelledAt,
      currency: o.currency,
      subtotal_cents: o.subtotalCents,
      total_cents: o.totalCents,
      refunded_cents: o.refundedCents,
      last_refund_at: o.lastRefundAt ?? null,
      discount_codes: o.discountCodes,
      source_name: o.sourceName,
      shopify_updated_at: o.updatedAt,
      line_items: opts.lineItems === "replace" ? o.lineItems : [],
    }));
    const replace = opts.lineItems === "replace";
    const rows = (await sql`
      INSERT INTO customer_orders (
        shopify_order_id, customer_id, shopify_customer_id, order_name, processed_at, financial_status,
        fulfillment_status, cancelled_at, currency, subtotal_cents, total_cents, refunded_cents, last_refund_at,
        discount_codes, source_name, line_items, shopify_updated_at, synced_at)
      SELECT x.shopify_order_id, c.id, x.shopify_customer_id, x.order_name, x.processed_at, x.financial_status,
             x.fulfillment_status, x.cancelled_at, x.currency, x.subtotal_cents, COALESCE(x.total_cents, 0),
             COALESCE(x.refunded_cents, 0), x.last_refund_at, COALESCE(x.discount_codes, '{}'), x.source_name,
             COALESCE(x.line_items, '[]'::jsonb), x.shopify_updated_at, now()
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(
          shopify_order_id text, shopify_customer_id text, order_name text, processed_at timestamptz,
          financial_status text, fulfillment_status text, cancelled_at timestamptz, currency text,
          subtotal_cents bigint, total_cents bigint, refunded_cents bigint, last_refund_at timestamptz, discount_codes text[],
          source_name text, shopify_updated_at timestamptz, line_items jsonb)
        LEFT JOIN customers c ON c.shopify_customer_id = x.shopify_customer_id
      ON CONFLICT (shopify_order_id) DO UPDATE SET
        -- An order Shopify now reports for ANOTHER customer follows them (or
        -- becomes an orphan until that person is mirrored) instead of staying
        -- on the old customer; an unresolved lookup for the same customer
        -- keeps the current link.
        customer_id        = CASE
                               WHEN EXCLUDED.shopify_customer_id IS NOT NULL
                                AND EXCLUDED.shopify_customer_id IS DISTINCT FROM customer_orders.shopify_customer_id
                               THEN EXCLUDED.customer_id
                               ELSE COALESCE(EXCLUDED.customer_id, customer_orders.customer_id)
                             END,
        shopify_customer_id = COALESCE(EXCLUDED.shopify_customer_id, customer_orders.shopify_customer_id),
        order_name         = EXCLUDED.order_name,
        processed_at       = EXCLUDED.processed_at,
        financial_status   = EXCLUDED.financial_status,
        fulfillment_status = EXCLUDED.fulfillment_status,
        cancelled_at       = EXCLUDED.cancelled_at,
        currency           = EXCLUDED.currency,
        subtotal_cents     = EXCLUDED.subtotal_cents,
        total_cents        = EXCLUDED.total_cents,
        refunded_cents     = EXCLUDED.refunded_cents,
        last_refund_at     = GREATEST(EXCLUDED.last_refund_at, customer_orders.last_refund_at),
        discount_codes     = EXCLUDED.discount_codes,
        source_name        = EXCLUDED.source_name,
        line_items         = CASE WHEN ${replace} THEN EXCLUDED.line_items ELSE customer_orders.line_items END,
        shopify_updated_at = EXCLUDED.shopify_updated_at,
        synced_at          = now()
      WHERE customer_orders.shopify_updated_at IS NULL
         OR EXCLUDED.shopify_updated_at IS NULL
         OR EXCLUDED.shopify_updated_at >= customer_orders.shopify_updated_at
      RETURNING customer_id
    `) as Array<{ customer_id: number | null }>;

    const touched = [...new Set(rows.map((r) => r.customer_id).filter((x): x is number => x != null).map(Number))];
    if (touched.length > 0) {
      await sql`UPDATE customers SET facts_dirty_at = now() WHERE id = ANY(${touched}::bigint[])`;
    }
    return { upserted: rows.length, skipped: orders.length - keep.length, customerIds: touched };
  } catch (err) {
    reportError(err, { route: "lib/customer-orders-store", phase: "upsertMirrorOrders" });
    return null;
  }
}

/**
 * Append bulk-import line items to their orders, idempotently (an item whose
 * line-item id is already on the order is skipped, so a retried step never
 * duplicates). Keyed by the order's numeric id.
 */
export async function appendOrderLineItems(
  itemsByOrder: Map<string, MirrorLineItem[]>,
  sql: Sql | null = getSql()
): Promise<number> {
  if (!sql || itemsByOrder.size === 0) return 0;
  try {
    const payload = [...itemsByOrder.entries()].map(([orderId, items]) => ({ order_id: orderId, items }));
    const rows = await sql`
      UPDATE customer_orders o
         SET line_items = o.line_items || (
               SELECT COALESCE(jsonb_agg(i), '[]'::jsonb)
                 FROM jsonb_array_elements(x.items) i
                WHERE i->>'id' IS NULL
                   OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(o.line_items) e WHERE e->>'id' = i->>'id')
             )
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(order_id text, items jsonb)
       WHERE o.shopify_order_id = x.order_id
      RETURNING o.id
    `;
    return rows.length;
  } catch (err) {
    reportError(err, { route: "lib/customer-orders-store", phase: "appendOrderLineItems" });
    return 0;
  }
}

/** Orders that arrived before their customer: attach them now. */
export async function linkOrphanOrders(sql: Sql | null = getSql()): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = await sql`
      UPDATE customer_orders o SET customer_id = c.id
        FROM customers c
       WHERE o.customer_id IS NULL
         AND o.shopify_customer_id IS NOT NULL
         AND c.shopify_customer_id = o.shopify_customer_id
      RETURNING o.customer_id
    `;
    return rows.length;
  } catch (err) {
    reportError(err, { route: "lib/customer-orders-store", phase: "linkOrphanOrders" });
    return 0;
  }
}

async function queryCustomerOrders(
  sql: Sql,
  customerId: number,
  opts: { limit?: number; offset?: number }
): Promise<{ orders: LedgerOrder[]; total: number }> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = (await sql`
    SELECT id, shopify_order_id, order_name, processed_at, financial_status, fulfillment_status,
           cancelled_at, currency, total_cents, refunded_cents, discount_codes, line_items,
           count(*) OVER () AS total
      FROM customer_orders
     WHERE customer_id = ${customerId}
     ORDER BY processed_at DESC, id DESC
     LIMIT ${limit} OFFSET ${offset}
  `) as Array<Record<string, unknown>>;
  return { orders: rows.map(mapOrder), total: rows.length > 0 ? Number(rows[0].total) : 0 };
}

/** A customer's orders, newest first (Käufe tab, facts job). */
export async function listCustomerOrders(
  customerId: number,
  opts: { limit?: number; offset?: number } = {},
  sql: Sql | null = getSql()
): Promise<{ orders: LedgerOrder[]; total: number }> {
  if (!sql) return { orders: [], total: 0 };
  try {
    return await queryCustomerOrders(sql, customerId, opts);
  } catch (err) {
    reportError(err, { route: "lib/customer-orders-store", phase: "listCustomerOrders" });
    return { orders: [], total: 0 };
  }
}

/**
 * The orders of ONE signed-in shop customer for the order status in the chat:
 * only rows Shopify reports for that Shopify customer, linked to this
 * customer row or not linked yet (an order whose webhook arrived before the
 * customer was mirrored). Newest first. Null without a database or on an
 * error — the caller must never mistake a failure for "no orders" (the chat
 * answers "unavailable" then).
 */
export async function findCustomerOrders(
  customerId: number,
  shopifyCustomerId: string,
  opts: { limit?: number } = {},
  sql: Sql | null = getSql()
): Promise<LedgerOrder[] | null> {
  if (!sql) return null;
  const sid = shopifyCustomerId.trim();
  if (!sid) return null;
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
  try {
    const rows = (await sql`
      SELECT id, shopify_order_id, order_name, processed_at, financial_status, fulfillment_status,
             cancelled_at, currency, total_cents, refunded_cents, discount_codes, line_items
        FROM customer_orders
       WHERE shopify_customer_id = ${sid}
         AND (customer_id = ${customerId} OR customer_id IS NULL)
       ORDER BY processed_at DESC, id DESC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map(mapOrder);
  } catch (err) {
    reportError(err, { route: "lib/customer-orders-store", phase: "findCustomerOrders" });
    return null;
  }
}

/** Orders of many customers at once (facts job). */
export async function listOrdersForCustomers(
  customerIds: number[],
  sql: Sql | null = getSql()
): Promise<Map<number, LedgerOrder[]>> {
  const out = new Map<number, LedgerOrder[]>();
  if (!sql || customerIds.length === 0) return out;
  try {
    const rows = (await sql`
      SELECT id, customer_id, shopify_order_id, order_name, processed_at, financial_status, fulfillment_status,
             cancelled_at, currency, total_cents, refunded_cents, discount_codes, line_items
        FROM customer_orders
       WHERE customer_id = ANY(${customerIds}::bigint[])
       ORDER BY processed_at ASC
    `) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const id = Number(r.customer_id);
      const list = out.get(id) ?? [];
      list.push(mapOrder(r));
      out.set(id, list);
    }
  } catch (err) {
    reportError(err, { route: "lib/customer-orders-store", phase: "listOrdersForCustomers" });
  }
  return out;
}

const HISTORY_MAX_ORDERS = 30;

/** Ledger orders → the OrderHistory shape the prompt builders read. */
export function ordersToHistory(orders: LedgerOrder[], total: number): OrderHistory {
  return {
    orders: orders.slice(0, HISTORY_MAX_ORDERS).map((o) => ({
      name: o.name ?? `#${o.shopifyOrderId}`,
      createdAt: o.processedAt,
      totalAmount: (o.totalCents / 100).toFixed(2),
      currencyCode: o.currency,
      financialStatus: o.financialStatus,
      items: o.lineItems.map((li) => ({ title: li.title, handle: li.handle ?? null, quantity: li.quantity })),
    })),
    truncated: total > HISTORY_MAX_ORDERS,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * The purchase history of a customer for prompts and the admin: the ledger
 * when the customer is mirrored (or has ledger rows), else the cached
 * per-e-mail summary from before the import. Null = unknown.
 */
export async function loadPurchaseHistory(
  customer: { id: number; shopifySyncedAt?: string | null; purchaseSummary: OrderHistory | null },
  sql: Sql | null = getSql()
): Promise<OrderHistory | null> {
  const { orders, total } = await listCustomerOrders(customer.id, { limit: HISTORY_MAX_ORDERS }, sql);
  if (total > 0 || customer.shopifySyncedAt) return ordersToHistory(orders, total);
  return customer.purchaseSummary;
}
