// Data access for the §7 Abs. 3 UWG "Bestandskunden" (existing-customer)
// marketing basis — the SEPARATE lawful basis from DOI-consented marketing.
//
// ⚠️ THE TWO BASES ARE NEVER MERGED. This module touches ONLY:
//   * customers.bestandskunde_eligible (a completed purchase exists), and
//   * bestandskunden_suppression_list  (the SEPARATE §7(3) objection/opt-out).
// It never reads or writes marketing_doi_status / suppression_list (those are
// the DOI path, lib/email-capture-store.ts). A customer may be DOI-consented,
// a §7(3) Bestandskunde, both, or neither — the dashboard shows them apart.
//
// Real §7(3) sends additionally require BESTANDSKUNDE_SENDS_APPROVED (default
// OFF, lib/bestandskunden.mjs) — built, gated until the lawyer blesses the
// "own similar products" boundary + opt-out copy. See docs/CONSENT_FLOW.md.

import { createHmac, timingSafeEqual } from "node:crypto";
import { getSql, type Sql } from "./db";
import { normalizeEmail } from "./email-capture-store";
import { isBestandskundenSendsApproved } from "./bestandskunden.mjs";
import { reportError } from "./observability";

// ---------------------------------------------------------------------------
// Eligibility cache write (called from saveCustomerPurchaseSummary)
// ---------------------------------------------------------------------------

/**
 * Persist the recomputed §7(3) eligibility on the customer row. Best-effort:
 * returns false on no DB / write failure; never throws. The boolean is derived
 * by the caller from the fresh order history via isBestandskundeEligible.
 */
export async function setBestandskundeEligibility(
  customerId: number,
  eligible: boolean,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  try {
    const rows = await sql`
      UPDATE customers
         SET bestandskunde_eligible = ${eligible},
             bestandskunde_eligible_updated_at = now()
       WHERE id = ${customerId}
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/bestandskunden-store", phase: "setBestandskundeEligibility" });
    return false;
  }
}

// ---------------------------------------------------------------------------
// The SEPARATE Bestandskunden opt-out (objection)
// ---------------------------------------------------------------------------

/**
 * True if the address has objected to §7(3) existing-customer mail. ALWAYS
 * returns true (fail-closed) when it can't reach the DB, so a transient error
 * can never let a §7(3) send slip past an objection.
 */
export async function isBestandskundeSuppressed(
  email: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return true; // fail-closed
  const e = normalizeEmail(email);
  if (!e) return true;
  try {
    const rows = await sql`
      SELECT 1 FROM bestandskunden_suppression_list WHERE email = ${e} LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return true; // fail-closed
  }
}

/**
 * Record a §7(3) objection. Idempotent (ON CONFLICT DO NOTHING). Distinct from
 * unsubscribeByEmail: it touches ONLY the Bestandskunden list, leaving any DOI
 * marketing consent untouched (separate lawful basis, separate decision).
 * Returns false on no DB / failure; never throws.
 */
export async function suppressBestandskunde(
  email: string,
  reason = "bestandskunde_opt_out",
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const e = normalizeEmail(email);
  if (!e) return false;
  try {
    await sql`
      INSERT INTO bestandskunden_suppression_list (email, reason)
      VALUES (${e}, ${reason})
      ON CONFLICT (email) DO NOTHING
    `;
    return true;
  } catch (err) {
    reportError(err, { route: "lib/bestandskunden-store", phase: "suppressBestandskunde" });
    return false;
  }
}

// ---------------------------------------------------------------------------
// The send gate — the single chokepoint a future §7(3) send path must pass.
// ---------------------------------------------------------------------------

/**
 * True ONLY when a §7(3) existing-customer email is permitted for this address:
 *   1. BESTANDSKUNDE_SENDS_APPROVED is on (lawyer blessed the boundary + copy),
 *   2. the customer is §7(3)-eligible (a completed purchase is cached), AND
 *   3. the address has NOT objected (separate Bestandskunden opt-out).
 * Independent of DOI marketing consent — this is a DIFFERENT lawful basis, so it
 * neither requires nor implies marketing_doi_status = 'confirmed'. Fail-closed:
 * any missing condition / DB error → false. Use this to gate every §7(3) send.
 */
