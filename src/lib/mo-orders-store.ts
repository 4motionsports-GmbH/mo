// I/O layer of the Mo order-attribution pipeline (pure logic:
// lib/order-attribution.mjs; design: docs/ORDER_ATTRIBUTION.md).
//
// Three responsibilities:
//   1. MINT attribution tokens — opaque, server-side random ids that ride on
//      Mo-built cart links (`attributes[_mo]=<token>`) or that the widget
//      stamps onto the live storefront cart. One token per (session, source),
//      reused on re-request, so a session never accumulates marker spam.
//   2. INGEST orders/create + orders/paid webhook deliveries — idempotent
//      upsert keyed by shopify_order_id. Only orders carrying a Mo marker are
//      stored (data minimisation); the tier is snapshotted at ingest against
//      the session's discussed/selected products.
//   3. AGGREGATE the tiered attribution KPIs for the dashboard.
//
// GDPR: everything here is Cluster A — session-keyed, pseudonymous. The
// webhook payload's customer fields are never read (see parseOrderWebhook).
// Best-effort discipline like every store in this repo: no DB → null/no-op,
// failures are reported and swallowed, a webhook 500 is returned only for a
// real processing failure so Shopify retries an idempotent operation.

import { getSql, type Sql } from "./db";
import { loadProductCatalog } from "./product-catalog";
import { loadConversationForSummary } from "./conversation-store";
import { hasRecommendedPurchase } from "./kpi-match.mjs";
import { isRealisedFinancialStatus } from "./kpi-revenue-core.mjs";
import {
  parseOrderWebhook,
  hasMoMarker,
  isMoDiscountCode,
  matchOrderLineItems,
  classifyAttributionTier,
  isWithinAttributionWindow,
} from "./order-attribution.mjs";
import { reportError } from "./observability";
import { parseIntEnv } from "./env-num";
import type { KpiRange } from "./kpi-range";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Who put the marker on the cart. 'widget' = live-cart stamp (the only
 * session-behaviour-derived source → tiers assisted/influenced); the link
 * sources are Mo-built artifacts → tier direct. */
export type AttributionSource =
  | "widget"
  | "summary_email"
  | "marketing_email"
  | "bundle";

/** Attribution window (days) between token minting and the order. Orders
 * older than this relative to their token are NOT attributed (honesty:
 * a months-old consultation shouldn't claim an unrelated purchase). */
export function attributionWindowDays(): number {
  return parseIntEnv("MO_ATTRIBUTION_WINDOW_DAYS", 30, 1);
}

function generateAttributionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // base64url, no padding — same shape as the /api/r redirect tokens.
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Mint (or reuse) the attribution token for a (session, source) pair. For a
 * sessionless carrier (bundle links) every call mints a fresh token. Returns
 * null when no DB is configured or on failure — callers then simply ship the
 * unstamped URL (the link still works; only attribution is lost).
 */
