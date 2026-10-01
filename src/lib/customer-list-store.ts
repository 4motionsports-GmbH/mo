// The Kunden list — server-side over the whole customer base (I/O).
//
// One spelled-out query over the customer_overview view (0068). Every filter
// is a nullable parameter (lib/admin-customer-filter.mjs builds the tuple), so
// the query is never composed from fragments (CLAUDE.md hard rule). The total
// comes from the same query (count(*) OVER ()), so list and count can never
// disagree. Pure DB, no Shopify call. docs/CUSTOMER_PLATFORM_PLAN.md §9.2.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { customerQueryParams, type CustomerFilter } from "./admin-customer-filter.mjs";
import type { ConsentState, ConsentLevel } from "./consent-core.mjs";

export interface CustomerListItem {
  id: number;
  email: string;
  name: string | null;
  source: string;
  isShopifyCustomer: boolean;
  personaLabel: string | null;
  profileDepth: "kauf" | "voll" | null;
  consentState: ConsentState;
  consentLevel: ConsentLevel | null;
  blocked: boolean;
  blockReason: string | null;
  ordersCount: number;
  totalSpentCents: number;
  lastOrderAt: string | null;
  lifecycleSegment: string | null;
  valueTier: string | null;
  churnRisk: string | null;
  conversationsCount: number;
  lastChatAt: string | null;
  lastActivityAt: string | null;
  openTasks: number;
  topTaskPriority: number | null;
}

export interface CustomerListPage {
  items: CustomerListItem[];
  total: number;
}

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

function mapItem(r: Record<string, unknown>): CustomerListItem {
  return {
    id: Number(r.customer_id),
    email: String(r.email),
    name: (r.display_name as string | null) ?? null,
    source: String(r.source ?? "chat"),
    isShopifyCustomer: r.is_shopify_customer === true,
    personaLabel: (r.persona_label as string | null) ?? null,
    profileDepth: (r.profile_depth as "kauf" | "voll" | null) ?? null,
    consentState: (r.email_consent_state as ConsentState) ?? "not_subscribed",
    consentLevel: (r.email_consent_level as ConsentLevel | null) ?? null,
    blocked: r.blocked === true,
    blockReason: (r.block_reason as string | null) ?? null,
    ordersCount: Number(r.orders_count ?? 0),
    totalSpentCents: Number(r.total_spent_cents ?? 0),
    lastOrderAt: iso(r.last_order_at),
    lifecycleSegment: (r.lifecycle_segment as string | null) ?? null,
    valueTier: (r.value_tier as string | null) ?? null,
    churnRisk: (r.churn_risk as string | null) ?? null,
    conversationsCount: Number(r.conversations_count ?? 0),
    lastChatAt: iso(r.last_chat_at),
    lastActivityAt: iso(r.last_activity_at),
    openTasks: Number(r.open_tasks_count ?? 0),
    topTaskPriority: r.top_task_priority == null ? null : Number(r.top_task_priority),
  };
}

