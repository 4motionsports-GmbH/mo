// I/O layer of the Mo order-attribution pipeline (pure logic:
// lib/order-attribution.mjs; design: docs/ORDER_ATTRIBUTION.md).
//
// Two responsibilities (the KPI aggregation over mo_orders lives in
// lib/mo-revenue-store — „Umsatz durch Mo“):
//   1. MINT attribution tokens — opaque, server-side random ids that ride on
//      Mo-built cart links (`attributes[_mo]=<token>`) or that the widget
//      stamps onto the live storefront cart. One token per (session, source),
//      reused on re-request, so a session never accumulates marker spam; a
//      reused mail-link token restarts its window (created_at = now()).
//   2. INGEST orders/create + orders/paid webhook deliveries — idempotent
//      upsert keyed by shopify_order_id. Only orders carrying a Mo marker are
//      stored (data minimisation); the tier is snapshotted at ingest against
//      the session's discussed/selected products.
//
// GDPR: everything here is Cluster A — session-keyed, pseudonymous. The
// webhook payload's customer fields are never read (see parseOrderWebhook).
// Best-effort discipline like every store in this repo: no DB → null/no-op,
// failures are reported and swallowed, a webhook 500 is returned only for a
// real processing failure so Shopify retries an idempotent operation.

import { getSql, type Sql } from "./db";
import { loadProductCatalog } from "./product-catalog";
import { hasRecommendedPurchase } from "./kpi-match.mjs";
import {
  parseOrderWebhook,
  hasMoMarker,
  isMoDiscountCode,
  matchOrderLineItems,
  classifyAttributionTier,
  isWithinAttributionWindow,
  attributionAnchor,
  isSessionAnchoredSource,
  unresolvedMarkerEvent,
  unresolvedMarkerDedupeKey,
  restartsWindowOnReuse,
  overlapLookback,
  unionConsultedProducts,
  CONSULTATION_ANCHOR_TOOLS,
} from "./order-attribution.mjs";
import { isAttributionSessionAnchorEnabled } from "./platform-flags.mjs";
import { recordKpiEvent, KPI_MO_ORDER_MARKER_UNRESOLVED } from "./kpi-events";
import { reportError } from "./observability";
import { parseIntEnv } from "./env-num";

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

/** Attribution window (days) between the anchor and the order: the token's
 * minting, or — MO_ATTRIBUTION_SESSION_ANCHOR on, widget tokens — the device's
 * latest product consultation before the order. Orders older than this
 * relative to their anchor are NOT attributed (honesty: a months-old
 * consultation shouldn't claim an unrelated purchase). */
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
 * sessionless carrier (bundle links) every call mints a fresh token.
 *
 * Reuse: the widget gets its existing token unchanged (its window is the
 * session anchor). A Mo-built link source (summary / marketing e-mail) gets
 * its existing token with `created_at` re-stamped to now — the window and the
 * retention purge count from `created_at`, so without it a mail sent 31–37
 * days after the session's first one shipped a link that was already outside
 * the window (restartsWindowOnReuse). The earlier mails carry the same token
 * and keep attributing, within the window of the latest mail.
 *
 * Returns null when no DB is configured or on failure — callers then simply
 * ship the unstamped URL (the link still works; only attribution is lost).
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
      const existing = restartsWindowOnReuse(source)
        ? ((await sql`
            UPDATE mo_attribution_tokens
               SET created_at = now()
             WHERE session_id = ${sid} AND source = ${source}
            RETURNING token
          `) as Array<{ token: string }>)
        : ((await sql`
            SELECT token FROM mo_attribution_tokens
             WHERE session_id = ${sid} AND source = ${source}
             LIMIT 1
          `) as Array<{ token: string }>);
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
  /** What happened: stored | updated | ignored (+ reason) | failed. A marked
   * order that cannot be attributed is ignored with reason 'unknown_token'
   * (token not in the table: purged, erased, forged) or 'outside_window'. */
  action: "stored" | "updated" | "ignored" | "failed";
  reason?: string;
  tier?: string | null;
  /** Source of a token that resolved but fell outside the window. */
  tokenSource?: string;
}

/**
 * The latest product consultation written by `sessionId` at or before the
 * order (ATTR-TOKEN-LIFETIME). Rows since 0076 carry their writer
 * (messages.session_id); older rows (NULL) fall back to the thread's session
 * until they leave the 37-day horizon. Throws — a failed lookup must reach the
 * ingest's db-error path so Shopify retries instead of losing the order.
 */
async function lastConsultationAt(
  sessionId: string,
  orderAt: string,
  sql: Sql
): Promise<string | Date | null> {
  const tools = [...CONSULTATION_ANCHOR_TOOLS];
  const rows = (await sql`
    SELECT GREATEST(
      (SELECT max(m.created_at)
         FROM messages m
        WHERE m.session_id = ${sessionId}
          AND m.tool_name = ANY(${tools}::text[])
          AND m.created_at <= ${orderAt}::timestamptz),
      (SELECT max(m.created_at)
         FROM conversations c
         JOIN messages m ON m.conversation_id = c.id
        WHERE c.session_id = ${sessionId}
          AND m.session_id IS NULL
          AND m.tool_name = ANY(${tools}::text[])
          AND m.created_at <= ${orderAt}::timestamptz)
    ) AS last_consulted
  `) as Array<{ last_consulted: string | Date | null }>;
  return rows[0]?.last_consulted ?? null;
}