export async function mintAttributionToken(
  sessionId: string | null,
  source: AttributionSource,
  sql: Sql | null = getSql()
): Promise<string | null> {
  if (!sql) return null;
  const sid = sessionId?.trim() || null;
  try {
    if (sid) {
      const existing = (await sql`
        SELECT token FROM mo_attribution_tokens
         WHERE session_id = ${sid} AND source = ${source}
         LIMIT 1
      `) as Array<{ token: string }>;
      if (existing[0]?.token) return String(existing[0].token);
    }
    const token = generateAttributionToken();
    // Concurrent mints for the same (session, source) race on the partial
    // unique index — on conflict, fall back to reading the winner.
    const inserted = (await sql`
      INSERT INTO mo_attribution_tokens (token, session_id, source)
      VALUES (${token}, ${sid}, ${source})
      ON CONFLICT DO NOTHING
      RETURNING token
    `) as Array<{ token: string }>;
    if (inserted[0]?.token) return String(inserted[0].token);
    if (sid) {
      const winner = (await sql`
        SELECT token FROM mo_attribution_tokens
         WHERE session_id = ${sid} AND source = ${source}
         LIMIT 1
      `) as Array<{ token: string }>;
      return winner[0]?.token ? String(winner[0].token) : null;
    }
    return null;
  } catch (err) {
    reportError(err, { route: "lib/mo-orders-store", phase: "mintAttributionToken" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export interface IngestOrderResult {
  ok: boolean;
  /** What happened: stored | updated | ignored (+ reason) | failed. */
  action: "stored" | "updated" | "ignored" | "failed";
  reason?: string;
  tier?: string | null;
}

/**
 * Ingest one (verified) orders/create | orders/paid webhook payload.
 * Idempotent on shopify_order_id: a duplicate or follow-up delivery (create →
 * paid) updates the mutable order facts (status, total, codes) and keeps the
 * original attribution snapshot. Never throws.
 */
export async function ingestShopifyOrder(payload: unknown): Promise<IngestOrderResult> {
  const sql = getSql();
  if (!sql) return { ok: true, action: "ignored", reason: "no-db" };

  const parsed = parseOrderWebhook(payload);
  if (!parsed) return { ok: true, action: "ignored", reason: "no-order-id" };
  if (!hasMoMarker(parsed)) {
    // Data minimisation: an unmarked order is none of our business.
    return { ok: true, action: "ignored", reason: "no-mo-marker" };
  }

  try {
    // Follow-up delivery for an order we already ingested? Update the mutable
    // facts only (the attribution snapshot at first ingest stays).
    const existing = (await sql`
      SELECT id FROM mo_orders WHERE shopify_order_id = ${parsed.shopifyOrderId} LIMIT 1
    `) as Array<{ id: number }>;
    if (existing.length > 0) {
      await sql`
        UPDATE mo_orders
           SET financial_status = ${parsed.financialStatus},
               total_price      = ${parsed.totalPrice},
               currency         = COALESCE(${parsed.currency}, currency),
               discount_codes   = ${parsed.discountCodes}::text[],
               updated_at       = now()
         WHERE shopify_order_id = ${parsed.shopifyOrderId}
      `;
      return { ok: true, action: "updated" };
    }

    // Resolve the token → (session, source, minted-at). An unknown token (e.g.
    // aged out by retention) contributes nothing.
    let tokenSource: string | null = null;
    let sessionId: string | null = null;
    if (parsed.moToken) {
      const rows = (await sql`
        SELECT session_id, source, created_at
          FROM mo_attribution_tokens WHERE token = ${parsed.moToken} LIMIT 1
      `) as Array<{ session_id: string | null; source: string; created_at: string | Date }>;
      if (
        rows[0] &&
        isWithinAttributionWindow(
          parsed.processedAt,
          rows[0].created_at,
          attributionWindowDays()
        )
      ) {
        tokenSource = String(rows[0].source);
        sessionId = rows[0].session_id ? String(rows[0].session_id) : null;
      }
    }

    const hasMoCode = parsed.discountCodes.some(isMoDiscountCode);
    if (!hasMoCode && !tokenSource) {
      // Marker present but unresolvable/expired → honestly unattributable.
      return { ok: true, action: "ignored", reason: "marker-expired-or-unknown" };
    }

    // Map line items to catalog handles (variant id, then normalised title).
    const catalog = await loadProductCatalog();
    const { items, matchedHandles } = matchOrderLineItems(parsed.lineItems, catalog);

    // Product overlap with the linked consultation (discussed ∪ selected).
    let hasOverlap = false;
    if (sessionId && matchedHandles.length > 0) {
      const conversation = await loadConversationForSummary(sessionId);
      const consulted = [
        ...(conversation?.recommendedProductIds ?? []),
        ...(conversation?.selectedProductIds ?? []),
      ];
      hasOverlap = hasRecommendedPurchase(consulted, matchedHandles);
    }

    const tier = classifyAttributionTier({ hasMoCode, tokenSource, hasOverlap });
    if (!tier) return { ok: true, action: "ignored", reason: "unclassifiable" };

    await sql`
      INSERT INTO mo_orders (
        shopify_order_id, order_name, processed_at, financial_status, currency,
        total_price, discount_codes, line_items, attribution_token, session_id,
        attribution_source, attribution_tier, recommended_overlap, matched_handles
      ) VALUES (
        ${parsed.shopifyOrderId}, ${parsed.orderName}, ${parsed.processedAt},
        ${parsed.financialStatus}, ${parsed.currency}, ${parsed.totalPrice},
        ${parsed.discountCodes}::text[], ${JSON.stringify(items)}::jsonb,
        ${parsed.moToken}, ${sessionId}, ${tokenSource ?? (hasMoCode ? "discount_code" : null)},
        ${tier}, ${hasOverlap}, ${matchedHandles}::text[]
      )
      ON CONFLICT (shopify_order_id) DO UPDATE
        SET financial_status = EXCLUDED.financial_status,
            total_price      = EXCLUDED.total_price,
            updated_at       = now()
    `;
    return { ok: true, action: "stored", tier };
  } catch (err) {
    reportError(err, { route: "lib/mo-orders-store", phase: "ingestShopifyOrder" });
    return { ok: false, action: "failed", reason: "db-error" };
  }
}

/**
 * Conversion-sweep / funnel short-circuit: has this discount code already been
 * seen on an ingested order? A definite true avoids a Shopify round-trip;
 * false/unknown means "ask Shopify" (our table only starts filling once the
 * orders webhooks are registered — it is NOT a census of history).
 */
export async function wasCodeSeenOnIngestedOrder(
  code: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const c = code.trim();
  if (!c) return false;
  try {
    const rows = (await sql`
      SELECT 1 FROM mo_orders WHERE discount_codes @> ARRAY[${c}]::text[] LIMIT 1
    `) as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/mo-orders-store", phase: "wasCodeSeenOnIngestedOrder" });
    return false;
  }
}

// ---------------------------------------------------------------------------
// KPI aggregation
// ---------------------------------------------------------------------------

export interface MoAttributionTierStats {
  /** Orders in the window (realised money only — PAID/PARTIALLY_REFUNDED). */
  orderCount: number;
  /** Sum of the realised order totals. */
  revenueAmount: number;
}

export interface MoAttributionKpis {
  direct: MoAttributionTierStats;
  assisted: MoAttributionTierStats;
  influenced: MoAttributionTierStats;
  /** Ingested orders in the window whose money is not (yet) realised
   * (pending/voided/refunded) — visible so nothing disappears silently. */
  unrealisedOrders: number;
  currency: string;
  /** Total ingested Mo-marked orders in the window (all tiers, all statuses). */
  totalOrders: number;
  /** True once at least one order was EVER ingested — before that the section
   * shows the "webhook not registered yet?" empty state. */
  ingestionSeen: boolean;
  attributionWindowDays: number;
  range: { from: string; to: string; days: number; label: string };
}

const EMPTY_TIER: MoAttributionTierStats = { orderCount: 0, revenueAmount: 0 };

/**
 * Tiered "Mo-zugeordneter Umsatz" for the dashboard window — a plain DB
 * aggregate over ingested orders (no Shopify calls, no caps, no sampling).
 * Returns null only when no DB is configured. Never throws.
 */
export async function getMoAttributionKpis(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<MoAttributionKpis | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT attribution_tier, financial_status, total_price, currency
        FROM mo_orders
       WHERE processed_at >= ${range.from}::date
         AND processed_at < (${range.to}::date + 1)
    `) as Array<{
      attribution_tier: string | null;
      financial_status: string | null;
      total_price: string | number | null;
      currency: string | null;
    }>;
    const seenRows = (await sql`
      SELECT 1 FROM mo_orders LIMIT 1
    `) as Array<Record<string, unknown>>;

    const tiers: Record<"direct" | "assisted" | "influenced", MoAttributionTierStats> = {
      direct: { ...EMPTY_TIER },
      assisted: { ...EMPTY_TIER },
      influenced: { ...EMPTY_TIER },
    };
    let unrealisedOrders = 0;
    let currency = "EUR";
    for (const row of rows) {
      if (row.currency) currency = String(row.currency);
      if (!isRealisedFinancialStatus(row.financial_status)) {
        unrealisedOrders++;
        continue;
      }
      const tier = row.attribution_tier as keyof typeof tiers | null;
      if (!tier || !(tier in tiers)) continue;
      const amount = row.total_price == null ? null : Number(row.total_price);
      tiers[tier].orderCount++;
      if (amount != null && Number.isFinite(amount) && amount >= 0) {
        tiers[tier].revenueAmount = Math.round((tiers[tier].revenueAmount + amount) * 100) / 100;
      }
    }

    return {
      ...tiers,
      unrealisedOrders,
      currency,
      totalOrders: rows.length,
      ingestionSeen: seenRows.length > 0,
      attributionWindowDays: attributionWindowDays(),
      range: { from: range.from, to: range.to, days: range.days, label: range.label },
    };
  } catch (err) {
    reportError(err, { route: "lib/mo-orders-store", phase: "getMoAttributionKpis" });
    return null;
  }
}
