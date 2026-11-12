// Rundmail analysis — the queries behind the „Versand“ tab: the figures with
// orders and revenue, the time series, the paged recipient list (also the
// CSV export), one recipient's detail and the data of the per-recipient mail
// view (docs/CAMPAIGNS.md §9.6).
//
// The attribution rule lives in rundmail-analytics.mjs (pure, tested) and is
// spelled out here in SQL, set-based over ALL recipients of a Rundmail at
// once — no per-recipient loop, index-backed for 10,000+ recipients:
//
//   att = the sends of this Rundmail (campaign_sends, not test, with a
//         customer) × the customer's orders placed after sent_at, within the
//         window, not cancelled — minus every order with a LATER Rundmail
//         send to the same customer before it (last touch).
//
// The orders are read per send through a LATERAL subquery with OFFSET 0
// (an optimisation fence): one index probe of customer_orders_customer_idx
// (customer_id, processed_at) per recipient and one of
// campaign_sends_customer_idx per candidate order, so the cost follows the
// recipients, not the size of the order ledger — measured 2026-11-12 with
// 10,000 recipients and 1,000,000 orders in the ledger: figures ~15 ms, a
// list page ~30–50 ms (JIT off, see withoutJit), where a plain join chose a
// hash over the whole ledger (~500 ms).
//
// Neon's tagged templates cannot be composed, so `att` is written out in the
// figures query and in the list query — change both (and the core) together.
// The detail of one recipient runs the core's attributeRecipientOrders on
// that person's few rows instead, so it can say WHY an order does not count.
//
// Fail-soft like every store: null / an empty page on errors, reported.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { getMailing, getMailingStats, type Mailing, type MailingStats } from "./mailing-store";
import { isWebFontStylesheetUrl } from "./mailing-core.mjs";
import {
  RECIPIENT_PAGE_SIZE,
  attributeRecipientOrders,
  buildActivitySeries,
  buildSendSeries,
  likePattern,
  parseRundmailWindow,
  recipientTimeline,
  rundmailCouponCodes,
  rundmailRates,
  rundmailWindowDays,
  rundmailWindowHours,
  type OrderVerdict,
  type RecipientFilter,
  type RecipientSort,
  type RundmailWindowKey,
  type SortDirection,
  type TimelineEntry,
} from "./rundmail-analytics.mjs";

const iso = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const int = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** What every query needs from the Rundmail itself. */
interface AnalyticsContext {
  mailing: Mailing;
  /** The Rundmail's coupon codes (upper case). */
  codes: string[];
  /** Link indexes (as kpi_events.data->>'link' text) of web-font stylesheets — no clicks (0082). */
  fontLinks: string[];
}

function contextOf(mailing: Mailing): AnalyticsContext {
  return {
    mailing,
    codes: rundmailCouponCodes(mailing.doc, mailing.links),
    fontLinks: mailing.links.flatMap((l, i) => (isWebFontStylesheetUrl(l.url) ? [String(i)] : [])),
  };
}

/**
 * Run one statement with JIT off (SET LOCAL in the same one-request
 * transaction). The fenced LATERAL makes the planner's cost estimate of the
 * attribution statements large (it scales with the recipients and, for „bis
 * heute“, with every order since the send), which switches on JIT inlining
 * and optimisation — measured 2026-11-12: ~630 ms of compiling for ~20 ms of
 * work (10,000 recipients); with JIT off the figures take ~15 ms, a list
 * page ~30–50 ms. No effect where JIT is not available.
 */
async function withoutJit(sql: Sql, statement: ReturnType<Sql>): Promise<unknown> {
  const results = await sql.transaction([sql`SET LOCAL jit = off`, statement]);
  return results[1];
}

// ── figures + time series ────────────────────────────────────────────────────

export interface RundmailAnalyticsSummary {
  window: RundmailWindowKey;
  windowDays: number | null;
  /** The figures of the workspace (progress, delivery, clicks per link, reasons). */
  stats: MailingStats;
  /** The Rundmail's coupon codes („mit Code“). */
  codes: string[];
  /** Counted orders (the rule above) and their customers / net revenue. */
  orders: number;
  buyers: number;
  revenueCents: number;
  codeOrders: number;
  codeBuyers: number;
  codeRevenueCents: number;
  clickOrders: number;
  clickRevenueCents: number;
  /** Orders with one of the codes by ANYONE (recipients or not, e.g. a forwarded code) from the first send to the end of the window after the last; null without codes. */
  codeOrdersAll: number | null;
  codeRevenueAllCents: number | null;
  rates: ReturnType<typeof rundmailRates>;
  firstSentAt: string | null;
  lastSentAt: string | null;
  /** End of the measured period: the last send + the window, at most now. */
  measuredUntil: string | null;
  /** The window of the last send is still running — orders can still come in. */
  windowOpen: boolean;
}

