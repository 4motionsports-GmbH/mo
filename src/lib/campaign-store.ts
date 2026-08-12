// Data access for the campaign module (Kampagnen-Modul, R12) — the Shopify
// marketing-subscriber audience, their pre-generated drafts, and the immutable
// campaign send records. See docs/CAMPAIGNS.md and migration 0034.
//
// Legal invariants enforced at THIS layer (the send path re-checks them all
// independently — defense in depth, see campaign-email.ts):
//   * Contacts are only ever written by the sync, which stores exclusively
//     Shopify-SUBSCRIBED customers and marks locally-suppressed / Shopify-
//     unsubscribed rows status='suppressed' (never deletes them mid-campaign —
//     audit trail).
//   * The queue reads exclude suppressed rows.
//   * campaign_sends rows are immutable once written (no UPDATE path exists).

import { createHash } from "node:crypto";
import { getSql, type Sql } from "./db";
import { normalizeEmail } from "./email-capture-store";
import { reportError } from "./observability";
import { wasDiscountCodeRedeemed } from "./shopify-orders";
import { isShopifyConfigured } from "./shopify";
import { KPI_CAMPAIGN_EMAIL_CLICKED } from "./kpi-events";
import type { KpiRange } from "./kpi-range";

export type CampaignContactStatus =
  | "pending"
  | "drafted"
  | "sending"
  | "sent"
  | "skipped"
  | "suppressed"
  | "draft_failed";

export interface CampaignContactRow {
  id: number;
  shopifyCustomerId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** EFFECTIVE email language: the operator override when set, else the
   * profile-derived value — every consumer (draft, preview, send) uses this. */
  language: "de" | "en";
  /** Profile-derived language (campaign-language.mjs), refreshed by the sync. */
  derivedLanguage: "de" | "en";
  /** Operator-pinned language (Kampagne tab), or null. Survives re-syncs. */
  languageOverride: "de" | "en" | null;
  optInLevel: string | null;
  consentUpdatedAt: string | null;
  ordersCount: number;
  totalSpentCents: number;
  lastSyncedAt: string | null;
  status: CampaignContactStatus;
  sentAt: string | null;
  skippedAt: string | null;
  createdAt: string | null;
}

/** Compact per-order snapshot stored on the draft to render the review card. */
export interface CampaignPurchaseSummary {
  orders: Array<{
    name: string;
    createdAt: string | null;
    totalAmount: string | null;
    currencyCode: string | null;
    items: Array<{
      title: string | null;
      quantity: number;
      /** Catalog product id (= Shopify handle) when the purchased item maps to
       * a current catalog product — the key the purchase-basis selection uses.
       * Null/absent = unmatched (old/removed item; drafts saved before
       * migration 0043 have no value at all). */
      productId?: string | null;
    }>;
  }>;
  /** True when the underlying Shopify read may have been truncated. */
  truncated: boolean;
}

