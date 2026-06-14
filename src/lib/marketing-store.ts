// Data access for the admin marketing dashboard (Cluster B — explicit consent).
//
// Bridges the two GDPR clusters READ-ONLY for display: an eligible email capture
// (Cluster B) is matched to its conversation (Cluster A) via the pseudonymous
// session_id — the same optional bridge the summary email uses. We never write
// email into Cluster A.
//
// "Eligible" everywhere here means the SAME bar the send path enforces:
// marketing_doi_status = 'confirmed' AND not unsubscribed AND not on the
// suppression list. The dashboard only ever lists eligible contacts, and the
// send path re-checks independently (see canSendMarketing).

import { getSql, type Sql } from "./db";
import { normalizeEmail } from "./email-capture-store";
import { loadConversationForSummary, type TranscriptMessage } from "./conversation-store";
import { getProductsByIds } from "./product-catalog";
import { chooseCartProductIds } from "./cart";
import {
  checkRecentPurchase,
  wasDiscountCodeRedeemed,
  type PurchaseCheck,
} from "./shopify-orders";
import { isShopifyConfigured } from "./shopify";
import { ARCHETYPE_META } from "./persona";
import type { PersonaArchetype } from "./types";
import { reportError } from "./observability";

export type MarketingSendStatus = "draft" | "approved" | "sent";

export interface MarketingSendRow {
  id: number;
  emailCaptureId: number;
  /**
   * The customer this draft was generated FROM (per-customer full-context
   * drafts, migration 0010). Null for legacy per-capture drafts.
   */
  customerId: number | null;
  /**
   * Snapshot of the admin's special instructions that went into THIS draft —
   * frozen here for the audit trail (the editable value lives on the customer).
   */
  adminInstructions: string | null;
  status: MarketingSendStatus;
  subject: string | null;
  draftedText: string | null;
  /** Admin-selected discount depth (whole-number percent). 0 = no offer. */
  discountPercent: number;
  discountCode: string | null;
  discountExpiresAt: string | null;
  cartUrl: string | null;
  productIds: string[];
  personaLabel: string | null;
  /** Unique token for the tracked redirect link (/api/r/<token>); minted at send. */
  redirectToken: string | null;
  /** First-click timestamp on the tracked link (null = not yet clicked). */
  clickedAt: string | null;
  sentAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MarketingTarget {
  captureId: number;
  email: string;
  sessionId: string | null;
  confirmedAt: string | null;
  personaLabel: string | null;
  /** Human-readable persona label (German), derived from the archetype id. */
  personaDisplay: string | null;
  productIds: string[];
  products: Array<{ id: string; name: string }>;
  /** Readable conversation turns (tool bookkeeping rows dropped). */
  transcript: TranscriptMessage[];
  /** "Chatted but not purchased" signal — see shopify-orders.checkRecentPurchase. */
  purchase: PurchaseCheck;
  /** The latest marketing_sends row for this capture, if any. */
  latestSend: MarketingSendRow | null;
}

export interface EligibleCapture {
  id: number;
  email: string;
  sessionId: string | null;
}

function personaDisplayLabel(label: string | null): string | null {
  if (!label) return null;
  const meta = ARCHETYPE_META[label as PersonaArchetype];
  return meta ? meta.label : label;
}

function mapSendRow(r: Record<string, unknown>): MarketingSendRow {
  return {
    id: Number(r.id),
    emailCaptureId: Number(r.email_capture_id),
    customerId: r.customer_id != null ? Number(r.customer_id) : null,
    adminInstructions: (r.admin_instructions as string | null) ?? null,
    status: r.status as MarketingSendStatus,
    subject: (r.subject as string | null) ?? null,
    draftedText: (r.drafted_text as string | null) ?? null,
    discountPercent: r.discount_percent != null ? Number(r.discount_percent) : 0,
    discountCode: (r.discount_code as string | null) ?? null,
    discountExpiresAt: (r.discount_expires_at as string | null) ?? null,
    cartUrl: (r.cart_url as string | null) ?? null,
    productIds: Array.isArray(r.product_ids) ? (r.product_ids as string[]) : [],
    personaLabel: (r.persona_label as string | null) ?? null,
    redirectToken: (r.redirect_token as string | null) ?? null,
    clickedAt: (r.clicked_at as string | null) ?? null,
    sentAt: (r.sent_at as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
  };
}

/**
 * List every marketing-eligible contact for the dashboard, enriched with their
 * conversation transcript/persona/products, the "chatted but not purchased"
 * flag, and any existing draft/sent row. Returns [] when no DB is configured.
 */
export async function listMarketingTargets(
  sql: Sql | null = getSql()
): Promise<MarketingTarget[]> {
  if (!sql) return [];

  let captureRows: Array<Record<string, unknown>>;
  try {
    captureRows = (await sql`
      SELECT ec.id, ec.email, ec.session_id, ec.doi_confirmed_at
        FROM email_captures ec
       WHERE ec.marketing_doi_status = 'confirmed'
         AND ec.unsubscribed_at IS NULL
         AND NOT EXISTS (
               SELECT 1 FROM suppression_list s WHERE s.email = ec.email
             )
       ORDER BY ec.doi_confirmed_at DESC NULLS LAST, ec.id DESC
       LIMIT 200
    `) as Array<Record<string, unknown>>;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "listCaptures" });
    return [];
  }

