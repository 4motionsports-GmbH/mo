// Read-only aggregates behind the admin Übersicht (D-1 in docs/CLEANUP_AUDIT.md):
// every number comes from the DATABASE — the DOI status and the cached Shopify
// purchase history on `customers`, the campaign/marketing send tables, the
// queue counts — so opening the overview costs a handful of COUNT queries and
// never a Shopify round-trip. All reads are fail-soft: a failing query logs and
// degrades to null / 0 / [] instead of breaking the screen.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { getCoreMetrics, type CoreMetrics } from "./kpi-store";
import { getAiCostMetrics, type AiCostMetrics } from "./ai-usage-store";
import { getMarketingActivity, type MarketingActivity } from "./marketing-store";
import { getCampaignCounts, type CampaignCounts } from "./campaign-store";
import { getQaCounts, type QaCounts } from "./qa-store";
import { countUnmatchedInbound } from "./email-messages-store";
import { resolveKpiRange } from "./kpi-range";
import { ADMIN_TIME_ZONE } from "./admin-datetime.mjs";

export interface OverviewMarketingSummary {
  /** Customers with marketing_status = 'confirmed' (DOI). */
  eligible: number;
  /** …whose cached purchase history is loaded and contains no order. */
  notPurchased: number;
  /** …whose cached purchase history contains at least one order. */
  purchased: number;
  /** …without a loaded purchase history yet (not counted either way). */
  unknown: number;
}

export interface OverviewConfirmedContact {
  email: string;
  /** ISO timestamp. */
  confirmedAt: string;
}

export interface OverviewSend {
  id: number;
  email: string;
  subject: string | null;
  sentAt: string | null;
  source: "campaign" | "marketing";
}

export interface OverviewCampaignActivity {
  recentSends: OverviewSend[];
  sentInWindow: number;
}

export interface OverviewRunning {
  /** Komplettanalysen with status 'running'. */
  reports: number;
  /** Verbesserungsläufe with status 'running'. */
  improvementRuns: number;
}

export interface OverviewSnapshot {
  windowDays: number;
  core: CoreMetrics | null;
  aiCost: AiCostMetrics | null;
  marketing: OverviewMarketingSummary;
  recentConfirmed: OverviewConfirmedContact[];
  campaignActivity: OverviewCampaignActivity;
  marketingActivity: MarketingActivity | null;
  campaignCounts: CampaignCounts | null;
  qaCounts: QaCounts;
  unmatchedInbound: number;
  running: OverviewRunning;
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string" && value) return value;
  return null;
}

async function marketingSummary(sql: Sql): Promise<OverviewMarketingSummary> {
  const empty = { eligible: 0, notPurchased: 0, purchased: 0, unknown: 0 };
  try {
    // Same buckets the Kunden list filter uses (customer-filter.ts purchaseState):
    // null summary = unknown, orders.length > 0 = purchased, else no purchase.
    const rows = (await sql`
      SELECT
        count(*) FILTER (WHERE marketing_status = 'confirmed')::int AS eligible,
        count(*) FILTER (WHERE marketing_status = 'confirmed'
                           AND purchase_summary IS NULL)::int AS unknown,
        count(*) FILTER (WHERE marketing_status = 'confirmed'
                           AND purchase_summary IS NOT NULL
                           AND CASE WHEN jsonb_typeof(purchase_summary->'orders') = 'array'
                                    THEN jsonb_array_length(purchase_summary->'orders')
                                    ELSE 0 END > 0)::int AS purchased
        FROM customers
    `) as Array<{ eligible: number; unknown: number; purchased: number }>;
    const r = rows[0];
    if (!r) return empty;
    const eligible = Number(r.eligible ?? 0);
    const unknown = Number(r.unknown ?? 0);
    const purchased = Number(r.purchased ?? 0);
    return { eligible, unknown, purchased, notPurchased: Math.max(0, eligible - unknown - purchased) };
  } catch (err) {
    reportError(err, { route: "lib/admin-overview-store", phase: "marketingSummary" });
    return empty;
  }
}

