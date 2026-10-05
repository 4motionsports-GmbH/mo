// One vocabulary for the opt-in events (OI1): which Mo surface an opt-in came
// from (`source`) and what it led to (`outcome`) — written by the three opt-in
// routes, read by the dashboard and the verify script. Pure, tested.

export const OPT_IN_SOURCES = Object.freeze(["mo_capture_form", "mo_signin", "mo_chat_gate"]);
export const OPT_IN_OUTCOMES = Object.freeze(["doi_required", "already_confirmed", "already_subscribed", "suppressed"]);
/** The offer_email_summary trigger enum — keep in sync with src/lib/tools.ts (inputSchema.trigger). */
export const TOOL_OFFER_TRIGGERS = Object.freeze([
  "recommendation_accepted",
  "comparison_delivered",
  "consideration_pause",
  "buying_intent",
  "checkout_intent",
]);
/** Read side: the tool enum + api/chat's fallback. */
export const OFFER_TRIGGERS = Object.freeze([...TOOL_OFFER_TRIGGERS, "unspecified"]);
/** Server-set or server-defaulted legacy markers, consulted only when `source` is missing. */
export const LEGACY_SOURCE_TRIGGERS = Object.freeze(["signin_optin", "chat_gate"]);

/** Write side (/api/capture-email): keep a client echo only when it is a tool enum value. @param {unknown} raw */
export function storedOfferTrigger(raw) {
  return typeof raw === "string" && TOOL_OFFER_TRIGGERS.includes(raw) ? raw : null;
}

/** Read side: a stored trigger → bounded key ('' → none, unknown text → other). @param {unknown} raw */
export function normaliseTrigger(raw) {
  if (typeof raw !== "string" || raw === "") return "none";
  return OFFER_TRIGGERS.includes(raw) ? raw : "other";
}

/**
 * Write side: the outcome of a ticked marketing box, from the upsert result.
 * null when not ticked.
 * @param {{ marketingConsent: boolean, suppressed: boolean, doiEmailRequired: boolean,
 *   marketingDoiStatus: string, subscribedElsewhere: boolean }} r
 */
export function optInOutcome({ marketingConsent, suppressed, doiEmailRequired, marketingDoiStatus, subscribedElsewhere }) {
  if (!marketingConsent) return null;
  if (suppressed) return "suppressed";
  if (doiEmailRequired) return "doi_required";
  if (marketingDoiStatus === "confirmed") return "already_confirmed";
  if (subscribedElsewhere) return "already_subscribed";
  return null;
}

/**
 * The routes' `alreadyConfirmed: true` answer from an outcome. A suppressed
 * address is never answered „already subscribed“ (F2): it gets the neutral
 * answer, whatever its old DOI status.
 * @param {unknown} outcome
 */
export function isAlreadyConfirmedAnswer(outcome) {
  return outcome === "already_confirmed" || outcome === "already_subscribed";
}

/** Read side: stored opted_in → outcome; legacy rows (no outcome) approximated by doiStatus. */
export function eventOutcome(outcome, doiStatus) {
  if (OPT_IN_OUTCOMES.includes(outcome)) return outcome;
  if (doiStatus === "pending") return "doi_required";
  if (doiStatus === "confirmed") return "already_confirmed";
  return "unknown";
}

/**
 * Read side: stored submitted / opted_in → source. `source` (server-set) wins;
 * legacy rows by the server-set or server-defaulted trigger.
 */
export function eventSource(source, trigger) {
  if (typeof source === "string" && source !== "") return OPT_IN_SOURCES.includes(source) ? source : "mo_capture_form";
  if (trigger === "signin_optin") return "mo_signin";
  if (trigger === "chat_gate") return "mo_chat_gate";
  return "mo_capture_form";
}

/** Write side (DOI confirmation): the session's DOI opt-in, else the latest pending consent row, else 'mo'. */
export function confirmationSource({ sessionSource, pendingSource }) {
  if (OPT_IN_SOURCES.includes(sessionSource)) return sessionSource;
  if (OPT_IN_SOURCES.includes(pendingSource)) return pendingSource;
  return "mo";
}
