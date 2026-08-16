// Data access for bundle offers (S10) — the bundle_offers table (migration 0013).
//
// One row per generated offer, lifecycle pending → active → expired | failed
// (see docs/BUNDLES.md). Mirrors the marketing-store conventions: getSql()
// default param, graceful null when no DB is configured, reportError on
// failures, and guarded UPDATEs for idempotency.

import { getSql, type Sql } from "./db";
import { generateRedirectToken } from "./marketing-store";
import { reportError } from "./observability";

export type BundleOfferStatus = "pending" | "active" | "expired" | "failed";

/** A persisted component snapshot (one entry of the components JSONB array). */
export interface BundleComponentRecord {
  productId: string;
  /** Display title — "Produktname – Variantentitel" for pinned variants. */
  title: string;
  /** The chosen variant's label ("16 kg"); absent for default/single-variant. */
  variantTitle?: string;
  variantId: string;
  numericVariantId: string | null;
  quantity: number;
  unitPrice: string;
  currency: string;
}

export interface BundleOfferRow {
  id: number;
  customerId: number | null;
  marketingSendId: number | null;
  /** Campaign contact this offer is attached to (migration 0035), or null. */
  campaignContactId: number | null;
  components: BundleComponentRecord[];
  /** Decimal Money strings (NUMERIC columns come back as strings). */
  componentsSum: string;
  bundlePrice: string;
  currency: string;
  title: string | null;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  numericVariantId: string | null;
  shopifyHandle: string | null;
  bundleOperationId: string | null;
  creationMode: string;
  status: BundleOfferStatus;
  error: string | null;
  cartUrl: string | null;
  redirectToken: string | null;
  expiresAt: string | null;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function mapRow(r: Record<string, unknown>): BundleOfferRow {
  return {
    id: Number(r.id),
    customerId: r.customer_id != null ? Number(r.customer_id) : null,
    marketingSendId: r.marketing_send_id != null ? Number(r.marketing_send_id) : null,
    campaignContactId: r.campaign_contact_id != null ? Number(r.campaign_contact_id) : null,
    // jsonb comes back already parsed from the neon driver; tolerate a string too.
    components:
      typeof r.components === "string"
        ? (JSON.parse(r.components) as BundleComponentRecord[])
        : ((r.components as BundleComponentRecord[]) ?? []),
    componentsSum: String(r.components_sum),
    bundlePrice: String(r.bundle_price),
    currency: (r.currency as string) ?? "EUR",
    title: (r.title as string | null) ?? null,
    shopifyProductId: (r.shopify_product_id as string | null) ?? null,
    shopifyVariantId: (r.shopify_variant_id as string | null) ?? null,
    numericVariantId: (r.numeric_variant_id as string | null) ?? null,
    shopifyHandle: (r.shopify_handle as string | null) ?? null,
    bundleOperationId: (r.bundle_operation_id as string | null) ?? null,
    creationMode: r.creation_mode as string,
    status: r.status as BundleOfferStatus,
    error: (r.error as string | null) ?? null,
    cartUrl: (r.cart_url as string | null) ?? null,
    redirectToken: (r.redirect_token as string | null) ?? null,
    expiresAt: (r.expires_at as string | null) ?? null,
    archivedAt: (r.archived_at as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
  };
}

export interface InsertPendingOfferInput {
  customerId: number | null;
  marketingSendId: number | null;
  /** Campaign contact this offer is attached to (campaign channel), or null. */
  campaignContactId?: number | null;
  components: BundleComponentRecord[];
  componentsSum: string;
  bundlePrice: string;
  currency: string;
  title: string | null;
  creationMode: string;
  expiresAt: string; // ISO
}

/**
 * Insert a fresh offer in 'pending' state with a minted redirect token. Returns
 * the created row (carrying the token), or null when no DB is configured.
 * Re-throws on a real DB error so the caller can surface the reason (a pending
 * offer with no Shopify product is a recoverable, diagnosable state).
 */
export async function insertPendingOffer(
  input: InsertPendingOfferInput,
  sql: Sql | null = getSql()
): Promise<BundleOfferRow | null> {
  if (!sql) return null;
  const token = generateRedirectToken();
  try {
    const rows = (await sql`
      INSERT INTO bundle_offers
        (customer_id, marketing_send_id, campaign_contact_id, components,
         components_sum, bundle_price, currency, title, creation_mode, status,
         redirect_token, expires_at, created_at, updated_at)
      VALUES
        (${input.customerId}, ${input.marketingSendId},
         ${input.campaignContactId ?? null},
         ${JSON.stringify(input.components)}::jsonb,
         ${input.componentsSum}, ${input.bundlePrice}, ${input.currency},
         ${input.title}, ${input.creationMode}, 'pending', ${token},
         ${input.expiresAt}, now(), now())
      RETURNING *
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "insertPendingOffer" });
    throw err;
  }
}

export interface ActivateOfferPatch {
  shopifyProductId: string;
  shopifyVariantId: string;
  numericVariantId: string | null;
  shopifyHandle: string | null;
  bundleOperationId: string | null;
  cartUrl: string | null;
}

/**
 * Flip a pending offer to 'active' with its Shopify linkage + materialized cart
 * URL. Guarded to non-final states so a double-create can't reactivate an
 * already-expired/failed offer. Returns the updated row or null.
 */
export async function markOfferActive(
  id: number,
  patch: ActivateOfferPatch,
  sql: Sql | null = getSql()
): Promise<BundleOfferRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE bundle_offers
         SET status = 'active',
             shopify_product_id = ${patch.shopifyProductId},
             shopify_variant_id = ${patch.shopifyVariantId},
             numeric_variant_id = ${patch.numericVariantId},
             shopify_handle = ${patch.shopifyHandle},
             bundle_operation_id = ${patch.bundleOperationId},
             cart_url = ${patch.cartUrl},
             error = NULL,
             updated_at = now()
       WHERE id = ${id} AND status = 'pending'
      RETURNING *
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "markOfferActive" });
    throw err;
  }
}

/** Record a creation failure (status='failed' + the error). Best-effort. */
export async function markOfferFailed(
  id: number,
  error: string,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE bundle_offers
         SET status = 'failed', error = ${error.slice(0, 1000)}, updated_at = now()
       WHERE id = ${id} AND status = 'pending'
    `;
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "markOfferFailed" });
  }
}

/**
 * Mark an offer expired/archived: status='expired' + archived_at=now. Guarded
 * to status='active' so it is idempotent (a repeat run updates zero rows) and
 * never resurrects a failed/pending offer. Used by BOTH the expiry cron and the
 * manual archive path. Returns true when this call actually flipped the row.
 */
export async function markOfferExpired(
  id: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE bundle_offers
         SET status = 'expired', archived_at = now(), updated_at = now()
       WHERE id = ${id} AND status = 'active'
      RETURNING id
    `) as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "markOfferExpired" });
    throw err;
  }
}

/**
 * Hard-DELETE a draft/unsent offer's row. Guarded to status IN ('pending',
 * 'failed') — the never-published DRAFT states (see isDeletableBundleStatus) —
 * so an active/published or expired offer can NEVER be deleted here (those use
 * the ARCHIVE path). Returns true only when this call actually removed the row,
 * so a racing activation (pending → active between read and delete) yields false
 * and the caller surfaces it rather than silently dropping a live offer. The
 * caller is responsible for archiving any (unexpected) Shopify product first.
 */
export async function deleteDraftOffer(
  id: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      DELETE FROM bundle_offers
       WHERE id = ${id} AND status IN ('pending', 'failed')
      RETURNING id
    `) as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "deleteDraftOffer" });
    throw err;
  }
}

