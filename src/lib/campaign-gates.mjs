// THE marketing send gate (pure, no I/O) — the single decision function every
// marketing e-mail passes BEFORE any claim/mint/send step: every campaign, the
// Einzelansprache, the copy path, the desk's Prüfpunkte and the Eingang
// suggestions. Kept in plain .mjs so the part with legal consequences is
// unit-tested in isolation.
//
// Since the one consent (docs/archive/CUSTOMER_PLATFORM_PLAN.md §7) the person's
// consent STATE comes from customers.email_consent_state (shared with Shopify),
// the opt-in LEVEL from customers.email_consent_level — read fresh at send time.
//
// The caller gathers the facts (flags, opt-in level, suppression check result,
// last cross-channel send timestamp) and this function decides — in a fixed
// order, most fundamental refusal first — whether the send may proceed. Every
// input is treated fail-closed: an unknown opt-in level blocks like UNKNOWN,
// and `suppressed` must be an explicit `false` (the DB check itself already
// fails closed — see isSuppressed).

/** Opt-in levels that count as a PROVABLE double opt-in on the Shopify side. */
export const CONFIRMED_OPT_IN = "CONFIRMED_OPT_IN";

export const GATE_REASONS = /** @type {const} */ ({
  NOT_APPROVED: "not_approved",
  NO_CONSENT: "no_consent",
  OPT_IN_LEVEL: "opt_in_level",
  SUPPRESSED: "suppressed",
  TOO_SOON: "too_soon",
});

/**
 * Evaluate every campaign send gate. Returns `{ allowed: true }` only when ALL
 * gates pass; otherwise `{ allowed: false, reason }` with the FIRST failing
 * gate (evaluation order: master flag → consent → opt-in level → suppression →
 * frequency cap).
 *
 * @param {{
 *   sendsApproved: boolean,          // CAMPAIGN_SENDS_APPROVED
 *   allowSingleOptIn: boolean,       // CAMPAIGN_ALLOW_SINGLE_OPT_IN
 *   consentState: string | null,     // customers.email_consent_state — must be "subscribed"
 *   optInLevel: string | null,       // CONFIRMED_OPT_IN | SINGLE_OPT_IN | UNKNOWN
 *   suppressed: boolean,             // fresh isSuppressed() result (fail-closed)
 *   lastSendAt: string | null,       // newest send to this EMAIL across BOTH
 *                                    // channels (marketing + campaign), or null
 *   minIntervalDays: number,         // MARKETING_MIN_SEND_INTERVAL_DAYS (0 = off)
 *   nowMs?: number,                  // injectable clock for tests
 * }} input
 * @returns {{ allowed: true } | { allowed: false, reason: string }}
 */
export function evaluateCampaignSendGates(input) {
  if (input.sendsApproved !== true) {
    return { allowed: false, reason: GATE_REASONS.NOT_APPROVED };
  }
  if (input.consentState !== "subscribed") {
    return { allowed: false, reason: GATE_REASONS.NO_CONSENT };
  }
  if (input.optInLevel !== CONFIRMED_OPT_IN && input.allowSingleOptIn !== true) {
    return { allowed: false, reason: GATE_REASONS.OPT_IN_LEVEL };
  }
  if (input.suppressed !== false) {
    return { allowed: false, reason: GATE_REASONS.SUPPRESSED };
  }
  const intervalDays = Number(input.minIntervalDays);
  if (Number.isFinite(intervalDays) && intervalDays > 0 && input.lastSendAt) {
    const last = Date.parse(input.lastSendAt);
    const now = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
    if (Number.isFinite(last)) {
      const ageMs = now - last;
      if (ageMs < intervalDays * 86_400_000) {
        return { allowed: false, reason: GATE_REASONS.TOO_SOON };
      }
    }
  }
  return { allowed: true };
}

/** customers.email_consent_level → the gate's opt-in level vocabulary. */
export function optInLevelFromConsent(level) {
  if (level === "confirmed_opt_in") return CONFIRMED_OPT_IN;
  if (level === "single_opt_in") return "SINGLE_OPT_IN";
  return "UNKNOWN";
}
