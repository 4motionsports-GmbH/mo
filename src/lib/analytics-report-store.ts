// Data layer for the "Komplettanalyse" analytics reports (the side-panel of
// stored, full-interval overviews). Two responsibilities:
//
//   1) CRUD + state-machine persistence for the analytics_reports row (create,
//      read, list for the sidebar, patch phase/progress/usage/sections, delete).
//      The EUR cost is priced in JS from the stored per-model usage on every read
//      (lib/ai-pricing.mjs) — one source of truth, like the other cost KPIs.
//
//   2) The PURE, range-scoped DB aggregations the generator's final `assemble`
//      phase and the up-front estimate consume: headline KPIs + tiers, the
//      category/quality distributions, the (range-scoped) persona favourites, the
//      active-customer worklist, the per-conversation appendix and the interval's
//      AI spend. ZERO model calls live here — the AI passes are orchestrated in
//      analytics-report-generate.ts. The interval is whole days in Europe/Berlin
//      (midnight to midnight local time), like the admin's dates (C.4).
//
// Identity note: most aggregations are pseudonymous Cluster-A reads. The active-
// customer worklist returns customer IDs only (the generator resolves the rest
// through the existing, consent-respecting customer pipeline); names enter a
// report solely through the OPTIONAL per-customer profiles phase.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { loadModelPrices, usdEurRate, usdCostForUsage, usdToEur } from "./ai-pricing.mjs";
import {
  reportCostEur,
  totalTokens,
  normalizeOptions,
} from "./analytics-report-core.mjs";
import type { assembleDecision, buildReportComparison } from "./analytics-report-synthesis-core.mjs";
import type { BusinessSnapshot } from "./business-snapshot";
import {
  classifyTier,
  CATEGORY_LABELS,
  QUALITY_LABELS,
} from "./conversation-analysis-core.mjs";
import { ARCHETYPE_META } from "./persona";
import { getProductsByIds } from "./product-catalog";
import { CART_PATTERNS } from "./kpi-event-patterns.mjs";
import type { PersonaArchetype } from "./types";

const REPORT_LIST_LIMIT = 100;

export type ReportStatus = "running" | "complete" | "failed";

export interface ReportOptions {
  includePerCustomer: boolean;
  includeAppendix: boolean;
  maxAnalyze: number;
  maxProfiles: number;
}

/** Mutable progress counters + a transient `scratch` work-queue area. */
export interface ReportProgress {
  analyzed: number;
  analyzeFailed: number;
  analyzeRemaining: number;
  personasTotal: number;
  personasDone: number;
  profilesTotal: number;
  profilesDone: number;
  profilesFailed: number;
  scratch?: Record<string, unknown>;
}

export type ReportUsage = Record<string, { input: number; output: number }>;

// ── The assembled, render-ready report payload ────────────────────────────────

export interface ReportKpis {
  conversations: number;
  analyzed: number;
  tiers: { anonymous: number; emailOnly: number; signedIn: number };
  withError: number;
  emailCaptured: number;
  cartUsed: number;
  checkoutOffered: number;
}
export interface ReportDistributionRow {
  label: string;
  count: number;
}
export interface ReportPersonaSection {
  personaLabel: string;
  personaDisplay: string;
  chatCount: number;
  favoriteProducts: { productId: string; name: string; count: number }[];
  topQuestionsMd: string | null;
}
export interface ReportProfileSection {
  customerId: number;
  name: string;
  profileSummary: string;
  sessionCount: number;
  lastSeenAt: string | null;
}
export interface ReportAppendixItem {
  conversationKey: string;
  createdAt: string;
  tier: string;
  personaDisplay: string | null;
  category: string | null;
  quality: string | null;
  summary: string | null;
}
export interface ReportSpend {
  totalEur: number;
  byCallSite: { callSite: string; eur: number }[];
}
export interface ReportSections {
  kpis: ReportKpis;
  spend: ReportSpend;
  categories: ReportDistributionRow[];
  qualities: ReportDistributionRow[];
  insightsMd: string | null;
  personas: ReportPersonaSection[];
  customerKnowledgeMd: string | null;
  profiles: ReportProfileSection[];
  appendix: ReportAppendixItem[];
  notes: string[];
  /** Chapter „Kundenbasis“ (since the customer platform; absent in older reports). */
  customerBase?: ReportCustomerBase | null;
  /** Chapter „Kampagnen“: mails sent in the interval, per campaign. */
  campaigns?: ReportCampaignRow[];
  /** Payload version: absent/1 = before the decision layer, 2 = with it (2026-10-06). */
  version?: number;
  /** The business snapshot of the period vs the previous period (v2). */
  snapshot?: BusinessSnapshot | null;
  /** The strategist's decision layer (v2): summary, decisions, plan, risks. */
  decision?: ReportDecision | null;
  /** The comparison with the previously stored, completed report (v2). */
  comparison?: ReportComparison | null;
}

