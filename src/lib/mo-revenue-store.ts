// „Umsatz durch Mo“ — the database side of the KPI revenue centre
// (docs/ADMIN_DASHBOARD.md §5.1–§5.3). Pure DB over the attribution ledger
// `mo_orders` (orders/create + orders/paid webhooks, docs/ORDER_ATTRIBUTION.md),
// so it is NEVER cached (CLAUDE.md, KPI cache rule). The Shopify code lookup that
// fills the gap before the webhooks were registered stays in the cached
// lib/kpi-revenue-store; the two meet at render time in the pure
// mergeCodeRedemptions (lib/mo-revenue.mjs), which drops every redemption the
// ledger already holds — one order, one count.
//
// What this loads for a period:
//   - every ledger order of the period (minimal columns — the exact totals),
//   - the same for the period of equal length before it (the comparison),
//   - the newest DETAIL_LIMIT orders with their products, the products of the
//     session's consultation, the conversation and the customer to link to,
//   - the Mo codes and order numbers the ledger holds around the period (the
//     dedupe set for the Shopify lookup),
//   - the marked orders no consultation could claim (event
//     mo_order_marker_unresolved) and whether ingestion was ever seen.
//
// GDPR: the KPI screen shows no identity value. A detail row carries the order
// number, amount, product titles and the ids of the conversation and the
// customer — the links lead to the screens where the operator sees the person
// anyway; no name or e-mail is read here.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { KPI_MO_ORDER_MARKER_UNRESOLVED } from "./kpi-events";
import { countUnresolvedMarkers } from "./order-attribution.mjs";
import { isAttributionSessionAnchorEnabled } from "./platform-flags.mjs";
import { attributionWindowDays } from "./mo-orders-store";
import { previousPeriod } from "./mo-revenue.mjs";
import type { KpiRange } from "./kpi-range";

/** Detail rows per period (newest first) — the drill-down list. */
export const REVENUE_DETAIL_LIMIT = 500;

/** One ledger order, minimal — what the totals and the series need. */
export interface RevenueLedgerOrder {
  processedAt: string | null;
  total: number | null;
  currency: string | null;
  financialStatus: string | null;
  tier: string | null;
  source: string | null;
  discountCodes: string[];
  overlap: boolean | null;
}

export interface RevenueLineItem {
  title: string;
  quantity: number;
  price: number | string | null;
  handle: string | null;
}

/** One ledger order with everything „Was genau passiert ist“ shows. */
export interface RevenueOrderDetail extends RevenueLedgerOrder {
  id: number;
  orderName: string | null;
  lineItems: RevenueLineItem[];
  /** Products discussed or selected in the session's chats up to the order. */
  consultedHandles: string[];
  /** Latest chat message of the session at or before the order. */
  lastChatAt: string | null;
  /** The conversation to open (?tab=gespraeche&gid=…), null without a session. */
  conversationId: number | null;
  /** The customer to open (?tab=kunden&customer=…), when one is linked. */
  customerId: number | null;
}

export interface MoRevenueData {
  range: { from: string; to: string; days: number; label: string };
  previous: { from: string; to: string; days: number } | null;
  orders: RevenueLedgerOrder[];
  previousOrders: RevenueLedgerOrder[];
  details: RevenueOrderDetail[];
  /** More ledger orders in the period than REVENUE_DETAIL_LIMIT. */
  detailsTruncated: boolean;
  /** Mo codes (upper case) and order numbers in the ledger around the period. */
  ledgerCodes: string[];
  ledgerOrderNames: string[];
  /** Marked orders in the period no consultation could claim, by reason. */
  unresolved: { unknownToken: number; outsideWindow: number };
  /** True once a marked order was ever seen (stored, or counted as unresolved). */
  ingestionSeen: boolean;
  attributionWindowDays: number;
  /** MO_ATTRIBUTION_SESSION_ANCHOR — which window rule the explanation names. */
  sessionAnchor: boolean;
}

type LedgerRow = {
  processed_at: string | Date | null;
  total_price: string | number | null;
  currency: string | null;
  financial_status: string | null;
  attribution_tier: string | null;
  attribution_source: string | null;
  discount_codes: string[] | null;
  recommended_overlap: boolean | null;
};

