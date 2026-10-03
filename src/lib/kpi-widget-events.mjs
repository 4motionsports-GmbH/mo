// Widget-emitted KPI events the dashboard reads BY NAME (the storefront widget
// sends them through POST /api/kpi, which accepts any name), the ones the
// widget no longer sends, and the arithmetic of the sign-in popup funnel.
// Shapes in docs/API_CONTRACT.md §5. Server-emitted names live in
// kpi-events.ts.

// ---------------------------------------------------------------------------
// Sign-in popup for anonymous visitors (widget 2026-10-01)
// ---------------------------------------------------------------------------
//
// After an anonymous visitor's first answered message (once per browser
// session, never in voice mode) the widget asks them to sign in. All four
// carry `data: {}`.

/** The sign-in popup was shown. */
export const LOGIN_GATE_SHOWN = "login_gate_shown";
/** „Anmelden“ in the popup (the redirect follows once the reply has streamed). */
export const LOGIN_GATE_SIGNIN_CLICKED = "login_gate_signin_clicked";
/** „Später“ — the popup is snoozed for 24 h on that device. */
export const LOGIN_GATE_DECLINED = "login_gate_declined";
/** Closed with Esc or a backdrop click (no snooze). */
export const LOGIN_GATE_DISMISSED = "login_gate_dismissed";

/** Any sign-in start; `data.source` = "login_gate" from the popup, absent from the welcome card / header. */
export const ACCOUNT_SIGNIN_STARTED = "account_signin_started";
/** The widget saw the return from the sign-in; `data.result` = "ok" | … (widget truth). */
export const ACCOUNT_SIGNIN_RETURN = "account_signin_return";

/** Where a sign-in started: the popup or anywhere else (welcome card, header button). */
export const SIGNIN_SOURCES = /** @type {const} */ (["login_gate", "other"]);

/**
 * @param {unknown} source `data.source` of account_signin_started
 * @returns {typeof SIGNIN_SOURCES[number]}
 */
export function signinSource(source) {
  return source === "login_gate" ? "login_gate" : "other";
}

// ---------------------------------------------------------------------------
// Events the widget no longer sends
// ---------------------------------------------------------------------------

/** Retired widget events — shown as „eingestellt“, never treated as a drop. */
export const DISCONTINUED_WIDGET_EVENTS = Object.freeze({
  starter_shown: Object.freeze({ since: "2026-10-01", note: "Startfragen aus dem Widget entfernt" }),
  starter_clicked: Object.freeze({ since: "2026-10-01", note: "Startfragen aus dem Widget entfernt" }),
});

/**
 * @param {string} event
 * @returns {{ since: string, note: string } | null}
 */
export function discontinuedWidgetEvent(event) {
  return Object.prototype.hasOwnProperty.call(DISCONTINUED_WIDGET_EVENTS, event)
    ? /** @type {Record<string, { since: string, note: string }>} */ (DISCONTINUED_WIDGET_EVENTS)[event]
    : null;
}

/**
 * The consent gate's surfaces. `chat` (the anonymous e-mail gate) is no longer
 * shown by the widget since 2026-10-01 — the sign-in popup replaced it; old
 * events stay countable.
 */
export const CONSENT_GATE_SURFACES = /** @type {const} */ (["signin", "chat"]);
export const RETIRED_CONSENT_GATE_SURFACES = Object.freeze({ chat: "2026-10-01" });

// ---------------------------------------------------------------------------
// Sign-in popup funnel (per session)
// ---------------------------------------------------------------------------

/** @param {number} part @param {number} whole */
function rate(part, whole) {
  return whole > 0 ? Math.min(1, Math.max(0, part / whole)) : null;
}

/**
 * Rates of the sign-in popup funnel. All counts are SESSIONS: shown = sessions
 * that saw the popup; clicked/declined/dismissed = of those; signedIn = clicked
 * AND a successful Shopify sign-in (server, account_signin_succeeded) in the
 * same session afterwards; linked = clicked AND the chat redeemed the one-time
 * code (server, account_signin_linked) — the sign-in that actually counts.
 *
 * @param {{ shown: number, clicked: number, declined: number, dismissed: number,
 *           signedIn: number, linked: number }} c
 */
export function loginGateRates(c) {
  const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const shown = n(c.shown);
  const clicked = n(c.clicked);
  const signedIn = n(c.signedIn);
  const linked = n(c.linked);
  return {
    clickRate: rate(clicked, shown),
    declineRate: rate(n(c.declined), shown),
    dismissRate: rate(n(c.dismissed), shown),
    /** Of the clicks, how many finished at Shopify. */
    signInRate: rate(signedIn, clicked),
    /** Of the Shopify sign-ins, how many the chat completed (one-time code redeemed). */
    linkRate: rate(linked, signedIn),
    /** Popup shown → signed in in the chat. */
    overallRate: rate(linked, shown),
    /** Shopify sign-ins the chat never completed — the widget is not redeeming the code. */
    unlinked: Math.max(0, signedIn - linked),
  };
}