/** The stored decision layer (analytics-report-synthesis-core assembleDecision). */
export type ReportDecision = ReturnType<typeof assembleDecision>;
/** The comparison with the previous report (analytics-report-synthesis-core buildReportComparison). */
export type ReportComparison = NonNullable<ReturnType<typeof buildReportComparison>>;

export interface ReportCustomerBase {
  total: number;
  shopifyCustomers: number;
  leads: number;
  withMo: number;
  subscribed: number;
  /** People who signed up to the one consent within the interval (any surface). */
  newSubscribers: number;
  bySegment: Array<{ key: string; n: number }>;
}

export interface ReportCampaignRow {
  /** campaigns.id; null for sends without a campaign (older reports: absent). */
  campaignId?: number | null;
  name: string;
  kind: string;
  sent: number;
  clicked: number;
  chatStarted: number;
  unsubscribed: number;
}

// ── Row shapes ────────────────────────────────────────────────────────────────

export interface AnalyticsReportListItem {
  id: number;
  title: string;
  from: string;
  to: string;
  preset: string;
  status: ReportStatus;
  phase: string;
  progress: ReportProgress;
  costEur: number;
  createdAt: string;
  completedAt: string | null;
}

export interface AnalyticsReportDetail extends AnalyticsReportListItem {
  options: ReportOptions;
  usage: ReportUsage;
  tokens: { input: number; output: number };
  sections: ReportSections | null;
  error: string | null;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return v ? String(v) : "";
}
function toIsoOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
function ymd(v: unknown): string {
  return toIso(v).slice(0, 10);
}

