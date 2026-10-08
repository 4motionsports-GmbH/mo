// The marketing-DOI resend cooldown (MARKETING_DOI_RESEND_COOLDOWN_MINUTES) —
// one parser for the opt-in routes and verify:live (OPTIN_REWARD T2.1).
//
// Within the cooldown after a DOI mail, another opt-in for the same address
// sends no new mail (a valid link is in the inbox); the same window makes
// parallel accepts collapse into one mail, so it cannot be switched off.

export const DEFAULT_DOI_RESEND_COOLDOWN_MINUTES = 30;
/** Upper bound: the default link life (MARKETING_DOI_EXPIRY_DAYS = 7 days). */
export const MAX_DOI_RESEND_COOLDOWN_MINUTES = 10_080;

/**
 * Minutes from the raw env value. Unset, not a whole number, below 1 or above
 * MAX_DOI_RESEND_COOLDOWN_MINUTES → the default.
 * @param {unknown} raw
 * @returns {number}
 */
export function parseDoiResendCooldownMinutes(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return DEFAULT_DOI_RESEND_COOLDOWN_MINUTES;
  const n = Number(text);
  return n >= 1 && n <= MAX_DOI_RESEND_COOLDOWN_MINUTES ? n : DEFAULT_DOI_RESEND_COOLDOWN_MINUTES;
}