export interface CampaignDraftRow {
  id: number;
  contactId: number;
  subject: string;
  body: string;
  discountPercent: number;
  discountExpiresAt: string | null;
  purchaseSummary: CampaignPurchaseSummary | null;
  recommendedProductIds: string[];
  /** Operator-narrowed purchase basis for the recommendations (catalog product
   * ids). NULL = all past purchases (the default). Survives regenerates. */
  purchaseSelectedIds: string[] | null;
  lowConfidence: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

function toIso(v: unknown): string | null {
  return v == null ? null : v instanceof Date ? v.toISOString() : String(v);
}

function mapContactRow(r: Record<string, unknown>): CampaignContactRow {
  const derivedLanguage = r.language === "en" ? ("en" as const) : ("de" as const);
  const languageOverride =
    r.language_override === "en" ? ("en" as const)
    : r.language_override === "de" ? ("de" as const)
    : null;
  return {
    id: Number(r.id),
    shopifyCustomerId: String(r.shopify_customer_id),
    email: String(r.email),
    firstName: (r.first_name as string | null) ?? null,
    lastName: (r.last_name as string | null) ?? null,
    language: languageOverride ?? derivedLanguage,
    derivedLanguage,
    languageOverride,
    optInLevel: (r.opt_in_level as string | null) ?? null,
    consentUpdatedAt: toIso(r.consent_updated_at),
    ordersCount: Number(r.orders_count ?? 0),
    totalSpentCents: Number(r.total_spent_cents ?? 0),
    lastSyncedAt: toIso(r.last_synced_at),
    status: r.status as CampaignContactStatus,
    sentAt: toIso(r.sent_at),
    skippedAt: toIso(r.skipped_at),
    createdAt: toIso(r.created_at),
  };
}

function mapDraftRow(r: Record<string, unknown>): CampaignDraftRow {
  return {
    id: Number(r.id),
    contactId: Number(r.contact_id),
    subject: String(r.subject ?? ""),
    body: String(r.body ?? ""),
    discountPercent: Number(r.discount_percent ?? 0),
    discountExpiresAt: toIso(r.discount_expires_at),
    purchaseSummary: (r.purchase_summary as CampaignPurchaseSummary | null) ?? null,
    recommendedProductIds: Array.isArray(r.recommended_product_ids)
      ? (r.recommended_product_ids as string[])
      : [],
    purchaseSelectedIds: Array.isArray(r.purchase_selected_ids)
      ? (r.purchase_selected_ids as string[])
      : null,
    lowConfidence: r.low_confidence === true,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Suppression (bulk + single) — OUR opt-out store is authoritative.
// ---------------------------------------------------------------------------

/**
 * The subset of `emails` that is locally suppressed: on the suppression list OR
 * carrying an unsubscribed capture (the same two signals isSuppressed checks,
 * in one bulk query for the sync). Fail-closed: on any error the FULL input set
 * is returned as suppressed, so a DB hiccup can never widen the audience.
 */
export async function listSuppressedEmails(
  emails: string[],
  sql: Sql | null = getSql()
): Promise<Set<string>> {
  const normalized = emails.map(normalizeEmail).filter(Boolean);
  if (!sql || normalized.length === 0) return new Set(normalized);
  try {
    const rows = (await sql`
      SELECT email FROM suppression_list WHERE email = ANY(${normalized}::text[])
      UNION
      SELECT email FROM email_captures
       WHERE email = ANY(${normalized}::text[]) AND unsubscribed_at IS NOT NULL
    `) as Array<{ email: string }>;
    return new Set(rows.map((r) => String(r.email)));
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "listSuppressedEmails" });
    return new Set(normalized); // fail-closed
  }
}

// ---------------------------------------------------------------------------
// Sync writes
// ---------------------------------------------------------------------------

export interface CampaignContactUpsert {
  shopifyCustomerId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  language: "de" | "en";
  optInLevel: string;
  consentUpdatedAt: string | null;
  ordersCount: number;
  totalSpentCents: number;
  /** Planned status (campaign-sync-core.planContactStatus). */
  status: CampaignContactStatus;
}

/** Map of shopify_customer_id → current row status, for the sync's planning. */
export async function getContactStatusesByShopifyIds(
  shopifyIds: string[],
  sql: Sql | null = getSql()
): Promise<Map<string, CampaignContactStatus>> {
  const out = new Map<string, CampaignContactStatus>();
  if (!sql || shopifyIds.length === 0) return out;
  const rows = (await sql`
    SELECT shopify_customer_id, status
      FROM campaign_contacts
     WHERE shopify_customer_id = ANY(${shopifyIds}::text[])
  `) as Array<{ shopify_customer_id: string; status: CampaignContactStatus }>;
  for (const r of rows) out.set(String(r.shopify_customer_id), r.status);
  return out;
}

/**
 * Idempotent upsert of one synced contact (keyed by shopify_customer_id).
 * Refreshes the Shopify-derived fields + last_synced_at and applies the planned
 * status. Throws on failure (the sync surfaces the real DB reason).
 */
export async function upsertCampaignContact(
  input: CampaignContactUpsert,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO campaign_contacts
      (shopify_customer_id, email, first_name, last_name, language,
       opt_in_level, consent_updated_at, orders_count, total_spent_cents,
       last_synced_at, status, created_at)
    VALUES
      (${input.shopifyCustomerId}, ${input.email}, ${input.firstName},
       ${input.lastName}, ${input.language}, ${input.optInLevel},
       ${input.consentUpdatedAt}, ${input.ordersCount}, ${input.totalSpentCents},
       now(), ${input.status}, now())
    ON CONFLICT (shopify_customer_id) DO UPDATE SET
      email              = EXCLUDED.email,
      first_name         = EXCLUDED.first_name,
      last_name          = EXCLUDED.last_name,
      language           = EXCLUDED.language,
      opt_in_level       = EXCLUDED.opt_in_level,
      consent_updated_at = EXCLUDED.consent_updated_at,
      orders_count       = EXCLUDED.orders_count,
      total_spent_cents  = EXCLUDED.total_spent_cents,
      last_synced_at     = now(),
      status             = EXCLUDED.status
  `;
}

/**
 * Mark every contact that did NOT appear in this sync pass as suppressed: they
 * dropped out of Shopify's SUBSCRIBED filter (unsubscribed / redacted on the
 * Shopify side). Never deletes (audit trail). Returns the number marked.
 */
export async function suppressContactsMissingFromSync(
  syncedShopifyIds: string[],
  sql: Sql | null = getSql()
): Promise<number> {
  if (!sql) return 0;
  const rows = (await sql`
    WITH upd AS (
      UPDATE campaign_contacts
         SET status = 'suppressed'
       WHERE status <> 'suppressed'
         AND NOT (shopify_customer_id = ANY(${syncedShopifyIds}::text[]))
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM upd
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Queue reads
// ---------------------------------------------------------------------------

export interface CampaignCounts {
  pending: number;
  drafted: number;
  sentTotal: number;
  sentToday: number;
  skipped: number;
  suppressed: number;
  draftFailed: number;
  byOptInLevel: Record<string, number>;
}

/** Header counts for the Kampagne tab. Returns null when no DB is configured. */
export async function getCampaignCounts(
  sql: Sql | null = getSql()
): Promise<CampaignCounts | null> {
  if (!sql) return null;
  try {
    const [statusRows, levelRows] = (await Promise.all([
      sql`
        SELECT
          count(*) FILTER (WHERE status = 'pending')::int AS pending,
          count(*) FILTER (WHERE status IN ('drafted','sending'))::int AS drafted,
          count(*) FILTER (WHERE status = 'sent')::int AS sent_total,
          count(*) FILTER (WHERE status = 'sent'
                             AND sent_at >= current_date)::int AS sent_today,
          count(*) FILTER (WHERE status = 'skipped')::int AS skipped,
          count(*) FILTER (WHERE status = 'suppressed')::int AS suppressed,
          count(*) FILTER (WHERE status = 'draft_failed')::int AS draft_failed
          FROM campaign_contacts
      `,
      sql`
        SELECT COALESCE(opt_in_level, 'UNKNOWN') AS level, count(*)::int AS n
          FROM campaign_contacts
         WHERE status <> 'suppressed'
         GROUP BY 1
      `,
    ])) as [Array<Record<string, unknown>>, Array<{ level: string; n: number }>];
    const s = statusRows[0] ?? {};
    const byOptInLevel: Record<string, number> = {};
    for (const r of levelRows) byOptInLevel[String(r.level)] = Number(r.n);
    return {
      pending: Number(s.pending ?? 0),
      drafted: Number(s.drafted ?? 0),
      sentTotal: Number(s.sent_total ?? 0),
      sentToday: Number(s.sent_today ?? 0),
      skipped: Number(s.skipped ?? 0),
      suppressed: Number(s.suppressed ?? 0),
      draftFailed: Number(s.draft_failed ?? 0),
      byOptInLevel,
    };
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "getCampaignCounts" });
    return null;
  }
}

/** A queue entry: the contact with its (present) draft. */
export interface CampaignQueueEntry {
  contact: CampaignContactRow;
  draft: CampaignDraftRow;
}

/**
 * The review queue: drafted contacts (oldest first, so the queue drains in
 * order) with their drafts. Suppressed rows never appear. Returns [] on error.
 */
export async function listDraftedQueue(
  limit = 250,
  sql: Sql | null = getSql()
): Promise<CampaignQueueEntry[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT c.*,
             d.id AS d_id, d.subject AS d_subject, d.body AS d_body,
             d.discount_percent AS d_discount_percent,
             d.discount_expires_at AS d_discount_expires_at,
             d.purchase_summary AS d_purchase_summary,
             d.recommended_product_ids AS d_recommended_product_ids,
             d.purchase_selected_ids AS d_purchase_selected_ids,
             d.low_confidence AS d_low_confidence,
             d.created_at AS d_created_at, d.updated_at AS d_updated_at
        FROM campaign_contacts c
        JOIN campaign_drafts d ON d.contact_id = c.id
       WHERE c.status = 'drafted'
       ORDER BY c.id ASC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      contact: mapContactRow(r),
      draft: mapDraftRow({
        id: r.d_id,
        contact_id: r.id,
        subject: r.d_subject,
        body: r.d_body,
        discount_percent: r.d_discount_percent,
        discount_expires_at: r.d_discount_expires_at,
        purchase_summary: r.d_purchase_summary,
        recommended_product_ids: r.d_recommended_product_ids,
        purchase_selected_ids: r.d_purchase_selected_ids,
        low_confidence: r.d_low_confidence,
        created_at: r.d_created_at,
        updated_at: r.d_updated_at,
      }),
    }));
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "listDraftedQueue" });
    return [];
  }
}

