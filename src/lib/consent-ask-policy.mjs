// Per-customer anti-nag for the consent popup after a sign-in (P0.3 Phase 2).
// Pure, tested.
//
// The widget remembers a decline per device (30 days) and a dismiss per tab
// session only; the backend recorded neither (CA §6.1). Once a shop login
// signs a visitor in without a click (D-AP1), the popup would otherwise ask
// in every tab session and on every device. So the backend stops offering the
// opt-in (`optInActionable:false`) for a customer who declined in any of
// their sessions in the last 30 days, or who saw the ask in 3 sessions.

export const CONSENT_ASK_MAX_SHOWN_SESSIONS = 3;

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