/**
 * Products discussed or selected in the linked consultation, for the overlap
 * check (ATTR §9.2): the union over every thread of the session that started
 * at or before the order and was active within the attribution window before
 * it (overlapLookback) — not only the latest thread. Thread level
 * (conversations.session_id), as before. Throws — a failed read must reach
 * the ingest's db-error path so Shopify retries, instead of snapshotting
 * „influenced“ for good.
 */
async function consultedProductIds(
  sessionId: string,
  orderAt: string | null,
  sql: Sql
): Promise<string[]> {
  const span = overlapLookback(orderAt, attributionWindowDays());
  if (!span) return [];
  const rows = (await sql`
    SELECT recommended_product_ids, selected_product_ids
      FROM conversations
     WHERE session_id = ${sessionId}
       AND created_at <= ${span.until}::timestamptz
       AND last_activity_at >= ${span.since}::timestamptz
     ORDER BY last_activity_at DESC, id DESC
     LIMIT 100
  `) as Array<{ recommended_product_ids: string[] | null; selected_product_ids: string[] | null }>;
  return unionConsultedProducts(rows);
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

    // Resolve the token → (session, source, anchor). An unknown token (aged
    // out by retention, erased, forged) or one outside the window contributes
    // nothing; the reason is returned for the unresolved-marker counter.
    let tokenSource: string | null = null;
    let sessionId: string | null = null;
    let unresolved: "unknown_token" | "outside_window" | null = null;
    let unresolvedSource: string | undefined;
    if (parsed.moToken) {
      const rows = (await sql`
        SELECT session_id, source, created_at
          FROM mo_attribution_tokens WHERE token = ${parsed.moToken} LIMIT 1
      `) as Array<{ session_id: string | null; source: string; created_at: string | Date }>;
      const row = rows[0];
      if (!row) {
        unresolved = "unknown_token";
      } else {
        const sid = row.session_id ? String(row.session_id) : null;
        const source = String(row.source);
        const orderAt = parsed.processedAt;
        let lastConsultedAt: string | Date | null = null;
        if (
          isAttributionSessionAnchorEnabled() &&
          isSessionAnchoredSource(source) &&
          sid &&
          orderAt &&
          Number.isFinite(Date.parse(orderAt))
        ) {
          lastConsultedAt = await lastConsultationAt(sid, orderAt, sql);
        }
        const anchor = attributionAnchor({
          source,
          tokenCreatedAt: row.created_at,
          lastConsultedAt,
          orderAt,
        });
        if (isWithinAttributionWindow(orderAt, anchor, attributionWindowDays())) {
          tokenSource = source;
          sessionId = sid;
        } else {
          unresolved = "outside_window";
          unresolvedSource = source;
        }
      }
    }

    const hasMoCode = parsed.discountCodes.some(isMoDiscountCode);
    if (!hasMoCode && !tokenSource) {
      // Marker present but unresolvable or outside the window → honestly
      // unattributable; counted (without the order) by noteUnresolvedMarker.
      return {
        ok: true,
        action: "ignored",
        reason: unresolved ?? "outside_window",
        ...(unresolved === "outside_window" && unresolvedSource ? { tokenSource: unresolvedSource } : {}),
      };
    }

    // Map line items to catalog handles (variant id, then normalised title).
    const catalog = await loadProductCatalog();
    const { items, matchedHandles } = matchOrderLineItems(parsed.lineItems, catalog);

    // Product overlap with the linked consultation (discussed ∪ selected,
    // across the session's threads inside the window before the order).
    let hasOverlap = false;
    if (sessionId && matchedHandles.length > 0) {
      const consulted = await consultedProductIds(sessionId, parsed.processedAt, sql);
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
 * Claim the one count of a Shopify event (key from unresolvedMarkerDedupeKey)
 * in the webhook dedupe table — no order id, purged with it on the sync-log
 * window. False when the event was already counted. Fails open like
 * recordWebhookDelivery: no DB or a DB error never drops a count.
 */
async function claimUnresolvedMarker(key: string, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return true;
  try {
    const rows = (await sql`
      INSERT INTO shopify_webhook_events (webhook_id, topic, processed_at, outcome)
      VALUES (${key}, ${KPI_MO_ORDER_MARKER_UNRESOLVED}, now(), 'counted')
      ON CONFLICT (webhook_id) DO NOTHING
      RETURNING webhook_id
    `) as Array<{ webhook_id: string }>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/mo-orders-store", phase: "claimUnresolvedMarker" });
    return true;
  }
}

/**
 * Count a Mo-marked order that could not be attributed — the server event
 * `mo_order_marker_unresolved {reason, source?}`, session NULL, never an order
 * id, token or amount. orders/create only (the filter is in the pure core), so
 * the orders/paid delivery of the same order does not count it again. Call it
 * after the webhook delivery was recorded as done (a retry of the same
 * delivery is absorbed by its X-Shopify-Webhook-Id). With the delivery's
 * X-Shopify-Event-Id it also counts once per Shopify event — a second
 * subscription or a redelivery under a new webhook id adds nothing. Never throws.
 */
export async function noteUnresolvedMarker(
  topic: string,
  result: IngestOrderResult,
  shopifyEventId: string | null = null
): Promise<void> {
  const data = unresolvedMarkerEvent(topic, result);
  if (!data) return;
  const key = unresolvedMarkerDedupeKey(shopifyEventId);
  if (key && !(await claimUnresolvedMarker(key))) return;
  await recordKpiEvent({ sessionId: null, event: KPI_MO_ORDER_MARKER_UNRESOLVED, data });
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