/**
 * The next `limit` contacts awaiting draft generation (status 'pending';
 * 'draft_failed' rows are NOT auto-retried — the admin regenerates those
 * explicitly). Oldest first for a stable, fair queue order.
 */
export async function listNextPendingContacts(
  limit: number,
  sql: Sql | null = getSql()
): Promise<CampaignContactRow[]> {
  if (!sql) return [];
  const rows = (await sql`
    SELECT * FROM campaign_contacts
     WHERE status = 'pending'
     ORDER BY id ASC
     LIMIT ${limit}
  `) as Array<Record<string, unknown>>;
  return rows.map(mapContactRow);
}

/** A contact row + whether a draft exists — the global contact search /
 * skipped-list shape (any status, so the admin can find sent/skipped/pending
 * people, not just the queue). */
export interface CampaignContactSearchHit {
  contact: CampaignContactRow;
  hasDraft: boolean;
}

/**
 * Case-insensitive substring search over ALL campaign contacts (email, first
 * and last name), any status, newest-synced first. Backs the review UI's
 * global contact search — deliberately not limited to the drafted queue, so a
 * specific person can be looked up and pulled INTO the queue. Never throws.
 */
export async function searchCampaignContacts(
  query: string,
  limit = 10,
  sql: Sql | null = getSql()
): Promise<CampaignContactSearchHit[]> {
  if (!sql) return [];
  const q = query.trim();
  if (!q) return [];
  const pattern = `%${q}%`;
  try {
    const rows = (await sql`
      SELECT c.*,
             EXISTS (SELECT 1 FROM campaign_drafts d WHERE d.contact_id = c.id) AS has_draft
        FROM campaign_contacts c
       WHERE c.email ILIKE ${pattern}
          OR c.first_name ILIKE ${pattern}
          OR c.last_name ILIKE ${pattern}
       ORDER BY c.last_synced_at DESC NULLS LAST, c.id DESC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ contact: mapContactRow(r), hasDraft: r.has_draft === true }));
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "searchCampaignContacts" });
    return [];
  }
}

/** Skipped contacts (newest skip first) + draft-existence, for the review
 * rail's "Übersprungen" section with its restore action. Never throws. */
export async function listSkippedContacts(
  limit = 100,
  sql: Sql | null = getSql()
): Promise<CampaignContactSearchHit[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT c.*,
             EXISTS (SELECT 1 FROM campaign_drafts d WHERE d.contact_id = c.id) AS has_draft
        FROM campaign_contacts c
       WHERE c.status = 'skipped'
       ORDER BY c.skipped_at DESC NULLS LAST, c.id DESC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({ contact: mapContactRow(r), hasDraft: r.has_draft === true }));
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "listSkippedContacts" });
    return [];
  }
}

/**
 * Undo a skip: 'skipped' → 'drafted' when a draft still exists (straight back
 * into the queue), else → 'pending' (the caller may generate a draft next).
 * Returns the new status, or null when the contact wasn't skipped.
 */
export async function unskipContact(
  contactId: number,
  sql: Sql | null = getSql()
): Promise<CampaignContactStatus | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE campaign_contacts c
         SET status = CASE
               WHEN EXISTS (SELECT 1 FROM campaign_drafts d WHERE d.contact_id = c.id)
                 THEN 'drafted'
               ELSE 'pending'
             END,
             skipped_at = NULL
       WHERE c.id = ${contactId} AND c.status = 'skipped'
      RETURNING c.status
    `) as Array<Record<string, unknown>>;
    return rows[0] ? (rows[0].status as CampaignContactStatus) : null;
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "unskipContact" });
    return null;
  }
}