async function recentConfirmed(sql: Sql, limit: number): Promise<OverviewConfirmedContact[]> {
  try {
    const rows = (await sql`
      SELECT email, doi_confirmed_at
        FROM email_captures
       WHERE marketing_doi_status = 'confirmed'
         AND unsubscribed_at IS NULL
         AND doi_confirmed_at IS NOT NULL
       ORDER BY doi_confirmed_at DESC, id DESC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.flatMap((r) => {
      const confirmedAt = toIso(r.doi_confirmed_at);
      return confirmedAt ? [{ email: String(r.email), confirmedAt }] : [];
    });
  } catch (err) {
    reportError(err, { route: "lib/admin-overview-store", phase: "recentConfirmed" });
    return [];
  }
}

async function campaignActivity(
  sql: Sql,
  windowDays: number,
  limit: number
): Promise<OverviewCampaignActivity> {
  try {
    const [recentRows, windowRows] = (await Promise.all([
      sql`
        SELECT id, email, subject, sent_at
          FROM campaign_sends
         ORDER BY sent_at DESC NULLS LAST, id DESC
         LIMIT ${limit}
      `,
      // Window starts at local (store timezone) midnight, windowDays days ago.
      sql`
        SELECT count(*)::int AS n
          FROM campaign_sends
         WHERE sent_at >= (((now() AT TIME ZONE ${ADMIN_TIME_ZONE})::date - ${windowDays - 1}::int)::timestamp
                           AT TIME ZONE ${ADMIN_TIME_ZONE})
      `,
    ])) as [Array<Record<string, unknown>>, Array<{ n: number }>];
    return {
      recentSends: recentRows.map((r) => ({
        id: Number(r.id),
        email: String(r.email),
        subject: (r.subject as string | null) ?? null,
        sentAt: toIso(r.sent_at),
        source: "campaign" as const,
      })),
      sentInWindow: Number(windowRows[0]?.n ?? 0),
    };
  } catch (err) {
    reportError(err, { route: "lib/admin-overview-store", phase: "campaignActivity" });
    return { recentSends: [], sentInWindow: 0 };
  }
}

async function running(sql: Sql): Promise<OverviewRunning> {
  try {
    const rows = (await sql`
      SELECT
        (SELECT count(*) FROM analytics_reports WHERE status = 'running')::int AS reports,
        (SELECT count(*) FROM improvement_runs WHERE status = 'running')::int AS runs
    `) as Array<{ reports: number; runs: number }>;
    return {
      reports: Number(rows[0]?.reports ?? 0),
      improvementRuns: Number(rows[0]?.runs ?? 0),
    };
  } catch (err) {
    reportError(err, { route: "lib/admin-overview-store", phase: "running" });
    return { reports: 0, improvementRuns: 0 };
  }
}

/**
 * Everything the Übersicht shows, gathered in parallel. Returns null only when
 * no database is configured.
 */
export async function getOverviewSnapshot(
  { windowDays = 30, limit = 5 }: { windowDays?: number; limit?: number } = {},
  sql: Sql | null = getSql()
): Promise<OverviewSnapshot | null> {
  if (!sql) return null;
  const days = Number.isFinite(windowDays) && windowDays > 0 ? Math.floor(windowDays) : 30;
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;

  const [
    core,
    aiCost,
    marketing,
    confirmed,
    campaign,
    marketingActivity,
    campaignCounts,
    qaCounts,
    unmatchedInbound,
    runningNow,
  ] = await Promise.all([
    getCoreMetrics(resolveKpiRange({ kpiRange: `${days}d` }), sql),
    getAiCostMetrics(null, sql),
    marketingSummary(sql),
    recentConfirmed(sql, cap),
    campaignActivity(sql, days, cap),
    getMarketingActivity({ windowDays: days, limit: cap }, sql),
    getCampaignCounts(sql),
    getQaCounts(sql),
    countUnmatchedInbound(sql),
    running(sql),
  ]);

  return {
    windowDays: days,
    core,
    aiCost,
    marketing,
    recentConfirmed: confirmed,
    campaignActivity: campaign,
    marketingActivity,
    campaignCounts,
    qaCounts,
    unmatchedInbound,
    running: runningNow,
  };
}