/** Load one offer by id. */
export async function getBundleOfferById(
  id: number,
  sql: Sql | null = getSql()
): Promise<BundleOfferRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`SELECT * FROM bundle_offers WHERE id = ${id}`) as Array<
      Record<string, unknown>
    >;
    return rows[0] ? mapRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "getBundleOfferById" });
    return null;
  }
}

/** List a customer's offers, newest first (for the admin UI). */
export async function listBundleOffersForCustomer(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<BundleOfferRow[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT * FROM bundle_offers
       WHERE customer_id = ${customerId}
       ORDER BY created_at DESC, id DESC
       LIMIT 200
    `) as Array<Record<string, unknown>>;
    return rows.map(mapRow);
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "listBundleOffersForCustomer" });
    return [];
  }
}

/** Per-offer signals derived for the admin list: whether the offer rode out on a
 * SENT email (→ "sent" display status) and whether the tracked link reported a
 * click (the "redeemed" engagement signal). */
export interface BundleOfferSignals {
  /** sent_at of the linked marketing send, if that send was actually sent. */
  emailSentAt: string | null;
  /** True when ≥1 'bundle_offer_clicked' kpi_event exists for this offer. */
  clicked: boolean;
}

export type BundleOfferRowWithSignals = BundleOfferRow & BundleOfferSignals;

/**
 * List a customer's offers (newest first) enriched with the two display signals
 * the per-customer bundle list needs: the linked send's sent_at (so a bundle
 * that already rode out shows as "sent") and a clicked flag from the tracked
 * link's kpi_events (the redeemed/engagement signal). One query; never throws.
 */
export async function listBundleOffersWithSignalsForCustomer(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<BundleOfferRowWithSignals[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT bo.*,
             ms.sent_at AS email_sent_at,
             EXISTS (
               SELECT 1 FROM kpi_events k
                WHERE k.event = 'bundle_offer_clicked'
                  AND (k.data->>'offerId')::bigint = bo.id
             ) AS clicked
        FROM bundle_offers bo
        LEFT JOIN marketing_sends ms
          ON ms.id = bo.marketing_send_id AND ms.status = 'sent'
       WHERE bo.customer_id = ${customerId}
       ORDER BY bo.created_at DESC, bo.id DESC
       LIMIT 200
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      ...mapRow(r),
      emailSentAt: (r.email_sent_at as string | null) ?? null,
      clicked: r.clicked === true,
    }));
  } catch (err) {
    reportError(err, {
      route: "lib/bundle-offers-store",
      phase: "listBundleOffersWithSignalsForCustomer",
    });
    return [];
  }
}

/** The most recent ACTIVE offer for a customer that a new email may attach —
 * i.e. not already ridden out on a SENT email (so a bundle that was sent stays
 * "sent" and is not silently re-attached to a fresh draft). Null when none. */
export async function getActiveBundleForCustomer(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<BundleOfferRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT bo.*
        FROM bundle_offers bo
        LEFT JOIN marketing_sends ms ON ms.id = bo.marketing_send_id
       WHERE bo.customer_id = ${customerId}
         AND bo.status = 'active'
         AND (bo.marketing_send_id IS NULL OR ms.status <> 'sent')
       ORDER BY bo.created_at DESC, bo.id DESC
       LIMIT 1
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "getActiveBundleForCustomer" });
    return null;
  }
}

/** The ACTIVE offer linked to a marketing send — what the send path renders as
 * the special-offer block. Null when no live bundle is attached to the send. */
export async function getActiveBundleForSend(
  sendId: number,
  sql: Sql | null = getSql()
): Promise<BundleOfferRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT * FROM bundle_offers
       WHERE marketing_send_id = ${sendId} AND status = 'active'
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "getActiveBundleForSend" });
    return null;
  }
}

/**
 * Attach an ACTIVE offer to a marketing send (sets marketing_send_id) so the
 * send path can render its special-offer block. Guarded to status='active' so a
 * dead offer is never (re)attached. Returns true when this call linked the row.
 */
export async function linkBundleOfferToSend(
  offerId: number,
  sendId: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE bundle_offers
         SET marketing_send_id = ${sendId}, updated_at = now()
       WHERE id = ${offerId} AND status = 'active'
      RETURNING id
    `) as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "linkBundleOfferToSend" });
    return false;
  }
}

