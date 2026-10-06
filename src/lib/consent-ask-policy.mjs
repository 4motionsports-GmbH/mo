// Per-customer anti-nag for the consent popup after a sign-in (P0.3 Phase 2).
// Pure, tested.
//
// The widget remembers a decline per device (30 days) and a dismiss per tab
// session only; the backend recorded neither (CA §6.1). Once a shop login
// signs a visitor in without a click (D-AP1), the popup would otherwise ask
// in every tab session and on every device. So the backend stops offering the
// opt-in (`optInActionable:false`) for a customer who declined in any of
// their sessions in the last 30 days, or who saw the ask in 3 sessions.
// `isMarketingOptInActionable` holds the whole rule (address, status,
// suppression list, anti-nag) for /api/auth/me and whoami alike.

export const CONSENT_ASK_MAX_SHOWN_SESSIONS = 3;

/**
 * A tier-3 row created without a verified Shopify e-mail claim is keyed by this
 * placeholder — it cannot receive a DOI or marketing mail.
 */
export const SYNTHETIC_EMAIL_PREFIX = "shopify:";

/** @param {unknown} email  true when it is a real, mailable address (not the placeholder) */
export function isMailableEmail(email) {
  return typeof email === "string" && email.includes("@") && !email.startsWith(SYNTHETIC_EMAIL_PREFIX);
}

/**
 * The whole `optInActionable` rule (ACCOUNT_CONTRACT §6.1): offer the
 * marketing ask after a sign-in only when the customer has a real address, no
 * consent decision on record (status `none`), the address is NOT on the
 * suppression list — any reason: unsubscribe, manual, complaint, bounce,
 * erasure (owner's decision 2026-10-06: an accept there writes no consent act,
 * so the ask would only come back) — and the anti-nag is not quiet. Only an
 * explicit `false` for `suppressed` and `quiet` counts: an unknown value fails
 * closed.
 *
 * @param {{ email: unknown, marketingStatus: unknown, suppressed: unknown, quiet: unknown }} state
 * @returns {boolean}
 */
export function isMarketingOptInActionable({ email, marketingStatus, suppressed, quiet }) {
  return isMailableEmail(email) && marketingStatus === "none" && suppressed === false && quiet === false;
}

/**
 * @param {{ declinedSessions: unknown, shownSessions: unknown }} counts  sessions of
 *   this customer in the last 30 days (consent_gate_* with surface signin)
 * @param {{ maxShownSessions?: number }} [options]
 * @returns {boolean} true = do not ask again now; invalid input → true (fail closed)
 */
export function isConsentAskQuiet({ declinedSessions, shownSessions }, { maxShownSessions = CONSENT_ASK_MAX_SHOWN_SESSIONS } = {}) {
  const declined = Number(declinedSessions);
  const shown = Number(shownSessions);
  if (!Number.isFinite(declined) || !Number.isFinite(shown) || declined < 0 || shown < 0) return true;
  return declined > 0 || shown >= maxShownSessions;
}
