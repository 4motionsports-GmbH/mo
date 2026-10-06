// The business snapshot's data layer: collects, for a period and the equally
// long period before it, everything a business decision needs from the
// current backend, and shapes it with the pure, tested
// business-snapshot-core.mjs. Read-only: it calls the SAME store getters the
// KPI screen calls (kpi-store, mo-revenue-store, kpi-journey-store,
// ai-usage-store, …) so every number matches the KPI screen, plus a handful of
// small spelled-out queries for what no getter answers per period (campaign
// sends per campaign, the campaign of an MK code, letters, e-mail ratings,
// the order ledger, new consents).
//
// „Umsatz durch Mo“ is the KPI screen's: the ledger from getMoRevenueData plus
// the Shopify code lookup of the KPI cache, folded by mo-revenue.mjs in the
// core (same tiers, channels, dedupe). The Shopify lookup is bounded by a
// timeout so a slow Shopify never stalls a report step; without it the
// snapshot says so in a caveat.
//
// Null-safe and never throws: without a database every part is null and the
// snapshot carries a "Fehlende Daten" caveat; a failing part is reported via
// reportError and left null. The raw fields the core reads are a typed
// contract (SNAPSHOT_RAW_FIELDS, checked below against the getter types).
//
// Consumers: the Komplettanalyse (analytics-report-generate.ts) and the
// Verbesserung. Field list: docs/BUSINESS_SNAPSHOT.md.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import type { KpiRange } from "./kpi-range";
import {
  buildBusinessSnapshot,
  campaignCodesIn,
  describePeriod,
  previousPeriod,
  SECTION_RELEASE_NOTES,
  SNAPSHOT_RAW_FIELDS,
} from "./business-snapshot-core.mjs";
import { releaseNotesFor, releasesInRange } from "./kpi-releases.mjs";
import {
  getAccountActivity,
  getConsentGateFunnel,
  getCoreMetrics,
  getEmailCaptureFunnel,
  getLocaleSplit,
  getLoginGateFunnel,
  getOrderStatusKpis,
  getPageContextKpis,
} from "./kpi-store";
import { getMoRevenueData } from "./mo-revenue-store";
import { getJourneyCounts } from "./kpi-journey-store";
import { getAiCostMetrics } from "./ai-usage-store";
import { getInboxKpis } from "./inbox-store";
import { getQaKpis } from "./qa-store";
import { getFeedbackKpis } from "./feedback-store";
import { getBundleKpis } from "./bundle-offers-store";
import { getConversationStats } from "./admin-conversations";
import { getCustomerBaseKpis, getMoEffectKpis } from "./customer-list-store";
import { computeMoEffect } from "./mo-effect.mjs";
import { getReportKpis } from "./analytics-report-store";
import { loadKpiShopifyBlock } from "./kpi-cache";
import { isShopifyConfigured } from "./shopify";
import { isEmailConfigured } from "./email";
import { pageContextHoldoutPct } from "./page-context";
import { parseIntEnv } from "./env-num";
import { isCampaignReleaseEnabled, isCampaignSendsApproved } from "./campaign-flags.mjs";
import { isPhysicalMailSendsApproved } from "./pingen-flag.mjs";
import {
  isAppProxySigninEnabled,
  isAttributionSessionAnchorEnabled,
  isChatOrderStatusEnabled,
  isChatPageContextEnabled,
  isShopifyConsentWritebackEnabled,
  isShopifyCustomerSyncEnabled,
} from "./platform-flags.mjs";

// ── The snapshot's shape (built by business-snapshot-core buildBusinessSnapshot) ──

export type MetricUnit = "count" | "eur" | "rate" | "ratio" | "hours" | "score";

/** One figure: value in the period, value in the previous period (null for "Stand heute"). */
export interface SnapshotMetric {
  /** Stable key, e.g. "revenue.total" — never renamed (docs/BUSINESS_SNAPSHOT.md). */
  key: string;
  label: string;
  unit: MetricUnit;
  value: number | null;
  previous: number | null;
  /** Denominator of a rate (sample size). */
  base?: number | null;
  /** Which direction is good — colours the change. */
  good: "up" | "down" | "none";
  hint?: string;
}

export interface SnapshotTableColumn {
  key: string;
  label: string;
  unit: MetricUnit;
}