export async function getContactById(
  contactId: number,
  sql: Sql | null = getSql()
): Promise<CampaignContactRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT * FROM campaign_contacts WHERE id = ${contactId}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapContactRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "getContactById" });
    return null;
  }
}

/**
 * Pin (or clear, with null) the operator's language override for a contact —
 * the Kampagne tab's DE/EN switch (migration 0040). Lives in its own column so
 * the sync's language re-derivation can never clobber it. Returns the updated
 * row (with the new EFFECTIVE language) or null when the contact is unknown.
 * Throws on DB failure so the route can answer with a real error.
 */
export async function setContactLanguageOverride(
  contactId: number,
  language: "de" | "en" | null,
  sql: Sql | null = getSql()
): Promise<CampaignContactRow | null> {
  if (!sql) return null;
  const rows = (await sql`
    UPDATE campaign_contacts
       SET language_override = ${language}
     WHERE id = ${contactId}
    RETURNING *
  `) as Array<Record<string, unknown>>;
  return rows[0] ? mapContactRow(rows[0]) : null;
}

export async function getDraftForContact(
  contactId: number,
  sql: Sql | null = getSql()
): Promise<CampaignDraftRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT * FROM campaign_drafts WHERE contact_id = ${contactId}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapDraftRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "getDraftForContact" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Draft writes
// ---------------------------------------------------------------------------

export interface SaveCampaignDraftInput {
  contactId: number;
  subject: string;
  body: string;
  discountPercent: number;
  /** Projected expiry for the preview; the real code gets its own at send. */
  discountExpiresAt: string | null;
  purchaseSummary: CampaignPurchaseSummary | null;
  recommendedProductIds: string[];
  /** Narrowed purchase basis to persist (null = all purchases). */
  purchaseSelectedIds: string[] | null;
  lowConfidence: boolean;
}

/**
 * Upsert the (single) draft for a contact — a regenerate or a changed discount
 * depth OVERWRITES the row (same rule as saveRegeneratedDraft) — and flip the
 * contact to 'drafted' (also recovering 'draft_failed'). Throws on failure so
 * the caller can mark the contact draft_failed with the real reason logged.
 */