export async function canSendBestandskundenMail(
  email: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  // (1) Hard gate: no approved boundary/copy ⇒ nothing sends, full stop.
  if (!isBestandskundenSendsApproved()) return false;
  if (!sql) return false;
  const e = normalizeEmail(email);
  if (!e) return false;
  // (3) Objected ⇒ never send.
  if (await isBestandskundeSuppressed(e, sql)) return false;
  try {
    // (2) A completed purchase must be cached for this address's customer.
    const rows = await sql`
      SELECT 1 FROM customers
       WHERE email = ${e} AND bestandskunde_eligible = true
       LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false; // fail-closed
  }
}

// ---------------------------------------------------------------------------
// The §7(3) audience (for the dashboard) — kept apart from the DOI list.
// ---------------------------------------------------------------------------

export interface BestandskundeAudienceRow {
  customerId: number;
  email: string;
  /** Whether this Bestandskunde ALSO has a confirmed DOI marketing consent. */
  hasDoiConsent: boolean;
  /** Aggregated DOI marketing state (for the dashboard label only). */
  marketingStatus: string;
  bestandskundeEligibleUpdatedAt: string | null;
}

// Bound the dashboard read, mirroring the DOI list cap.
const BESTANDSKUNDEN_AUDIENCE_LIMIT = 200;

/**
 * The §7(3) audience: customers with a completed purchase (cached eligibility)
 * who have NOT objected. Flags whether each also holds a DOI consent so the
 * dashboard can show the two bases apart. Pure DB read (no Shopify fan-out — the
 * eligibility is precomputed on purchase refresh). Returns [] when no DB.
 */
export async function listBestandskundenAudience(
  sql: Sql | null = getSql()
): Promise<BestandskundeAudienceRow[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT c.id, c.email, c.marketing_status, c.bestandskunde_eligible_updated_at
        FROM customers c
       WHERE c.bestandskunde_eligible = true
         AND NOT EXISTS (
               SELECT 1 FROM bestandskunden_suppression_list b WHERE b.email = c.email
             )
       ORDER BY c.bestandskunde_eligible_updated_at DESC NULLS LAST, c.id DESC
       LIMIT ${BESTANDSKUNDEN_AUDIENCE_LIMIT}
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const marketingStatus = (r.marketing_status as string | null) ?? "none";
      return {
        customerId: Number(r.id),
        email: String(r.email),
        marketingStatus,
        hasDoiConsent: marketingStatus === "confirmed",
        bestandskundeEligibleUpdatedAt:
          (r.bestandskunde_eligible_updated_at as string | null) ?? null,
      } satisfies BestandskundeAudienceRow;
    });
  } catch (err) {
    reportError(err, { route: "lib/bestandskunden-store", phase: "listBestandskundenAudience" });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Signed §7(3) opt-out token — domain-separated from the DOI unsubscribe token.
// ---------------------------------------------------------------------------
//
// Same stateless, email-keyed HMAC shape as the unsubscribe token, but the
// signed payload is prefixed with a fixed context string so a DOI-unsubscribe
// token can NEVER be replayed as a §7(3) objection (or vice versa) — the two
// opt-outs stay independent end to end.

const OPT_OUT_CONTEXT = "bestandskunde-opt-out:v1:";

function optOutSecret(): string | undefined {
  return process.env.UNSUBSCRIBE_SECRET || process.env.CHAT_SHARED_SECRET || undefined;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build a signed §7(3) opt-out token for an address:
 * `b64url(email).b64url(hmac(context + email))`. Stateless — verifiable without
 * a DB lookup. Returns null when no signing secret is configured.
 */
export function buildBestandskundeOptOutToken(email: string): string | null {
  const secret = optOutSecret();
  if (!secret) return null;
  const e = normalizeEmail(email);
  if (!e) return null;
  const sig = createHmac("sha256", secret).update(OPT_OUT_CONTEXT + e).digest();
  return `${base64url(Buffer.from(e, "utf8"))}.${base64url(sig)}`;
}

/**
 * Verify a §7(3) opt-out token and return the normalised email it signs, or null
 * if it is malformed / the signature doesn't match (including a token signed for
 * a different context, e.g. the DOI unsubscribe).
 */
export function verifyBestandskundeOptOutToken(token: string): string | null {
  const secret = optOutSecret();
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let email: string;
  try {
    email = Buffer.from(parts[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
  if (!email) return null;
  const expected = createHmac("sha256", secret).update(OPT_OUT_CONTEXT + email).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? email : null;
}
