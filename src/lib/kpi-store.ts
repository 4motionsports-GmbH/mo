// KPI aggregation for the admin dashboard's KPI tab (Cluster A — analytics,
// legitimate interest). Pure read-only aggregation over the pseudonymous
// conversations / messages / kpi_events tables. NEVER touches email/Cluster B.
//
// Everything degrades gracefully: when no database is configured getSql() is
// null and the public getters return null so the UI can show an empty state.
//
// Design notes / caveats (mirrored in docs/ADMIN_DASHBOARD.md):
//   - "Daily chats" is windowed (default 30d); the headline totals are all-time
//     (which, given the 180d retention windows, is effectively last-180d).
//   - The in-chat click signals are derived from the widget's fail-silent
//     track() telemetry. The exact event NAMES are owned by the frontend, so we
//     match by PATTERN (see CTA_PATTERN / CART_PATTERN) rather than hard-coding a
//     single string, and additionally surface the full event breakdown so an
//     operator can always see the raw truth.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import type { KpiRange } from "./kpi-range";

export interface DailyCount {
  /** ISO date (YYYY-MM-DD). */
  day: string;
  count: number;
}

export interface EventCount {
  event: string;
  count: number;
}

export interface StatusBreakdown {
  active: number;
  abandoned: number;
  converted: number;
}

export interface CoreMetrics {
  /** All-time conversation count (one row per chat that sent ≥1 message). */
  totalChats: number;
  /** Daily new-chat counts across the selected window, gap-filled with 0s. */
  chatsByDay: DailyCount[];
  /** Inclusive day count of the selected window (see lib/kpi-range). */
  windowDays: number;
  /** Mean message_count across conversations (user + assistant + tool turns). */
  avgMessagesPerChat: number;
  status: StatusBreakdown;
  /** abandoned / totalChats (0 when no chats). */
  abandonedRate: number;
  /** In-chat product-card / CTA clicks (kpi_events, pattern-matched). */
  productCtaClicks: number;
  /** In-chat add-to-cart / checkout clicks (kpi_events, pattern-matched). */
  addToCartClicks: number;
  /** productCtaClicks / totalChats. */
  productCtaRatePerChat: number;
  /** addToCartClicks / totalChats. */
  addToCartRatePerChat: number;
  /** Distinct sessions that produced ANY telemetry (a proxy for "opened"). */
  sessionsWithTelemetry: number;
  /** Conversations = a message was actually sent. */
  chatsWithMessages: number;
  /** chatsWithMessages / sessionsWithTelemetry (engagement proxy; null if no telemetry). */
  engagementRate: number | null;
  /** Full event-name breakdown (top 20), so the raw telemetry is always visible. */
  topEvents: EventCount[];
}

// Pattern matching for the two headline click signals. These are SQL ILIKE
// patterns, kept here (and documented) because the widget owns the literal event
// names; matching by shape survives a rename like product_card_click →
// product_cta_click without a code change.
const CTA_PATTERNS = ["%product%click%", "%cta%click%"] as const;
const CART_PATTERNS = ["%cart%", "%checkout%"] as const;

function ratePerChat(numerator: number, totalChats: number): number {
  return totalChats > 0 ? numerator / totalChats : 0;
}

/**
 * Aggregate the core dashboard metrics in a handful of round-trips. Returns null
 * when no DB is configured or on a hard failure (the caller renders an empty
 * state rather than crashing the page).
 *
 * Scoped to the resolved [from, to] window (the date picker — see lib/kpi-range)
 * via `created_at >= from AND created_at < to+1` (i.e. `to` inclusive of the
 * whole day). Both range bounds are calendar dates; conversations has a
 * created_at index (migration 0027) and kpi_events one from migration 0001, so
 * these stay index scans.
 */