function emptyProgress(): ReportProgress {
  return {
    analyzed: 0,
    analyzeFailed: 0,
    analyzeRemaining: 0,
    personasTotal: 0,
    personasDone: 0,
    profilesTotal: 0,
    profilesDone: 0,
    profilesFailed: 0,
    scratch: {},
  };
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function mapProgress(v: unknown): ReportProgress {
  const o = asObject(v);
  const base = emptyProgress();
  return {
    analyzed: Number(o.analyzed ?? base.analyzed),
    analyzeFailed: Number(o.analyzeFailed ?? base.analyzeFailed),
    analyzeRemaining: Number(o.analyzeRemaining ?? base.analyzeRemaining),
    personasTotal: Number(o.personasTotal ?? base.personasTotal),
    personasDone: Number(o.personasDone ?? base.personasDone),
    profilesTotal: Number(o.profilesTotal ?? base.profilesTotal),
    profilesDone: Number(o.profilesDone ?? base.profilesDone),
    profilesFailed: Number(o.profilesFailed ?? base.profilesFailed),
    scratch: asObject(o.scratch),
  };
}

function costOf(usage: unknown): number {
  return reportCostEur(asObject(usage), loadModelPrices(), usdEurRate());
}

function mapListItem(r: Record<string, unknown>): AnalyticsReportListItem {
  // The list (sidebar) never needs the transient `scratch` work-queue — and for a
  // completed report it can hold the full per-customer profiles — so strip it here
  // to keep the list payload small (JSON omits the undefined). mapDetail re-attaches
  // the full progress.
  const progress: ReportProgress = { ...mapProgress(r.progress), scratch: undefined };
  return {
    id: Number(r.id),
    title: String(r.title ?? ""),
    from: ymd(r.date_from),
    to: ymd(r.date_to),
    preset: String(r.preset ?? "custom"),
    status: (String(r.status ?? "running") as ReportStatus),
    phase: String(r.phase ?? "analyze"),
    progress,
    costEur: costOf(r.usage),
    createdAt: toIso(r.created_at),
    completedAt: toIsoOrNull(r.completed_at),
  };
}

function mapDetail(r: Record<string, unknown>): AnalyticsReportDetail {
  const usage = asObject(r.usage) as ReportUsage;
  return {
    ...mapListItem(r),
    // The generator reads progress.scratch, so detail carries the FULL progress.
    progress: mapProgress(r.progress),
    options: normalizeOptions(asObject(r.options)) as ReportOptions,
    usage,
    tokens: totalTokens(usage),
    sections: (r.sections ?? null) as ReportSections | null,
    error: (r.error as string | null) ?? null,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/** Create a fresh report row (status='running', phase='analyze'). Returns its id. */
export async function createAnalyticsReport(
  input: {
    title: string;
    from: string;
    to: string;
    preset: string;
    options: ReportOptions;
    progress?: Partial<ReportProgress>;
  },
  sql: Sql | null = getSql()
): Promise<number | null> {
  if (!sql) return null;
  const progress = { ...emptyProgress(), ...(input.progress ?? {}) };
  try {
    const rows = (await sql`
      INSERT INTO analytics_reports (title, date_from, date_to, preset, status, phase, progress, options, usage)
      VALUES (
        ${input.title}, ${input.from}::date, ${input.to}::date, ${input.preset},
        'running', 'analyze', ${JSON.stringify(progress)}::jsonb,
        ${JSON.stringify(input.options)}::jsonb, '{}'::jsonb
      )
      RETURNING id
    `) as Array<{ id: number }>;
    return rows[0] ? Number(rows[0].id) : null;
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "create" });
    return null;
  }
}

/** The full detail for one report, or null. */
export async function getAnalyticsReport(
  id: number,
  sql: Sql | null = getSql()
): Promise<AnalyticsReportDetail | null> {
  if (!sql) return null;
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    const rows = (await sql`
      SELECT id, title, date_from, date_to, preset, status, phase, progress, options,
             sections, usage, error, created_at, completed_at
        FROM analytics_reports WHERE id = ${id}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapDetail(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "get" });
    return null;
  }
}

/** The sidebar list — newest first, no heavy `sections` payload. */
export async function listAnalyticsReports(
  limit = REPORT_LIST_LIMIT,
  sql: Sql | null = getSql()
): Promise<AnalyticsReportListItem[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, title, date_from, date_to, preset, status, phase, progress, usage,
             created_at, completed_at
        FROM analytics_reports
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map(mapListItem);
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "list" });
    return [];
  }
}

export interface ReportPatch {
  status?: ReportStatus;
  phase?: string;
  progress?: ReportProgress;
  usage?: ReportUsage;
  sections?: ReportSections;
  error?: string | null;
  completed?: boolean;
}

/** Patch a report's state-machine fields. Only provided fields change. */
export async function updateAnalyticsReport(
  id: number,
  patch: ReportPatch,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE analytics_reports SET
        status       = COALESCE(${patch.status ?? null}, status),
        phase        = COALESCE(${patch.phase ?? null}, phase),
        progress     = COALESCE(${patch.progress ? JSON.stringify(patch.progress) : null}::jsonb, progress),
        usage        = COALESCE(${patch.usage ? JSON.stringify(patch.usage) : null}::jsonb, usage),
        sections     = COALESCE(${patch.sections ? JSON.stringify(patch.sections) : null}::jsonb, sections),
        error        = ${patch.error === undefined ? null : patch.error}::text,
        completed_at = CASE WHEN ${patch.completed === true} THEN now() ELSE completed_at END,
        updated_at   = now()
       WHERE id = ${id}
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "update" });
    return false;
  }
}

// How long a step claim shields against concurrent stepping before it counts as
// stale (a crashed function never released it). Above the step route's 300 s.
const STEP_CLAIM_TTL_MINUTES = 6;

/**
 * Atomically claim a running report for ONE step (migration 0077):
 *  - 'claimed' — do the work, then releaseReportStep();
 *  - 'busy'    — another /step is live on this report (the client polls);
 *  - 'error'   — DB failure or migration 0077 not applied: the caller proceeds
 *                without a claim (fail-open — the behaviour before the claim).
 */
export async function claimReportStep(
  id: number,
  sql: Sql | null = getSql()
): Promise<"claimed" | "busy" | "error"> {
  if (!sql) return "error";
  try {
    const rows = (await sql`
      UPDATE analytics_reports
         SET step_claimed_at = now()
       WHERE id = ${id}
         AND status = 'running'
         AND (step_claimed_at IS NULL
              OR step_claimed_at < now() - make_interval(mins => ${STEP_CLAIM_TTL_MINUTES}))
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.length > 0 ? "claimed" : "busy";
  } catch (err) {
    // 42703 = undefined column: migration 0077 not applied yet — fail open quietly.
    if ((err as { code?: string })?.code !== "42703") {
      reportError(err, { route: "lib/analytics-report-store", phase: "claim" });
    }
    return "error";
  }
}

/** Release a step claim (best effort; a stale claim expires on its own). */
export async function releaseReportStep(id: number, sql: Sql | null = getSql()): Promise<void> {
  if (!sql) return;
  try {
    await sql`UPDATE analytics_reports SET step_claimed_at = NULL WHERE id = ${id}`;
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "release" });
  }
}

