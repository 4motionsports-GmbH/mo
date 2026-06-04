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
import { loadConversationForSummary, type TranscriptMessage } from "./conversation-store";
import { getProductsByIds } from "./product-catalog";
import { checkRecentPurchase, type PurchaseCheck } from "./shopify-orders";
import { ARCHETYPE_META } from "./persona";
import type { PersonaArchetype } from "./types";
import { reportError } from "./observability";

export type MarketingSendStatus = "draft" | "approved" | "sent";

export interface MarketingSendRow {
  id: number;
  emailCaptureId: number;
  status: MarketingSendStatus;
  subject: string | null;
  draftedText: string | null;
  discountCode: string | null;
  discountExpiresAt: string | null;
  cartUrl: string | null;
  productIds: string[];
  personaLabel: string | null;
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
    status: r.status as MarketingSendStatus,
    subject: (r.subject as string | null) ?? null,
    draftedText: (r.drafted_text as string | null) ?? null,
    discountCode: (r.discount_code as string | null) ?? null,
    discountExpiresAt: (r.discount_expires_at as string | null) ?? null,
    cartUrl: (r.cart_url as string | null) ?? null,
    productIds: Array.isArray(r.product_ids) ? (r.product_ids as string[]) : [],
    personaLabel: (r.persona_label as string | null) ?? null,
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

      const productIds = conversation?.recommendedProductIds ?? [];
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

export interface CreateDraftInput {
  captureId: number;
  subject: string;
  draftedText: string;
  discountCode: string | null;
  discountCodeGid: string | null;
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
        (email_capture_id, status, subject, drafted_text, discount_code,
         discount_code_gid, discount_expires_at, cart_url, product_ids,
         persona_label, created_at, updated_at)
      VALUES
        (${input.captureId}, 'draft', ${input.subject}, ${input.draftedText},
         ${input.discountCode}, ${input.discountCodeGid}, ${input.discountExpiresAt},
         ${input.cartUrl}, ${input.productIds}::text[], ${input.personaLabel},
         now(), now())
      ON CONFLICT (email_capture_id) WHERE status <> 'sent'
        DO NOTHING
      RETURNING *
    `) as Array<Record<string, unknown>>;
    if (rows[0]) return mapSendRow(rows[0]);
    // Conflict: an open draft already exists — return it untouched.
    return getOpenDraftForCapture(input.captureId, sql);
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "createDraft" });
    return null;
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
 * Atomically flip a draft to 'sent' with a sent_at stamp. The `status <> 'sent'`
 * guard makes this idempotent / double-send-proof: a row already sent updates
 * zero rows and returns null, so the caller knows not to send again.
 */
export async function markSent(
  sendId: number,
  sql: Sql | null = getSql()
): Promise<MarketingSendRow | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      UPDATE marketing_sends
         SET status = 'sent', sent_at = now(), updated_at = now()
       WHERE id = ${sendId} AND status <> 'sent'
      RETURNING *
    `) as Array<Record<string, unknown>>;
    return rows[0] ? mapSendRow(rows[0]) : null;
  } catch (err) {
    reportError(err, { route: "lib/marketing-store", phase: "markSent" });
    return null;
  }
}