export async function getCoreMetrics(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<CoreMetrics | null> {
  if (!sql) return null;
  const from = range.from;
  const to = range.to;
  const days = Number.isFinite(range.days) && range.days > 0 ? Math.floor(range.days) : 30;

  try {
    const [totalsRows, dailyRows, statusRows, clickRows, telemetryRows, eventRows] =
      await Promise.all([
        sql`
          SELECT count(*)::int AS total,
                 COALESCE(avg(message_count), 0)::float AS avg_messages
            FROM conversations
           WHERE created_at >= ${from}::date
             AND created_at < (${to}::date + 1)
        `,
        sql`
          SELECT to_char(g.day, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::int AS count
            FROM generate_series(
                   ${from}::date,
                   ${to}::date,
                   interval '1 day'
                 ) AS g(day)
            LEFT JOIN (
                   SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS n
                     FROM conversations
                    WHERE created_at >= ${from}::date
                      AND created_at < (${to}::date + 1)
                    GROUP BY 1
                 ) c ON c.day = g.day::date
           ORDER BY g.day
        `,
        sql`
          SELECT status, count(*)::int AS n
            FROM conversations
           WHERE created_at >= ${from}::date
             AND created_at < (${to}::date + 1)
           GROUP BY status
        `,
        sql`
          SELECT
            count(*) FILTER (
              WHERE event ILIKE ${CTA_PATTERNS[0]} OR event ILIKE ${CTA_PATTERNS[1]}
            )::int AS cta,
            count(*) FILTER (
              WHERE event ILIKE ${CART_PATTERNS[0]} OR event ILIKE ${CART_PATTERNS[1]}
            )::int AS cart
            FROM kpi_events
           WHERE created_at >= ${from}::date
             AND created_at < (${to}::date + 1)
        `,
        sql`
          SELECT count(DISTINCT session_id)::int AS sessions
            FROM kpi_events
           WHERE session_id IS NOT NULL
             AND created_at >= ${from}::date
             AND created_at < (${to}::date + 1)
        `,
        sql`
          SELECT event, count(*)::int AS n
            FROM kpi_events
           WHERE created_at >= ${from}::date
             AND created_at < (${to}::date + 1)
           GROUP BY event
           ORDER BY n DESC, event ASC
           LIMIT 20
        `,
      ]);

    const totalChats = Number(totalsRows[0]?.total ?? 0);
    const avgMessagesPerChat = Number(totalsRows[0]?.avg_messages ?? 0);

    const status: StatusBreakdown = { active: 0, abandoned: 0, converted: 0 };
    for (const r of statusRows as Array<{ status: string; n: number }>) {
      if (r.status === "active" || r.status === "abandoned" || r.status === "converted") {
        status[r.status] = Number(r.n);
      }
    }

    const productCtaClicks = Number(clickRows[0]?.cta ?? 0);
    const addToCartClicks = Number(clickRows[0]?.cart ?? 0);
    const sessionsWithTelemetry = Number(telemetryRows[0]?.sessions ?? 0);

    return {
      totalChats,
      chatsByDay: (dailyRows as Array<{ day: string; count: number }>).map((r) => ({
        day: String(r.day),
        count: Number(r.count),
      })),
      windowDays: days,
      avgMessagesPerChat,
      status,
      abandonedRate: totalChats > 0 ? status.abandoned / totalChats : 0,
      productCtaClicks,
      addToCartClicks,
      productCtaRatePerChat: ratePerChat(productCtaClicks, totalChats),
      addToCartRatePerChat: ratePerChat(addToCartClicks, totalChats),
      sessionsWithTelemetry,
      chatsWithMessages: totalChats,
      engagementRate:
        sessionsWithTelemetry > 0 ? totalChats / sessionsWithTelemetry : null,
      topEvents: (eventRows as Array<{ event: string; n: number }>).map((r) => ({
        event: String(r.event),
        count: Number(r.n),
      })),
    } satisfies CoreMetrics;
  } catch (err) {
    reportError(err, { route: "lib/kpi-store", phase: "getCoreMetrics" });
    return null;
  }
}