/** The previous report to compare with: the latest COMPLETED report created before this one. */
export interface PreviousReport {
  id: number;
  title: string;
  from: string;
  to: string;
  completedAt: string | null;
  sections: ReportSections;
}

export async function getPreviousCompletedReport(
  id: number,
  sql: Sql | null = getSql()
): Promise<PreviousReport | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT p.id, p.title, p.date_from, p.date_to, p.completed_at, p.sections
        FROM analytics_reports p
       WHERE p.status = 'complete'
         AND p.sections IS NOT NULL
         AND p.id <> ${id}
         AND p.created_at <= (SELECT created_at FROM analytics_reports WHERE id = ${id})
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 1
    `) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      title: String(r.title ?? ""),
      from: ymd(r.date_from),
      to: ymd(r.date_to),
      completedAt: toIsoOrNull(r.completed_at),
      sections: r.sections as ReportSections,
    };
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "previous" });
    return null;
  }
}

/** Delete a report. */
export async function deleteAnalyticsReport(
  id: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`DELETE FROM analytics_reports WHERE id = ${id} RETURNING id`) as Array<{
      id: number;
    }>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "delete" });
    return false;
  }
}

// ── Pure, range-scoped aggregations ───────────────────────────────────────────

/** Headline KPIs + tier split + outcome signals for the interval. */
export async function getReportKpis(
  from: string,
  to: string,
  sql: Sql | null = getSql()
): Promise<ReportKpis> {
  const empty: ReportKpis = {
    conversations: 0,
    analyzed: 0,
    tiers: { anonymous: 0, emailOnly: 0, signedIn: 0 },
    withError: 0,
    emailCaptured: 0,
    cartUsed: 0,
    checkoutOffered: 0,
  };
  if (!sql) return empty;
  try {
    const [coreRows, errRows, emailRows, cartRows] = await Promise.all([
      sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE c.analysis_updated_at IS NOT NULL)::int AS analyzed,
          count(*) FILTER (
            WHERE cu.shopify_customer_id IS NOT NULL OR cul.shopify_customer_id IS NOT NULL
          )::int AS signed_in,
          count(*) FILTER (
            WHERE cu.shopify_customer_id IS NULL AND cul.shopify_customer_id IS NULL
              AND (c.customer_id IS NOT NULL OR csl.customer_id IS NOT NULL)
          )::int AS email_only,
          count(*) FILTER (
            WHERE cu.shopify_customer_id IS NULL AND cul.shopify_customer_id IS NULL
              AND c.customer_id IS NULL AND csl.customer_id IS NULL
          )::int AS anon,
          count(*) FILTER (
            WHERE COALESCE(array_length(c.selected_product_ids, 1), 0) > 0
          )::int AS checkout_offered
          FROM conversations c
          LEFT JOIN customers cu ON cu.id = c.customer_id
          LEFT JOIN customer_session_links csl ON csl.session_id = c.session_id
          LEFT JOIN customers cul ON cul.id = csl.customer_id
         WHERE c.created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND c.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
      `,
      sql`
        SELECT count(*)::int AS n FROM conversations c
         WHERE c.created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND c.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
           AND EXISTS (SELECT 1 FROM messages mu
                        WHERE mu.conversation_id = c.id AND mu.role = 'user'
                          AND mu.tool_name IS NULL AND length(btrim(mu.content)) > 0)
           AND NOT EXISTS (SELECT 1 FROM messages ma
                        WHERE ma.conversation_id = c.id AND ma.role = 'assistant'
                          AND ma.tool_name IS NULL AND length(btrim(ma.content)) > 0)
      `,
      sql`
        SELECT count(*)::int AS n FROM conversations c
         WHERE c.created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND c.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
           AND EXISTS (SELECT 1 FROM email_captures e WHERE e.session_id = c.session_id)
      `,
      sql`
        SELECT count(*)::int AS n FROM conversations c
         WHERE c.created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND c.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
           AND EXISTS (SELECT 1 FROM kpi_events k
                        WHERE k.session_id = c.session_id
                          AND (k.event ILIKE ${CART_PATTERNS[0]} OR k.event ILIKE ${CART_PATTERNS[1]}))
      `,
    ]);
    const core = (coreRows as Array<Record<string, number>>)[0] ?? {};
    return {
      conversations: Number(core.total ?? 0),
      analyzed: Number(core.analyzed ?? 0),
      tiers: {
        anonymous: Number(core.anon ?? 0),
        emailOnly: Number(core.email_only ?? 0),
        signedIn: Number(core.signed_in ?? 0),
      },
      withError: Number((errRows as Array<{ n: number }>)[0]?.n ?? 0),
      emailCaptured: Number((emailRows as Array<{ n: number }>)[0]?.n ?? 0),
      cartUsed: Number((cartRows as Array<{ n: number }>)[0]?.n ?? 0),
      checkoutOffered: Number(core.checkout_offered ?? 0),
    };
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "kpis" });
    return empty;
  }
}