export interface RundmailAnalyticsSeries {
  /** Mails sent per bucket during the send (per minute / 10 minutes / hour / day). */
  send: { stepMinutes: number; points: Array<{ t: string; value: number }> };
  /** Clicks, counted orders and their revenue per hour (≤ 4 days) or Berlin day. */
  activity: {
    granularity: "hour" | "day";
    points: Array<{ t: string; clicks: number; orders: number; revenueCents: number }>;
  };
}

/**
 * The figures and the time series of one Rundmail for a window. Null when the
 * Rundmail (its content row) does not exist or the database fails. Four
 * set-based queries in parallel, next to getMailingStats' own.
 */
export async function getRundmailAnalytics(
  campaignId: number,
  windowKey: unknown,
  sql: Sql | null = getSql()
): Promise<{ summary: RundmailAnalyticsSummary; series: RundmailAnalyticsSeries } | null> {
  if (!sql) return null;
  const window = parseRundmailWindow(windowKey);
  const hours = rundmailWindowHours(window);
  try {
    const mailing = await getMailing(campaignId, sql);
    if (!mailing) return null;
    const ctx = contextOf(mailing);
    const [stats, attRows, clickRows, sendRows, codeRows] = await Promise.all([
      getMailingStats(campaignId, sql),
      withoutJit(sql, sql`
        WITH s AS (
          SELECT id, customer_id, sent_at, clicked_at
            FROM campaign_sends
           WHERE campaign_id = ${campaignId} AND is_test = false AND customer_id IS NOT NULL
        ),
        att AS (
          SELECT s.customer_id, o.processed_at, o.net, o.with_code,
                 (s.clicked_at IS NOT NULL AND s.clicked_at < o.processed_at) AS after_click
            FROM s
            CROSS JOIN LATERAL (
              SELECT o.processed_at,
                     GREATEST(o.total_cents - o.refunded_cents, 0)::bigint AS net,
                     EXISTS (SELECT 1 FROM unnest(o.discount_codes) d WHERE upper(btrim(d)) = ANY(${ctx.codes}::text[])) AS with_code,
                     EXISTS (SELECT 1
                               FROM campaign_sends s2
                               JOIN campaigns k ON k.id = s2.campaign_id AND k.kind = 'rundmail'
                              WHERE s2.customer_id = s.customer_id
                                AND s2.is_test = false
                                AND s2.sent_at < o.processed_at
                                AND (s2.sent_at > s.sent_at OR (s2.sent_at = s.sent_at AND s2.id > s.id))) AS later_touch
                FROM customer_orders o
               WHERE o.customer_id = s.customer_id
                 AND o.processed_at > s.sent_at
                 AND (${hours}::int IS NULL OR o.processed_at <= s.sent_at + ${hours}::int * interval '1 hour')
                 AND o.cancelled_at IS NULL
              OFFSET 0
            ) o
           WHERE NOT o.later_touch
        ),
        a AS (
          SELECT att.*, floor(extract(epoch FROM att.processed_at) / 3600)::bigint AS hour FROM att
        )
        SELECT GROUPING(a.hour) AS total_row, a.hour,
               count(*)::int AS orders,
               count(DISTINCT a.customer_id)::int AS buyers,
               COALESCE(sum(a.net), 0)::bigint AS revenue,
               count(*) FILTER (WHERE a.with_code)::int AS code_orders,
               count(DISTINCT a.customer_id) FILTER (WHERE a.with_code)::int AS code_buyers,
               COALESCE(sum(a.net) FILTER (WHERE a.with_code), 0)::bigint AS code_revenue,
               count(*) FILTER (WHERE a.after_click)::int AS click_orders,
               COALESCE(sum(a.net) FILTER (WHERE a.after_click), 0)::bigint AS click_revenue
          FROM a
         GROUP BY GROUPING SETS ((a.hour), ())
      `),
      sql`
        SELECT floor(extract(epoch FROM e.created_at) / 3600)::bigint AS hour, count(*)::int AS clicks
          FROM kpi_events e
         WHERE e.event = 'campaign_email_clicked'
           AND e.data->>'campaignId' = ${String(campaignId)}
           AND NOT (COALESCE(e.data->>'link', '') = ANY(${ctx.fontLinks}::text[]))
         GROUP BY 1
      `,
      sql`
        SELECT floor(extract(epoch FROM sent_at) / 60)::bigint AS minute, count(*)::int AS n,
               min(sent_at) AS first_at, max(sent_at) AS last_at
          FROM campaign_sends
         WHERE campaign_id = ${campaignId} AND is_test = false
         GROUP BY 1
      `,
      ctx.codes.length === 0
        ? Promise.resolve([])
        : sql`
            SELECT count(*)::int AS n, COALESCE(sum(GREATEST(o.total_cents - o.refunded_cents, 0)), 0)::bigint AS revenue
              FROM customer_orders o,
                   (SELECT min(sent_at) AS first_at, max(sent_at) AS last_at
                      FROM campaign_sends
                     WHERE campaign_id = ${campaignId} AND is_test = false) b
             WHERE b.first_at IS NOT NULL
               AND o.processed_at > b.first_at
               AND (${hours}::int IS NULL OR o.processed_at <= b.last_at + ${hours}::int * interval '1 hour')
               AND o.cancelled_at IS NULL
               AND EXISTS (SELECT 1 FROM unnest(o.discount_codes) d WHERE upper(btrim(d)) = ANY(${ctx.codes}::text[]))
          `,
    ]);

    const att = attRows as Array<Record<string, unknown>>;
    const total = att.find((r) => int(r.total_row) === 1) ?? {};
    const sends = sendRows as Array<Record<string, unknown>>;
    const firstMs = Math.min(...sends.map((r) => Date.parse(String(r.first_at))).filter(Number.isFinite));
    const lastMs = Math.max(...sends.map((r) => Date.parse(String(r.last_at))).filter(Number.isFinite));
    const hasSends = Number.isFinite(firstMs) && Number.isFinite(lastMs);
    const now = Date.now();
    const windowEnd = hasSends ? (hours == null ? now : lastMs + hours * 3_600_000) : NaN;
    const measuredUntil = hasSends ? Math.min(now, windowEnd) : NaN;

    const summaryBase = {
      orders: int(total.orders),
      buyers: int(total.buyers),
      revenueCents: int(total.revenue),
      codeOrders: int(total.code_orders),
      codeBuyers: int(total.code_buyers),
      codeRevenueCents: int(total.code_revenue),
      clickOrders: int(total.click_orders),
      clickRevenueCents: int(total.click_revenue),
    };
    const code = (codeRows as Array<Record<string, unknown>>)[0];
    const summary: RundmailAnalyticsSummary = {
      window,
      windowDays: rundmailWindowDays(window),
      stats,
      codes: ctx.codes,
      ...summaryBase,
      codeOrdersAll: ctx.codes.length === 0 ? null : int(code?.n),
      codeRevenueAllCents: ctx.codes.length === 0 ? null : int(code?.revenue),
      rates: rundmailRates({
        sent: stats.sent,
        clicked: stats.clicked,
        bounced: stats.bounced,
        complained: stats.complained,
        unsubscribed: stats.unsubscribed,
        buyers: summaryBase.buyers,
        revenueCents: summaryBase.revenueCents,
      }),
      firstSentAt: hasSends ? new Date(firstMs).toISOString() : null,
      lastSentAt: hasSends ? new Date(lastMs).toISOString() : null,
      measuredUntil: hasSends ? new Date(measuredUntil).toISOString() : null,
      windowOpen: hasSends && (hours == null || windowEnd > now),
    };

    // Per hour: clicks and the counted orders, merged.
    const byHour = new Map<number, { hour: number; clicks: number; orders: number; revenueCents: number }>();
    const hourRow = (h: number) => {
      let r = byHour.get(h);
      if (!r) {
        r = { hour: h, clicks: 0, orders: 0, revenueCents: 0 };
        byHour.set(h, r);
      }
      return r;
    };
    for (const r of clickRows as Array<Record<string, unknown>>) hourRow(int(r.hour)).clicks += int(r.clicks);
    for (const r of att) {
      if (int(r.total_row) === 1 || r.hour == null) continue;
      const row = hourRow(int(r.hour));
      row.orders += int(r.orders);
      row.revenueCents += int(r.revenue);
    }
    const series: RundmailAnalyticsSeries = {
      send: buildSendSeries(sends.map((r) => ({ minute: int(r.minute), count: int(r.n) }))),
      activity: hasSends
        ? buildActivitySeries([...byHour.values()], { fromMs: firstMs, toMs: measuredUntil })
        : { granularity: "hour", points: [] },
    };
    return { summary, series };
  } catch (err) {
    reportError(err, { route: "lib/rundmail-analytics-store", phase: "analytics", campaignId });
    return null;
  }
}