export async function saveCampaignDraft(
  input: SaveCampaignDraftInput,
  sql: Sql | null = getSql()
): Promise<CampaignDraftRow | null> {
  if (!sql) return null;
  const rows = (await sql`
    INSERT INTO campaign_drafts
      (contact_id, subject, body, discount_percent, discount_expires_at,
       purchase_summary, recommended_product_ids, purchase_selected_ids,
       low_confidence, created_at, updated_at)
    VALUES
      (${input.contactId}, ${input.subject}, ${input.body},
       ${input.discountPercent}, ${input.discountExpiresAt},
       ${input.purchaseSummary ? JSON.stringify(input.purchaseSummary) : null}::jsonb,
       ${input.recommendedProductIds}::text[],
       ${input.purchaseSelectedIds}::text[], ${input.lowConfidence},
       now(), now())
    ON CONFLICT (contact_id) DO UPDATE SET
      subject                 = EXCLUDED.subject,
      body                    = EXCLUDED.body,
      discount_percent        = EXCLUDED.discount_percent,
      discount_expires_at     = EXCLUDED.discount_expires_at,
      purchase_summary        = EXCLUDED.purchase_summary,
      recommended_product_ids = EXCLUDED.recommended_product_ids,
      purchase_selected_ids   = EXCLUDED.purchase_selected_ids,
      low_confidence          = EXCLUDED.low_confidence,
      updated_at              = now()
    RETURNING *
  `) as Array<Record<string, unknown>>;
  await sql`
    UPDATE campaign_contacts
       SET status = 'drafted'
     WHERE id = ${input.contactId} AND status IN ('pending', 'drafted', 'draft_failed')
  `;
  return rows[0] ? mapDraftRow(rows[0]) : null;
}

/**
 * Persist the admin's edits (subject + body). Only while the contact is still
 * in review ('drafted') — a sent contact's record is immutable.
 */
export async function updateCampaignDraftText(
  contactId: number,
  subject: string,
  body: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE campaign_drafts d
         SET subject = ${subject}, body = ${body}, updated_at = now()
        FROM campaign_contacts c
       WHERE d.contact_id = ${contactId}
         AND c.id = d.contact_id
         AND c.status = 'drafted'
      RETURNING d.id
    `) as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "updateCampaignDraftText" });
    return false;
  }
}

/**
 * Persist manually-curated recommendations on a draft (review-time control:
 * the admin swaps products in/out via the catalog picker). Only while the
 * contact is still in review ('drafted'). Curated picks are trusted picks —
 * the low_confidence flag is cleared. Returns the updated draft or null.
 */
export async function updateCampaignDraftRecommendations(
  contactId: number,
  productIds: string[],
  sql: Sql | null = getSql()
): Promise<CampaignDraftRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE campaign_drafts d
         SET recommended_product_ids = ${productIds}::text[],
             low_confidence = false,
             updated_at = now()
        FROM campaign_contacts c
       WHERE d.contact_id = ${contactId}
         AND c.id = d.contact_id
         AND c.status = 'drafted'
      RETURNING d.*
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapDraftRow(rows[0]) : null;
  } catch (err) {
    reportError(err, {
      route: "lib/campaign-store",
      phase: "updateCampaignDraftRecommendations",
    });
    return null;
  }
}

/**
 * Set the discount depth on an EXISTING draft without regenerating the prose
 * (review-time control). Safe because the code + deadline ship
 * DETERMINISTICALLY outside the editable prose at send time; prose that states
 * a CONTRADICTING percentage is still refused by the send route's
 * detectDiscountTextMismatch backstop — the caller surfaces that warning.
 * Only while the contact is still 'drafted'. Returns the updated draft or null.
 */
export async function updateCampaignDraftDiscount(
  contactId: number,
  discountPercent: number,
  discountExpiresAt: string | null,
  sql: Sql | null = getSql()
): Promise<CampaignDraftRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE campaign_drafts d
         SET discount_percent = ${discountPercent},
             discount_expires_at = ${discountExpiresAt},
             updated_at = now()
        FROM campaign_contacts c
       WHERE d.contact_id = ${contactId}
         AND c.id = d.contact_id
         AND c.status = 'drafted'
      RETURNING d.*
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapDraftRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "updateCampaignDraftDiscount" });
    return null;
  }
}

/**
 * Rebuild-queue reset: delete the drafts of ALL contacts still in review
 * ('drafted') and return those contacts to 'pending', so the next "Prepare"
 * run regenerates them with the current generation code. Deliberately narrow:
 * sent/skipped/suppressed/sending contacts are untouched, and attached bundle
 * offers stay active (the regenerated draft picks them up again). Returns the
 * number of contacts reset. Throws on failure so the route surfaces the reason.
 */
export async function resetDraftedContacts(
  sql: Sql | null = getSql()
): Promise<number> {
  if (!sql) return 0;
  await sql`
    DELETE FROM campaign_drafts d
     USING campaign_contacts c
     WHERE c.id = d.contact_id AND c.status = 'drafted'
  `;
  const rows = (await sql`
    WITH upd AS (
      UPDATE campaign_contacts
         SET status = 'pending'
       WHERE status = 'drafted'
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM upd
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/** 'pending'|'drafted'|'draft_failed' → 'skipped' (review decision). */
export async function markContactSkipped(
  contactId: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE campaign_contacts
         SET status = 'skipped', skipped_at = now()
       WHERE id = ${contactId} AND status IN ('pending','drafted','draft_failed')
      RETURNING id
    `) as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "markContactSkipped" });
    return false;
  }
}

/** Batch-generation failure marker ('pending' → 'draft_failed'). Best-effort. */
export async function markContactDraftFailed(
  contactId: number,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE campaign_contacts
         SET status = 'draft_failed'
       WHERE id = ${contactId} AND status = 'pending'
    `;
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "markContactDraftFailed" });
  }
}

