// Consent / marketing data access (Cluster B — explicit consent).
//
// The module that writes the email-capture records (email_captures). It backs
// the GDPR email-capture + double-opt-in (DOI) flow:
//
//   - upsertEmailCapture()      POST /api/capture-email, /api/chat-marketing-opt-in,
//                               /api/account/marketing-opt-in
//   - releaseDoiClaim()         the same routes, after a DOI send that failed or never ran
//   - confirmMarketingByToken() GET  /api/confirm-marketing
//   - unsubscribeByEmail()      GET  /api/unsubscribe
//   - isSuppressed()            the block list, checked by every marketing send
//   - canSendMarketing()        the DOI gate of the legacy 1:1 path (approveAndSend)
//
// Rules enforced here (mirrors docs/CONSENT_FLOW.md):
//   * Transactional consent and marketing consent are independent.
//   * The legacy 1:1 path (canSendMarketing) requires marketing_doi_status =
//     'confirmed' AND the address not suppressed/unsubscribed. Campaign sends
//     use the one consent instead (customers.email_consent_state = 'subscribed'
//     AND not suppressed — campaign-prepare.ts / campaign-email.ts).
//   * A suppressed or unsubscribed address is never re-pended for DOI.
//   * At most one DOI mail per address within MARKETING_DOI_RESEND_COOLDOWN_
//     MINUTES, also for parallel requests; a DOI link confirms once, and never
//     after a withdrawal or a block (OPTIN_REWARD T2.1–T2.3).

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getSql, type Sql } from "./db";
import { isValidEmail } from "./capture-validation.mjs";
import { decideCaptureDoi, recordDoiCooldown } from "./email-capture-core.mjs";
import { effectiveDoiResendCooldownMinutes, parseDoiResendCooldownMinutes } from "./doi-cooldown.mjs";
import { optInOutcome } from "./capture-funnel.mjs";
import { normalizeLocale } from "./locale.mjs";
import type { Locale } from "./locale";
import { parseIntEnv } from "./env-num";
import { getBaseUrl } from "./base-url";
import { reportError } from "./observability";

export type MarketingDoiStatus = "none" | "pending" | "confirmed";

/** What a ticked marketing box led to (capture-funnel.mjs → OPT_IN_OUTCOMES). */
export type OptInOutcome =
  | "doi_required"
  | "already_confirmed"
  | "already_subscribed"
  | "suppressed"
  | "doi_pending"
  | "shopify_pending";

// Canonical email validation lives in capture-validation.mjs (plain .mjs so
// the capture-request validation is unit-testable); re-exported here so
// existing importers keep working off one definition.
export { isValidEmail };

/** Normalise an email for storage + lookup (trim + lower-case). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Cryptographically-random, URL-safe DOI token. */
function generateDoiToken(): string {
  return randomBytes(32).toString("hex");
}

export function doiExpiryDays(): number {
  return parseIntEnv("MARKETING_DOI_EXPIRY_DAYS", 7);
}

/**
 * MARKETING_DOI_RESEND_COOLDOWN_MINUTES (default 30, at least 1): after a DOI
 * mail, another opt-in for the address sends none within this window — and
 * parallel accepts collapse into one mail (doi-cooldown.mjs).
 */