  // Build each target concurrently. Conversation load + latest send are DB
  // reads; the purchase check hits Shopify. All degrade gracefully.
  return Promise.all(
    captureRows.map(async (row) => {
      const captureId = Number(row.id);
      const email = String(row.email);
      const sessionId = (row.session_id as string | null) ?? null;

      const [conversation, latestSend, purchase] = await Promise.all([
        sessionId ? loadConversationForSummary(sessionId) : Promise.resolve(null),
        getLatestSendForCapture(captureId, sql),
        checkRecentPurchase(email),
      ]);

      // Same chooser the draft/send path uses, so the dashboard previews the
      // exact product set a marketing email for this contact would carry.
      const productIds = chooseCartProductIds(conversation);
      const products = productIds.length
        ? (await getProductsByIds(productIds)).map((p) => ({ id: p.id, name: p.name }))
        : [];
      const transcript = (conversation?.messages ?? []).filter(
        (m) =>
          m.toolName === null &&
          (m.role === "user" || m.role === "assistant") &&
          m.content.trim()
      );
      const personaLabel = conversation?.personaLabel ?? null;

      return {
        captureId,
        email,
        sessionId,
        confirmedAt: (row.doi_confirmed_at as string | null) ?? null,
        personaLabel,
        personaDisplay: personaDisplayLabel(personaLabel),
        productIds,
        products,
        transcript,
        purchase,
        latestSend,
      } satisfies MarketingTarget;
    })
  );
}

/** The most recent marketing_sends row for a capture, or null. */
export async function getLatestSendForCapture(
  captureId: number,
  sql: Sql | null = getSql()
): Promise<MarketingSendRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT *
        FROM marketing_sends
       WHERE email_capture_id = ${captureId}
       ORDER BY (status = 'sent') ASC, created_at DESC, id DESC
       LIMIT 1
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapSendRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "getLatestSendForCapture" });
    return null;
  }
}

/** Load a marketing_sends row by id. */
export async function getSendById(
  sendId: number,
  sql: Sql | null = getSql()
): Promise<MarketingSendRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT *
        FROM marketing_sends WHERE id = ${sendId}
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapSendRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "getSendById" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Click-tracking — the tracked redirect link in sent marketing emails.
// ---------------------------------------------------------------------------
//
// The email links to /api/r/<token> instead of straight to Shopify. The token
// maps to one marketing_sends row, whose cart_url is the REAL prefilled-cart URL
// (with ?discount=CODE). The redirect endpoint logs the click and forwards there.
//
// GDPR: this is a click on a link the user CHOSE to click — not covert
// surveillance, no open-tracking pixel.

// Bound the number of Shopify code-redemption checks per dashboard load, so the
// funnel is a sample, not an unbounded fan-out of Admin API calls.
const MARKETING_FUNNEL_MAX_CODES = 100;

export interface MarketingFunnel {
  /** Emails actually sent (marketing_sends.status = 'sent'). */
  sent: number;
  /** Of those, emails whose tracked link was clicked (clicked_at set). */
  clicked: number;
  /** clicked / sent — null when nothing was sent. */
  clickRate: number | null;
  /** Whether Shopify is wired up (false ⇒ conversion is unknowable). */
  shopifyConfigured: boolean;
  /** Sent emails whose UNIQUE single-use code was redeemed in a real order. */
  converted: number;
  /** converted / sent — null when nothing was sent. */
  conversionRate: number | null;
  /** Codes actually checked against Shopify (capped sample). */
  codesChecked: number;
  /** Codes where Shopify couldn't answer (unconfigured / error). */
  redemptionUnknown: number;
  /** True when the codes set was truncated to the cap. */
  sampled: boolean;
}

