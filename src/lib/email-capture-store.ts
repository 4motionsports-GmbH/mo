// Consent / marketing data access (Cluster B — explicit consent).
//
// This is the ONLY module that writes email addresses. It backs the GDPR
// email-capture + double-opt-in (DOI) flow:
//
//   - upsertEmailCapture()      POST /api/capture-email
//   - confirmMarketingByToken() GET  /api/confirm-marketing
//   - unsubscribeByEmail()      GET  /api/unsubscribe
//   - isSuppressed()/canSendMarketing()  gate every marketing send
//
// Rules enforced here (mirrors docs/CONSENT_FLOW.md):
//   * Transactional consent and marketing consent are independent.
//   * Marketing requires marketing_doi_status = 'confirmed' AND the address not
//     suppressed/unsubscribed — never anything weaker.
//   * A suppressed or unsubscribed address is never re-pended for DOI.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSql, type Sql } from "./db";

export type MarketingDoiStatus = "none" | "pending" | "confirmed";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && EMAIL_RE.test(email.trim());
}

/** Normalise an email for storage + lookup (trim + lower-case). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Cryptographically-random, URL-safe DOI token. */
export function generateDoiToken(): string {
  return randomBytes(32).toString("hex");
}

function doiExpiryDays(): number {
  const raw = process.env.MARKETING_DOI_EXPIRY_DAYS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 7;
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

/**
 * Hard block for ANY send: true when the address is on the suppression list OR
 * has an unsubscribed_at timestamp. Always returns true (fail-closed) if it
 * can't reach the database, so a transient DB error can never let a send slip
 * past the opt-out.
 */
export async function isSuppressed(email: string, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return true; // fail-closed: no DB means we can't prove it's allowed
  const e = normalizeEmail(email);
  try {
    const rows = await sql`
      SELECT 1
        FROM suppression_list WHERE email = ${e}
      UNION
      SELECT 1
        FROM email_captures WHERE email = ${e} AND unsubscribed_at IS NOT NULL
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return true; // fail-closed
  }
}

/**
 * True only when marketing email is permitted for this address: DOI confirmed
 * AND not suppressed/unsubscribed. Use this to gate every marketing send.
 */
export async function canSendMarketing(
  email: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const e = normalizeEmail(email);
  if (await isSuppressed(e, sql)) return false;
  try {
    const rows = await sql`
      SELECT 1 FROM email_captures
       WHERE email = ${e}
         AND marketing_doi_status = 'confirmed'
         AND unsubscribed_at IS NULL
       LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Upsert (capture)
// ---------------------------------------------------------------------------

export interface UpsertCaptureInput {
  sessionId: string | null;
  email: string;
  transactionalConsent: boolean;
  marketingConsent: boolean;
  consentTextShown: string | null;
}

export interface UpsertCaptureResult {
  id: number;
  email: string;
  marketingDoiStatus: MarketingDoiStatus;
  doiToken: string | null;
  /** True when a fresh DOI confirmation email must be sent for marketing. */
  doiEmailRequired: boolean;
}

/**
 * Upsert one consent record (keyed by normalised email). Records the exact
 * consent copy shown for the Art. 7 audit trail. Decides the marketing DOI
 * state defensively:
 *   - already 'confirmed' → stays confirmed (re-submitting doesn't reset it).
 *   - marketing ticked, not yet confirmed, not suppressed → 'pending' + new
 *     token + doiEmailRequired=true.
 *   - marketing not ticked (or address suppressed) → no new DOI; an existing
 *     'confirmed' is preserved, otherwise 'none'.
 */
export async function upsertEmailCapture(
  input: UpsertCaptureInput,
  sql: Sql | null = getSql()
): Promise<UpsertCaptureResult | null> {
  if (!sql) return null;
  const email = normalizeEmail(input.email);
  const sessionId = input.sessionId?.trim() || null;

  // Read existing state to decide the marketing transition.
  const existingRows = await sql`
    SELECT id, marketing_doi_status, doi_token, unsubscribed_at
      FROM email_captures WHERE email = ${email}
  `;
  const existing = existingRows[0] as
    | { marketing_doi_status: MarketingDoiStatus; doi_token: string | null; unsubscribed_at: string | null }
    | undefined;

  const suppressed = await isSuppressed(email, sql);

  let status: MarketingDoiStatus = "none";
  let doiToken: string | null = null;
  let doiSentAt: string | null = null;
  let doiEmailRequired = false;

  const alreadyConfirmed = existing?.marketing_doi_status === "confirmed";

  if (input.marketingConsent && !suppressed) {
    if (alreadyConfirmed) {
      // Keep the existing confirmation; don't re-send a DOI.
      status = "confirmed";
      doiToken = existing?.doi_token ?? null;
    } else {
      status = "pending";
      doiToken = generateDoiToken();
      doiSentAt = new Date().toISOString();
      doiEmailRequired = true;
    }
  } else {
    // Marketing not granted now (or suppressed). Preserve a prior confirmed
    // consent — only an explicit unsubscribe revokes it — otherwise 'none'.
    if (alreadyConfirmed) {
      status = "confirmed";
      doiToken = existing?.doi_token ?? null;
    }
  }

  const marketingConsentColumn = input.marketingConsent || alreadyConfirmed;

  const rows = await sql`
    INSERT INTO email_captures
      (session_id, email, transactional_consent, marketing_consent,
       marketing_doi_status, doi_token, doi_sent_at, consent_text_shown, created_at)
    VALUES
      (${sessionId}, ${email}, ${input.transactionalConsent}, ${marketingConsentColumn},
       ${status}, ${doiToken}, ${doiSentAt}, ${input.consentTextShown}, now())
    ON CONFLICT (email) DO UPDATE SET
      session_id            = COALESCE(EXCLUDED.session_id, email_captures.session_id),
      transactional_consent = email_captures.transactional_consent OR EXCLUDED.transactional_consent,
      marketing_consent     = EXCLUDED.marketing_consent,
      marketing_doi_status  = EXCLUDED.marketing_doi_status,
      doi_token             = EXCLUDED.doi_token,
      doi_sent_at           = EXCLUDED.doi_sent_at,
      -- Keep the freshest consent copy we actually showed.
      consent_text_shown    = COALESCE(EXCLUDED.consent_text_shown, email_captures.consent_text_shown)
    RETURNING id
  `;
  const id = rows[0]?.id as number | undefined;
  if (id == null) return null;

  return {
    id,
    email,
    marketingDoiStatus: status,
    doiToken,
    doiEmailRequired,
  };
}

// ---------------------------------------------------------------------------
// DOI confirmation
// ---------------------------------------------------------------------------

export type ConfirmResult =
  | { ok: true; alreadyConfirmed: boolean; email: string }
  | { ok: false; reason: "not_found" | "expired" };

/**
 * Validate a DOI token and flip the capture to 'confirmed'. Idempotent: a
 * token that is already confirmed returns ok with alreadyConfirmed=true. Tokens
 * older than the expiry window (by doi_sent_at) are rejected as expired.
 */
export async function confirmMarketingByToken(
  token: string,
  sql: Sql | null = getSql()
): Promise<ConfirmResult> {
  if (!sql) return { ok: false, reason: "not_found" };
  const t = token.trim();
  if (!t) return { ok: false, reason: "not_found" };

  const rows = await sql`
    SELECT id, email, marketing_doi_status, doi_sent_at, doi_confirmed_at
      FROM email_captures WHERE doi_token = ${t}
  `;
  const row = rows[0] as
    | { id: number; email: string; marketing_doi_status: MarketingDoiStatus; doi_sent_at: string | null }
    | undefined;
  if (!row) return { ok: false, reason: "not_found" };

  if (row.marketing_doi_status === "confirmed") {
    return { ok: true, alreadyConfirmed: true, email: row.email };
  }

  // Expiry by doi_sent_at (fall back to "expired" if we somehow have no stamp).
  const sentAt = row.doi_sent_at ? Date.parse(row.doi_sent_at) : NaN;
  const ageMs = Number.isFinite(sentAt) ? Date.now() - sentAt : Infinity;
  if (ageMs > doiExpiryDays() * 86_400_000) {
    return { ok: false, reason: "expired" };
  }

  await sql`
    UPDATE email_captures
       SET marketing_doi_status = 'confirmed',
           doi_confirmed_at = now()
     WHERE id = ${row.id}
  `;
  return { ok: true, alreadyConfirmed: false, email: row.email };
}

// ---------------------------------------------------------------------------
// Unsubscribe (signed, email-keyed token — no extra DB column needed)
// ---------------------------------------------------------------------------

function unsubscribeSecret(): string | undefined {
  return process.env.UNSUBSCRIBE_SECRET || process.env.CHAT_SHARED_SECRET || undefined;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build a signed unsubscribe token for an address: `b64url(email).b64url(hmac)`.
 * Stateless — verifiable without a DB lookup. Returns null when no signing
 * secret is configured.
 */
export function buildUnsubscribeToken(email: string): string | null {
  const secret = unsubscribeSecret();
  if (!secret) return null;
  const e = normalizeEmail(email);
  const sig = createHmac("sha256", secret).update(e).digest();
  return `${base64url(Buffer.from(e, "utf8"))}.${base64url(sig)}`;
}

/**
 * Verify an unsubscribe token and return the normalised email it signs, or null
 * if the token is malformed / the signature doesn't match.
 */
export function verifyUnsubscribeToken(token: string): string | null {
  const secret = unsubscribeSecret();
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
  const expected = createHmac("sha256", secret).update(email).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  return timingSafeEqual(provided, expected) ? email : null;
}

/**
 * Honour an unsubscribe: stamp unsubscribed_at on any capture for the address,
 * add it to the suppression list, and revoke marketing DOI. Idempotent.
 */
export async function unsubscribeByEmail(
  email: string,
  reason = "unsubscribe",
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false;
  const e = normalizeEmail(email);
  try {
    await sql.transaction([
      sql`
        UPDATE email_captures
           SET unsubscribed_at = COALESCE(unsubscribed_at, now()),
               marketing_doi_status = 'none'
         WHERE email = ${e}
      `,
      sql`
        INSERT INTO suppression_list (email, reason)
        VALUES (${e}, ${reason})
        ON CONFLICT (email) DO NOTHING
      `,
    ]);
    return true;
  } catch {
    return false;
  }
}