// ── recipient list (and the CSV export) ──────────────────────────────────────

export interface RundmailRecipientRow {
  contactId: number;
  customerId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  status: string;
  excludedReason: string | null;
  sendId: number | null;
  subject: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  bounceType: string | null;
  complainedAt: string | null;
  clickedAt: string | null;
  unsubscribedAt: string | null;
  /** Every recorded click on this mail (web-font loads excluded). */
  clicks: number;
  /** Counted orders in the window, their net revenue and how many used the code. */
  orders: number;
  revenueCents: number;
  codeOrders: number;
  /** „#1042, #1043“ — the counted orders' names, oldest first. */
  orderNames: string | null;
}

export interface RundmailRecipientQuery {
  window?: unknown;
  filter?: RecipientFilter;
  /** With filter `not_sent`: one reason (null = all). */
  reason?: string | null;
  q?: string;
  sort?: RecipientSort;
  dir?: SortDirection;
  page?: number;
  /** Rows per page (the list: 50; the export: its chunk size). */
  pageSize?: number;
  /** Keyset for the export: only recipients with a higher id, ordered by id (sort and page are ignored). */
  afterId?: number | null;
}

export interface RundmailRecipientPage {
  rows: RundmailRecipientRow[];
  total: number;
  page: number;
  pageSize: number;
  /** The query failed (reported) — the export must not end as if complete. */
  failed?: boolean;
}

