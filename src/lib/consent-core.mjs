// THE merge rule for the one e-mail-marketing consent (pure, no I/O).
//
// Mo and Shopify share one consent per person (docs/archive/CUSTOMER_PLATFORM_PLAN.md
// §7). Changes arrive from both sides — Mo's surfaces (DOI confirm, unsubscribe
// link, admin opt-out) and Shopify's (checkout checkbox, account, Shopify Email
// footer, admin edits, delivered by webhook or the nightly reconciliation). Every
// one of them goes through resolveEmailConsent, which decides the next state and
// DECLARES the side effects; lib/consent-store.ts executes them. Nothing else in
// the code base decides consent.
//
// Rules:
//   1. Hard blocks win. A spam complaint refuses any automatic re-subscribe. An
//      erasure refuses every subscribe that is not a NEW act (newer than the
//      erasure) — a person who deleted their data and later signs up again has
//      given a new consent, which lifts the erasure block.
//   2. The newer act wins. On equal timestamps the more restrictive state wins.
//      An act without a timestamp (Shopify reports none for never-subscribed
//      customers) can never override a timestamped state.
//   3. No silent downgrade: a pending DOI never overrides "subscribed".
//   4. Echo is a no-op: an incoming state equal to the current one only marks
//      the mirror as in sync with Shopify.
//   5. The level follows the act (our DOI → confirmed_opt_in).
//   6. Side effects are declared: an unsubscribe adds the block-list row, a
//      newer real subscribe lifts an unsubscribe/manual row, a Mo-side change is
//      pushed to Shopify, and a Shopify value that LOSES against a newer Mo
//      subscribe or unsubscribe is answered by pushing Mo's state back (drift
//      heals itself). Healing never pushes pending or not_subscribed.

/** @typedef {"subscribed" | "pending" | "unsubscribed" | "not_subscribed"} ConsentState */
/** @typedef {"confirmed_opt_in" | "single_opt_in" | "unknown"} ConsentLevel */
/** @typedef {"mo_capture_form" | "mo_chat_gate" | "mo_signin" | "mo" | "shopify" | "admin" | "import"} ConsentSource */
/** @typedef {"unsubscribe" | "manual" | "bounce" | "complaint" | "erasure"} SuppressionReason */

export const CONSENT_STATES = /** @type {const} */ (["subscribed", "pending", "unsubscribed", "not_subscribed"]);
export const CONSENT_LEVELS = /** @type {const} */ (["confirmed_opt_in", "single_opt_in", "unknown"]);

/** Restrictiveness for the equal-timestamp tie-break (higher = more restrictive). */
const RESTRICTIVENESS = { subscribed: 0, pending: 1, not_subscribed: 2, unsubscribed: 3 };

/**
 * @typedef {Object} CurrentConsent
 * @property {ConsentState} state
 * @property {ConsentLevel | null} level
 * @property {string | null} at
 * @property {ConsentSource | string | null} source
 * @property {SuppressionReason | string | null} [suppression]    the block-list reason, if any
 * @property {string | null} [suppressionAt]
 *
 * @typedef {Object} IncomingConsent
 * @property {ConsentState | "invalid"} state
 * @property {ConsentLevel | null} [level]
 * @property {string | null} at               when the act happened (ISO)
 * @property {ConsentSource} source
 * @property {"unsubscribe" | "manual" | "complaint"} [reason]   for withdrawals: the block-list reason
 *
 * @typedef {Object} ConsentDecision
 * @property {{ state: ConsentState, level: ConsentLevel | null, at: string | null, source: string | null }} next
 * @property {boolean} changed       the stored state changes (→ write + history event)
 * @property {string} outcome        applied | echo | stale | blocked | ignored
 * @property {string | null} note    German note for the history (blocked / ignored cases)
 * @property {{
 *   suppress: SuppressionReason | null,
 *   liftSuppression: boolean,
 *   liftErasure: boolean,
 *   pushToShopify: boolean,
 *   markSynced: boolean,
 * }} effects
 */

