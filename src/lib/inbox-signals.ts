// The Eingang job (I/O): load the facts the rules need, let the pure core
// decide (lib/customer-signals.mjs), upsert the items by dedupe key, close
// the ones whose rule stopped firing, expire old ones, fill the 14-day
// outcome of decided items and — within INBOX_AI_DAILY_LIMIT — write AI
// suggestions for the newest customer items. Runs hourly from
// /api/cron/inbox; never sends anything. docs/CUSTOMER_PLATFORM_PLAN.md §11.4.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import {
  JOB_SIGNAL_KINDS,
  bounceSignal,
  capSignals,
  dissatisfiedSignal,
  offerExpiringSignal,
  signalsForCustomer,
} from "./customer-signals.mjs";
import { closeStaleInboxItems, expireInboxItems, reopenDueSnoozed, upsertInboxItems, type InboxItemInput } from "./inbox-store";
import { inboxAiDailyLimit } from "./platform-flags.mjs";
import { suggestForInboxItems } from "./inbox-suggest";

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
const MAX_CANDIDATES = 20_000;

/** Total-spend threshold of the top 1 % (null below 200 buyers — not meaningful). */
async function topPercentileCents(sql: Sql): Promise<number | null> {
  const rows = (await sql`
    SELECT count(*)::int AS n,
           percentile_cont(0.99) WITHIN GROUP (ORDER BY total_spent_cents) AS p99
      FROM customer_facts WHERE orders_count > 0
  `) as Array<{ n: number; p99: number | null }>;
  const r = rows[0];
  return r && Number(r.n) >= 200 && r.p99 != null ? Math.round(Number(r.p99)) : null;
}

async function factSignals(sql: Sql, now: Date): Promise<InboxItemInput[]> {
  const p99 = await topPercentileCents(sql);
  const rows = (await sql`
    SELECT o.customer_id, o.email_consent_state, o.blocked, o.orders_count, o.total_spent_cents,
           o.last_order_at, o.median_interval_days, o.value_tier, o.conversations_count, o.last_chat_at,
           COALESCE(f.selected_handles, '{}') AS selected_handles,
           COALESCE(f.discussed_handles, '{}') AS discussed_handles,
           o.last_click_at, o.last_marketing_at, o.last_inbound_at, o.unanswered_inbound_count,
           (SELECT co.total_cents FROM customer_orders co
             WHERE co.customer_id = o.customer_id AND co.cancelled_at IS NULL
             ORDER BY co.processed_at DESC LIMIT 1) AS last_order_cents,
           (SELECT count(*) FROM customer_orders co
             WHERE co.customer_id = o.customer_id AND co.cancelled_at IS NULL
               AND co.processed_at > now() - interval '365 days')::int AS orders_12m,
           (SELECT max(co.total_cents) FROM customer_orders co
             WHERE co.customer_id = o.customer_id AND co.cancelled_at IS NULL
               AND co.processed_at > now() - interval '14 days') AS recent_big,
           (${p99}::bigint IS NOT NULL AND o.total_spent_cents >= ${p99}::bigint) AS top,
           EXISTS (
             SELECT 1 FROM campaign_contacts cc JOIN campaigns k ON k.id = cc.campaign_id
              WHERE cc.customer_id = o.customer_id AND cc.is_test = false AND k.status = 'aktiv'
                AND cc.status IN ('pending', 'drafted', 'sending')
           ) AS in_open_campaign
      FROM customer_overview o
      LEFT JOIN customer_facts f ON f.customer_id = o.customer_id
     WHERE NOT o.blocked
       AND (o.unanswered_inbound_count > 0
            OR o.last_chat_at > now() - interval '8 days'
            OR o.last_click_at > now() - interval '4 days'
            OR o.last_order_at > now() - interval '31 days'
            OR o.orders_count >= 3
            OR (o.value_tier IN ('komponente', 'grossgeraet')
                AND o.last_order_at BETWEEN now() - interval '731 days' AND now() - interval '179 days')
            OR (${p99}::bigint IS NOT NULL AND o.total_spent_cents >= ${p99}::bigint)
            OR (o.email_consent_state NOT IN ('subscribed', 'unsubscribed')
                AND (o.conversations_count > 0 OR o.orders_count >= 2)))
     LIMIT ${MAX_CANDIDATES}
  `) as Array<Record<string, unknown>>;
  const out: InboxItemInput[] = [];
  for (const r of rows) {
    out.push(
      ...(signalsForCustomer(
        {
          customerId: Number(r.customer_id),
          consentState: String(r.email_consent_state ?? "not_subscribed"),
          blocked: r.blocked === true,
          ordersCount: Number(r.orders_count ?? 0),
          totalSpentCents: Number(r.total_spent_cents ?? 0),
          lastOrderAt: iso(r.last_order_at),
          lastOrderCents: r.last_order_cents == null ? null : Number(r.last_order_cents),
          medianIntervalDays: r.median_interval_days == null ? null : Number(r.median_interval_days),
          valueTier: (r.value_tier as string | null) ?? null,
          conversationsCount: Number(r.conversations_count ?? 0),
          lastChatAt: iso(r.last_chat_at),
          selectedHandles: (r.selected_handles as string[]) ?? [],
          discussedHandles: (r.discussed_handles as string[]) ?? [],
          lastClickAt: iso(r.last_click_at),
          lastMarketingAt: iso(r.last_marketing_at),
          lastInboundAt: iso(r.last_inbound_at),
          unansweredInboundCount: Number(r.unanswered_inbound_count ?? 0),
          ordersLast12m: Number(r.orders_12m ?? 0),
          topPercentile: r.top === true,
          inOpenCampaign: r.in_open_campaign === true,
          recentBigOrderCents: r.recent_big == null ? null : Number(r.recent_big),
        },
        now
      ) as InboxItemInput[])
    );
  }
  return out;
}