function mapRecipient(r: Record<string, unknown>): RundmailRecipientRow {
  return {
    contactId: int(r.contact_id),
    customerId: r.customer_id == null ? null : int(r.customer_id),
    firstName: (r.first_name as string | null) ?? null,
    lastName: (r.last_name as string | null) ?? null,
    email: String(r.email ?? ""),
    status: String(r.status ?? ""),
    excludedReason: (r.excluded_reason as string | null) ?? null,
    sendId: r.send_id == null ? null : int(r.send_id),
    subject: (r.subject as string | null) ?? null,
    sentAt: iso(r.sent_at),
    deliveredAt: iso(r.delivered_at),
    bouncedAt: iso(r.bounced_at),
    bounceType: (r.bounce_type as string | null) ?? null,
    complainedAt: iso(r.complained_at),
    clickedAt: iso(r.clicked_at),
    unsubscribedAt: iso(r.unsubscribed_at),
    clicks: int(r.clicks),
    orders: int(r.orders),
    revenueCents: int(r.revenue),
    codeOrders: int(r.code_orders),
    orderNames: (r.order_names as string | null) || null,
  };
}

/**
 * One page of the recipients of a Rundmail — every recipient (sent, not
 * sent with the reason, still pending), searchable by name or e-mail,
 * filtered, sorted on the server, with clicks and the counted orders of the
 * window. ONE statement (the total via count(*) OVER ()). Empty page on errors.
 */
