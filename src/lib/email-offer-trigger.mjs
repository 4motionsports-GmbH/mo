// Deterministic server-side trigger for the email-summary offer. Kept in plain
// .mjs (pure, no I/O) so it is trivially unit-testable with node:test and
// shared by the TS chat route — mirroring the kpi-match.mjs convention.
//
// WHY THIS EXISTS: the value-triggered ask was originally prompt-driven only.
// In real client testing the model reliably emitted the add_to_cart /
// direct-checkout card at buying intent but never followed up with
// offer_email_summary — the persona's (correct) anti-pushiness rules outweigh
// the soft prompt trigger at exactly the highest-intent moment. The backend
// therefore guarantees the ask at checkout intent: when a turn has called
// add_to_cart and the model has not offered the email summary itself, the
// chat route forces ONE extra step with toolChoice pinned to
// offer_email_summary (see api/chat/route.ts → prepareStep). The forced call
// streams like any other tool call, so it counts toward the two-ask cap and
// the ask-shown KPI exactly like a model-initiated offer.

/**
 * Hard cap on offer_email_summary invitations per conversation. The system
 * prompt instructs the model to stop on its own; this constant additionally
 * backs the server-side enforcement (the tool is withheld entirely once the
 * cap is reached — see buildChatTools / api/chat).
 */
export const MAX_EMAIL_OFFERS_PER_CONVERSATION = 2;

/**
 * Decide whether the next step of the agentic loop must be forced to call
 * offer_email_summary. Evaluated before every step (and by the step-budget
 * stop condition, so the forced step can never be starved by the step cap).
 *
 * Fires only when ALL of these hold:
 * - a checkout-intent tool call (add_to_cart) already happened this turn,
 * - the model has not called offer_email_summary itself this turn,
 * - no email was captured in this session,
 * - the two-ask cap is not reached (the forced ask becomes one of the two),
 * - the user has not declined a capture form in this session.
 *
 * @param {{
 *   emailCaptured: boolean,
 *   offersMade: number,
 *   declined: boolean,
 *   toolNamesCalled: string[],
 * }} state `offersMade` counts offers from PRIOR turns (message history);
 *   `toolNamesCalled` are the tool calls of the CURRENT turn's steps so far.
 * @returns {boolean}
 */
export function shouldForceEmailOfferStep({
  emailCaptured,
  offersMade,
  declined,
  toolNamesCalled,
}) {
  if (emailCaptured) return false;
  if (declined) return false;
  if (offersMade >= MAX_EMAIL_OFFERS_PER_CONVERSATION) return false;
  if (toolNamesCalled.includes("offer_email_summary")) return false;
  return toolNamesCalled.includes("add_to_cart");
}
