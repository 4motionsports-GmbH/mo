// The system figures on top of the Eingang (the former Übersicht „Heute“):
// a 30-day strip — chats, campaign mails, new sign-ups to the one consent —
// plus the Wissen queue and running background jobs. Pure DB, a handful of
// COUNT queries, never a Shopify round-trip. Fail-soft: a failing query logs
// and degrades to null / 0.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { getQaCounts } from "./qa-store";
import { ADMIN_TIME_ZONE } from "./admin-datetime.mjs";

export interface EingangSystemSnapshot {
  windowDays: number;
  /** Conversations started in the window (null when the query failed). */
  chats: number | null;
  /** Campaign mails sent in the window (test sends excluded). */
  campaignMails: number;
  /** People who signed up to the one consent in the window (any surface; backfill excluded). */
  newSubscribers: number;
  qaOpen: number;
  runningReports: number;
  runningImprovementRuns: number;
}

export async function getEingangSystemSnapshot(
  { windowDays = 30 }: { windowDays?: number } = {},
  sql: Sql | null = getSql()
): Promise<EingangSystemSnapshot | null> {
  if (!sql) return null;
  const days = Number.isFinite(windowDays) && windowDays > 0 ? Math.floor(windowDays) : 30;
  try {
    // The window starts at local (store timezone) midnight, `days` days ago.
    const [counts, qa] = await Promise.all([
      sql`
        WITH w AS (
          SELECT (((now() AT TIME ZONE ${ADMIN_TIME_ZONE})::date - ${days - 1}::int)::timestamp
                  AT TIME ZONE ${ADMIN_TIME_ZONE}) AS start
        )
        SELECT
          (SELECT count(*) FROM conversations, w WHERE created_at >= w.start)::int AS chats,
          (SELECT count(*) FROM campaign_sends, w WHERE is_test = false AND sent_at >= w.start)::int AS mails,
          (SELECT count(DISTINCT customer_id) FROM consent_events, w
            WHERE state = 'subscribed' AND occurred_at >= w.start
              AND COALESCE(origin_ref, '') <> 'import')::int AS subscribers,
          (SELECT count(*) FROM analytics_reports WHERE status = 'running')::int AS reports,
          (SELECT count(*) FROM improvement_runs WHERE status = 'running')::int AS runs
      ` as Promise<Array<Record<string, number>>>,
      getQaCounts(sql),
    ]);
    const c = counts[0] ?? {};
    return {
      windowDays: days,
      chats: Number(c.chats ?? 0),
      campaignMails: Number(c.mails ?? 0),
      newSubscribers: Number(c.subscribers ?? 0),
      qaOpen: qa.open,
      runningReports: Number(c.reports ?? 0),
      runningImprovementRuns: Number(c.runs ?? 0),
    };
  } catch (err) {
    reportError(err, { route: "lib/admin-overview-store", phase: "eingangSnapshot" });
    return null;
  }
}