export async function listRundmailRecipients(
  campaignId: number,
  query: RundmailRecipientQuery = {},
  sql: Sql | null = getSql()
): Promise<RundmailRecipientPage> {
  const pageSize = Math.max(1, Math.min(5000, Math.floor(query.pageSize ?? RECIPIENT_PAGE_SIZE)));
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const empty: RundmailRecipientPage = { rows: [], total: 0, page: 1, pageSize };
  if (!sql) return empty;
  const hours = rundmailWindowHours(query.window);
  const filter = query.filter ?? "all";
  const reason = filter === "not_sent" ? (query.reason ?? null) : null;
  const q = (query.q ?? "").trim();
  const like = likePattern(q);
  const afterId = query.afterId ?? null;
  // The keyset export orders by id only; the list by the chosen column.
  const sort = afterId != null ? "id" : (query.sort ?? "sent");
  const dir = query.dir === "asc" ? "asc" : "desc";
  const offset = afterId != null ? 0 : (page - 1) * pageSize;
  try {
    const mailing = await getMailing(campaignId, sql);
    if (!mailing) return { ...empty, failed: true };
    const ctx = contextOf(mailing);
    const rows = (await withoutJit(sql, sql`
      WITH s AS (
        SELECT id, contact_id, customer_id, email, subject, sent_at, delivered_at, bounced_at, bounce_type,
               complained_at, clicked_at, unsubscribed_at
          FROM campaign_sends
         WHERE campaign_id = ${campaignId} AND is_test = false
      ),
      att AS (
        SELECT s.id AS send_id, o.order_name, o.processed_at, o.net, o.with_code
          FROM s
          CROSS JOIN LATERAL (
            SELECT o.order_name, o.processed_at,
                   GREATEST(o.total_cents - o.refunded_cents, 0)::bigint AS net,
                   EXISTS (SELECT 1 FROM unnest(o.discount_codes) d WHERE upper(btrim(d)) = ANY(${ctx.codes}::text[])) AS with_code,
                   EXISTS (SELECT 1
                             FROM campaign_sends s2
                             JOIN campaigns k ON k.id = s2.campaign_id AND k.kind = 'rundmail'
                            WHERE s2.customer_id = s.customer_id
                              AND s2.is_test = false
                              AND s2.sent_at < o.processed_at
                              AND (s2.sent_at > s.sent_at OR (s2.sent_at = s.sent_at AND s2.id > s.id))) AS later_touch
              FROM customer_orders o
             WHERE o.customer_id = s.customer_id
               AND o.processed_at > s.sent_at
               AND (${hours}::int IS NULL OR o.processed_at <= s.sent_at + ${hours}::int * interval '1 hour')
               AND o.cancelled_at IS NULL
            OFFSET 0
          ) o
         WHERE s.customer_id IS NOT NULL AND NOT o.later_touch
      ),
      ord AS (
        SELECT send_id, count(*)::int AS orders, sum(net)::bigint AS revenue,
               count(*) FILTER (WHERE with_code)::int AS code_orders,
               string_agg(COALESCE(order_name, '—'), ', ' ORDER BY processed_at) AS order_names
          FROM att
         GROUP BY send_id
      ),
      clk AS (
        SELECT e.data->>'sendId' AS send_key, count(*)::int AS clicks
          FROM kpi_events e
         WHERE e.event = 'campaign_email_clicked'
           AND e.data->>'campaignId' = ${String(campaignId)}
           AND NOT (COALESCE(e.data->>'link', '') = ANY(${ctx.fontLinks}::text[]))
         GROUP BY 1
      ),
      r AS (
        SELECT cc.id AS contact_id, cc.customer_id, cc.status, cc.excluded_reason,
               COALESCE(c.first_name, cc.first_name) AS first_name,
               COALESCE(c.last_name, cc.last_name) AS last_name,
               COALESCE(s.email, c.email, cc.email) AS email,
               s.id AS send_id, s.subject, s.sent_at, s.delivered_at, s.bounced_at, s.bounce_type,
               s.complained_at, s.clicked_at, s.unsubscribed_at,
               COALESCE(clk.clicks, 0) AS clicks,
               COALESCE(ord.orders, 0) AS orders,
               COALESCE(ord.revenue, 0) AS revenue,
               COALESCE(ord.code_orders, 0) AS code_orders,
               ord.order_names
          FROM campaign_contacts cc
          LEFT JOIN customers c ON c.id = cc.customer_id
          LEFT JOIN s ON s.contact_id = cc.id
          LEFT JOIN clk ON clk.send_key = s.id::text
          LEFT JOIN ord ON ord.send_id = s.id
         WHERE cc.campaign_id = ${campaignId}
           AND cc.is_test = false
           AND cc.status IN ('pending', 'sending', 'sent', 'suppressed', 'skipped')
      )
      SELECT r.*, count(*) OVER ()::int AS total
        FROM r
       WHERE (${filter} = 'all'
              OR (${filter} = 'sent' AND r.send_id IS NOT NULL)
              OR (${filter} = 'delivered' AND r.delivered_at IS NOT NULL)
              OR (${filter} = 'clicked' AND r.clicked_at IS NOT NULL)
              OR (${filter} = 'ordered' AND r.orders > 0)
              OR (${filter} = 'bounced' AND r.bounced_at IS NOT NULL)
              OR (${filter} = 'complained' AND r.complained_at IS NOT NULL)
              OR (${filter} = 'unsubscribed' AND r.unsubscribed_at IS NOT NULL)
              OR (${filter} = 'not_sent' AND r.send_id IS NULL AND r.status IN ('skipped', 'suppressed')
                  AND (${reason}::text IS NULL OR COALESCE(r.excluded_reason, 'sonstiges') = ${reason}::text)))
         AND (${q} = ''
              OR r.email ILIKE ${like}
              OR COALESCE(r.first_name, '') ILIKE ${like}
              OR COALESCE(r.last_name, '') ILIKE ${like}
              OR (COALESCE(r.first_name, '') || ' ' || COALESCE(r.last_name, '')) ILIKE ${like})
         AND (${afterId}::bigint IS NULL OR r.contact_id > ${afterId}::bigint)
       ORDER BY
         CASE WHEN ${sort} = 'clicks' AND ${dir} = 'desc' THEN r.clicks END DESC NULLS LAST,
         CASE WHEN ${sort} = 'clicks' AND ${dir} = 'asc' THEN r.clicks END ASC NULLS LAST,
         CASE WHEN ${sort} = 'revenue' AND ${dir} = 'desc' THEN r.revenue END DESC NULLS LAST,
         CASE WHEN ${sort} = 'revenue' AND ${dir} = 'asc' THEN r.revenue END ASC NULLS LAST,
         CASE WHEN ${sort} = 'sent' AND ${dir} = 'asc' THEN r.sent_at END ASC NULLS LAST,
         CASE WHEN ${sort} <> 'id' THEN r.sent_at END DESC NULLS LAST,
         r.contact_id ASC
       LIMIT ${pageSize} OFFSET ${offset}
    `)) as Array<Record<string, unknown>>;
    const total = rows.length > 0 ? int(rows[0].total) : 0;
    if (rows.length === 0 && page > 1 && afterId == null) {
      // A page past the end (an old link, a narrowed filter): the first page instead.
      return listRundmailRecipients(campaignId, { ...query, page: 1 }, sql);
    }
    return { rows: rows.map(mapRecipient), total, page: afterId != null ? 1 : page, pageSize };
  } catch (err) {
    reportError(err, { route: "lib/rundmail-analytics-store", phase: "recipients", campaignId });
    return { ...empty, failed: true };
  }
}