/**
 * Atomically claim a drafted contact for sending ('drafted' → 'sending') so two
 * concurrent send requests can't both proceed. Returns the contact only when
 * this call performed the transition.
 */
export async function claimContactForSend(
  contactId: number,
  sql: Sql | null = getSql()
): Promise<CampaignContactRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE campaign_contacts
         SET status = 'sending'
       WHERE id = ${contactId} AND status = 'drafted'
      RETURNING *
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapContactRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "claimContactForSend" });
    return null;
  }
}

/** Release a failed claim ('sending' → 'drafted') so the admin can retry. */
export async function revertContactClaim(
  contactId: number,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE campaign_contacts
         SET status = 'drafted'
       WHERE id = ${contactId} AND status = 'sending'
    `;
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "revertContactClaim" });
  }
}

/**
 * Flip a claimed ('sending') — or, for the explicit copy/mark-done flow, a
 * 'drafted' — contact to 'sent'. The `status <> 'sent'` guard makes it
 * double-send-proof.
 */
export async function markContactSent(
  contactId: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE campaign_contacts
         SET status = 'sent', sent_at = now()
       WHERE id = ${contactId} AND status IN ('sending','drafted')
      RETURNING id
    `) as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "markContactSent" });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Send records + cross-channel frequency cap
// ---------------------------------------------------------------------------

/** SHA-256 hex of the shipped text part — proves WHAT was sent. */
export function hashCampaignBody(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface RecordCampaignSendInput {
  contactId: number;
  email: string;
  subject: string;
  bodyHash: string;
  /** The shipped text part (real code swapped in); for 'copy' the copied prose. */
  bodyText: string | null;
  /** The shipped branded HTML part; NULL on the copy path (nothing HTML shipped). */
  bodyHtml: string | null;
  sentVia: "email" | "copy";
  discountCode: string | null;
  discountCodeGid: string | null;
  discountExpiresAt: string | null;
  /** Token behind the tracked CTA link (/api/r/<token>, migration 0041). NULL
   * on the copy path — nothing tracked left the system. */
  redirectToken?: string | null;
}

/** Append the immutable send record. Throws on failure (the send path treats a
 * missing record as a hard error — the audit trail is not optional). */
export async function recordCampaignSend(
  input: RecordCampaignSendInput,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) throw new Error("No database configured — cannot record campaign send");
  await sql`
    INSERT INTO campaign_sends
      (contact_id, email, subject, body_hash, body_text, body_html, sent_via,
       discount_code, discount_code_gid, discount_expires_at, redirect_token,
       sent_at, created_at)
    VALUES
      (${input.contactId}, ${normalizeEmail(input.email)}, ${input.subject},
       ${input.bodyHash}, ${input.bodyText}, ${input.bodyHtml},
       ${input.sentVia}, ${input.discountCode},
       ${input.discountCodeGid}, ${input.discountExpiresAt},
       ${input.redirectToken ?? null}, now(), now())
  `;
}

/**
 * Resolve a CAMPAIGN redirect token and record the click — the campaign sibling
 * of marketing-store.recordEmailClick, same two-step contract:
 *   - stamp clicked_at on the FIRST click only (`clicked_at IS NULL` guard),
 *   - log a campaign_email_clicked kpi_event on EVERY click so click volume
 *     stays visible (session NULL — an email click has no widget session).
 * Returns the send id + firstClick flag, or null when the token isn't a
 * campaign token (the caller then tries the other channels). Never throws.
 */