export interface SnapshotTableRow {
  key: string;
  label: string;
  values: Record<string, number | null>;
  previous?: Record<string, number | null>;
}

export interface SnapshotTable {
  key: string;
  title: string;
  columns: SnapshotTableColumn[];
  rows: SnapshotTableRow[];
  note?: string;
}

export type SnapshotSectionKey =
  | "revenue"
  | "chat"
  | "signin"
  | "consent"
  | "campaigns"
  | "customers"
  | "inbox"
  | "quality"
  | "costs";

export interface SnapshotSection {
  key: SnapshotSectionKey;
  title: string;
  scope: "period" | "lifetime";
  /** Admin link key (business-snapshot-core ADMIN_LINKS). */
  link: string;
  metrics: SnapshotMetric[];
  tables: SnapshotTable[];
  /** Release notes for the period (kpi-releases releaseNotesFor). */
  notes: string[];
  /** Release notes for the previous period — comparison only with care. */
  previousNotes: string[];
}

export interface SnapshotFunnel {
  key: string;
  title: string;
  link: string;
  steps: Array<{ label: string; value: number | null; previous: number | null }>;
}

export interface SnapshotCaveat {
  level: "info" | "warning";
  title: string;
  detail: string;
  sections?: string[];
}

export interface SnapshotSwitch {
  key: string;
  label: string;
  env: string | null;
  value: boolean | number;
}

export interface SnapshotPeriod {
  from: string;
  to: string;
  days: number;
  label: string;
}

export interface BusinessSnapshot {
  version: number;
  generatedAt: string | null;
  period: SnapshotPeriod | null;
  previous: SnapshotPeriod | null;
  sections: SnapshotSection[];
  funnels: SnapshotFunnel[];
  caveats: SnapshotCaveat[];
  switches: SnapshotSwitch[];
  releases: Array<{ date: string; key: string; title: string }>;
}

export interface SnapshotOptions {
  /** Also check Mo codes at Shopify (current period only, KPI cache). Default false. */
  includeShopify?: boolean;
  /** Upper bound for the Shopify cross-check in ms (default 45 s). */
  shopifyTimeoutMs?: number;
  /** Clock for `generatedAt` (tests). */
  now?: Date;
}

/** Same `[from, to]` window shape every KPI getter takes. */
function asRange(p: { from: string; to: string; days: number; label: string }): KpiRange {
  return { preset: "custom", from: p.from, to: p.to, days: p.days, label: p.label };
}