/**
 * Active offers past their deadline — the expiry cron's work list. `now` is
 * injectable for testing; defaults to the DB clock semantics (we pass an ISO
 * cutoff). Returns the minimal shape the sweep needs.
 */
export async function fetchDueBundleOffers(
  nowIso: string = new Date().toISOString(),
  sql: Sql | null = getSql()
): Promise<Array<{ id: number; shopifyProductId: string | null }>> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, shopify_product_id
        FROM bundle_offers
       WHERE status = 'active' AND expires_at < ${nowIso}
       ORDER BY expires_at ASC
       LIMIT 500
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      shopifyProductId: (r.shopify_product_id as string | null) ?? null,
    }));
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "fetchDueBundleOffers" });
    throw err;
  }
}

/** The ACTIVE offer attached to a campaign contact — what the campaign card
 * shows and the campaign send path renders as the special-offer block. Null
 * when none. Newest first, mirroring getActiveBundleForSend. */
export async function getActiveBundleForCampaignContact(
  contactId: number,
  sql: Sql | null = getSql()
): Promise<BundleOfferRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT * FROM bundle_offers
       WHERE campaign_contact_id = ${contactId} AND status = 'active'
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapRow(rows[0]) : null;
  } catch (err) {
    reportError(err, {
      route: "lib/bundle-offers-store",
      phase: "getActiveBundleForCampaignContact",
    });
    return null;
  }
}