/** One page of the Kunden list for a filter. Never throws. */
export async function listCustomers(filter: CustomerFilter, sql: Sql | null = getSql()): Promise<CustomerListPage> {
  if (!sql) return { items: [], total: 0 };
  const p = customerQueryParams(filter);
  try {
    const rows = (await sql`
      SELECT o.customer_id, o.email, o.display_name, o.source, o.is_shopify_customer, o.persona_label,
             o.profile_depth, o.email_consent_state, o.email_consent_level, o.blocked, o.block_reason,
             o.orders_count, o.total_spent_cents, o.last_order_at, o.lifecycle_segment, o.value_tier,
             o.churn_risk, o.conversations_count, o.last_chat_at, o.last_activity_at,
             o.open_tasks_count, o.top_task_priority,
             count(*) OVER () AS total
        FROM customer_overview o
       WHERE (${p.q}::text IS NULL
              OR lower(o.email) LIKE ${p.q}
              OR lower(COALESCE(o.display_name, '')) LIKE ${p.q})
         AND (${p.mo}::text IS NULL OR (${p.mo} = 'yes') = (o.conversations_count > 0))
         AND (${p.consent}::text IS NULL
              OR (${p.consent} = 'blocked' AND o.blocked)
              OR (${p.consent} <> 'blocked' AND o.email_consent_state = ${p.consent}
                  AND NOT (${p.consent} = 'subscribed' AND o.blocked)))
         AND (${p.segment}::text IS NULL
              OR (${p.segment} = 'keine_bestellung' AND o.orders_count = 0)
              OR o.lifecycle_segment = ${p.segment})
         AND (${p.value}::text IS NULL OR o.value_tier = ${p.value})
         AND (${p.persona}::text IS NULL
              OR (${p.persona} = 'unknown' AND o.persona_label IS NULL)
              OR o.persona_label = ${p.persona})
         AND (${p.shop}::text IS NULL OR (${p.shop} = 'shopify') = o.is_shopify_customer)
         AND (${p.churn}::text IS NULL OR o.churn_risk = ${p.churn})
         AND (${p.tasks}::boolean IS NULL OR o.open_tasks_count > 0)
         AND (${p.newSince}::timestamptz IS NULL OR COALESCE(o.shopify_created_at, o.created_at) >= ${p.newSince})
         AND (${p.minSpentCents}::bigint IS NULL OR o.total_spent_cents >= ${p.minSpentCents})
         AND (${p.activeNoConsent}::boolean IS NULL
              OR (o.email_consent_state <> 'subscribed' AND NOT o.blocked
                  AND (o.orders_count >= 2 OR o.conversations_count > 0)))
       ORDER BY
         CASE WHEN ${p.sort} = 'revenue' THEN o.total_spent_cents END DESC NULLS LAST,
         CASE WHEN ${p.sort} = 'orders' THEN o.orders_count END DESC NULLS LAST,
         CASE WHEN ${p.sort} = 'last_order' THEN o.last_order_at END DESC NULLS LAST,
         CASE WHEN ${p.sort} = 'name' THEN lower(COALESCE(o.display_name, o.email)) END ASC,
         CASE WHEN ${p.sort} = 'created' THEN COALESCE(o.shopify_created_at, o.created_at) END DESC,
         o.last_activity_at DESC NULLS LAST,
         o.customer_id DESC
       LIMIT ${p.limit} OFFSET ${p.offset}
    `) as Array<Record<string, unknown>>;
    return { items: rows.map(mapItem), total: rows.length > 0 ? Number(rows[0].total) : 0 };
  } catch (err) {
    reportError(err, { route: "lib/customer-list-store", phase: "listCustomers" });
    return { items: [], total: 0 };
  }
}

export interface CustomerBaseSummary {
  total: number;
  shopifyCustomers: number;
  leads: number;
  withMo: number;
  subscribed: number;
  withOpenTasks: number;
  factsComputed: number;
}

/** Header numbers of the Kunden screen. Never throws. */
export async function getCustomerBaseSummary(sql: Sql | null = getSql()): Promise<CustomerBaseSummary | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE is_shopify_customer)::int AS shopify,
             count(*) FILTER (WHERE NOT is_shopify_customer)::int AS leads,
             count(*) FILTER (WHERE conversations_count > 0)::int AS mo,
             count(*) FILTER (WHERE email_consent_state = 'subscribed' AND NOT blocked)::int AS subscribed,
             count(*) FILTER (WHERE open_tasks_count > 0)::int AS tasks,
             count(*) FILTER (WHERE facts_computed_at IS NOT NULL)::int AS facts
        FROM customer_overview
    `) as Array<Record<string, unknown>>;
    const r = rows[0] ?? {};
    return {
      total: Number(r.total ?? 0),
      shopifyCustomers: Number(r.shopify ?? 0),
      leads: Number(r.leads ?? 0),
      withMo: Number(r.mo ?? 0),
      subscribed: Number(r.subscribed ?? 0),
      withOpenTasks: Number(r.tasks ?? 0),
      factsComputed: Number(r.facts ?? 0),
    };
  } catch (err) {
    reportError(err, { route: "lib/customer-list-store", phase: "getCustomerBaseSummary" });
    return null;
  }
}

/** Search customers by name / e-mail (assignment pickers, the Eingang). */
export async function searchCustomers(
  query: string,
  limit = 10,
  sql: Sql | null = getSql()
): Promise<Array<{ id: number; email: string; name: string | null }>> {
  if (!sql) return [];
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const pattern = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  try {
    const rows = (await sql`
      SELECT customer_id, email, display_name
        FROM customer_overview
       WHERE lower(email) LIKE ${pattern} OR lower(COALESCE(display_name, '')) LIKE ${pattern}
       ORDER BY last_activity_at DESC NULLS LAST
       LIMIT ${Math.max(1, Math.min(limit, 50))}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.customer_id),
      email: String(r.email),
      name: (r.display_name as string | null) ?? null,
    }));
  } catch (err) {
    reportError(err, { route: "lib/customer-list-store", phase: "searchCustomers" });
    return [];
  }
}