async function eventSignals(sql: Sql, now: Date): Promise<InboxItemInput[]> {
  const [offers, refunds, bounces] = (await Promise.all([
    sql`
      SELECT s.id, s.customer_id, k.name AS campaign_name,
             LEAST(CASE WHEN s.discount_code IS NOT NULL THEN s.discount_expires_at END, b.expires_at) AS ends_at,
             (b.expires_at IS NOT NULL
              AND (s.discount_code IS NULL OR b.expires_at <= s.discount_expires_at)) AS is_set
        FROM campaign_sends s
        LEFT JOIN bundle_offers b ON b.id = s.bundle_offer_id
        LEFT JOIN campaigns k ON k.id = s.campaign_id
        JOIN customer_overview o ON o.customer_id = s.customer_id
       WHERE s.is_test = false
         AND (s.clicked_at IS NOT NULL OR s.bundle_clicked_at IS NOT NULL)
         AND o.email_consent_state = 'subscribed' AND NOT o.blocked
         AND LEAST(CASE WHEN s.discount_code IS NOT NULL THEN s.discount_expires_at END, b.expires_at)
             BETWEEN now() AND now() + interval '48 hours'
         AND NOT (s.discount_code IS NOT NULL AND EXISTS (
               SELECT 1 FROM customer_orders co WHERE co.discount_codes @> ARRAY[s.discount_code]))
         AND NOT EXISTS (
               SELECT 1 FROM customer_orders co WHERE co.customer_id = s.customer_id AND co.processed_at > s.sent_at)
       LIMIT 500
    `,
    sql`
      SELECT co.customer_id, co.order_name, (co.cancelled_at IS NOT NULL) AS cancelled, co.refunded_cents,
             COALESCE(co.cancelled_at, co.shopify_updated_at, co.processed_at) AS at
        FROM customer_orders co
        JOIN customer_overview o ON o.customer_id = co.customer_id
       WHERE NOT o.blocked
         AND (co.cancelled_at > now() - interval '14 days'
              OR (co.refunded_cents > 0 AND co.shopify_updated_at > now() - interval '14 days'))
       LIMIT 500
    `,
    sql`
      SELECT o.customer_id, s.added_at
        FROM customer_overview o
        JOIN suppression_list s ON s.email = o.email
       WHERE s.reason = 'bounce' AND o.last_order_at > now() - interval '365 days'
       LIMIT 200
    `,
  ])) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>, Array<Record<string, unknown>>];
  const out: InboxItemInput[] = [];
  for (const r of offers) {
    if (!r.ends_at || r.customer_id == null) continue;
    out.push(
      offerExpiringSignal(
        {
          customerId: Number(r.customer_id),
          sendId: Number(r.id),
          campaignName: (r.campaign_name as string | null) ?? null,
          endsAt: iso(r.ends_at) as string,
          kind: r.is_set === true ? "set" : "code",
        },
        now
      ) as InboxItemInput
    );
  }
  for (const r of refunds) {
    out.push(
      dissatisfiedSignal({
        customerId: Number(r.customer_id),
        orderName: (r.order_name as string | null) ?? null,
        cancelled: r.cancelled === true,
        refundedCents: Number(r.refunded_cents ?? 0),
        at: iso(r.at) ?? now.toISOString(),
      }) as InboxItemInput
    );
  }
  for (const r of bounces) {
    out.push(bounceSignal({ customerId: Number(r.customer_id), bouncedAt: iso(r.added_at) ?? now.toISOString() }) as InboxItemInput);
  }
  return out;
}