// ── one recipient ────────────────────────────────────────────────────────────

export interface RundmailRecipientOrder {
  id: number;
  orderName: string | null;
  processedAt: string | null;
  cancelledAt: string | null;
  financialStatus: string | null;
  currency: string | null;
  totalCents: number;
  refundedCents: number;
  netCents: number;
  discountCodes: string[];
  items: Array<{ title: string; variantTitle: string | null; quantity: number; unitPrice: number | null }>;
  verdict: OrderVerdict;
  counts: boolean;
  withCode: boolean;
  afterClick: boolean;
  /** For „zählt für eine spätere Rundmail“: that Rundmail. */
  laterRundmail: { campaignId: number; name: string; sentAt: string | null } | null;
}

export interface RundmailRecipientDetail {
  contactId: number;
  campaignId: number;
  customerId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  consentState: string | null;
  status: string;
  excludedReason: string | null;
  skippedAt: string | null;
  send: {
    id: number;
    subject: string | null;
    sentAt: string | null;
    deliveredAt: string | null;
    bouncedAt: string | null;
    bounceType: string | null;
    complainedAt: string | null;
    clickedAt: string | null;
    unsubscribedAt: string | null;
  } | null;
  clicks: Array<{ at: string | null; index: number | null; url: string | null }>;
  orders: RundmailRecipientOrder[];
  /** The counted orders. */
  totals: { orders: number; revenueCents: number; codeOrders: number };
  timeline: TimelineEntry[];
  window: RundmailWindowKey;
  codes: string[];
}

/** Clicks of one mail kept for the detail (the newest beyond are summarised). */
const DETAIL_MAX_CLICKS = 100;
const DETAIL_MAX_ORDERS = 50;

/**
 * One recipient of a Rundmail: the send, every click with its link, the
 * orders after it inside the window with their verdict (attributeRecipientOrders
 * — the same rule as the figures), the timeline. Null when the recipient is
 * not one of this Rundmail's or the database fails.
 */