/** The computed figures + block state of ONE customer (detail header). */
export interface CustomerFigures {
  blocked: boolean;
  blockReason: string | null;
  isShopifyCustomer: boolean;
  ordersCount: number;
  totalSpentCents: number;
  aovCents: number | null;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  medianIntervalDays: number | null;
  expectedNextOrderAt: string | null;
  lifecycleSegment: string | null;
  valueTier: string | null;
  churnRisk: string | null;
  rfm: { r: number | null; f: number | null; m: number | null };
  boughtCategories: string[];
  complementHandles: string[];
  conversationsCount: number;
  lastChatAt: string | null;
  emailsSentCount: number;
  lastMarketingAt: string | null;
  lastClickAt: string | null;
  clicks90d: number;
  redemptionsCount: number;
  unansweredInboundCount: number;
  lastActivityAt: string | null;
  factsComputedAt: string | null;
  openTasks: number;
}

export async function getCustomerFigures(customerId: number, sql: Sql | null = getSql()): Promise<CustomerFigures | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT * FROM customer_overview WHERE customer_id = ${customerId}
    `) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    const n = (v: unknown) => (v == null ? null : Number(v));
    const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
    return {
      blocked: r.blocked === true,
      blockReason: (r.block_reason as string | null) ?? null,
      isShopifyCustomer: r.is_shopify_customer === true,
      ordersCount: Number(r.orders_count ?? 0),
      totalSpentCents: Number(r.total_spent_cents ?? 0),
      aovCents: n(r.aov_cents),
      firstOrderAt: iso(r.first_order_at),
      lastOrderAt: iso(r.last_order_at),
      medianIntervalDays: n(r.median_interval_days),
      expectedNextOrderAt: iso(r.expected_next_order_at),
      lifecycleSegment: (r.lifecycle_segment as string | null) ?? null,
      valueTier: (r.value_tier as string | null) ?? null,
      churnRisk: (r.churn_risk as string | null) ?? null,
      rfm: { r: n(r.rfm_r), f: n(r.rfm_f), m: n(r.rfm_m) },
      boughtCategories: arr(r.bought_categories),
      complementHandles: arr(r.complement_handles),
      conversationsCount: Number(r.conversations_count ?? 0),
      lastChatAt: iso(r.last_chat_at),
      emailsSentCount: Number(r.emails_sent_count ?? 0),
      lastMarketingAt: iso(r.last_marketing_at),
      lastClickAt: iso(r.last_click_at),
      clicks90d: Number(r.clicks_90d ?? 0),
      redemptionsCount: Number(r.redemptions_count ?? 0),
      unansweredInboundCount: Number(r.unanswered_inbound_count ?? 0),
      lastActivityAt: iso(r.last_activity_at),
      factsComputedAt: iso(r.facts_computed_at),
      openTasks: Number(r.open_tasks_count ?? 0),
    };
  } catch (err) {
    reportError(err, { route: "lib/customer-list-store", phase: "getCustomerFigures" });
    return null;
  }
}
