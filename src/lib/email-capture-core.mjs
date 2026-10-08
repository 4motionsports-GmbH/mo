// The marketing double-opt-in decision of one e-mail capture upsert
// (email-capture-store.ts → upsertEmailCapture). Pure: the store reads the
// existing row and the suppression list, this decides what to write.
//
// The decision is a PRE-FILTER: the store's conditional SQL (CLAIM / RECORD in
// email-capture-store.ts) mirrors these rules against the locked current row
// and the database clock, and is authoritative when requests race (OPTIN_REWARD
// T2.1/T2.2). Change both together.

import { DEFAULT_DOI_RESEND_COOLDOWN_MINUTES } from "./doi-cooldown.mjs";

/** MARKETING_DOI_EXPIRY_DAYS default (email-capture-store.ts → doiExpiryDays). */
export const DEFAULT_DOI_EXPIRY_DAYS = 7;

/**
 * @typedef {"none" | "pending" | "confirmed"} DoiStatus
 * @typedef {{ status: DoiStatus, token: string | null, sentAt: string | null }} ExistingDoi
 */

/** ms from `iso` to `now`; null when either is missing or unparsable. */
function ageMs(iso, now) {
  if (!iso) return null;
  const t = Date.parse(iso);
  const n = Date.parse(now);
  return Number.isFinite(t) && Number.isFinite(n) ? n - t : null;
}

/**
 * A pending DOI whose mail went out less than `cooldownMs` ago — a valid link
 * is in the inbox, so another opt-in sends none. A released claim (sentAt
 * null: its send failed or never ran) is never in the cooldown.
 * @param {ExistingDoi | null | undefined} existing
 * @param {string} now
 * @param {number} cooldownMs
 */
export function isWithinDoiCooldown(existing, now, cooldownMs) {
  if (existing?.status !== "pending" || !existing.token) return false;
  const age = ageMs(existing.sentAt, now);
  return age !== null && age < cooldownMs;
}

/**
 * The pending token may be mailed again: present and not expired. sentAt null
 * (a released claim) → reusable; an unparsable sentAt → not.
 * @param {ExistingDoi | null | undefined} existing
 * @param {string} now
 * @param {number} expiryMs
 */
export function isReusableDoiToken(existing, now, expiryMs) {
  if (existing?.status !== "pending" || !existing.token) return false;
  if (existing.sentAt == null) return true;
  const age = ageMs(existing.sentAt, now);
  return age !== null && age < expiryMs;
}

/**
 * Rules:
 *   - already `confirmed` → stays confirmed with its token and send time
 *     (re-submitting never resets it; only an explicit unsubscribe revokes it);
 *   - marketing ticked, address already subscribed elsewhere (the one consent)
 *     or the shop's own confirmation mail is out (`pendingElsewhere`, C.29) →
 *     no new token, no DOI mail; a `pending` Mo DOI keeps token and send time
 *     (never overwritten, its link stays valid);
 *   - marketing ticked, not suppressed, a Mo DOI `pending` whose mail went out
 *     within the cooldown → kept as it is, no mail (`doiCooldown`);
 *   - marketing ticked, not suppressed, otherwise → `pending`, sent now: the
 *     still-valid pending token is mailed again (`doiResend`; its expiry
 *     restarts), else a new token;
 *   - marketing NOT ticked now (e.g. only the summary) but a DOI is still
 *     `pending` and the address is not suppressed → the pending DOI stays as
 *     it is (token, send time, marketing flag), so the link already in the
 *     inbox keeps working until it expires;
 *   - otherwise (not ticked or suppressed) → `none`, no token.
 *
 * @param {{
 *   marketingConsent: boolean,
 *   alreadySubscribed?: boolean,
 *   pendingElsewhere?: boolean,
 *   suppressed: boolean,
 *   existing: ExistingDoi | null | undefined,
 *   newToken: () => string,
 *   now: string,
 *   cooldownMinutes?: number,
 *   expiryDays?: number,
 * }} input
 * @returns {{ status: DoiStatus, doiToken: string | null, doiSentAt: string | null,
 *             doiEmailRequired: boolean, marketingConsentColumn: boolean,
 *             doiCooldown: boolean, doiResend: boolean }}
 */
