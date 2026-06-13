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
  title: string;
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
        (customer_id, marketing_send_id, components, components_sum, bundle_price,
         currency, title, creation_mode, status, redirect_token, expires_at,
         created_at, updated_at)
      VALUES
        (${input.customerId}, ${input.marketingSendId},
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
