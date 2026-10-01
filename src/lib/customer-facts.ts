// The facts job (I/O around lib/customer-facts-core.mjs).
//
// Recomputes customer_facts in batches: dirty customers first (an order, chat,
// send or mail changed something), then everyone whose facts are older than a
// day (lifecycle segment and churn risk move with the calendar). Zero tokens;
// a few aggregate queries per batch of 500. Run by the nightly
// /api/cron/shopify-reconcile and after the bulk import (Einstellungen →
// Shopify-Abgleich). docs/CUSTOMER_PLATFORM_PLAN.md §6.4.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { loadProductCatalog } from "./product-catalog";
import { listOrdersForCustomers } from "./customer-orders-store";
import { computeCustomerFacts } from "./customer-facts-core.mjs";
import { parseProductRef } from "./product-ref.mjs";

const BATCH = 500;
const DAY_MS = 86_400_000;

type CatalogMap = Record<string, { category: string | null; compatibleWith: string[] }>;

async function catalogMap(): Promise<CatalogMap> {
  try {
    const catalog = await loadProductCatalog();
    const out: CatalogMap = {};
    for (const p of catalog) {
      out[p.id] = { category: p.category ?? null, compatibleWith: Array.isArray(p.compatibleWith) ? p.compatibleWith : [] };
    }
    return out;
  } catch {
    return {};
  }
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function computeBatch(sql: Sql, ids: number[], catalog: CatalogMap, now: Date): Promise<number> {
  const since90 = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const since365 = new Date(now.getTime() - 365 * DAY_MS).toISOString();
  const [orders, chats, sends, mails] = await Promise.all([
    listOrdersForCustomers(ids, sql),
    sql`
      SELECT customer_id, last_activity_at, recommended_product_ids, selected_product_ids
        FROM conversations WHERE customer_id = ANY(${ids}::bigint[])
    ` as Promise<Array<Record<string, unknown>>>,
    sql`
      SELECT customer_id, sent_at, clicked_at, discount_code
        FROM campaign_sends WHERE customer_id = ANY(${ids}::bigint[]) AND is_test = false
      UNION ALL
      SELECT customer_id, sent_at, clicked_at, discount_code
        FROM marketing_sends WHERE customer_id = ANY(${ids}::bigint[]) AND status = 'sent'
    ` as Promise<Array<Record<string, unknown>>>,
    sql`
      SELECT customer_id, direction, occurred_at, COALESCE(thread_id, message_id, id::text) AS thread
        FROM email_messages
       WHERE customer_id = ANY(${ids}::bigint[]) AND occurred_at >= ${since365}
       ORDER BY occurred_at ASC
    ` as Promise<Array<Record<string, unknown>>>,
  ]);

  const chatAgg = new Map<number, { count: number; lastAt: string | null; discussed: string[]; selected: string[] }>();
  for (const c of chats) {
    const id = Number(c.customer_id);
    const agg = chatAgg.get(id) ?? { count: 0, lastAt: null, discussed: [], selected: [] };
    agg.count++;
    const last = toIso(c.last_activity_at);
    if (last && (!agg.lastAt || last > agg.lastAt)) agg.lastAt = last;
    if (last && last >= since90) {
      for (const h of (c.recommended_product_ids as string[] | null) ?? []) agg.discussed.push(parseProductRef(h).productId);
      for (const h of (c.selected_product_ids as string[] | null) ?? []) agg.selected.push(parseProductRef(h).productId);
    }
    chatAgg.set(id, agg);
  }

  const sendAgg = new Map<number, { sentCount: number; lastSentAt: string | null; lastClickAt: string | null; clicks90d: number; codes: Set<string> }>();
  for (const s of sends) {
    const id = Number(s.customer_id);
    const agg = sendAgg.get(id) ?? { sentCount: 0, lastSentAt: null, lastClickAt: null, clicks90d: 0, codes: new Set<string>() };
    agg.sentCount++;
    const sent = toIso(s.sent_at);
    const clicked = toIso(s.clicked_at);
    if (sent && (!agg.lastSentAt || sent > agg.lastSentAt)) agg.lastSentAt = sent;
    if (clicked && (!agg.lastClickAt || clicked > agg.lastClickAt)) agg.lastClickAt = clicked;
    if (clicked && clicked >= since90) agg.clicks90d++;
    if (s.discount_code) agg.codes.add(String(s.discount_code).toUpperCase());
    sendAgg.set(id, agg);
  }

  const mailAgg = new Map<number, { lastInboundAt: string | null; unanswered: number }>();
  const threadState = new Map<string, { customerId: number; lastReceived: string | null; lastSent: string | null }>();
  for (const m of mails) {
    const id = Number(m.customer_id);
    const key = `${id}:${String(m.thread)}`;
    const st = threadState.get(key) ?? { customerId: id, lastReceived: null, lastSent: null };
    const at = toIso(m.occurred_at);
    if (m.direction === "received") st.lastReceived = at;
    else st.lastSent = at;
    threadState.set(key, st);
  }
  for (const st of threadState.values()) {
    const agg = mailAgg.get(st.customerId) ?? { lastInboundAt: null, unanswered: 0 };
    if (st.lastReceived && (!agg.lastInboundAt || st.lastReceived > agg.lastInboundAt)) agg.lastInboundAt = st.lastReceived;
    if (st.lastReceived && (!st.lastSent || st.lastSent < st.lastReceived)) agg.unanswered++;
    mailAgg.set(st.customerId, agg);
  }

  const rows = ids.map((id) => {
    const ledger = orders.get(id) ?? [];
    const send = sendAgg.get(id);
    const orderCodes = new Set(ledger.flatMap((o) => o.discountCodes.map((c) => c.toUpperCase())));
    const redemptions = send ? [...send.codes].filter((c) => orderCodes.has(c)).length : 0;
    const f = computeCustomerFacts({
      orders: ledger.map((o) => ({
        processedAt: o.processedAt,
        totalCents: o.totalCents,
        refundedCents: o.refundedCents,
        financialStatus: o.financialStatus,
        cancelledAt: o.cancelledAt,
        discountCodes: o.discountCodes,
        lineItems: o.lineItems.map((li) => ({ handle: li.handle ?? null, quantity: li.quantity, unitPrice: li.unitPrice ?? null })),
      })),
      chats: chatAgg.get(id),
      marketing: send
        ? { sentCount: send.sentCount, lastSentAt: send.lastSentAt, lastClickAt: send.lastClickAt, clicks90d: send.clicks90d, redemptions }
        : undefined,
      service: mailAgg.get(id),
      catalog,
      now,
    });
    return {
      customer_id: id,
      orders_count: f.ordersCount,
      total_spent_cents: f.totalSpentCents,
      first_order_at: f.firstOrderAt,
      last_order_at: f.lastOrderAt,
      aov_cents: f.aovCents,
      median_interval_days: f.medianIntervalDays,
      expected_next_order_at: f.expectedNextOrderAt,
      refunds_count: f.refundsCount,
      discount_order_share: f.discountOrderShare,
      lifecycle_segment: f.lifecycleSegment,
      value_tier: f.valueTier,
      rfm_r: f.rfmR,
      rfm_f: f.rfmF,
      rfm_m: f.rfmM,
      churn_risk: f.churnRisk,
      bought_handles: f.boughtHandles,
      bought_categories: f.boughtCategories,
      complement_handles: f.complementHandles,
      conversations_count: f.conversationsCount,
      last_chat_at: f.lastChatAt,
      discussed_handles: f.discussedHandles,
      selected_handles: f.selectedHandles,
      emails_sent_count: f.emailsSentCount,
      last_marketing_at: f.lastMarketingAt,
      last_click_at: f.lastClickAt,
      clicks_90d: f.clicks90d,
      redemptions_count: f.redemptionsCount,
      last_inbound_at: f.lastInboundAt,
      unanswered_inbound_count: f.unansweredInboundCount,
      last_activity_at: f.lastActivityAt,
    };
  });

  await sql.transaction([
    sql`
      INSERT INTO customer_facts (
        customer_id, computed_at, orders_count, total_spent_cents, first_order_at, last_order_at, aov_cents,
        median_interval_days, expected_next_order_at, refunds_count, discount_order_share, lifecycle_segment,
        value_tier, rfm_r, rfm_f, rfm_m, churn_risk, bought_handles, bought_categories, complement_handles,
        conversations_count, last_chat_at, discussed_handles, selected_handles, emails_sent_count,
        last_marketing_at, last_click_at, clicks_90d, redemptions_count, last_inbound_at,
        unanswered_inbound_count, last_activity_at)
      SELECT x.customer_id, now(), x.orders_count, x.total_spent_cents, x.first_order_at, x.last_order_at, x.aov_cents,
             x.median_interval_days, x.expected_next_order_at, x.refunds_count, x.discount_order_share, x.lifecycle_segment,
             x.value_tier, x.rfm_r, x.rfm_f, x.rfm_m, x.churn_risk, COALESCE(x.bought_handles, '{}'),
             COALESCE(x.bought_categories, '{}'), COALESCE(x.complement_handles, '{}'),
             x.conversations_count, x.last_chat_at, COALESCE(x.discussed_handles, '{}'), COALESCE(x.selected_handles, '{}'),
             x.emails_sent_count, x.last_marketing_at, x.last_click_at, x.clicks_90d, x.redemptions_count,
             x.last_inbound_at, x.unanswered_inbound_count, x.last_activity_at
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
          customer_id bigint, orders_count int, total_spent_cents bigint, first_order_at timestamptz,
          last_order_at timestamptz, aov_cents bigint, median_interval_days int, expected_next_order_at timestamptz,
          refunds_count int, discount_order_share real, lifecycle_segment text, value_tier text, rfm_r smallint,
          rfm_f smallint, rfm_m smallint, churn_risk text, bought_handles text[], bought_categories text[],
          complement_handles text[], conversations_count int, last_chat_at timestamptz, discussed_handles text[],
          selected_handles text[], emails_sent_count int, last_marketing_at timestamptz, last_click_at timestamptz,
          clicks_90d int, redemptions_count int, last_inbound_at timestamptz, unanswered_inbound_count int,
          last_activity_at timestamptz)
       WHERE EXISTS (SELECT 1 FROM customers c WHERE c.id = x.customer_id)
      ON CONFLICT (customer_id) DO UPDATE SET
        computed_at = now(),
        orders_count = EXCLUDED.orders_count,
        total_spent_cents = EXCLUDED.total_spent_cents,
        first_order_at = EXCLUDED.first_order_at,
        last_order_at = EXCLUDED.last_order_at,
        aov_cents = EXCLUDED.aov_cents,
        median_interval_days = EXCLUDED.median_interval_days,
        expected_next_order_at = EXCLUDED.expected_next_order_at,
        refunds_count = EXCLUDED.refunds_count,
        discount_order_share = EXCLUDED.discount_order_share,
        lifecycle_segment = EXCLUDED.lifecycle_segment,
        value_tier = EXCLUDED.value_tier,
        rfm_r = EXCLUDED.rfm_r,
        rfm_f = EXCLUDED.rfm_f,
        rfm_m = EXCLUDED.rfm_m,
        churn_risk = EXCLUDED.churn_risk,
        bought_handles = EXCLUDED.bought_handles,
        bought_categories = EXCLUDED.bought_categories,
        complement_handles = EXCLUDED.complement_handles,
        conversations_count = EXCLUDED.conversations_count,
        last_chat_at = EXCLUDED.last_chat_at,
        discussed_handles = EXCLUDED.discussed_handles,
        selected_handles = EXCLUDED.selected_handles,
        emails_sent_count = EXCLUDED.emails_sent_count,
        last_marketing_at = EXCLUDED.last_marketing_at,
        last_click_at = EXCLUDED.last_click_at,
        clicks_90d = EXCLUDED.clicks_90d,
        redemptions_count = EXCLUDED.redemptions_count,
        last_inbound_at = EXCLUDED.last_inbound_at,
        unanswered_inbound_count = EXCLUDED.unanswered_inbound_count,
        last_activity_at = EXCLUDED.last_activity_at
    `,
    sql`UPDATE customers SET facts_dirty_at = NULL
         WHERE id = ANY(${ids}::bigint[]) AND facts_dirty_at IS NOT NULL AND facts_dirty_at <= ${now.toISOString()}`,
  ]);
  return rows.length;
}

export interface FactsRunResult {
  computed: number;
  batches: number;
  remaining: number;
  stoppedByDeadline: boolean;
}

/**
 * Recompute facts until the deadline: dirty customers first, then everyone
 * computed more than 20 hours ago (or never). Never throws.
 */
export async function recomputeCustomerFacts(
  opts: { deadlineMs: number; maxBatches?: number; customerIds?: number[] },
  sql: Sql | null = getSql()
): Promise<FactsRunResult> {
  const out: FactsRunResult = { computed: 0, batches: 0, remaining: 0, stoppedByDeadline: false };
  if (!sql) return out;
  try {
    const catalog = await catalogMap();
    if (opts.customerIds && opts.customerIds.length > 0) {
      for (let i = 0; i < opts.customerIds.length; i += BATCH) {
        out.computed += await computeBatch(sql, opts.customerIds.slice(i, i + BATCH), catalog, new Date());
        out.batches++;
      }
      return out;
    }
    const maxBatches = opts.maxBatches ?? 200;
    while (out.batches < maxBatches) {
      if (Date.now() > opts.deadlineMs) {
        out.stoppedByDeadline = true;
        break;
      }
      const stale = new Date(Date.now() - 20 * 3_600_000).toISOString();
      const rows = (await sql`
        SELECT c.id FROM customers c
          LEFT JOIN customer_facts f ON f.customer_id = c.id
         WHERE c.facts_dirty_at IS NOT NULL OR f.customer_id IS NULL OR f.computed_at < ${stale}
         ORDER BY (c.facts_dirty_at IS NULL), c.facts_dirty_at, f.computed_at NULLS FIRST, c.id
         LIMIT ${BATCH}
      `) as Array<{ id: number }>;
      if (rows.length === 0) break;
      out.computed += await computeBatch(sql, rows.map((r) => Number(r.id)), catalog, new Date());
      out.batches++;
    }
    const remaining = (await sql`
      SELECT count(*)::int AS n FROM customers c LEFT JOIN customer_facts f ON f.customer_id = c.id
       WHERE c.facts_dirty_at IS NOT NULL OR f.customer_id IS NULL OR f.computed_at < now() - interval '20 hours'
    `) as Array<{ n: number }>;
    out.remaining = Number(remaining[0]?.n ?? 0);
  } catch (err) {
    reportError(err, { route: "lib/customer-facts", phase: "recomputeCustomerFacts" });
  }
  return out;
}