/**
 * The marketing funnel: sent → clicked → converted (the send's unique code was
 * redeemed). `sent`/`clicked` are a cheap DB aggregate; `converted` reuses the
 * read_orders logic, checking each sent code's redemption (capped, never throws).
 * Returns null only when no DB is configured.
 */
export async function getMarketingFunnel(
  sql: Sql | null = getSql()
): Promise<MarketingFunnel | null> {
  if (!sql) return null;
  const shopifyConfigured = isShopifyConfigured();

  try {
    const totals = (await sql`
      SELECT
        count(*) FILTER (WHERE status = 'sent')::int AS sent,
        count(*) FILTER (WHERE status = 'sent' AND clicked_at IS NOT NULL)::int AS clicked
        FROM marketing_sends
    `) as Array<{ sent: number; clicked: number }>;
    const sent = Number(totals[0]?.sent ?? 0);
    const clicked = Number(totals[0]?.clicked ?? 0);

    // Conversion = the send's UNIQUE single-use code shows up in a real order.
    // Only sent rows that actually carried a code can convert.
    const codeRows = (await sql`
      SELECT discount_code
        FROM marketing_sends
       WHERE status = 'sent' AND discount_code IS NOT NULL
       ORDER BY sent_at DESC NULLS LAST, id DESC
       LIMIT ${MARKETING_FUNNEL_MAX_CODES + 1}
    `) as Array<{ discount_code: string }>;
    const sampled = codeRows.length > MARKETING_FUNNEL_MAX_CODES;
    const codes = codeRows
      .slice(0, MARKETING_FUNNEL_MAX_CODES)
      .map((r) => String(r.discount_code));

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

    return {
      sent,
      clicked,
      clickRate: sent > 0 ? clicked / sent : null,
      shopifyConfigured,
      converted,
      conversionRate: sent > 0 ? converted / sent : null,
      codesChecked: codes.length,
      redemptionUnknown,
      sampled,
    } satisfies MarketingFunnel;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "getMarketingFunnel" });
    return null;
  }
}

export interface RecentSend {
  id: number;
  /** Recipient email (via the capture join). */
  email: string;
  subject: string | null;
  sentAt: string | null;
}

export interface MarketingActivity {
  /** Most recently SENT marketing emails (newest first), capped to `limit`. */
  recentSends: RecentSend[];
  /** Count of marketing emails sent within the trailing `windowDays`. */
  sentInWindow: number;
  windowDays: number;
}

/**
 * Read-only activity feed for the overview tab: the newest sent marketing emails
 * (with the recipient email, via the same capture join getLatestSendForEmail
 * uses) plus a windowed sent count for the headline "sends this period" KPI. Pure
 * aggregation over marketing_sends — never writes. Returns null only when no DB
 * is configured; degrades to empty/zero (logged) on a query failure.
 */
export async function getMarketingActivity(
  { windowDays = 30, limit = 5 }: { windowDays?: number; limit?: number } = {},
  sql: Sql | null = getSql()
): Promise<MarketingActivity | null> {
  if (!sql) return null;
  const days = Number.isFinite(windowDays) && windowDays > 0 ? Math.floor(windowDays) : 30;
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
  try {
    const [recentRows, windowRows] = (await Promise.all([
      sql`
        SELECT ms.id, ec.email, ms.subject, ms.sent_at
          FROM marketing_sends ms
          JOIN email_captures ec ON ec.id = ms.email_capture_id
         WHERE ms.status = 'sent'
         ORDER BY ms.sent_at DESC NULLS LAST, ms.id DESC
         LIMIT ${cap}
      `,
      sql`
        SELECT count(*)::int AS n
          FROM marketing_sends
         WHERE status = 'sent'
           AND sent_at >= (current_date - ${days - 1}::int)::date
      `,
    ])) as [Array<Record<string, unknown>>, Array<{ n: number }>];

    return {
      recentSends: recentRows.map((r) => ({
        id: Number(r.id),
        email: String(r.email),
        subject: (r.subject as string | null) ?? null,
        sentAt: (r.sent_at as string | null) ?? null,
      })),
      sentInWindow: Number(windowRows[0]?.n ?? 0),
      windowDays: days,
    } satisfies MarketingActivity;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "getMarketingActivity" });
    return null;
  }
}