function time(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

function noEffects() {
  return { suppress: null, liftSuppression: false, liftErasure: false, pushToShopify: false, markSynced: false };
}

function sameConsent(a, b) {
  if (a.state !== b.state) return false;
  if (a.state !== "subscribed") return true;
  return (a.level ?? "unknown") === (b.level ?? "unknown");
}

const isMoSource = (s) => typeof s === "string" && (s === "mo" || s.startsWith("mo_") || s === "admin");

/**
 * Decide what one incoming consent act does to the current state.
 *
 * @param {CurrentConsent} current
 * @param {IncomingConsent} incoming
 * @returns {ConsentDecision}
 */
export function resolveEmailConsent(current, incoming) {
  const cur = {
    state: CONSENT_STATES.includes(current?.state) ? current.state : "not_subscribed",
    level: current?.level ?? null,
    at: current?.at ?? null,
    source: current?.source ?? null,
  };
  const keep = (outcome, note = null, effects = noEffects()) => ({
    next: cur,
    changed: false,
    outcome,
    note,
    effects,
  });

  // "invalid" (Shopify: undeliverable address) — not consent, a block.
  if (incoming?.state === "invalid") {
    return keep("blocked", "Adresse laut Shopify ungültig", { ...noEffects(), suppress: "bounce" });
  }
  if (!incoming || !CONSENT_STATES.includes(incoming.state)) {
    return keep("ignored", "Unbekannter Einwilligungsstatus");
  }

  const inc = {
    state: incoming.state,
    level: incoming.state === "subscribed" ? incoming.level ?? "unknown" : null,
    at: incoming.at ?? null,
    source: incoming.source,
  };
  const fromShopify = inc.source === "shopify";
  const suppression = current?.suppression ?? null;
  const tInc = time(inc.at);
  const tCur = time(cur.at);

  // (4) Echo.
  if (sameConsent(cur, inc)) {
    return keep("echo", null, { ...noEffects(), markSynced: fromShopify });
  }

  // (1) Hard blocks.
  if (inc.state === "subscribed" || inc.state === "pending") {
    if (suppression === "complaint") {
      return keep("blocked", "Spam-Beschwerde — keine automatische Wiederanmeldung");
    }
    if (suppression === "erasure") {
      const tErased = time(current?.suppressionAt ?? null);
      const isNewAct = tInc !== null && tErased !== null && tInc > tErased;
      if (!isNewAct) return keep("blocked", "Gelöschte Person — nur eine neue Anmeldung zählt");
    }
  }

  // (3) A pending DOI never overrides a live subscription.
  if (inc.state === "pending" && cur.state === "subscribed") {
    return keep("ignored", "Bereits angemeldet — keine erneute Bestätigung nötig");
  }

  // (2) Newer act wins.
  let wins;
  if (tInc === null) {
    // An undated act may only fill a gap, never override a dated state.
    wins = tCur === null && cur.state === "not_subscribed";
  } else if (tCur === null) {
    wins = true;
  } else if (tInc > tCur) {
    wins = true;
  } else if (tInc < tCur) {
    wins = false;
  } else {
    wins = RESTRICTIVENESS[inc.state] > RESTRICTIVENESS[cur.state];
  }

  if (!wins) {
    // A Shopify value that loses against a newer Mo state: Shopify drifted
    // (e.g. our write is still in the outbox) — push Mo's state back. Only a
    // state Mo itself pushes heals: subscribed (DOI confirm) or unsubscribed
    // (opt-out). Pending is local, and not_subscribed is never an act of Mo's —
    // only the DOI expiry sets it, also for a Shopify-sourced pending — so
    // pushing it would overwrite the shop's own pending or consent (C.29).
    const heal =
      fromShopify && isMoSource(cur.source) && (cur.state === "subscribed" || cur.state === "unsubscribed");
    return keep("stale", null, { ...noEffects(), pushToShopify: heal });
  }

  const effects = noEffects();
  if (inc.state === "unsubscribed") {
    effects.suppress = incoming.reason ?? (inc.source === "admin" ? "manual" : "unsubscribe");
  }
  if (inc.state === "subscribed") {
    // A real, newer subscribe lifts an opt-out row; bounce stays (deliverability).
    effects.liftSuppression = suppression === "unsubscribe" || suppression === "manual";
    effects.liftErasure = suppression === "erasure";
  }
  // Pending is local (our DOI mail is out); everything else Mo decides goes to Shopify.
  effects.pushToShopify = !fromShopify && inc.state !== "pending";
  effects.markSynced = fromShopify;

  return {
    next: { state: inc.state, level: inc.level, at: inc.at ?? new Date().toISOString(), source: inc.source },
    changed: true,
    outcome: "applied",
    note: null,
    effects,
  };
}

/** The compatibility mirror customers.marketing_status (until the legacy drop). */
export function legacyMarketingStatus(state) {
  switch (state) {
    case "subscribed":
      return "confirmed";
    case "pending":
      return "pending";
    case "unsubscribed":
      return "unsubscribed";
    default:
      return "none";
  }
}

/** German label for the admin (badge + history). */
export function consentLabel(state, level) {
  switch (state) {
    case "subscribed":
      return level === "confirmed_opt_in" ? "Angemeldet (DOI)" : "Angemeldet (ohne DOI-Nachweis)";
    case "pending":
      return "Bestätigung ausstehend";
    case "unsubscribed":
      return "Abgemeldet";
    default:
      return "Keine Einwilligung";
  }
}

/** German label for where an act happened. */
export function consentSourceLabel(source) {
  switch (source) {
    case "mo_capture_form":
      return "Mo · Zusammenfassungs-Formular";
    case "mo_chat_gate":
      return "Mo · Chat";
    case "mo_signin":
      return "Mo · nach Anmeldung";
    case "mo":
      return "Mo";
    case "shopify":
      return "Shopify";
    case "admin":
      return "Team (Admin)";
    case "import":
      return "Übernahme";
    default:
      return source ? String(source) : "—";
  }
}

/** Block-list reasons that are hard blocks (not consent). */
export function isHardBlock(reason) {
  return reason === "bounce" || reason === "complaint" || reason === "erasure";
}