async function safe<T>(phase: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    reportError(err, { route: "lib/business-snapshot", phase });
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

// ── Small per-period queries (spelled out — the neon tag is not composable) ──

interface CampaignPeriodRow {
  campaignId: number | null;
  name: string;
  kind: string;
  sent: number;
  tracked: number;
  clicked: number;
  bundleClicked: number;
  chatStarted: number;
  unsubscribed: number;
  delivered: number;
  bounced: number;
  complained: number;
  letters: number;
}

/** An MK code and its campaign — maps the channel „Kampagne (MK-Code)“ onto campaigns. */
interface CampaignCodeRow {
  code: string;
  campaignId: number | null;
  name: string | null;
  kind: string | null;
}

/** The campaign of each MK code (non-test sends); codes upper case. */
async function loadCampaignCodes(codes: string[], sql: Sql): Promise<CampaignCodeRow[]> {
  if (codes.length === 0) return [];
  const rows = (await sql`
    SELECT DISTINCT ON (upper(s.discount_code))
           upper(s.discount_code) AS code, s.campaign_id, k.name, k.kind
      FROM campaign_sends s
      LEFT JOIN campaigns k ON k.id = s.campaign_id
     WHERE s.is_test = false AND upper(s.discount_code) = ANY(${codes}::text[])
     ORDER BY upper(s.discount_code), s.id
  `) as Array<{ code: string; campaign_id: number | null; name: string | null; kind: string | null }>;
  return rows.map((r) => ({
    code: String(r.code),
    campaignId: r.campaign_id == null ? null : Number(r.campaign_id),
    name: r.name == null ? null : String(r.name),
    kind: r.kind == null ? null : String(r.kind),
  }));
}

/**
 * Campaign sends of the period per campaign — the same funnel the KPI screen
 * shows, pure DB — plus the letters per campaign. The MK revenue per campaign
 * is added by the core (business-snapshot-core withCampaignRevenue).
 */
async function loadCampaignRows(range: KpiRange, sql: Sql): Promise<CampaignPeriodRow[]> {
  const [sendRows, letterRows] = (await Promise.all([
    sql`
      SELECT s.campaign_id, COALESCE(min(k.name), 'Ohne Kampagne') AS name, COALESCE(min(k.kind), '') AS kind,
             count(*)::int AS sent,
             count(*) FILTER (WHERE s.redirect_token IS NOT NULL)::int AS tracked,
             count(*) FILTER (WHERE s.clicked_at IS NOT NULL OR s.bundle_clicked_at IS NOT NULL)::int AS clicked,
             count(*) FILTER (WHERE s.bundle_clicked_at IS NOT NULL)::int AS bundle_clicked,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM kpi_events e
                WHERE e.event = 'campaign_chat_started' AND e.data->>'sendId' = s.id::text))::int AS chats,
             count(*) FILTER (WHERE s.unsubscribed_at IS NOT NULL)::int AS unsubscribed,
             count(*) FILTER (WHERE s.delivered_at IS NOT NULL)::int AS delivered,
             count(*) FILTER (WHERE s.bounced_at IS NOT NULL)::int AS bounced,
             count(*) FILTER (WHERE s.complained_at IS NOT NULL)::int AS complained
        FROM campaign_sends s
        LEFT JOIN campaigns k ON k.id = s.campaign_id
       WHERE s.is_test = false
         AND s.sent_at >= ${range.from}::date
         AND s.sent_at < (${range.to}::date + 1)
       GROUP BY s.campaign_id
    `,
    sql`
      SELECT campaign_id, count(*)::int AS n
        FROM physical_letters
       WHERE provider_letter_id IS NOT NULL AND status <> 'failed'
         AND created_at >= ${range.from}::date
         AND created_at < (${range.to}::date + 1)
       GROUP BY campaign_id
    `,
  ])) as [Array<Record<string, unknown>>, Array<{ campaign_id: number | null; n: number }>];
  const letters = new Map(letterRows.map((r) => [r.campaign_id == null ? "none" : String(r.campaign_id), Number(r.n)]));
  const out: CampaignPeriodRow[] = sendRows.map((r) => {
    const key = r.campaign_id == null ? "none" : String(r.campaign_id);
    return {
      campaignId: r.campaign_id == null ? null : Number(r.campaign_id),
      name: String(r.name),
      kind: String(r.kind),
      sent: Number(r.sent ?? 0),
      tracked: Number(r.tracked ?? 0),
      clicked: Number(r.clicked ?? 0),
      bundleClicked: Number(r.bundle_clicked ?? 0),
      chatStarted: Number(r.chats ?? 0),
      unsubscribed: Number(r.unsubscribed ?? 0),
      delivered: Number(r.delivered ?? 0),
      bounced: Number(r.bounced ?? 0),
      complained: Number(r.complained ?? 0),
      letters: letters.get(key) ?? 0,
    };
  });
  // Campaigns with letters in the period but no send in it still belong in
  // the comparison (campaigns with only revenue are added by the core).
  const seen = new Set(out.map((r) => (r.campaignId == null ? "none" : String(r.campaignId))));
  const missing = [...letters.keys()].filter((k) => !seen.has(k));
  if (missing.length > 0) {
    const ids = missing.filter((k) => k !== "none").map(Number);
    const names = ids.length
      ? ((await sql`SELECT id, name, kind FROM campaigns WHERE id = ANY(${ids}::bigint[])`) as Array<{ id: number; name: string; kind: string }>)
      : [];
    for (const k of missing) {
      const meta = names.find((n) => String(n.id) === k);
      out.push({
        campaignId: k === "none" ? null : Number(k),
        name: meta?.name ?? (k === "none" ? "Ohne Kampagne" : `Kampagne #${k}`),
        kind: meta?.kind ?? "",
        sent: 0,
        tracked: 0,
        clicked: 0,
        bundleClicked: 0,
        chatStarted: 0,
        unsubscribed: 0,
        delivered: 0,
        bounced: 0,
        complained: 0,
        letters: letters.get(k) ?? 0,
      });
    }
  }
  return out;
}

/** Letters handed to Pingen in the period and their postage. */
async function loadLetters(range: KpiRange, sql: Sql) {
  const fallback = parseIntEnv("PINGEN_LETTER_COST_CENTS", 106, 0);
  const rows = (await sql`
    SELECT count(*)::int AS n, COALESCE(SUM(COALESCE(cost_cents, ${fallback})), 0)::bigint AS cents
      FROM physical_letters
     WHERE provider_letter_id IS NOT NULL AND status <> 'failed'
       AND created_at >= ${range.from}::date
       AND created_at < (${range.to}::date + 1)
  `) as Array<{ n: number; cents: string | number }>;
  return { sent: Number(rows[0]?.n ?? 0), costCents: Number(rows[0]?.cents ?? 0) };
}

/** One-click e-mail ratings of the period per mail kind (anonymous). */
async function loadRatings(range: KpiRange, sql: Sql) {
  const rows = (await sql`
    SELECT COALESCE(NULLIF(email_kind, ''), 'unbekannt') AS kind, count(*)::int AS n, avg(rating)::float AS avg
      FROM feedback
     WHERE rating IS NOT NULL
       AND created_at >= ${range.from}::date
       AND created_at < (${range.to}::date + 1)
     GROUP BY 1
     ORDER BY 2 DESC
  `) as Array<{ kind: string; n: number; avg: number | null }>;
  return rows.map((r) => ({ kind: String(r.kind), count: Number(r.n), avg: r.avg == null ? null : Number(r.avg) }));
}

/** The shop's order ledger in the period: orders, net revenue, first-time vs returning buyers. */
async function loadLedger(range: KpiRange, sql: Sql) {
  const rows = (await sql`
    WITH o AS (
      SELECT COALESCE(customer_id::text, 's:' || shopify_customer_id) AS buyer, total_cents, refunded_cents
        FROM customer_orders
       WHERE cancelled_at IS NULL
         AND processed_at >= ${range.from}::date
         AND processed_at < (${range.to}::date + 1)
    ), earlier AS (
      SELECT DISTINCT COALESCE(customer_id::text, 's:' || shopify_customer_id) AS buyer
        FROM customer_orders
       WHERE cancelled_at IS NULL
         AND processed_at < ${range.from}::date
         AND (customer_id IS NOT NULL OR shopify_customer_id IS NOT NULL)
    )
    SELECT count(*)::int AS orders,
           COALESCE(sum(total_cents - refunded_cents), 0)::bigint AS revenue_cents,
           count(DISTINCT o.buyer)::int AS buyers,
           count(DISTINCT o.buyer) FILTER (WHERE o.buyer IS NOT NULL AND o.buyer NOT IN (SELECT buyer FROM earlier))::int AS new_buyers
      FROM o
  `) as Array<{ orders: number; revenue_cents: string | number; buyers: number; new_buyers: number }>;
  const r = rows[0];
  const buyers = Number(r?.buyers ?? 0);
  const newBuyers = Number(r?.new_buyers ?? 0);
  return {
    orders: Number(r?.orders ?? 0),
    revenueCents: Number(r?.revenue_cents ?? 0),
    buyers,
    newBuyers,
    returningBuyers: Math.max(0, buyers - newBuyers),
  };
}

/** People who signed up to the one consent in the period (any surface, the backfill excluded). */
async function loadNewSubscribers(range: KpiRange, sql: Sql) {
  const rows = (await sql`
    SELECT count(DISTINCT customer_id)::int AS n
      FROM consent_events
     WHERE state = 'subscribed' AND COALESCE(origin_ref, '') <> 'import'
       AND occurred_at >= ${range.from}::date
       AND occurred_at < (${range.to}::date + 1)
  `) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

/** Every per-period part, each null-safe on its own. */
async function collectPeriod(range: KpiRange, sql: Sql | null) {
  const db = sql;
  const [
    core,
    journey,
    reportKpis,
    pageContext,
    locales,
    loginGate,
    account,
    consentGate,
    capture,
    newSubscribers,
    campaigns,
    letters,
    ratings,
    inbox,
    ledger,
    quality,
    qa,
    feedback,
    orderStatus,
    bundles,
    aiCost,
  ] = await Promise.all([
    safe("core", () => getCoreMetrics(range)),
    safe("journey", () => getJourneyCounts(range)),
    safe("reportKpis", () => getReportKpis(range.from, range.to)),
    safe("pageContext", () => getPageContextKpis(range)),
    safe("locales", () => getLocaleSplit(range)),
    safe("loginGate", () => getLoginGateFunnel(range)),
    safe("account", () => getAccountActivity(range)),
    safe("consentGate", () => getConsentGateFunnel(range)),
    safe("capture", () => getEmailCaptureFunnel(range)),
    db ? safe("newSubscribers", () => loadNewSubscribers(range, db)) : Promise.resolve(null),
    db ? safe("campaigns", () => loadCampaignRows(range, db)) : Promise.resolve(null),
    db ? safe("letters", () => loadLetters(range, db)) : Promise.resolve(null),
    db ? safe("ratings", () => loadRatings(range, db)) : Promise.resolve(null),
    safe("inbox", () => getInboxKpis(range)),
    db ? safe("ledger", () => loadLedger(range, db)) : Promise.resolve(null),
    db ? safe("quality", () => getConversationStats(range.from, range.to)) : Promise.resolve(null),
    safe("qa", () => getQaKpis(range)),
    safe("feedback", () => getFeedbackKpis(range)),
    safe("orderStatus", () => getOrderStatusKpis(range)),
    safe("bundles", () => getBundleKpis(range)),
    safe("aiCost", () => getAiCostMetrics(range)),
  ]);
  return {
    core,
    journey,
    reportKpis,
    pageContext,
    locales,
    loginGate,
    account,
    consentGate,
    capture,
    newSubscribers,
    campaigns,
    ratings,
    letters,
    inbox,
    ledger,
    quality,
    qa,
    feedback,
    orderStatus,
    bundles,
    aiCost,
  };
}

/** The switches that change what the numbers mean (values only, Stand heute). */
export function snapshotSwitches() {
  return {
    shopifyConfigured: isShopifyConfigured(),
    customerSync: isShopifyCustomerSyncEnabled(),
    consentWriteback: isShopifyConsentWritebackEnabled(),
    campaignSendsApproved: isCampaignSendsApproved(),
    campaignRelease: isCampaignReleaseEnabled(),
    physicalMailApproved: isPhysicalMailSendsApproved(),
    appProxySignin: isAppProxySigninEnabled(),
    attributionSessionAnchor: isAttributionSessionAnchorEnabled(),
    pageContext: isChatPageContextEnabled(),
    pageContextHoldoutPct: pageContextHoldoutPct(),
    chatOrderStatus: isChatOrderStatusEnabled(),
    emailConfigured: isEmailConfigured(),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

function releaseNotesBySection(period: { from: string; to: string }, previous: { from: string; to: string }) {
  const out: Record<string, { current: string[]; previous: string[] }> = {};
  for (const [section, keys] of Object.entries(SECTION_RELEASE_NOTES)) {
    out[section] = {
      current: (keys as readonly string[]).flatMap((k) => releaseNotesFor(k, period)),
      previous: (keys as readonly string[]).flatMap((k) => releaseNotesFor(k, previous)),
    };
  }
  return out;
}

/**
 * Collect the raw snapshot input for `range` (and its previous period). Exposed
 * separately so a caller can keep the raw parts (debugging, other shapes).
 */
export async function collectBusinessSnapshotRaw(
  range: { from: string; to: string },
  opts: SnapshotOptions = {},
  sql: Sql | null = getSql()
) {
  const period = describePeriod(range);
  const previous = previousPeriod(range);
  const shopifyWanted = Boolean(opts.includeShopify) && isShopifyConfigured();
  const [cur, prev, moRevenueData, shopifyBlock, customerBase, moEffectRaw] = await Promise.all([
    collectPeriod(asRange(period), sql),
    collectPeriod(asRange(previous), sql),
    // Both periods' ledger in one call (its previous period is ours).
    safe("moRevenue", () => getMoRevenueData(asRange(period), sql)),
    shopifyWanted
      ? withTimeout(loadKpiShopifyBlock(asRange(period)), opts.shopifyTimeoutMs ?? 45_000)
      : Promise.resolve(null),
    safe("customerBase", () => getCustomerBaseKpis()),
    safe("moEffect", () => getMoEffectKpis()),
  ]);
  const shopify = shopifyBlock
    ? { revenue: shopifyBlock.revenue.value, campaign: shopifyBlock.campaign.value, fetchedAt: shopifyBlock.fetchedAt }
    : null;
  // The detail rows (products, conversations) are the KPI drill-down, not snapshot input.
  const moRevenue = moRevenueData ? { ...moRevenueData, details: [] } : null;
  const codes = campaignCodesIn(moRevenue?.orders, moRevenue?.previousOrders, shopify?.revenue?.redemptions);
  const campaignCodes = sql && codes.length > 0 ? ((await safe("campaignCodes", () => loadCampaignCodes(codes, sql))) ?? []) : [];
  return {
    generatedAt: (opts.now ?? new Date()).toISOString(),
    period,
    previous,
    cur,
    prev,
    lifetime: {
      customerBase,
      moEffect: moEffectRaw ? computeMoEffect(moEffectRaw.rows) : null,
      wonByMo: moEffectRaw?.wonByMo ?? null,
      subscribersBySource: moEffectRaw?.subscribersBySource ?? [],
    },
    moRevenue,
    shopify,
    campaignCodes,
    switches: snapshotSwitches(),
    releases: releasesInRange({ from: previous.from, to: period.to }),
    releaseNotes: releaseNotesBySection(period, previous),
  };
}

// ── The raw-field contract, checked at compile time ──
// Every path in SNAPSHOT_RAW_FIELDS must exist in the type of the part it
// names; a getter that drops or renames a field the snapshot reads fails tsc
// here, with the path in the message. (The tests check the other half: the
// builder reads nothing else, and the fixture has every field.)

type SnapshotRaw = Awaited<ReturnType<typeof collectBusinessSnapshotRaw>>;
type Leaf = string | number | boolean | bigint | symbol | Date | null | undefined;
type Depth = [never, 0, 1, 2, 3, 4, 5, 6];
/** Dotted field paths into T ("a.b", "list[].c", "codes[]"), up to 7 levels. */
type FieldPath<T, D extends number = 7> = [D] extends [never]
  ? never
  : NonNullable<T> extends Leaf
    ? never
    : NonNullable<T> extends ReadonlyArray<infer E>
      ? "[]" | `[].${FieldPath<E, Depth[D]>}`
      : {
          [K in keyof NonNullable<T> & string]: NonNullable<NonNullable<T>[K]> extends ReadonlyArray<infer E>
            ? K | `${K}[]` | `${K}[].${FieldPath<E, Depth[D]>}`
            : K | `${K}.${FieldPath<NonNullable<T>[K], Depth[D]>}`;
        }[keyof NonNullable<T> & string];
/** Resolves only when `Unknown` is empty — otherwise tsc names the unknown path. */
type NoUnknownField<Unknown extends never> = Unknown;
type Declared = typeof SNAPSHOT_RAW_FIELDS;

export type SnapshotRawFieldCheck = [
  NoUnknownField<Exclude<Declared["period"][number], FieldPath<SnapshotRaw["cur"]>>>,
  NoUnknownField<Exclude<Declared["lifetime"][number], FieldPath<SnapshotRaw["lifetime"]>>>,
  NoUnknownField<Exclude<Declared["moRevenue"][number], FieldPath<SnapshotRaw["moRevenue"]>>>,
  NoUnknownField<Exclude<Declared["shopify"][number], FieldPath<SnapshotRaw["shopify"]>>>,
  NoUnknownField<Exclude<Declared["campaignCodes"][number], FieldPath<SnapshotRaw["campaignCodes"]>>>,
];

/**
 * The business snapshot for `range` vs the equally long period before it.
 * Never throws; parts that fail are null and named in the caveats.
 */
export async function getBusinessSnapshot(
  range: { from: string; to: string },
  opts: SnapshotOptions = {},
  sql: Sql | null = getSql()
): Promise<BusinessSnapshot> {
  try {
    const raw = await collectBusinessSnapshotRaw(range, opts, sql);
    return buildBusinessSnapshot(raw) as BusinessSnapshot;
  } catch (err) {
    reportError(err, { route: "lib/business-snapshot", phase: "build" });
    return buildBusinessSnapshot({ period: describePeriod(range), generatedAt: (opts.now ?? new Date()).toISOString() }) as BusinessSnapshot;
  }
}