/**
 * Generate a unique, hard-to-guess redirect token (192 bits, URL-safe base64).
 * Long and random enough that tokens can't be enumerated; short enough to sit in
 * a clean /api/r/<token> URL.
 */
export function generateRedirectToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // base64url, no padding.
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface ClickResolution {
  /** The real Shopify prefilled-cart URL to forward to (null if the row had none). */
  destination: string | null;
  sendId: number;
}

/**
 * Resolve a redirect token to its sent row and record the click in one place:
 *   - set clicked_at = now() on the FIRST click only (the `clicked_at IS NULL`
 *     guard makes repeat clicks a no-op — they never error),
 *   - log a 'marketing_email_clicked' kpi_event on every click (with send /
 *     capture id and a firstClick flag) so click VOLUME stays visible.
 * Returns the real cart destination, or null when the token can't be resolved
 * (unknown / expired / pruned) so the caller can fall back gracefully. Never
 * throws.
 */
export async function recordEmailClick(
  token: string,
  sql: Sql | null = getSql()
): Promise<ClickResolution | null> {
  if (!sql) return null;
  const t = token.trim();
  if (!t) return null;
  try {
    const rows = (await sql`
      SELECT id, email_capture_id, cart_url, clicked_at
        FROM marketing_sends
       WHERE redirect_token = ${t} AND status = 'sent'
       LIMIT 1
    `) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return null;

    const sendId = Number(row.id);
    const captureId = Number(row.email_capture_id);
    const destination = (row.cart_url as string | null) ?? null;
    const firstClick = row.clicked_at == null;

    // First click stamps clicked_at; the guard makes repeats a no-op.
    await sql`
      UPDATE marketing_sends
         SET clicked_at = now()
       WHERE id = ${sendId} AND clicked_at IS NULL
    `;
    // Cluster-A telemetry: session_id is null (this is a marketing-email click,
    // not a widget event); the internal send/capture ids live in `data`.
    await sql`
      INSERT INTO kpi_events (session_id, event, data)
      VALUES (
        NULL,
        'marketing_email_clicked',
        ${JSON.stringify({ sendId, captureId, firstClick })}::jsonb
      )
    `;
    return { destination, sendId };
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "recordEmailClick" });
    return null;
  }
}

/**
 * Load a capture ONLY if it is still marketing-eligible (confirmed, not
 * unsubscribed, not suppressed). Returns null otherwise. Used by the draft/send
 * routes so they operate exclusively on eligible contacts.
 */
export async function loadEligibleCapture(
  captureId: number,
  sql: Sql | null = getSql()
): Promise<EligibleCapture | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT ec.id, ec.email, ec.session_id
        FROM email_captures ec
       WHERE ec.id = ${captureId}
         AND ec.marketing_doi_status = 'confirmed'
         AND ec.unsubscribed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = ec.email)
    `) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      email: String(r.email),
      sessionId: (r.session_id as string | null) ?? null,
    };
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "loadEligibleCapture" });
    return null;
  }
}

/**
 * Like loadEligibleCapture, but keyed by EMAIL — the bridge the per-customer
 * draft uses: a customer (keyed by email) has at most one capture row (unique
 * email since migration 0002), and the SAME eligibility bar applies. Returns
 * null when there is no capture or it isn't marketing-eligible.
 */
export async function loadEligibleCaptureByEmail(
  email: string,
  sql: Sql | null = getSql()
): Promise<EligibleCapture | null> {
  if (!sql) return null;
  const e = normalizeEmail(email);
  if (!e) return null;
  try {
    const rows = (await sql`
      SELECT ec.id, ec.email, ec.session_id
        FROM email_captures ec
       WHERE ec.email = ${e}
         AND ec.marketing_doi_status = 'confirmed'
         AND ec.unsubscribed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = ec.email)
    `) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      email: String(r.email),
      sessionId: (r.session_id as string | null) ?? null,
    };
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "loadEligibleCaptureByEmail" });
    return null;
  }
}

/**
 * The most relevant marketing_sends row for an EMAIL (open draft preferred over
 * sent history, then newest first) — what the Kunden tab shows/edits for a
 * customer. Null when the email has no capture or no send rows.
 */
export async function getLatestSendForEmail(
  email: string,
  sql: Sql | null = getSql()
): Promise<MarketingSendRow | null> {
  if (!sql) return null;
  const e = normalizeEmail(email);
  if (!e) return null;
  try {
    const rows = (await sql`
      SELECT ms.*
        FROM marketing_sends ms
        JOIN email_captures ec ON ec.id = ms.email_capture_id
       WHERE ec.email = ${e}
       ORDER BY (ms.status = 'sent') ASC, ms.created_at DESC, ms.id DESC
       LIMIT 1
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapSendRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "getLatestSendForEmail" });
    return null;
  }
}