/** Per-persona chat counts + top-`topN` most-recommended products, range-scoped. */
export async function getRangePersonaInsights(
  from: string,
  to: string,
  topN = 5,
  sql: Sql | null = getSql()
): Promise<ReportPersonaSection[]> {
  if (!sql) return [];
  const limit = Number.isFinite(topN) && topN > 0 ? Math.floor(topN) : 5;
  try {
    const [chatRows, productRows] = await Promise.all([
      sql`
        SELECT COALESCE(persona_label, 'unknown') AS persona, count(*)::int AS n
          FROM conversations
         WHERE created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
         GROUP BY 1
      `,
      sql`
        SELECT COALESCE(c.persona_label, 'unknown') AS persona, pid, count(*)::int AS n
          FROM conversations c, unnest(c.recommended_product_ids) AS pid
         WHERE c.created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND c.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
         GROUP BY 1, 2
      `,
    ]);

    const byPersona = new Map<string, { productId: string; name: string; count: number }[]>();
    for (const r of productRows as Array<{ persona: string; pid: string; n: number }>) {
      const arr = byPersona.get(r.persona) ?? [];
      arr.push({ productId: String(r.pid), name: String(r.pid), count: Number(r.n) });
      byPersona.set(r.persona, arr);
    }
    const neededIds = new Set<string>();
    for (const arr of byPersona.values()) {
      arr.sort((a, b) => b.count - a.count || a.productId.localeCompare(b.productId));
      for (const p of arr.slice(0, limit)) neededIds.add(p.productId);
    }
    const nameById = new Map<string, string>();
    if (neededIds.size > 0) {
      const products = await getProductsByIds([...neededIds]);
      for (const p of products) nameById.set(p.id, p.name);
    }

    const out: ReportPersonaSection[] = (chatRows as Array<{ persona: string; n: number }>).map(
      (r) => {
        const favorites = (byPersona.get(r.persona) ?? [])
          .slice(0, limit)
          .map((p) => ({ ...p, name: nameById.get(p.productId) ?? p.productId }));
        const meta = ARCHETYPE_META[r.persona as PersonaArchetype];
        return {
          personaLabel: r.persona,
          personaDisplay: meta ? meta.label : r.persona,
          chatCount: Number(r.n),
          favoriteProducts: favorites,
          topQuestionsMd: null,
        };
      }
    );
    out.sort((a, b) => b.chatCount - a.chatCount);
    return out;
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "personas" });
    return [];
  }
}