/** 14 days after a decision: did the person get a mail, order, spend? */
async function fillOutcomes(sql: Sql): Promise<number> {
  const rows = (await sql`
    WITH due AS (
      SELECT i.id, i.customer_id, i.decided_at
        FROM inbox_items i
       WHERE i.status IN ('erledigt', 'verworfen')
         AND i.customer_id IS NOT NULL
         AND i.outcome IS NULL
         AND i.decided_at < now() - interval '14 days'
         AND i.decided_at > now() - interval '60 days'
       LIMIT 500
    ),
    upd AS (
      UPDATE inbox_items i
         SET outcome = jsonb_build_object(
               'mailSent', EXISTS (SELECT 1 FROM campaign_sends s
                                    WHERE s.customer_id = d.customer_id AND s.is_test = false
                                      AND s.sent_at BETWEEN d.decided_at AND d.decided_at + interval '14 days'),
               'orders', (SELECT count(*) FROM customer_orders co
                           WHERE co.customer_id = d.customer_id AND co.cancelled_at IS NULL
                             AND co.processed_at BETWEEN d.decided_at AND d.decided_at + interval '14 days'),
               'revenueCents', (SELECT COALESCE(sum(co.total_cents), 0) FROM customer_orders co
                                 WHERE co.customer_id = d.customer_id AND co.cancelled_at IS NULL
                                   AND co.processed_at BETWEEN d.decided_at AND d.decided_at + interval '14 days')),
             outcome_checked_at = now()
        FROM due d
       WHERE i.id = d.id
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM upd
  `) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

export interface InboxRunResult {
  candidates: number;
  created: number;
  closed: number;
  expired: number;
  outcomes: number;
  suggested: number;
}

/** One run of the Eingang job. Never throws. */
export async function runInboxSignals(
  opts: { now?: Date; suggest?: boolean; deadlineMs?: number } = {},
  sql: Sql | null = getSql()
): Promise<InboxRunResult> {
  const out: InboxRunResult = { candidates: 0, created: 0, closed: 0, expired: 0, outcomes: 0, suggested: 0 };
  if (!sql) return out;
  const now = opts.now ?? new Date();
  try {
    const items = capSignals([...(await factSignals(sql, now)), ...(await eventSignals(sql, now))]);
    out.candidates = items.length;
    for (let i = 0; i < items.length; i += 500) {
      out.created += await upsertInboxItems(items.slice(i, i + 500), sql);
    }
    out.closed = await closeStaleInboxItems([...JOB_SIGNAL_KINDS], items.map((i) => i.dedupeKey), sql);
    out.expired = await expireInboxItems(sql);
    await reopenDueSnoozed(sql);
    out.outcomes = await fillOutcomes(sql);
    if (opts.suggest !== false) {
      out.suggested = await suggestForInboxItems({ limit: inboxAiDailyLimit(), deadlineMs: opts.deadlineMs }, sql);
    }
  } catch (err) {
    reportError(err, { route: "lib/inbox-signals", phase: "runInboxSignals" });
  }
  return out;
}