/**
 * Bulk variant for the campaign review queue: the active offer per contact id
 * (at most one — the newest — per contact, matching the single-lookup above).
 * One query for the whole queue instead of a per-card fan-out. Never throws.
 */
export async function listActiveBundlesForCampaignContacts(
  contactIds: number[],
  sql: Sql | null = getSql()
): Promise<Map<number, BundleOfferRow>> {
  const out = new Map<number, BundleOfferRow>();
  if (!sql || contactIds.length === 0) return out;
  try {
    const rows = (await sql`
      SELECT DISTINCT ON (campaign_contact_id) *
        FROM bundle_offers
       WHERE campaign_contact_id = ANY(${contactIds}::bigint[])
         AND status = 'active'
       ORDER BY campaign_contact_id, created_at DESC, id DESC
    `) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const mapped = mapRow(r);
      if (mapped.campaignContactId != null) out.set(mapped.campaignContactId, mapped);
    }
    return out;
  } catch (err) {
    reportError(err, {
      route: "lib/bundle-offers-store",
      phase: "listActiveBundlesForCampaignContacts",
    });
    return out;
  }
}

export interface BundleRedirectResolution {
  /** The real Shopify cart permalink to forward to (active offers only). */
  destination: string | null;
  status: BundleOfferStatus;
  offerId: number;
}

/**
 * Resolve a redirect token to its bundle offer for /api/r/<token>. Logs the
 * click as a kpi_event (volume visible, like discount links). Returns the
 * resolution (with the offer's lifecycle status so the route can serve the
 * friendly "Angebot abgelaufen" page for expired/archived offers) or null when
 * the token is unknown. Never throws.
 */