/** Total conversations created in the interval (cheap count for the estimate). */
export async function countConversationsInRange(
  from: string,
  to: string,
  sql: Sql | null = getSql()
): Promise<number> {
  if (!sql) return 0;
  try {
    const rows = (await sql`
      SELECT count(*)::int AS n FROM conversations
       WHERE created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
    `) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "countConversations" });
    return 0;
  }
}

/** Distinct persona labels present in the interval (as stored, 'unknown' for null). */
export async function getPersonaLabelsInRange(
  from: string,
  to: string,
  sql: Sql | null = getSql()
): Promise<string[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT COALESCE(persona_label, 'unknown') AS persona, count(*)::int AS n
        FROM conversations
       WHERE created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
       GROUP BY 1
       ORDER BY count(*) DESC
    `) as Array<{ persona: string; n: number }>;
    return rows.map((r) => String(r.persona));
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "personaLabels" });
    return [];
  }
}

/**
 * Customer IDs with at least one conversation in the interval (consent-anchored
 * link OR a signed-in session link), newest activity first, capped. IDs only —
 * the generator resolves names/transcripts through the existing customer pipeline.
 */
export async function getActiveCustomerIdsInRange(
  from: string,
  to: string,
  limit: number,
  sql: Sql | null = getSql()
): Promise<number[]> {
  if (!sql) return [];
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  if (cap === 0) return [];
  try {
    const rows = (await sql`
      SELECT cust.id AS id
        FROM customers cust
       WHERE cust.id IN (
         SELECT c.customer_id FROM conversations c
          WHERE c.customer_id IS NOT NULL
            AND c.created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND c.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
         UNION
         SELECT csl.customer_id FROM customer_session_links csl
           JOIN conversations c ON c.session_id = csl.session_id
          WHERE c.created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND c.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
       )
       ORDER BY cust.last_seen_at DESC NULLS LAST, cust.id DESC
       LIMIT ${cap}
    `) as Array<{ id: number }>;
    return rows.map((r) => Number(r.id));
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "activeCustomers" });
    return [];
  }
}

/** Per-conversation appendix rows (cached analyses) for the interval, capped. */
export async function loadAppendixRows(
  from: string,
  to: string,
  limit: number,
  sql: Sql | null = getSql()
): Promise<ReportAppendixItem[]> {
  if (!sql) return [];
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  if (cap === 0) return [];
  try {
    const rows = (await sql`
      SELECT c.conversation_key, c.created_at, c.persona_label,
             c.analysis_summary, c.analysis_category, c.analysis_quality,
             (cu.shopify_customer_id IS NOT NULL OR cul.shopify_customer_id IS NOT NULL) AS signed_in,
             (c.customer_id IS NOT NULL OR csl.customer_id IS NOT NULL) AS identified
        FROM conversations c
        LEFT JOIN customers cu ON cu.id = c.customer_id
        LEFT JOIN customer_session_links csl ON csl.session_id = c.session_id
        LEFT JOIN customers cul ON cul.id = csl.customer_id
       WHERE c.created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND c.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
         AND c.analysis_updated_at IS NOT NULL
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ${cap}
    `) as Array<{
      conversation_key: string;
      created_at: unknown;
      persona_label: string | null;
      analysis_summary: string | null;
      analysis_category: string | null;
      analysis_quality: string | null;
      signed_in: boolean;
      identified: boolean;
    }>;
    return rows.map((r) => {
      const meta = r.persona_label
        ? ARCHETYPE_META[r.persona_label as PersonaArchetype]
        : null;
      return {
        conversationKey: r.conversation_key,
        createdAt: toIso(r.created_at),
        tier: classifyTier({ signedIn: r.signed_in, identified: r.identified }),
        personaDisplay: meta ? meta.label : r.persona_label,
        category: r.analysis_category
          ? ((CATEGORY_LABELS as Record<string, string>)[r.analysis_category] ?? r.analysis_category)
          : null,
        quality: r.analysis_quality
          ? ((QUALITY_LABELS as Record<string, string>)[r.analysis_quality] ?? r.analysis_quality)
          : null,
        summary: r.analysis_summary,
      };
    });
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "appendix" });
    return [];
  }
}

/** A recency-capped sample of user messages for a persona group within the
 *  interval — feeds the report's range-scoped top-questions pass. */
export async function sampleUserMessagesForPersona(
  persona: string,
  from: string,
  to: string,
  limit: number,
  sql: Sql | null = getSql()
): Promise<string[]> {
  if (!sql) return [];
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 80;
  try {
    const rows = (await sql`
      SELECT m.content
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
       WHERE COALESCE(c.persona_label, 'unknown') = ${persona}
         AND c.created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND c.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
         AND m.role = 'user' AND m.tool_name IS NULL
         AND m.content IS NOT NULL AND length(btrim(m.content)) > 0
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ${cap}
    `) as Array<{ content: string }>;
    return rows.map((r) => String(r.content).trim().slice(0, 600));
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "sampleMessages" });
    return [];
  }
}

/** AI spend (all call sites) recorded within the interval, priced in JS. */
export async function getRangeSpend(
  from: string,
  to: string,
  sql: Sql | null = getSql()
): Promise<ReportSpend> {
  const empty: ReportSpend = { totalEur: 0, byCallSite: [] };
  if (!sql) return empty;
  try {
    const rows = (await sql`
      SELECT call_site, model,
             sum(input_tokens)::bigint AS in_tok,
             sum(output_tokens)::bigint AS out_tok
        FROM ai_usage
       WHERE created_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
       GROUP BY call_site, model
    `) as Array<{ call_site: string; model: string; in_tok: string | number; out_tok: string | number }>;

    const prices = loadModelPrices();
    const rate = usdEurRate();
    const byCallSite = new Map<string, number>();
    let totalEur = 0;
    for (const r of rows) {
      const eur = usdToEur(
        usdCostForUsage(
          { model: r.model, inputTokens: Number(r.in_tok), outputTokens: Number(r.out_tok) },
          prices
        ),
        rate
      );
      totalEur += eur;
      byCallSite.set(r.call_site, (byCallSite.get(r.call_site) ?? 0) + eur);
    }
    return {
      totalEur,
      byCallSite: [...byCallSite.entries()]
        .map(([callSite, eur]) => ({ callSite, eur }))
        .sort((a, b) => b.eur - a.eur),
    };
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "spend" });
    return empty;
  }
}


/** Chapter „Kundenbasis“: the base today plus the interval's new subscribers. Pure DB, never throws. */
export async function getReportCustomerBase(
  from: string,
  to: string,
  sql: Sql | null = getSql()
): Promise<ReportCustomerBase | null> {
  if (!sql) return null;
  try {
    const [totals, segs, fresh] = (await Promise.all([
      sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE is_shopify_customer)::int AS shopify,
               count(*) FILTER (WHERE NOT is_shopify_customer)::int AS leads,
               count(*) FILTER (WHERE conversations_count > 0)::int AS mo,
               count(*) FILTER (WHERE email_consent_state = 'subscribed' AND NOT blocked)::int AS subscribed
          FROM customer_overview
      `,
      sql`
        SELECT COALESCE(lifecycle_segment, CASE WHEN orders_count = 0 THEN 'keine_bestellung' ELSE 'unbekannt' END) AS key,
               count(*)::int AS n
          FROM customer_overview
         GROUP BY 1 ORDER BY 2 DESC
      `,
      sql`
        SELECT count(DISTINCT customer_id)::int AS n
          FROM consent_events
         WHERE state = 'subscribed' AND COALESCE(origin_ref, '') <> 'import'
           AND occurred_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND occurred_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
      `,
    ])) as [Array<Record<string, number>>, Array<{ key: string; n: number }>, Array<{ n: number }>];
    const t = totals[0] ?? {};
    return {
      total: Number(t.total ?? 0),
      shopifyCustomers: Number(t.shopify ?? 0),
      leads: Number(t.leads ?? 0),
      withMo: Number(t.mo ?? 0),
      subscribed: Number(t.subscribed ?? 0),
      newSubscribers: Number(fresh[0]?.n ?? 0),
      bySegment: segs.map((r) => ({ key: String(r.key), n: Number(r.n) })),
    };
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "getReportCustomerBase" });
    return null;
  }
}