export function doiResendCooldownMinutes(): number {
  // Never as long as the link's life: an expired link is never answered as
  // „a valid mail is out“.
  return effectiveDoiResendCooldownMinutes(
    parseDoiResendCooldownMinutes(process.env.MARKETING_DOI_RESEND_COOLDOWN_MINUTES),
    doiExpiryDays()
  );
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

/**
 * Hard block for ANY send: true when the address is on the suppression list
 * (opt-out, bounce, complaint, erasure). Since the one consent
 * (lib/consent-core.mjs) every withdrawal — ours or Shopify's — writes the
 * block list, and a newer real re-subscribe lifts it, so the list alone is the
 * truth (email_captures.unsubscribed_at stays as evidence only). Always
 * returns true (fail-closed) if it can't reach the database, so a transient DB
 * error can never let a send slip past the opt-out.
 */
export async function isSuppressed(email: string, sql: Sql | null = getSql()): Promise<boolean> {
  if (!sql) return true; // fail-closed: no DB means we can't prove it's allowed
  const e = normalizeEmail(email);
  try {
    const rows = await sql`
      SELECT 1 FROM suppression_list WHERE email = ${e} LIMIT 1
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

/**
 * True only when the consent record for `email` carries `sessionId` — i.e. the
 * (latest) capture of this address really came from THIS chat session. This is
 * the server-side half of the in-session re-identification gate for customer
 * memory in the live chat: the widget's claim ("the user just typed this email
 * here") is cross-checked against the capture trail, so a forged chat request
 * naming someone else's address resolves nothing unless the capture flow
 * actually ran from this very session. Fail-closed: no DB / no match / any
 * error → false.
 */
export async function wasEmailCapturedFromSession(
  email: string,
  sessionId: string,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql) return false; // fail-closed
  const e = normalizeEmail(email);
  const sid = sessionId.trim();
  if (!e || !sid) return false;
  try {
    const rows = await sql`
      SELECT 1 FROM email_captures
       WHERE email = ${e} AND session_id = ${sid}
       LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false; // fail-closed
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
  /**
   * Which canonical copy `consentTextShown` is (e.g. "v2") — resolved
   * server-side by the route (resolveConsentCopyVersion): set only when the
   * echoed text matches the currently-served canonical string byte-for-byte,
   * `null` otherwise (honest "unattested"). Stored alongside the verbatim
   * text so v1/v2 audit records stay distinguishable.
   */
  consentCopyVersion: string | null;
  /**
   * Storefront language at capture time ("de" default, "en" on /en). Carried so
   * the summary/DOI emails sent now AND later marketing sends speak the right
   * language. Defaults to German when absent.
   */
  locale?: Locale;
  /**
   * The person is already subscribed in the ONE consent (Shopify or an earlier
   * Mo DOI — lib/consent-flows.isEmailAlreadySubscribed): the tap is recorded
   * as evidence, but no new DOI token / mail is issued.
   */
  alreadySubscribed?: boolean;
  /**
   * The shop's own sign-up confirmation mail is out for this person (C.29:
   * Shopify PENDING within MARKETING_DOI_EXPIRY_DAYS — lib/shopify-optin-
   * precheck.ts): like `alreadySubscribed`, the tap is recorded as evidence,
   * no Mo token or mail is issued, and a pending Mo DOI is kept untouched.
   */
  pendingElsewhere?: boolean;
  /**
   * The shop holds an unsubscribe or an invalid address for this person
   * (C.29 precheck route "blocked"): handled as suppressed — no DOI mail,
   * neutral answer — even if writing the block-list row failed.
   */
  blocked?: boolean;
}

export interface UpsertCaptureResult {
  id: number;
  email: string;
  marketingDoiStatus: MarketingDoiStatus;
  doiToken: string | null;
  /**
   * True when THIS request claimed the DOI send and must mail `doiToken` now.
   * After a failed send (or none at all) the route calls releaseDoiClaim.
   */
  doiEmailRequired: boolean;
  /** The claim's exact doi_sent_at text (releaseDoiClaim guard); null without a claim. */
  doiClaimStamp: string | null;
  /**
   * What releaseDoiClaim puts back into doi_sent_at: the previous send time
   * of a re-sent token (its earlier link stays valid); null for a new token
   * (moved to just before the cooldown instead).
   */
  doiClaimRestore: string | null;
  /**
   * The box was ticked, but a valid Mo DOI mail went out within the resend
   * cooldown or a parallel request just claimed the send: no mail now, the
   * answer reads „confirmation mail is out“ (T2.1, outcome doi_pending).
   */
  doiCooldown: boolean;
  /** The claim mails the still-valid pending token again (its expiry restarts). */
  doiResend: boolean;
  /**
   * Marketing was granted and the address already holds the one consent
   * (input.alreadySubscribed) and is not suppressed — answer "confirmed",
   * no DOI mail.
   */
  subscribedElsewhere: boolean;
  /**
   * Marketing was granted, the address is neither suppressed nor subscribed,
   * and the shop's own confirmation mail is out (input.pendingElsewhere) —
   * answer "pending", no Mo DOI mail (C.29, outcome shopify_pending).
   */
  pendingElsewhere: boolean;
  /** The address is on the suppression list (unsubscribed / bounced / complained). */
  suppressed: boolean;
  /** What a ticked marketing box led to (capture-funnel.mjs), null when not ticked. */
  optInOutcome: OptInOutcome | null;
  /** The stored language for this address ("de" default). */
  locale: Locale;
}

/**
 * Upsert one consent record (keyed by normalised email). Records the exact
 * consent copy shown for the Art. 7 audit trail, and decides the marketing
 * DOI state — at most ONE DOI mail per address within the resend cooldown,
 * also when requests race (OPTIN_REWARD T2.1/T2.2):
 *   - already 'confirmed' → stays confirmed (re-submitting doesn't reset it).
 *   - marketing ticked, address subscribed elsewhere or the shop's own
 *     confirmation mail out (pendingElsewhere) → no Mo token, no mail; a
 *     pending Mo DOI stays untouched.
 *   - marketing ticked, a Mo DOI pending whose mail went out within the
 *     cooldown → kept, no mail (doiCooldown).
 *   - marketing ticked otherwise, not suppressed → CLAIM: 'pending', the
 *     still-valid pending token (re-send, doiResend) or a new one, sent now —
 *     doiEmailRequired=true only for the request whose claim wins.
 *   - marketing not ticked (or address suppressed) → no new DOI; an existing
 *     'confirmed' is preserved, a 'pending' one too unless the address is
 *     suppressed (its link stays valid), otherwise 'none'.
 *
 * Two conditional statements, both deciding on the locked current row and the
 * database clock (a JS read alone races): CLAIM (only when the core decided
 * to send) writes the pending DOI unless the row is confirmed, within the
 * cooldown or suppressed — a row back means this request sends; RECORD (every
 * other decision, and every lost claim) stores the evidence and computes the
 * DOI columns from the current row, so it never clobbers a parallel claim or
 * reverts a confirmation. Rules and tests: email-capture-core.mjs
 * (decideCaptureDoi, recordDoiStatus, recordDoiCooldown) — the SQL mirrors
 * them. A lost claim is not an error; null only when there is no database or
 * a statement fails (the routes answer 503).
 */
export async function upsertEmailCapture(
  input: UpsertCaptureInput,
  sql: Sql | null = getSql()
): Promise<UpsertCaptureResult | null> {
  if (!sql) return null;
  const email = normalizeEmail(input.email);
  const sessionId = input.sessionId?.trim() || null;
  const locale: Locale = normalizeLocale(input.locale);
  const ticked = Boolean(input.marketingConsent);

  try {
    // Read existing state to pre-decide the marketing transition.
    const existingRows = await sql`
      SELECT marketing_doi_status, doi_token, doi_sent_at, doi_sent_at::text AS doi_sent_at_text
        FROM email_captures WHERE email = ${email}
    `;
    const existing = existingRows[0] as
      | {
          marketing_doi_status: MarketingDoiStatus;
          doi_token: string | null;
          doi_sent_at: string | Date | null;
          doi_sent_at_text: string | null;
        }
      | undefined;

    const suppressed = input.blocked === true || (await isSuppressed(email, sql));
    const cooldownMinutes = doiResendCooldownMinutes();
    const expiryDays = doiExpiryDays();

    // The transition rules live in the tested core (email-capture-core.mjs).
    const decided = decideCaptureDoi({
      marketingConsent: ticked,
      alreadySubscribed: input.alreadySubscribed,
      pendingElsewhere: input.pendingElsewhere,
      suppressed,
      existing: existing
        ? {
            status: existing.marketing_doi_status,
            token: existing.doi_token,
            sentAt: existing.doi_sent_at == null ? null : new Date(existing.doi_sent_at).toISOString(),
          }
        : null,
      newToken: generateDoiToken,
      now: new Date().toISOString(),
      cooldownMinutes,
      expiryDays,
    });

    const result = (r: {
      id: number;
      status: MarketingDoiStatus;
      doiToken: string | null;
      doiEmailRequired: boolean;
      doiClaimStamp: string | null;
      doiClaimRestore: string | null;
      doiCooldown: boolean;
      doiResend: boolean;
      suppressed: boolean;
    }): UpsertCaptureResult => {
      const subscribedElsewhere = Boolean(ticked && !r.suppressed && input.alreadySubscribed);
      const pendingElsewhere = Boolean(ticked && !r.suppressed && !input.alreadySubscribed && input.pendingElsewhere);
      return {
        id: r.id,
        email,
        marketingDoiStatus: r.status,
        doiToken: r.doiToken,
        doiEmailRequired: r.doiEmailRequired,
        doiClaimStamp: r.doiClaimStamp,
        doiClaimRestore: r.doiClaimRestore,
        doiCooldown: r.doiCooldown,
        doiResend: r.doiResend,
        subscribedElsewhere,
        pendingElsewhere,
        suppressed: r.suppressed,
        optInOutcome: optInOutcome({
          marketingConsent: ticked,
          suppressed: r.suppressed,
          doiEmailRequired: r.doiEmailRequired,
          marketingDoiStatus: r.status,
          subscribedElsewhere,
          pendingElsewhere,
        }) as OptInOutcome | null,
        locale,
      };
    };

    if (decided.doiEmailRequired) {
      // CLAIM. The VALUES token is always a new one; the SQL keeps a pending,
      // unexpired token instead (a re-send), so a token the core read as
      // reusable but the database clock calls expired is replaced. A row
      // back = this request won the send; nothing back = confirmed, within
      // the cooldown (a parallel request claimed it) or suppressed since.
      const freshToken = decided.doiResend ? generateDoiToken() : (decided.doiToken ?? generateDoiToken());
      const claimed = (await sql`
        INSERT INTO email_captures
          (session_id, email, transactional_consent, marketing_consent,
           marketing_doi_status, doi_token, doi_sent_at, consent_text_shown,
           consent_copy_version, locale, created_at)
        VALUES
          (${sessionId}, ${email}, ${input.transactionalConsent}, true,
           'pending', ${freshToken}, now(), ${input.consentTextShown},
           ${input.consentCopyVersion}, ${locale}, now())
        ON CONFLICT (email) DO UPDATE SET
          session_id            = COALESCE(EXCLUDED.session_id, email_captures.session_id),
          transactional_consent = email_captures.transactional_consent OR EXCLUDED.transactional_consent,
          marketing_consent     = true,
          marketing_doi_status  = 'pending',
          doi_token             = CASE
            WHEN email_captures.marketing_doi_status = 'pending'
             AND email_captures.doi_token IS NOT NULL
             AND (email_captures.doi_sent_at IS NULL
                  OR email_captures.doi_sent_at > now() - make_interval(days => ${expiryDays}))
            THEN email_captures.doi_token
            ELSE EXCLUDED.doi_token
          END,
          doi_sent_at           = EXCLUDED.doi_sent_at,
          consent_text_shown    = COALESCE(EXCLUDED.consent_text_shown, email_captures.consent_text_shown),
          consent_copy_version  = CASE
            WHEN EXCLUDED.consent_text_shown IS NOT NULL THEN EXCLUDED.consent_copy_version
            ELSE email_captures.consent_copy_version
          END,
          locale                = COALESCE(EXCLUDED.locale, email_captures.locale)
        WHERE email_captures.marketing_doi_status <> 'confirmed'
          AND NOT (email_captures.marketing_doi_status = 'pending'
                   AND email_captures.doi_token IS NOT NULL
                   AND email_captures.doi_sent_at IS NOT NULL
                   AND email_captures.doi_sent_at > now() - make_interval(mins => ${cooldownMinutes}))
          AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = EXCLUDED.email)
        RETURNING id, doi_token, doi_sent_at::text AS doi_claim_stamp
      `) as Array<{ id: number | string; doi_token: string; doi_claim_stamp: string }>;
      const won = claimed[0];
      // An unsubscribe that committed while this claim waited on the row lock
      // is not visible to the claim's own NOT EXISTS (statement snapshot):
      // re-check the block list in a fresh statement and undo the claim.
      if (won && won.id != null && (await isSuppressed(email, sql))) {
        await sql`
          UPDATE email_captures
             SET marketing_doi_status = 'none', doi_token = NULL, doi_sent_at = NULL
           WHERE id = ${won.id}
             AND doi_token = ${String(won.doi_token)}
             AND marketing_doi_status = 'pending'
             AND doi_sent_at = ${String(won.doi_claim_stamp)}::timestamptz
        `;
        return result({
          id: Number(won.id),
          status: "none",
          doiToken: null,
          doiEmailRequired: false,
          doiClaimStamp: null,
          doiClaimRestore: null,
          doiCooldown: false,
          doiResend: false,
          suppressed: true,
        });
      }
      if (won && won.id != null) {
        const doiToken = String(won.doi_token);
        const doiResend = doiToken !== freshToken;
        return result({
          id: Number(won.id),
          status: "pending",
          doiToken,
          doiEmailRequired: true,
          doiClaimStamp: String(won.doi_claim_stamp),
          // A re-sent token was mailed before: a failed re-send puts its
          // previous send time back, so the link in the inbox stays valid.
          doiClaimRestore: doiResend && existing?.doi_token === doiToken ? (existing.doi_sent_at_text ?? null) : null,
          doiCooldown: false,
          doiResend,
          suppressed,
        });
      }
    }

    // RECORD (mirrors recordDoiStatus): confirmed stays; pending stays unless
    // suppressed; anything else → none without a token.
    const rows = (await sql`
      INSERT INTO email_captures
        (session_id, email, transactional_consent, marketing_consent,
         marketing_doi_status, doi_token, doi_sent_at, consent_text_shown,
         consent_copy_version, locale, created_at)
      VALUES
        (${sessionId}, ${email}, ${input.transactionalConsent}, ${decided.marketingConsentColumn},
         'none', NULL, NULL, ${input.consentTextShown},
         ${input.consentCopyVersion}, ${locale}, now())
      ON CONFLICT (email) DO UPDATE SET
        session_id            = COALESCE(EXCLUDED.session_id, email_captures.session_id),
        transactional_consent = email_captures.transactional_consent OR EXCLUDED.transactional_consent,
        marketing_consent     = CASE
          WHEN email_captures.marketing_doi_status = 'confirmed' THEN true
          WHEN email_captures.marketing_doi_status = 'pending'
           AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = EXCLUDED.email) THEN true
          ELSE EXCLUDED.marketing_consent
        END,
        marketing_doi_status  = CASE
          WHEN email_captures.marketing_doi_status = 'confirmed' THEN 'confirmed'
          WHEN email_captures.marketing_doi_status = 'pending'
           AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = EXCLUDED.email) THEN 'pending'
          ELSE 'none'
        END,
        doi_token             = CASE
          WHEN email_captures.marketing_doi_status = 'confirmed' THEN email_captures.doi_token
          WHEN email_captures.marketing_doi_status = 'pending'
           AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = EXCLUDED.email) THEN email_captures.doi_token
          ELSE NULL
        END,
        doi_sent_at           = CASE
          WHEN email_captures.marketing_doi_status = 'confirmed' THEN email_captures.doi_sent_at
          WHEN email_captures.marketing_doi_status = 'pending'
           AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = EXCLUDED.email) THEN email_captures.doi_sent_at
          ELSE NULL
        END,
        -- Keep the freshest consent copy we actually showed; the version always
        -- follows the text it describes (updated together, or not at all).
        consent_text_shown    = COALESCE(EXCLUDED.consent_text_shown, email_captures.consent_text_shown),
        consent_copy_version  = CASE
          WHEN EXCLUDED.consent_text_shown IS NOT NULL THEN EXCLUDED.consent_copy_version
          ELSE email_captures.consent_copy_version
        END,
        -- Track the latest storefront language this address engaged from.
        locale                = COALESCE(EXCLUDED.locale, email_captures.locale)
      RETURNING id, marketing_doi_status, doi_token,
                (marketing_doi_status = 'pending'
                 AND doi_token IS NOT NULL
                 AND doi_sent_at IS NOT NULL
                 AND doi_sent_at > now() - make_interval(mins => ${cooldownMinutes})) AS in_cooldown,
                EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = email_captures.email) AS suppressed_now
    `) as Array<{
      id: number | string;
      marketing_doi_status: MarketingDoiStatus;
      doi_token: string | null;
      in_cooldown: boolean;
      suppressed_now: boolean;
    }>;
    const row = rows[0];
    if (!row || row.id == null) return null;
    const suppressedFinal = suppressed || row.suppressed_now === true;
    return result({
      id: Number(row.id),
      status: row.marketing_doi_status,
      doiToken: row.doi_token ?? null,
      doiEmailRequired: false,
      doiClaimStamp: null,
      doiClaimRestore: null,
      doiCooldown: recordDoiCooldown({
        marketingConsent: ticked,
        suppressed: suppressedFinal,
        alreadySubscribed: input.alreadySubscribed,
        pendingElsewhere: input.pendingElsewhere,
        status: row.marketing_doi_status,
        inCooldown: row.in_cooldown === true,
      }),
      doiResend: false,
      suppressed: suppressedFinal,
    });
  } catch (err) {
    reportError(err, { route: "lib/email-capture-store", phase: "upsertEmailCapture" });
    return null;
  }
}

/**
 * Undo a DOI claim whose mail did not go out (the send failed, or the request
 * ended before it ran): a new token's doi_sent_at moves to just before the
 * cooldown (the next accept sends at once — the same token —, and a mail the
 * provider delivered despite a reported failure keeps a working link); a
 * re-sent token gets its previous send time back (its earlier mail's link
 * stays valid). Guarded by id + token + the claim's exact stamp, so a
 * late release after a newer claim is a no-op. Fail-soft: false on no-op, no
 * database or an error.
 */
export async function releaseDoiClaim(
  claim: Pick<UpsertCaptureResult, "id" | "doiToken" | "doiClaimStamp" | "doiClaimRestore">,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql || !claim.doiToken || !claim.doiClaimStamp) return false;
  try {
    // A re-sent token gets its previous send time back. A new token is moved
    // to just before the cooldown, not cleared: the next accept sends at once
    // (same token), and a mail the provider delivered despite reporting a
    // failure keeps a working link.
    const cooldownMinutes = doiResendCooldownMinutes();
    const rows = await sql`
      UPDATE email_captures
         SET doi_sent_at = COALESCE(
               ${claim.doiClaimRestore}::timestamptz,
               ${claim.doiClaimStamp}::timestamptz - make_interval(mins => ${cooldownMinutes}) - interval '1 second'
             )
       WHERE id = ${claim.id}
         AND doi_token = ${claim.doiToken}
         AND marketing_doi_status = 'pending'
         AND doi_sent_at = ${claim.doiClaimStamp}::timestamptz
      RETURNING id
    `;
    return rows.length > 0;
  } catch (err) {
    reportError(err, { route: "lib/email-capture-store", phase: "releaseDoiClaim" });
    return false;
  }
}

// ---------------------------------------------------------------------------
// DOI confirmation
// ---------------------------------------------------------------------------

export type ConfirmResult =
  | {
      ok: true;
      /** true = this click did not confirm (an earlier or a parallel click did) — no act, no KPI. */
      alreadyConfirmed: boolean;
      email: string;
      /** Pseudonymous session the capture came from (for KPI telemetry). */
      sessionId: string | null;
      /** email_captures.id — the consent act's origin (email_capture:<id>). */
      captureId: number;
    }
  | { ok: false; reason: "not_found" | "expired" | "unavailable" };

/**
 * Validate a DOI token and flip the capture to 'confirmed' — once (T2.3). The
 * flip is conditional: the row is still 'pending' with this token, its link
 * is not expired and the address is not suppressed; exactly one click wins
 * (alreadyConfirmed=false) and only the winner may record the consent act and
 * the KPI. A click on an already confirmed token — earlier or in parallel —
 * answers ok with alreadyConfirmed=true. A token whose address has withdrawn
 * since (status 'none') or is suppressed → not_found, so an old link never
 * re-subscribes. Tokens older than the expiry window (by doi_sent_at; none →
 * expired, from claims released before 2026-10-09) → expired. No database or a failed statement →
 * unavailable.
 */
export async function confirmMarketingByToken(
  token: string,
  sql: Sql | null = getSql()
): Promise<ConfirmResult> {
  if (!sql) return { ok: false, reason: "unavailable" };
  const t = token.trim();
  if (!t) return { ok: false, reason: "not_found" };

  try {
    const rows = await sql`
      SELECT id, email, session_id, marketing_doi_status, doi_sent_at
        FROM email_captures WHERE doi_token = ${t}
    `;
    const row = rows[0] as
      | {
          id: number | string;
          email: string;
          session_id: string | null;
          marketing_doi_status: MarketingDoiStatus;
          doi_sent_at: string | Date | null;
        }
      | undefined;
    if (!row) return { ok: false, reason: "not_found" };
    const found = { email: row.email, sessionId: row.session_id, captureId: Number(row.id) };

    if (row.marketing_doi_status === "confirmed") {
      return { ok: true, alreadyConfirmed: true, ...found };
    }
    // Withdrawn since the mail (unsubscribe keeps the token with status none).
    if (row.marketing_doi_status !== "pending") return { ok: false, reason: "not_found" };

    // Expiry by doi_sent_at (no stamp — a claim released before 2026-10-09 → expired).
    const sentAt = row.doi_sent_at == null ? NaN : new Date(row.doi_sent_at).getTime();
    const ageMs = Number.isFinite(sentAt) ? Date.now() - sentAt : Infinity;
    if (ageMs > doiExpiryDays() * 86_400_000) {
      return { ok: false, reason: "expired" };
    }

    const won = await sql`
      UPDATE email_captures
         SET marketing_doi_status = 'confirmed',
             doi_confirmed_at = now()
       WHERE id = ${row.id}
         AND doi_token = ${t}
         AND marketing_doi_status = 'pending'
         AND doi_sent_at > now() - make_interval(days => ${doiExpiryDays()})
         AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = email_captures.email)
      RETURNING id
    `;
    if (won.length > 0) return { ok: true, alreadyConfirmed: false, ...found };

    // Lost: a parallel click confirmed it — or it was withdrawn, suppressed,
    // expired or re-tokened in the meantime (→ the invalid page).
    const again = (await sql`
      SELECT marketing_doi_status FROM email_captures WHERE id = ${row.id} AND doi_token = ${t}
    `) as Array<{ marketing_doi_status: MarketingDoiStatus }>;
    if (again[0]?.marketing_doi_status === "confirmed") {
      return { ok: true, alreadyConfirmed: true, ...found };
    }
    return { ok: false, reason: "not_found" };
  } catch (err) {
    reportError(err, { route: "lib/email-capture-store", phase: "confirmMarketingByToken" });
    return { ok: false, reason: "unavailable" };
  }
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
 * Sign an address for a purpose: `b64url(email).b64url(hmac)`. The unsubscribe
 * token signs the bare email (unchanged, so every link already sent keeps
 * working); other purposes sign `purpose:email`, so a token for one action
 * never verifies for another. Stateless; null without a signing secret.
 */
function signEmailToken(email: string, purpose: "" | "erase"): string | null {
  const secret = unsubscribeSecret();
  if (!secret) return null;
  const e = normalizeEmail(email);
  const payload = purpose ? `${purpose}:${e}` : e;
  const sig = createHmac("sha256", secret).update(payload).digest();
  return `${base64url(Buffer.from(e, "utf8"))}.${base64url(sig)}`;
}

function verifyEmailToken(token: string, purpose: "" | "erase"): string | null {
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
  const payload = purpose ? `${purpose}:${email}` : email;
  const expected = createHmac("sha256", secret).update(payload).digest();
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
 * Build a signed unsubscribe token for an address: `b64url(email).b64url(hmac)`.
 * Stateless — verifiable without a DB lookup. Returns null when no signing
 * secret is configured.
 */
export function buildUnsubscribeToken(email: string): string | null {
  return signEmailToken(email, "");
}

/**
 * Verify an unsubscribe token and return the normalised email it signs, or null
 * if the token is malformed / the signature doesn't match.
 */
export function verifyUnsubscribeToken(token: string): string | null {
  return verifyEmailToken(token, "");
}

/** The signed token behind a mail's "Daten löschen" link (/api/erase-data).
 *  Purpose-bound: an unsubscribe token never verifies as an erasure token. */
export function buildErasureToken(email: string): string | null {
  return signEmailToken(email, "erase");
}

/** The email an erasure token signs, or null when it is invalid. */
export function verifyErasureToken(token: string): string | null {
  return verifyEmailToken(token, "erase");
}

/** The "Daten löschen" URL for a mail footer, or null without a signing
 *  secret (the footer then simply omits the sentence). */
export function buildErasureUrl(email: string, locale: Locale = "de"): string | null {
  const token = buildErasureToken(email);
  if (!token) return null;
  return (
    `${getBaseUrl()}/api/erase-data?token=${encodeURIComponent(token)}` +
    (locale === "en" ? "&locale=en" : "")
  );
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