function iso(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function num(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toLedgerOrder(r: LedgerRow): RevenueLedgerOrder {
  return {
    processedAt: iso(r.processed_at),
    total: num(r.total_price),
    currency: r.currency ?? null,
    financialStatus: r.financial_status ?? null,
    tier: r.attribution_tier ?? null,
    source: r.attribution_source ?? null,
    discountCodes: Array.isArray(r.discount_codes) ? r.discount_codes.map(String) : [],
    overlap: r.recommended_overlap ?? null,
  };
}

function toLineItems(v: unknown): RevenueLineItem[] {
  const list = typeof v === "string" ? safeJson(v) : v;
  if (!Array.isArray(list)) return [];
  return list
    .filter((li): li is Record<string, unknown> => Boolean(li) && typeof li === "object")
    .map((li) => ({
      title: String(li.title ?? ""),
      quantity: Number(li.quantity) || 1,
      price: (li.price as number | string | null) ?? null,
      handle: li.handle == null ? null : String(li.handle),
    }));
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Load the revenue centre's database side for `range`. Returns null only when
 * no database is configured or on failure (the sections show an empty state).
 * Never throws.
 */
export async function getMoRevenueData(range: KpiRange, sql: Sql | null = getSql()): Promise<MoRevenueData | null> {
  if (!sql) return null;
  const previous = previousPeriod(range);
  try {
    const [orderRows, previousRows, detailRows, codeRows, unresolvedRows, seenRows] = await Promise.all([
      sql`
        SELECT processed_at, total_price, currency, financial_status, attribution_tier,
               attribution_source, discount_codes, recommended_overlap
          FROM mo_orders
         WHERE processed_at >= ${range.from}::date
           AND processed_at < (${range.to}::date + 1)
      `,
      previous
        ? sql`
            SELECT processed_at, total_price, currency, financial_status, attribution_tier,
                   attribution_source, discount_codes, recommended_overlap
              FROM mo_orders
             WHERE processed_at >= ${previous.from}::date
               AND processed_at < (${previous.to}::date + 1)
          `
        : Promise.resolve([]),
      // The newest orders with their story: the latest chat message of the
      // session at or before the order (its conversation is the one to open),
      // the products discussed or selected in the session's chats up to then,
      // and the customer — from that conversation, any other chat of the
      // session, or the order ledger.
      sql`
        SELECT o.id, o.order_name, o.processed_at, o.total_price, o.currency, o.financial_status,
               o.attribution_tier, o.attribution_source, o.discount_codes, o.recommended_overlap,
               o.line_items,
               last_chat.conversation_id,
               last_chat.created_at AS last_chat_at,
               COALESCE(
                 last_chat.customer_id,
                 (SELECT c2.customer_id FROM conversations c2
                   WHERE o.session_id IS NOT NULL AND c2.session_id = o.session_id
                     AND c2.customer_id IS NOT NULL
                   ORDER BY c2.last_activity_at DESC LIMIT 1),
                 (SELECT co.customer_id FROM customer_orders co
                   WHERE co.shopify_order_id = o.shopify_order_id LIMIT 1)
               ) AS customer_id,
               COALESCE(
                 last_chat.conversation_id,
                 (SELECT c3.id FROM conversations c3
                   WHERE o.session_id IS NOT NULL AND c3.session_id = o.session_id
                   ORDER BY c3.last_activity_at DESC, c3.id DESC LIMIT 1)
               ) AS any_conversation_id,
               ARRAY(
                 SELECT DISTINCT p
                   FROM conversations c4,
                        unnest(c4.recommended_product_ids || c4.selected_product_ids) AS p
                  WHERE o.session_id IS NOT NULL
                    AND c4.session_id = o.session_id
                    AND c4.created_at <= COALESCE(o.processed_at, now())
               ) AS consulted
          FROM mo_orders o
          LEFT JOIN LATERAL (
            SELECT m.conversation_id, m.created_at, c.customer_id
              FROM conversations c
              JOIN messages m ON m.conversation_id = c.id
             WHERE o.session_id IS NOT NULL
               AND c.session_id = o.session_id
               AND m.created_at <= COALESCE(o.processed_at, now())
             ORDER BY m.created_at DESC
             LIMIT 1
          ) AS last_chat ON true
         WHERE o.processed_at >= ${range.from}::date
           AND o.processed_at < (${range.to}::date + 1)
         ORDER BY o.processed_at DESC, o.id DESC
         LIMIT ${REVENUE_DETAIL_LIMIT + 1}
      `,
      // Dedupe set for the Shopify code lookup: a week of slack on both sides
      // (Shopify's created_at vs our processed_at).
      sql`
        SELECT o.order_name, o.discount_codes
          FROM mo_orders o
         WHERE o.processed_at >= (${range.from}::date - 7)
           AND o.processed_at < (${range.to}::date + 8)
      `,
      sql`
        SELECT COALESCE(data->>'reason', '') AS reason, count(*)::int AS n
          FROM kpi_events
         WHERE event = ${KPI_MO_ORDER_MARKER_UNRESOLVED}
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY 1
      `,
      sql`
        SELECT (EXISTS (SELECT 1 FROM mo_orders)
             OR EXISTS (SELECT 1 FROM kpi_events WHERE event = ${KPI_MO_ORDER_MARKER_UNRESOLVED})) AS seen
      `,
    ]);

    const details = (detailRows as Array<LedgerRow & Record<string, unknown>>).map((r) => ({
      ...toLedgerOrder(r),
      id: Number(r.id),
      orderName: r.order_name == null ? null : String(r.order_name),
      lineItems: toLineItems(r.line_items),
      consultedHandles: Array.isArray(r.consulted) ? (r.consulted as unknown[]).map(String) : [],
      lastChatAt: iso(r.last_chat_at as string | Date | null),
      conversationId: num((r.conversation_id ?? r.any_conversation_id) as number | null),
      customerId: num(r.customer_id as number | null),
    }));

    const ledgerCodes = new Set<string>();
    const ledgerOrderNames = new Set<string>();
    for (const r of codeRows as Array<{ order_name: string | null; discount_codes: string[] | null }>) {
      if (r.order_name) ledgerOrderNames.add(String(r.order_name).trim());
      for (const c of r.discount_codes ?? []) ledgerCodes.add(String(c).trim().toUpperCase());
    }

    return {
      range: { from: range.from, to: range.to, days: range.days, label: range.label },
      previous,
      orders: (orderRows as LedgerRow[]).map(toLedgerOrder),
      previousOrders: (previousRows as LedgerRow[]).map(toLedgerOrder),
      details: details.slice(0, REVENUE_DETAIL_LIMIT),
      detailsTruncated: details.length > REVENUE_DETAIL_LIMIT,
      ledgerCodes: [...ledgerCodes],
      ledgerOrderNames: [...ledgerOrderNames],
      unresolved: countUnresolvedMarkers(unresolvedRows as Array<{ reason: string; n: number }>),
      ingestionSeen: Boolean((seenRows as Array<{ seen: boolean }>)[0]?.seen),
      attributionWindowDays: attributionWindowDays(),
      sessionAnchor: isAttributionSessionAnchorEnabled(),
    };
  } catch (err) {
    reportError(err, { route: "lib/mo-revenue-store", phase: "getMoRevenueData" });
    return null;
  }
}