/** Chapter „Kampagnen“: per campaign, the mails sent in the interval and what they led to. Never throws. */
export async function getReportCampaigns(from: string, to: string, sql: Sql | null = getSql()): Promise<ReportCampaignRow[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT s.campaign_id, COALESCE(min(k.name), 'Ohne Kampagne') AS name, COALESCE(min(k.kind), '') AS kind,
             count(*)::int AS sent,
             count(*) FILTER (WHERE s.clicked_at IS NOT NULL OR s.bundle_clicked_at IS NOT NULL)::int AS clicked,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM kpi_events e
                WHERE e.event = 'campaign_chat_started' AND e.data->>'sendId' = s.id::text))::int AS chats,
             count(*) FILTER (WHERE s.unsubscribed_at IS NOT NULL)::int AS unsubscribed
        FROM campaign_sends s
        LEFT JOIN campaigns k ON k.id = s.campaign_id
       WHERE s.is_test = false
         AND s.sent_at >= ((${from}::date)::timestamp AT TIME ZONE 'Europe/Berlin') AND s.sent_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Europe/Berlin')
       GROUP BY s.campaign_id
       ORDER BY sent DESC
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      campaignId: r.campaign_id == null ? null : Number(r.campaign_id),
      name: String(r.name),
      kind: String(r.kind),
      sent: Number(r.sent ?? 0),
      clicked: Number(r.clicked ?? 0),
      chatStarted: Number(r.chats ?? 0),
      unsubscribed: Number(r.unsubscribed ?? 0),
    }));
  } catch (err) {
    reportError(err, { route: "lib/analytics-report-store", phase: "getReportCampaigns" });
    return [];
  }
}