export async function resolveBundleRedirect(
  token: string,
  sql: Sql | null = getSql()
): Promise<BundleRedirectResolution | null> {
  if (!sql) return null;
  const t = token.trim();
  if (!t) return null;
  try {
    const rows = (await sql`
      SELECT id, status, cart_url, customer_id
        FROM bundle_offers
       WHERE redirect_token = ${t}
       LIMIT 1
    `) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;

    const offerId = Number(row.id);
    const status = row.status as BundleOfferStatus;
    // Only an active offer forwards to its live cart; everything else (expired,
    // failed, pending) yields no destination so the route serves the friendly page.
    const destination = status === "active" ? ((row.cart_url as string | null) ?? null) : null;

    await sql`
      INSERT INTO kpi_events (session_id, event, data)
      VALUES (
        NULL,
        'bundle_offer_clicked',
        ${JSON.stringify({ offerId, status, expired: status !== "active" })}::jsonb
      )
    `;
    return { destination, status, offerId };
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "resolveBundleRedirect" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bundle KPIs (KPI tab)
// ---------------------------------------------------------------------------

export interface BundleKpis {
  /** Offers CREATED inside the window, by lifecycle status (current status —
   * an offer created in the window and expired since counts as expired). */
  created: { total: number; pending: number; active: number; expired: number; failed: number };
  /** Currently active offers (regardless of creation date) — the live stock. */
  activeNow: number;
  /** bundle_offer_clicked events inside the window (every click counts). */
  clicks: number;
  /** Distinct offers clicked inside the window. */
  clickedOffers: number;
  /** Discount vs. the true component sum across windowed offers: averages of
   * bundle_price / components_sum (only rows with a positive sum). */
  avgDiscountPct: number | null;
}

/**
 * Aggregate the bundle-offer channel for the KPI tab, scoped to the picker
 * window. Clicks come from the bundle_offer_clicked kpi_events the tracked
 * redirect writes; PURCHASES of a bundle are deliberately NOT attributed here
 * (no reliable order↔offer signal is stored — see lib/kpi-revenue-store's
 * honesty note). Returns null when no DB is configured or on a hard failure.
 */
export async function getBundleKpis(
  range: { from: string; to: string },
  sql: Sql | null = getSql()
): Promise<BundleKpis | null> {
  if (!sql) return null;
  try {
    const [offerRows, activeRows, clickRows, discountRows] = await Promise.all([
      sql`
        SELECT status, count(*)::int AS n
          FROM bundle_offers
         WHERE created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
         GROUP BY status
      `,
      sql`SELECT count(*)::int AS n FROM bundle_offers WHERE status = 'active'`,
      sql`
        SELECT count(*)::int AS clicks,
               count(DISTINCT data->>'offerId')::int AS offers
          FROM kpi_events
         WHERE event = 'bundle_offer_clicked'
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
      `,
      sql`
        SELECT avg(1 - bundle_price / components_sum)::float AS avg_discount
          FROM bundle_offers
         WHERE components_sum > 0
           AND created_at >= ${range.from}::date
           AND created_at < (${range.to}::date + 1)
      `,
    ]);

    const created = { total: 0, pending: 0, active: 0, expired: 0, failed: 0 };
    for (const r of offerRows as Array<{ status: string; n: number }>) {
      const n = Number(r.n);
      created.total += n;
      if (r.status in created && r.status !== "total") {
        created[r.status as BundleOfferStatus] = n;
      }
    }
    const avgDiscountRaw = (discountRows as Array<{ avg_discount: number | null }>)[0]
      ?.avg_discount;
    return {
      created,
      activeNow: Number((activeRows as Array<{ n: number }>)[0]?.n ?? 0),
      clicks: Number((clickRows as Array<{ clicks: number }>)[0]?.clicks ?? 0),
      clickedOffers: Number(
        (clickRows as Array<{ offers: number }>)[0]?.offers ?? 0
      ),
      avgDiscountPct:
        avgDiscountRaw == null || !Number.isFinite(Number(avgDiscountRaw))
          ? null
          : Number(avgDiscountRaw),
    } satisfies BundleKpis;
  } catch (err) {
    reportError(err, { route: "lib/bundle-offers-store", phase: "getBundleKpis" });
    return null;
  }
}