export async function getRundmailRecipientDetail(
  campaignId: number,
  contactId: number,
  windowKey: unknown,
  sql: Sql | null = getSql()
): Promise<RundmailRecipientDetail | null> {
  if (!sql) return null;
  const window = parseRundmailWindow(windowKey);
  const hours = rundmailWindowHours(window);
  try {
    const [mailing, baseRows] = await Promise.all([
      getMailing(campaignId, sql),
      sql`
        SELECT cc.id, cc.customer_id, cc.status, cc.excluded_reason, cc.skipped_at,
               COALESCE(c.first_name, cc.first_name) AS first_name,
               COALESCE(c.last_name, cc.last_name) AS last_name,
               COALESCE(s.email, c.email, cc.email) AS email,
               c.email_consent_state,
               s.id AS send_id, s.subject, s.sent_at, s.delivered_at, s.bounced_at, s.bounce_type,
               s.complained_at, s.clicked_at, s.unsubscribed_at, s.customer_id AS send_customer_id
          FROM campaign_contacts cc
          LEFT JOIN customers c ON c.id = cc.customer_id
          LEFT JOIN LATERAL (
            SELECT id, email, subject, sent_at, delivered_at, bounced_at, bounce_type, complained_at,
                   clicked_at, unsubscribed_at, customer_id
              FROM campaign_sends
             WHERE contact_id = cc.id AND is_test = false
             ORDER BY sent_at DESC
             LIMIT 1
          ) s ON true
         WHERE cc.id = ${contactId} AND cc.campaign_id = ${campaignId} AND cc.is_test = false
      `,
    ]);
    const base = (baseRows as Array<Record<string, unknown>>)[0];
    if (!mailing || !base) return null;
    const ctx = contextOf(mailing);
    const sendId = base.send_id == null ? null : int(base.send_id);
    const customerId = base.send_customer_id != null ? int(base.send_customer_id) : base.customer_id != null ? int(base.customer_id) : null;

    const [clickRows, personRows, orderRows] =
      sendId == null
        ? [[], [], []]
        : await Promise.all([
            sql`
              SELECT e.created_at, e.data->>'link' AS link
                FROM kpi_events e
               WHERE e.event = 'campaign_email_clicked'
                 AND e.data->>'sendId' = ${String(sendId)}
                 AND e.data->>'campaignId' = ${String(campaignId)}
                 AND NOT (COALESCE(e.data->>'link', '') = ANY(${ctx.fontLinks}::text[]))
               ORDER BY e.created_at, e.id
               LIMIT ${DETAIL_MAX_CLICKS}
            `,
            customerId == null
              ? Promise.resolve([])
              : sql`
                  SELECT s.id, s.campaign_id, k.name, s.sent_at
                    FROM campaign_sends s
                    JOIN campaigns k ON k.id = s.campaign_id AND k.kind = 'rundmail'
                   WHERE s.customer_id = ${customerId} AND s.is_test = false
                   ORDER BY s.sent_at, s.id
                `,
            customerId == null
              ? Promise.resolve([])
              : sql`
                  SELECT o.id, o.order_name, o.processed_at, o.cancelled_at, o.financial_status, o.currency,
                         o.total_cents, o.refunded_cents, o.discount_codes, o.line_items
                    FROM customer_orders o
                    JOIN campaign_sends s ON s.id = ${sendId}
                   WHERE o.customer_id = ${customerId}
                     AND o.processed_at > s.sent_at
                     AND (${hours}::int IS NULL OR o.processed_at <= s.sent_at + ${hours}::int * interval '1 hour')
                   ORDER BY o.processed_at, o.id
                   LIMIT ${DETAIL_MAX_ORDERS}
                `,
          ]);

    const send = sendId == null
      ? null
      : {
          id: sendId,
          subject: (base.subject as string | null) ?? null,
          sentAt: iso(base.sent_at),
          deliveredAt: iso(base.delivered_at),
          bouncedAt: iso(base.bounced_at),
          bounceType: (base.bounce_type as string | null) ?? null,
          complainedAt: iso(base.complained_at),
          clickedAt: iso(base.clicked_at),
          unsubscribedAt: iso(base.unsubscribed_at),
        };
    const clicks = (clickRows as Array<Record<string, unknown>>).map((r) => {
      const index = /^\d{1,4}$/.test(String(r.link ?? "")) ? Number(r.link) : null;
      return { at: iso(r.created_at), index, url: index == null ? null : (mailing.links[index]?.url ?? null) };
    });
    const personSends = (personRows as Array<Record<string, unknown>>).map((r) => ({
      id: int(r.id),
      campaignId: int(r.campaign_id),
      name: String(r.name ?? ""),
      sentAt: iso(r.sent_at),
    }));
    const ledger = (orderRows as Array<Record<string, unknown>>).map((r) => ({
      id: int(r.id),
      customerId,
      orderName: (r.order_name as string | null) ?? null,
      processedAt: iso(r.processed_at),
      cancelledAt: iso(r.cancelled_at),
      financialStatus: (r.financial_status as string | null) ?? null,
      currency: (r.currency as string | null) ?? null,
      totalCents: int(r.total_cents),
      refundedCents: int(r.refunded_cents),
      discountCodes: Array.isArray(r.discount_codes) ? (r.discount_codes as unknown[]).map(String) : [],
      items: (Array.isArray(r.line_items) ? (r.line_items as Array<Record<string, unknown>>) : []).slice(0, 30).map((li) => ({
        title: String(li?.title ?? "Artikel"),
        variantTitle: typeof li?.variantTitle === "string" && li.variantTitle && li.variantTitle !== "Default Title" ? li.variantTitle : null,
        quantity: int(li?.quantity) || 1,
        unitPrice: li?.unitPrice == null || !Number.isFinite(Number(li.unitPrice)) ? null : Number(li.unitPrice),
      })),
    }));
    // The rule sees every Rundmail send to the person (this one included).
    const ruleSends = personSends.map((p) => ({ id: p.id, sentAt: p.sentAt, clickedAt: null as string | null }));
    const attributed = send
      ? attributeRecipientOrders({
          send: { id: send.id, sentAt: send.sentAt, clickedAt: send.clickedAt },
          personSends: ruleSends,
          orders: ledger,
          windowDays: rundmailWindowDays(window),
          codes: ctx.codes,
        })
      : [];
    const sendById = new Map(personSends.map((p) => [p.id, p]));
    const orders: RundmailRecipientOrder[] = attributed.map((o) => {
      const later = o.verdict === "spaetere_rundmail" && o.touchId != null ? sendById.get(o.touchId) : undefined;
      return {
        id: o.id,
        orderName: o.orderName,
        processedAt: o.processedAt,
        cancelledAt: o.cancelledAt,
        financialStatus: o.financialStatus,
        currency: o.currency,
        totalCents: o.totalCents,
        refundedCents: o.refundedCents,
        netCents: o.netCents,
        discountCodes: o.discountCodes,
        items: o.items,
        verdict: o.verdict,
        counts: o.counts,
        withCode: o.withCode,
        afterClick: o.afterClick,
        laterRundmail: later ? { campaignId: later.campaignId, name: later.name, sentAt: later.sentAt } : null,
      };
    });
    const counted = orders.filter((o) => o.counts);
    return {
      contactId: int(base.id),
      campaignId,
      customerId: base.customer_id == null ? null : int(base.customer_id),
      firstName: (base.first_name as string | null) ?? null,
      lastName: (base.last_name as string | null) ?? null,
      email: String(base.email ?? ""),
      consentState: (base.email_consent_state as string | null) ?? null,
      status: String(base.status ?? ""),
      excludedReason: (base.excluded_reason as string | null) ?? null,
      skippedAt: iso(base.skipped_at),
      send,
      clicks,
      orders,
      totals: {
        orders: counted.length,
        revenueCents: counted.reduce((n, o) => n + o.netCents, 0),
        codeOrders: counted.filter((o) => o.withCode).length,
      },
      timeline: recipientTimeline({
        status: String(base.status ?? ""),
        excludedReason: (base.excluded_reason as string | null) ?? null,
        skippedAt: iso(base.skipped_at),
        sentAt: send?.sentAt ?? null,
        deliveredAt: send?.deliveredAt ?? null,
        bouncedAt: send?.bouncedAt ?? null,
        bounceType: send?.bounceType ?? null,
        complainedAt: send?.complainedAt ?? null,
        unsubscribedAt: send?.unsubscribedAt ?? null,
        clicks: clicks.map((c) => ({ at: c.at, url: c.url })),
        orders: orders.map((o) => ({ processedAt: o.processedAt, orderName: o.orderName, netCents: o.netCents, verdict: o.verdict })),
      }),
      window,
      codes: ctx.codes,
    };
  } catch (err) {
    reportError(err, { route: "lib/rundmail-analytics-store", phase: "recipient", campaignId });
    return null;
  }
}

