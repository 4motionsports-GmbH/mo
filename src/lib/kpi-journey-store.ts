// „Vom Chat zur Bestellung“ — the per-session journey funnel of the KPI tab
// (docs/ADMIN_DASHBOARD.md §5.4; stage rules in the pure lib/kpi-journey.mjs).
// One aggregate query over `conversations`/`messages` (the chat), `kpi_events`
// (the widget's clicks, matched by the shared click patterns — API_CONTRACT §5)
// and `mo_orders` (the attributed order). Pure DB — never cached.
//
// The session's window starts at its first chat in the period and ends with the
// period: clicks and orders before the chat or after the period end do not
// count. Manual-check sessions (`livecheck-%`) never count.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { CART_PATTERNS, CTA_PATTERNS } from "./kpi-event-patterns.mjs";
import { REALISED_FINANCIAL_STATUSES } from "./kpi-revenue-core.mjs";
import type { KpiRange } from "./kpi-range";

export interface JourneyCounts {
  chats: number;
  shown: number;
  clicked: number;
  cart: number;
  /** Sessions through all stages with an order (nested under „cart“). */
  ordered: number;
  /** Every chat session with an attributed, paid order — cart click or not. */
  orderedAny: number;
  /** Paid orders of those sessions. */
  orderedOrders: number;
  /** Their realised revenue. */
  revenue: number;
  /** Raw widget click events in the period (all sessions) — volume, not sessions. */
  productClicks: number;
  cartClicks: number;
}

/**
 * Per-stage session counts for `range`. Null when no database is configured or
 * on failure. Never throws.
 */
export async function getJourneyCounts(range: KpiRange, sql: Sql | null = getSql()): Promise<JourneyCounts | null> {
  if (!sql) return null;
  const realised = [...REALISED_FINANCIAL_STATUSES];
  try {
    const [funnelRows, clickRows] = await Promise.all([
      sql`
        WITH chats AS (
          SELECT c.session_id,
                 min(c.created_at) AS first_at,
                 bool_or(cardinality(c.recommended_product_ids) > 0
                         OR cardinality(c.selected_product_ids) > 0) AS shown
            FROM conversations c
           WHERE c.created_at >= ${range.from}::date
             AND c.created_at < (${range.to}::date + 1)
             AND c.session_id NOT LIKE 'livecheck-%'
             AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user')
           GROUP BY c.session_id
        ),
        ev AS (
          SELECT e.session_id,
                 bool_or(e.event ILIKE ${CTA_PATTERNS[0]} OR e.event ILIKE ${CTA_PATTERNS[1]}) AS clicked,
                 bool_or(e.event ILIKE ${CART_PATTERNS[0]} OR e.event ILIKE ${CART_PATTERNS[1]}) AS cart
            FROM kpi_events e
            JOIN chats ch ON ch.session_id = e.session_id
           WHERE e.created_at >= ch.first_at
             AND e.created_at < (${range.to}::date + 1)
           GROUP BY e.session_id
        ),
        ord AS (
          SELECT o.session_id, count(*)::int AS orders, COALESCE(sum(o.total_price), 0)::float AS revenue
            FROM mo_orders o
            JOIN chats ch ON ch.session_id = o.session_id
           WHERE o.processed_at >= ch.first_at
             AND o.processed_at < (${range.to}::date + 1)
             AND upper(COALESCE(o.financial_status, '')) = ANY(${realised}::text[])
           GROUP BY o.session_id
        )
        SELECT count(*)::int AS chats,
               count(*) FILTER (WHERE ch.shown)::int AS shown,
               count(*) FILTER (WHERE ch.shown AND (ev.clicked OR ev.cart))::int AS clicked,
               count(*) FILTER (WHERE ch.shown AND ev.cart)::int AS cart,
               count(*) FILTER (WHERE ch.shown AND ev.cart AND ord.orders > 0)::int AS ordered,
               count(*) FILTER (WHERE ord.orders > 0)::int AS ordered_any,
               COALESCE(sum(ord.orders), 0)::int AS ordered_orders,
               COALESCE(sum(ord.revenue), 0)::float AS revenue
          FROM chats ch
          LEFT JOIN ev ON ev.session_id = ch.session_id
          LEFT JOIN ord ON ord.session_id = ch.session_id
      `,
      sql`
        SELECT
          count(*) FILTER (WHERE event ILIKE ${CTA_PATTERNS[0]} OR event ILIKE ${CTA_PATTERNS[1]})::int AS cta,
          count(*) FILTER (WHERE event ILIKE ${CART_PATTERNS[0]} OR event ILIKE ${CART_PATTERNS[1]})::int AS cart
          FROM kpi_events
         WHERE created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
      `,
    ]);
    const f = (funnelRows as Array<Record<string, number>>)[0] ?? {};
    const c = (clickRows as Array<Record<string, number>>)[0] ?? {};
    return {
      chats: Number(f.chats ?? 0),
      shown: Number(f.shown ?? 0),
      clicked: Number(f.clicked ?? 0),
      cart: Number(f.cart ?? 0),
      ordered: Number(f.ordered ?? 0),
      orderedAny: Number(f.ordered_any ?? 0),
      orderedOrders: Number(f.ordered_orders ?? 0),
      revenue: Number(f.revenue ?? 0),
      productClicks: Number(c.cta ?? 0),
      cartClicks: Number(c.cart ?? 0),
    };
  } catch (err) {
    reportError(err, { route: "lib/kpi-journey-store", phase: "getJourneyCounts" });
    return null;
  }
}
