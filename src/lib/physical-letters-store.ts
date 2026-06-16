// Data access for `physical_letters` (migration 0022) + the LAWFUL postal
// address read. A letter is its OWN data category (NOT email): this table is the
// append-only audit log of every letter handed to Pingen, the snapshotted
// recipient address, the provider id + lifecycle status, and the cost.
//
// Everything is defensive: no DB ⇒ null/[]; writes log and degrade rather than
// throwing into the send path.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { parseIntEnv } from "./env-num";

export type PhysicalLetterStatus =
  | "pending"
  | "submitted"
  | "queued"
  | "printing"
  | "printed"
  | "posted"
  | "failed"
  | "cancelled"
  | "undeliverable";

/** A validated, complete recipient (from physical-address.validateFullAddress). */
export interface RecipientAddress {
  name: string;
  company: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  country: string;
}

export interface CreatePhysicalLetterInput {
  customerId: number | null;
  marketingSendId?: number | null;
  recipient: RecipientAddress;
  /** The letter content we printed (snapshot) — feeds the audit + the KB (§3). */
  subject?: string | null;
  body?: string | null;
}

/** INSERT a 'pending' letter row (before the Pingen call) — its id seeds the
 *  Idempotency-Key so a retry is safe. Returns the new id, or null. */
export async function createPhysicalLetter(
  input: CreatePhysicalLetterInput,
  sql: Sql | null = getSql()
): Promise<number | null> {
  if (!sql) return null;
  try {
    const r = input.recipient;
    const rows = (await sql`
      INSERT INTO physical_letters
        (customer_id, marketing_send_id, provider, status,
         recipient_name, recipient_company, recipient_address_line1,
         recipient_address_line2, recipient_postal_code, recipient_city,
         recipient_country, subject, body)
      VALUES
        (${input.customerId}, ${input.marketingSendId ?? null}, 'pingen', 'pending',
         ${r.name}, ${r.company}, ${r.addressLine1}, ${r.addressLine2},
         ${r.postalCode}, ${r.city}, ${r.country},
         ${input.subject ?? null}, ${input.body ?? null})
      RETURNING id
    `) as Array<{ id: number }>;
    return rows[0]?.id != null ? Number(rows[0].id) : null;
  } catch (err) {
    reportError(err, { route: "lib/physical-letters-store", phase: "createPhysicalLetter" });
    return null;
  }
}

/** Per-letter postage in cents when Pingen hasn't reported a price (staging, or
 *  not-yet-known). Configurable; defaults to 106 (≈ €1.06). */
export function defaultLetterCostCents(): number {
  return parseIntEnv("PINGEN_LETTER_COST_CENTS", 106, 0);
}

export interface PhysicalLetterStats {
  /** Letters actually handed to Pingen (provider id set, not a failed submit). */
  totalSent: number;
  /** Total postage in cents — Pingen's price where known, else the default. */
  totalCostCents: number;
}

/**
 * Aggregate physical-letter cost for the KPI dashboard: how many letters went
 * out and what they cost (Pingen's reported price per letter, falling back to
 * the configured default for any letter without a known price). Returns zeroes
 * on no DB / error.
 */
export async function getPhysicalLetterStats(
  sql: Sql | null = getSql()
): Promise<PhysicalLetterStats> {
  if (!sql) return { totalSent: 0, totalCostCents: 0 };
  try {
    const fallback = defaultLetterCostCents();
    const rows = (await sql`
      SELECT count(*)::int AS n,
             COALESCE(SUM(COALESCE(cost_cents, ${fallback})), 0)::bigint AS cents
        FROM physical_letters
       WHERE provider_letter_id IS NOT NULL
         AND status <> 'failed'
    `) as Array<{ n: number; cents: string | number }>;
    return {
      totalSent: rows[0]?.n != null ? Number(rows[0].n) : 0,
      totalCostCents: rows[0]?.cents != null ? Number(rows[0].cents) : 0,
    };
  } catch (err) {
    reportError(err, { route: "lib/physical-letters-store", phase: "getPhysicalLetterStats" });
    return { totalSent: 0, totalCostCents: 0 };
  }
}

/** A sent letter rendered as a KB "sent" message (for loadCustomerCorrespondence
 *  to merge with email, §3). body TEXT only, recency-capped by the caller. */
export interface LetterKbMessage {
  direction: "sent";
  occurredAt: string | null;
  bodyText: string;
}

/**
 * Sent letters for the knowledge base — the letter is correspondence too, so it
 * folds into the per-customer KB beside sent/received email. body TEXT only
 * (subject inlined as a label), within the recency window. Failed submits are
 * excluded (nothing was posted). Returns [] on no DB / error.
 */