export async function recordCampaignClick(
  token: string,
  sql: Sql | null = getSql()
): Promise<{ sendId: number; firstClick: boolean } | null> {
  if (!sql) return null;
  const t = token.trim();
  if (!t) return null;
  try {
    const rows = (await sql`
      SELECT id, clicked_at FROM campaign_sends
       WHERE redirect_token = ${t}
       LIMIT 1
    `) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;

    const sendId = Number(row.id);
    const firstClick = row.clicked_at == null;

    await sql`
      UPDATE campaign_sends
         SET clicked_at = now()
       WHERE id = ${sendId} AND clicked_at IS NULL
    `;
    await sql`
      INSERT INTO kpi_events (session_id, event, data)
      VALUES (NULL, ${KPI_CAMPAIGN_EMAIL_CLICKED},
              ${JSON.stringify({ sendId, firstClick })}::jsonb)
    `;
    return { sendId, firstClick };
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "recordCampaignClick" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Campaign KPIs (KPI tab) — the MK- channel funnel + language split
// ---------------------------------------------------------------------------

// Bound the per-load Shopify redemption fan-out, mirroring the marketing
// funnel's cap discipline (newest coded sends first).
export const CAMPAIGN_KPI_MAX_CODES = 100;

export interface CampaignKpis {
  /** Send records inside the window (both delivery paths). */
  sent: number;
  sentViaEmail: number;
  sentViaCopy: number;
  /** Windowed sends that carry a tracked CTA link (redirect_token minted —
   * 'email' sends after migration 0041). The honest click-rate base. */
  trackedSends: number;
  /** Of the tracked windowed sends, how many were clicked at least once. */
  clicked: number;
  /** clicked / trackedSends — null when nothing tracked yet. */
  clickRate: number | null;
  /** Windowed sends by the recipient contact's EFFECTIVE language. Sends whose
   * contact was purged (SET NULL) land in `unknown`. */
  byLanguage: { de: number; en: number; unknown: number };
  /** Whether Shopify is wired up (false ⇒ redemption is unknowable). */
  shopifyConfigured: boolean;
  /** Windowed coded sends whose unique MK- code was redeemed in a real order. */
  converted: number;
  /** converted / codesChecked — the rate over the CHECKED sample (never over
   * uncoded or unchecked sends). Null when no code was checked. */
  conversionRate: number | null;
  codesChecked: number;
  /** Codes where Shopify couldn't answer (unconfigured / error) — not counted. */
  redemptionUnknown: number;
  /** True when the checked set was truncated to CAMPAIGN_KPI_MAX_CODES. */
  sampled: boolean;
}

/**
 * Aggregate the campaign channel for the KPI tab, scoped to the picker window
 * via sent_at. Cheap DB aggregates plus the capped per-code Shopify redemption
 * check the revenue KPI already does for MK- codes — here per send so the
 * funnel (gesendet → geklickt → eingelöst) lines up. Returns null when no DB is
 * configured or on a hard failure.
 */
export async function getCampaignKpis(
  range: KpiRange,
  sql: Sql | null = getSql()
): Promise<CampaignKpis | null> {
  if (!sql) return null;
  const shopifyConfigured = isShopifyConfigured();
  try {
    const [totalRows, langRows, codeRows] = await Promise.all([
      sql`
        SELECT
          count(*)::int AS sent,
          count(*) FILTER (WHERE sent_via = 'email')::int AS via_email,
          count(*) FILTER (WHERE sent_via = 'copy')::int  AS via_copy,
          count(*) FILTER (WHERE redirect_token IS NOT NULL)::int AS tracked,
          count(*) FILTER (WHERE redirect_token IS NOT NULL
                             AND clicked_at IS NOT NULL)::int AS clicked
          FROM campaign_sends
         WHERE sent_at >= ${range.from}::date
           AND sent_at < (${range.to}::date + 1)
      `,
      sql`
        SELECT COALESCE(c.language_override, c.language, 'unknown') AS lang,
               count(*)::int AS n
          FROM campaign_sends s
          LEFT JOIN campaign_contacts c ON c.id = s.contact_id
         WHERE s.sent_at >= ${range.from}::date
           AND s.sent_at < (${range.to}::date + 1)
         GROUP BY 1
      `,
      sql`
        SELECT discount_code
          FROM campaign_sends
         WHERE discount_code IS NOT NULL
           AND sent_at >= ${range.from}::date
           AND sent_at < (${range.to}::date + 1)
         ORDER BY sent_at DESC, id DESC
         LIMIT ${CAMPAIGN_KPI_MAX_CODES + 1}
      `,
    ]);

    const t = (totalRows as Array<Record<string, unknown>>)[0] ?? {};
    const byLanguage = { de: 0, en: 0, unknown: 0 };
    for (const r of langRows as Array<{ lang: string; n: number }>) {
      const key = r.lang === "de" || r.lang === "en" ? r.lang : "unknown";
      byLanguage[key] += Number(r.n);
    }

    const codeList = (codeRows as Array<{ discount_code: string }>).map((r) =>
      String(r.discount_code)
    );
    const sampled = codeList.length > CAMPAIGN_KPI_MAX_CODES;
    const codes = codeList.slice(0, CAMPAIGN_KPI_MAX_CODES);

    let converted = 0;
    let redemptionUnknown = 0;
    if (shopifyConfigured && codes.length) {
      const results = await Promise.all(codes.map((c) => wasDiscountCodeRedeemed(c)));
      for (const r of results) {
        if (r === null) redemptionUnknown++;
        else if (r) converted++;
      }
    } else {
      // Can't check — every coded send is "unknown" rather than "not converted".
      redemptionUnknown = codes.length;
    }
    const checkedKnown = codes.length - redemptionUnknown;

    const trackedSends = Number(t.tracked ?? 0);
    const clicked = Number(t.clicked ?? 0);
    return {
      sent: Number(t.sent ?? 0),
      sentViaEmail: Number(t.via_email ?? 0),
      sentViaCopy: Number(t.via_copy ?? 0),
      trackedSends,
      clicked,
      clickRate: trackedSends > 0 ? clicked / trackedSends : null,
      byLanguage,
      shopifyConfigured,
      converted,
      conversionRate: checkedKnown > 0 ? converted / checkedKnown : null,
      codesChecked: codes.length,
      redemptionUnknown,
      sampled,
    } satisfies CampaignKpis;
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "getCampaignKpis" });
    return null;
  }
}