export function decideCaptureDoi(input) {
  const ex = input.existing ?? null;
  const confirmed = ex?.status === "confirmed";
  const pending = ex?.status === "pending";
  const cooldownMs = (input.cooldownMinutes ?? DEFAULT_DOI_RESEND_COOLDOWN_MINUTES) * 60_000;
  const expiryMs = (input.expiryDays ?? DEFAULT_DOI_EXPIRY_DAYS) * 86_400_000;
  const base = { doiCooldown: false, doiResend: false };
  /** @param {DoiStatus} status */
  const keep = (status) => ({
    ...base,
    status,
    doiToken: ex?.token ?? null,
    doiSentAt: ex?.sentAt ?? null,
    doiEmailRequired: false,
  });
  const ticked = Boolean(input.marketingConsent) && !input.suppressed;

  if (confirmed) {
    return { ...keep("confirmed"), marketingConsentColumn: true };
  }
  if (ticked && (input.alreadySubscribed || input.pendingElsewhere)) {
    if (pending) return { ...keep("pending"), marketingConsentColumn: true };
    return { ...base, status: "none", doiToken: null, doiSentAt: null, doiEmailRequired: false, marketingConsentColumn: true };
  }
  if (ticked) {
    if (pending && isWithinDoiCooldown(ex, input.now, cooldownMs)) {
      return { ...keep("pending"), marketingConsentColumn: true, doiCooldown: true };
    }
    const resend = pending && isReusableDoiToken(ex, input.now, expiryMs);
    return {
      ...base,
      status: "pending",
      doiToken: resend && ex ? ex.token : input.newToken(),
      doiSentAt: input.now,
      doiEmailRequired: true,
      marketingConsentColumn: true,
      doiResend: resend,
    };
  }
  if (pending && !input.suppressed) {
    return { ...keep("pending"), marketingConsentColumn: true };
  }
  return {
    ...base,
    status: "none",
    doiToken: null,
    doiSentAt: null,
    doiEmailRequired: false,
    marketingConsentColumn: Boolean(input.marketingConsent),
  };
}

/**
 * The store's RECORD write (every decision that sends no mail, and every
 * request that lost the CLAIM) as a pure function of the locked current row:
 * `confirmed` stays; `pending` stays unless the address is suppressed (the
 * link in the inbox keeps working); anything else becomes `none` without a
 * token. The SQL CASE in email-capture-store.ts mirrors this.
 * @param {DoiStatus | null | undefined} currentStatus  null = no row yet
 * @param {boolean} suppressed
 * @returns {DoiStatus}
 */
export function recordDoiStatus(currentStatus, suppressed) {
  if (currentStatus === "confirmed") return "confirmed";
  if (currentStatus === "pending" && !suppressed) return "pending";
  return "none";
}

/**
 * @typedef {"none" | "sent" | "skipped" | "failed"} DoiSendState
 *   none = the send never ran (not claimed, or the request ended first);
 *   skipped = no mail provider configured (local dev).
 */

/**
 * After the send attempt: give a won claim back (releaseDoiClaim) when its
 * mail did not go out — the send failed or never ran — so the next accept
 * sends at once instead of waiting out the cooldown. A skipped send (dev, no
 * provider) keeps the claim.
 * @param {boolean} claimed  upsert result doiEmailRequired
 * @param {DoiSendState} state
 */
export function shouldReleaseDoiClaim(claimed, state) {
  return claimed === true && (state === "none" || state === "failed");
}

/**
 * The pending act of the one consent (recordMoOptIn) is written only once the
 * claimed DOI mail went out — or was skipped (dev) — so a failed send leaves
 * the customer asked again (optInActionable stays true).
 * @param {boolean} claimed  upsert result doiEmailRequired
 * @param {DoiSendState} state
 */
export function isDoiOptInRecorded(claimed, state) {
  return claimed === true && (state === "sent" || state === "skipped");
}

/**
 * `doiCooldown` of a RECORD result: the box was ticked on an address that is
 * neither suppressed nor subscribed / pending elsewhere, and the row holds a
 * Mo DOI whose mail went out within the cooldown (also one a parallel request
 * just claimed) — no new mail, the answer reads „confirmation mail is out“.
 * @param {{ marketingConsent: boolean, suppressed: boolean, alreadySubscribed?: boolean,
 *   pendingElsewhere?: boolean, status: string, inCooldown: boolean }} r
 */
export function recordDoiCooldown(r) {
  return (
    Boolean(r.marketingConsent) &&
    !r.suppressed &&
    !r.alreadySubscribed &&
    !r.pendingElsewhere &&
    r.status === "pending" &&
    r.inCooldown === true
  );
}