// ── the mail one recipient got ───────────────────────────────────────────────

export interface RundmailRecipientMail {
  campaignId: number;
  /** The first name the mail is personalised with (today's, as the send used the person's then). */
  firstName: string | null;
  /** The personalised subject that was sent (stored per send). */
  subject: string | null;
  sentAt: string | null;
}

/**
 * What the per-recipient viewer needs: the Rundmail a recipient row belongs
 * to and the person's first name — only for a recipient who WAS sent the
 * Rundmail (a Rundmail send stores no body; the frozen content is
 * personalised again). Null otherwise or on errors.
 */
export async function getRundmailRecipientMail(contactId: number, sql: Sql | null = getSql()): Promise<RundmailRecipientMail | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT cc.campaign_id, COALESCE(c.first_name, cc.first_name) AS first_name, s.subject, s.sent_at
        FROM campaign_contacts cc
        JOIN campaigns k ON k.id = cc.campaign_id AND k.kind = 'rundmail'
        LEFT JOIN customers c ON c.id = cc.customer_id
        JOIN LATERAL (
          SELECT subject, sent_at FROM campaign_sends
           WHERE contact_id = cc.id AND is_test = false
           ORDER BY sent_at DESC
           LIMIT 1
        ) s ON true
       WHERE cc.id = ${contactId} AND cc.is_test = false
    `) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    return {
      campaignId: int(r.campaign_id),
      firstName: (r.first_name as string | null) ?? null,
      subject: (r.subject as string | null) ?? null,
      sentAt: iso(r.sent_at),
    };
  } catch (err) {
    reportError(err, { route: "lib/rundmail-analytics-store", phase: "recipientMail" });
    return null;
  }
}