export interface CreateDraftInput {
  captureId: number;
  /** The customer the draft was generated from (per-customer drafts only). */
  customerId?: number | null;
  /** Snapshot of the admin special instructions woven into this draft. */
  adminInstructions?: string | null;
  subject: string;
  draftedText: string;
  /** Selected discount depth (0 = none). The real code is minted at send time. */
  discountPercent: number;
  /** Null at draft time — the unique Shopify code is minted only at send. */
  discountCode: string | null;
  discountCodeGid: string | null;
  /** Projected expiry shown in the preview (the real code gets its own at send). */
  discountExpiresAt: string | null;
  cartUrl: string | null;
  productIds: string[];
  personaLabel: string | null;
}

/**
 * Insert a new draft marketing_sends row. The one-open-draft unique index means
 * at most one un-sent draft exists per capture; on conflict we return the
 * existing open draft instead of creating a duplicate (and minting a second
 * discount code).
 */
export async function createDraft(
  input: CreateDraftInput,
  sql: Sql | null = getSql()
): Promise<MarketingSendRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      INSERT INTO marketing_sends
        (email_capture_id, customer_id, admin_instructions, status, subject,
         drafted_text, discount_percent, discount_code, discount_code_gid,
         discount_expires_at, cart_url, product_ids, persona_label,
         created_at, updated_at)
      VALUES
        (${input.captureId}, ${input.customerId ?? null}, ${input.adminInstructions ?? null},
         'draft', ${input.subject}, ${input.draftedText},
         ${input.discountPercent}, ${input.discountCode}, ${input.discountCodeGid},
         ${input.discountExpiresAt}, ${input.cartUrl}, ${input.productIds}::text[],
         ${input.personaLabel}, now(), now())
      ON CONFLICT (email_capture_id) WHERE status <> 'sent'
        DO NOTHING
      RETURNING *
    `) as Array<Record<string, unknown>>;
    if (rows[0]) return mapSendRow(rows[0]);
    // Conflict: an open draft already exists — return it untouched.
    return getOpenDraftForCapture(input.captureId, sql);
  } catch (err) {
    // A failed draft INSERT must be diagnosable — re-throw (after logging) so the
    // route can surface the real DB reason (e.g. a missing column) in its JSON
    // envelope instead of collapsing to a bare, reasonless 500.
    reportError(err, { route: "lib/marketing-store", phase: "createDraft" });
    throw err;
  }
}

/** The single open (un-sent) draft for a capture, if any. */
export async function getOpenDraftForCapture(
  captureId: number,
  sql: Sql | null = getSql()
): Promise<MarketingSendRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT *
        FROM marketing_sends
       WHERE email_capture_id = ${captureId} AND status <> 'sent'
       LIMIT 1
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapSendRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "getOpenDraftForCapture" });
    return null;
  }
}

/**
 * Update the editable draft fields (subject + body). Only touches rows that are
 * still drafts — a sent row is immutable. Returns the updated row or null.
 */
export async function updateDraftText(
  sendId: number,
  subject: string,
  draftedText: string,
  sql: Sql | null = getSql()
): Promise<MarketingSendRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE marketing_sends
         SET subject = ${subject},
             drafted_text = ${draftedText},
             updated_at = now()
       WHERE id = ${sendId} AND status <> 'sent'
      RETURNING *
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapSendRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "updateDraftText" });
    return null;
  }
}

/**
 * DELETE an unsent marketing-email draft. Guarded to status = 'draft' — the
 * inverse of the "sent is read-only" guarantee: a 'sent' row is immutable (never
 * deletable, preserves the audit/analytics record) and an 'approved' row is an
 * in-flight send we must not race. Returns true only when this call removed the
 * row, so a concurrent send (draft → approved/sent) yields false and the caller
 * surfaces it rather than reporting a phantom delete.
 *
 * Nothing external needs cleaning up: a draft mints NO Shopify discount code and
 * NO redirect token (both happen only at send — see markSent / approveAndSend),
 * and its placeholder code (MO-XXXX) + preview cart URL live entirely on this
 * row, so removing the row removes all placeholder/preview state — and mints
 * nothing.
 */
export async function deleteDraftSend(
  sendId: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      DELETE FROM marketing_sends
       WHERE id = ${sendId} AND status = 'draft'
      RETURNING id
    `) as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "deleteDraftSend" });
    throw err;
  }
}

