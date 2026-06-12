// WELCOME_DISCOUNT_ENABLED feature flag — kept in plain .mjs (pure, no I/O)
// so it is trivially unit-testable with node:test and shared by the TS
// modules, mirroring the email-offer-trigger.mjs convention.
//
// CLIENT DECISION (June 2026): the automatic one-time welcome discount on DOI
// confirmation is too exploitable — one alias email = one fresh code — so the
// entire issuance path is gated behind this flag and the client issues codes
// manually via the dashboard instead. DEFAULT IS OFF: only an explicit
// opt-in value enables issuance, so a missing/typo'd env var can never mint
// codes. Historical issued/redeemed data stays visible on the dashboard
// (labelled "(deaktiviert)"). See docs/WELCOME_DISCOUNT.md.

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Whether the automatic welcome-discount issuance is enabled. Reads
 * WELCOME_DISCOUNT_ENABLED; defaults to FALSE (fail-closed) for any absent,
 * empty, or unrecognised value.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isWelcomeDiscountEnabled(env = process.env) {
  const raw = env.WELCOME_DISCOUNT_ENABLED;
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}