export async function loadSentLettersForKb(
  customerId: number,
  recencyCutoffIso: string,
  sql: Sql | null = getSql()
): Promise<LetterKbMessage[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT subject, body, COALESCE(submitted_at, created_at) AS occurred_at
        FROM physical_letters
       WHERE customer_id = ${customerId}
         AND body IS NOT NULL
         AND status <> 'failed'
         AND COALESCE(submitted_at, created_at) >= ${recencyCutoffIso}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const subject = (r.subject as string | null)?.trim();
      const body = ((r.body as string | null) ?? "").trim();
      return {
        direction: "sent" as const,
        occurredAt: (r.occurred_at as string | null) ?? null,
        bodyText: subject ? `Brief „${subject}": ${body}` : `Brief: ${body}`,
      };
    });
  } catch (err) {
    reportError(err, { route: "lib/physical-letters-store", phase: "loadSentLettersForKb" });
    return [];
  }
}

/** Mark a letter submitted to Pingen: record the provider id, status + cost. */
export async function markPhysicalLetterSubmitted(
  id: number,
  providerLetterId: string,
  status: PhysicalLetterStatus,
  costCents: number | null,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE physical_letters
         SET provider_letter_id = ${providerLetterId},
             status = ${status},
             cost_cents = ${costCents},
             submitted_at = COALESCE(submitted_at, now()),
             updated_at = now()
       WHERE id = ${id}
    `;
  } catch (err) {
    reportError(err, { route: "lib/physical-letters-store", phase: "markPhysicalLetterSubmitted" });
  }
}

/** Record a submit failure (kept on the row for triage, status 'failed'). */
export async function markPhysicalLetterFailed(
  id: number,
  error: string,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE physical_letters
         SET status = 'failed', error = ${error.slice(0, 500)}, updated_at = now()
       WHERE id = ${id}
    `;
  } catch (err) {
    reportError(err, { route: "lib/physical-letters-store", phase: "markPhysicalLetterFailed" });
  }
}

/**
 * Apply a status webhook to the matching letter (by Pingen id). Returns whether
 * a row was updated (false ⇒ unknown letter id → the route acks without retry).
 */
export async function updatePhysicalLetterStatusByProviderId(
  providerLetterId: string,
  status: PhysicalLetterStatus,
  costCents: number | null,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = (await sql`
      UPDATE physical_letters
         SET status = ${status},
             cost_cents = COALESCE(${costCents}, cost_cents),
             updated_at = now()
       WHERE provider_letter_id = ${providerLetterId}
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.length > 0;
  } catch (err) {
    reportError(err, {
      route: "lib/physical-letters-store",
      phase: "updatePhysicalLetterStatusByProviderId",
    });
    return false;
  }
}

/** One physical-letter row for the admin per-customer panel. */
export interface PhysicalLetterRow {
  id: number;
  status: PhysicalLetterStatus;
  providerLetterId: string | null;
  marketingSendId: number | null;
  recipientName: string | null;
  recipientCity: string | null;
  recipientCountry: string | null;
  subject: string | null;
  costCents: number | null;
  error: string | null;
  createdAt: string | null;
  submittedAt: string | null;
}

/** List a customer's letters, newest first, for the Korrespondenz/Brief panel. */
export async function listCustomerLetters(
  customerId: number,
  sql: Sql | null = getSql()
): Promise<PhysicalLetterRow[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT id, status, provider_letter_id, marketing_send_id, recipient_name,
             recipient_city, recipient_country, subject, cost_cents, error,
             created_at, submitted_at
        FROM physical_letters
       WHERE customer_id = ${customerId}
       ORDER BY created_at DESC, id DESC
       LIMIT 500
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      status: (r.status as PhysicalLetterStatus) ?? "pending",
      providerLetterId: (r.provider_letter_id as string | null) ?? null,
      marketingSendId: r.marketing_send_id == null ? null : Number(r.marketing_send_id),
      recipientName: (r.recipient_name as string | null) ?? null,
      recipientCity: (r.recipient_city as string | null) ?? null,
      recipientCountry: (r.recipient_country as string | null) ?? null,
      subject: (r.subject as string | null) ?? null,
      costCents: r.cost_cents == null ? null : Number(r.cost_cents),
      error: (r.error as string | null) ?? null,
      createdAt: (r.created_at as string | null) ?? null,
      submittedAt: (r.submitted_at as string | null) ?? null,
    }));
  } catch (err) {
    reportError(err, { route: "lib/physical-letters-store", phase: "listCustomerLetters" });
    return [];
  }
}