export interface RegenerateDraftInput {
  subject: string;
  draftedText: string;
  discountPercent: number;
  discountExpiresAt: string | null;
  cartUrl: string | null;
  productIds: string[];
  personaLabel: string | null;
  /** See CreateDraftInput. Re-stamped on regenerate so the audit snapshot
   *  always matches the text that was actually generated. */
  customerId?: number | null;
  adminInstructions?: string | null;
}

/**
 * Overwrite an existing OPEN draft when the admin re-generates (e.g. after
 * changing the discount depth). Replaces the AI-written fields and the selected
 * depth, and resets the (still un-minted) discount code/gid back to NULL so the
 * draft text and the eventual send-time code can never disagree. Only touches
 * non-sent rows; a sent row is immutable.
 */
export async function saveRegeneratedDraft(
  sendId: number,
  input: RegenerateDraftInput,
  sql: Sql | null = getSql()
): Promise<MarketingSendRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE marketing_sends
         SET subject = ${input.subject},
             drafted_text = ${input.draftedText},
             discount_percent = ${input.discountPercent},
             discount_code = NULL,
             discount_code_gid = NULL,
             discount_expires_at = ${input.discountExpiresAt},
             cart_url = ${input.cartUrl},
             product_ids = ${input.productIds}::text[],
             persona_label = ${input.personaLabel},
             customer_id = ${input.customerId ?? null},
             admin_instructions = ${input.adminInstructions ?? null},
             updated_at = now()
       WHERE id = ${sendId} AND status <> 'sent'
      RETURNING *
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapSendRow(rows[0]) : null;
  } catch (err) {
    // As with createDraft: surface the real reason rather than swallowing it.
    reportError(err, { route: "lib/marketing-store", phase: "saveRegeneratedDraft" });
    throw err;
  }
}

/**
 * Atomically claim a draft for sending: 'draft' → 'approved'. Returns the row
 * only if it was still a draft, so two concurrent send requests can't both get
 * past this point — exactly one claims it, the other gets null and aborts. The
 * 'approved' state is the transient in-flight marker between claim and send.
 */
export async function claimForSend(
  sendId: number,
  sql: Sql | null = getSql()
): Promise<MarketingSendRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE marketing_sends
         SET status = 'approved', updated_at = now()
       WHERE id = ${sendId} AND status = 'draft'
      RETURNING *
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapSendRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "claimForSend" });
    return null;
  }
}

/**
 * Release a claim ('approved' → 'draft') when a send fails, so the admin can
 * retry. Best-effort; never throws.
 */
export async function revertClaim(
  sendId: number,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE marketing_sends
         SET status = 'draft', updated_at = now()
       WHERE id = ${sendId} AND status = 'approved'
    `;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "revertClaim" });
  }
}

/**
 * What the send step finalized: the REAL minted code, its gid/expiry, the cart
 * permalink that actually went out (carrying ?discount=CODE) and the body with
 * the placeholder swapped for the real code. Stored on the row so analytics has
 * the complete record of which discount depth + code was used.
 */
export interface SentDiscountPatch {
  discountCode: string | null;
  discountCodeGid: string | null;
  discountExpiresAt: string | null;
  cartUrl: string | null;
  draftedText: string;
  /** Token for the tracked redirect link that went into the email (null = no cart). */
  redirectToken: string | null;
}

/**
 * Atomically flip a claimed row to 'sent' with a sent_at stamp, persisting the
 * send-time discount artifacts. The `status <> 'sent'` guard makes this
 * idempotent / double-send-proof: a row already sent updates zero rows and
 * returns null.
 */
export async function markSent(
  sendId: number,
  patch: SentDiscountPatch,
  sql: Sql | null = getSql()
): Promise<MarketingSendRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE marketing_sends
         SET status = 'sent',
             sent_at = now(),
             updated_at = now(),
             discount_code = ${patch.discountCode},
             discount_code_gid = ${patch.discountCodeGid},
             discount_expires_at = ${patch.discountExpiresAt},
             cart_url = ${patch.cartUrl},
             drafted_text = ${patch.draftedText},
             redirect_token = ${patch.redirectToken}
       WHERE id = ${sendId} AND status <> 'sent'
      RETURNING *
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapSendRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "markSent" });
    return null;
  }
}