/**
 * The newest send timestamp for an EMAIL across BOTH channels — campaign sends
 * (campaign_sends, by email) AND Mo-marketing sends (marketing_sends via the
 * capture join) — backing the shared MARKETING_MIN_SEND_INTERVAL_DAYS cap in
 * both directions. Null when never mailed / no DB / on error (fail-open like
 * lastMarketingSendAt: the cap is a cadence policy, the eligibility gates are
 * the hard ones).
 */
export async function lastCrossChannelSendAt(
  email: string,
  sql: Sql | null = getSql()
): Promise<string | null> {
  if (!sql) return null;
  const e = normalizeEmail(email);
  if (!e) return null;
  try {
    const rows = (await sql`
      SELECT max(t.sent_at) AS last_sent FROM (
        SELECT cs.sent_at
          FROM campaign_sends cs
         WHERE cs.email = ${e}
        UNION ALL
        SELECT ms.sent_at
          FROM marketing_sends ms
          JOIN email_captures ec ON ec.id = ms.email_capture_id
         WHERE ec.email = ${e} AND ms.status = 'sent'
      ) t
    `) as Array<Record<string, unknown>>;
    return toIso(rows[0]?.last_sent);
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "lastCrossChannelSendAt" });
    return null;
  }
}

export interface CampaignSendHistoryRow {
  id: number;
  contactId: number | null;
  email: string;
  subject: string | null;
  sentVia: "email" | "copy";
  discountCode: string | null;
  discountExpiresAt: string | null;
  sentAt: string | null;
  /** True when the shipped content was retained (body_text/body_html — sends
   * recorded before migration 0038 have neither). */
  hasContent: boolean;
}

/** Recent campaign sends (newest first) for the history sub-view. */
export async function listCampaignSendHistory(
  limit = 100,
  sql: Sql | null = getSql()
): Promise<CampaignSendHistoryRow[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, contact_id, email, subject, sent_via, discount_code,
             discount_expires_at, sent_at,
             (body_text IS NOT NULL OR body_html IS NOT NULL) AS has_content
        FROM campaign_sends
       ORDER BY sent_at DESC, id DESC
       LIMIT ${limit}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      contactId: r.contact_id != null ? Number(r.contact_id) : null,
      email: String(r.email),
      subject: (r.subject as string | null) ?? null,
      sentVia: r.sent_via === "copy" ? "copy" : "email",
      discountCode: (r.discount_code as string | null) ?? null,
      discountExpiresAt: toIso(r.discount_expires_at),
      sentAt: toIso(r.sent_at),
      hasContent: r.has_content === true,
    }));
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "listCampaignSendHistory" });
    return [];
  }
}

/** The retained content of ONE send record, for the "Gesendet" viewer. */
export interface CampaignSendContentRow {
  id: number;
  email: string;
  subject: string | null;
  sentVia: "email" | "copy";
  sentAt: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
}

/** Read one send record incl. the retained body parts. Null when the record
 * doesn't exist (the caller distinguishes "no record" from "no content"). */
export async function getCampaignSendContent(
  sendId: number,
  sql: Sql | null = getSql()
): Promise<CampaignSendContentRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT id, email, subject, sent_via, sent_at, body_text, body_html
        FROM campaign_sends
       WHERE id = ${sendId}
    `) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      email: String(r.email),
      subject: (r.subject as string | null) ?? null,
      sentVia: r.sent_via === "copy" ? "copy" : "email",
      sentAt: toIso(r.sent_at),
      bodyText: (r.body_text as string | null) ?? null,
      bodyHtml: (r.body_html as string | null) ?? null,
    };
  } catch (err) {
    reportError(err, { route: "lib/campaign-store", phase: "getCampaignSendContent" });
    return null;
  }
}
