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

// ---------------------------------------------------------------------------
// Server-only events (API_CONTRACT §5) — POST /api/kpi drops them
// ---------------------------------------------------------------------------

/**
 * Written only by backend routes. A copy arriving through POST /api/kpi (a
 * misbehaving widget, or anyone on an allow-listed origin) would double-count
 * or forge a funnel stage, so the ingestion route acknowledges it (202) but
 * never stores it.
 */
export const SERVER_ONLY_EVENTS = Object.freeze([
  "email_capture_ask_shown",
  "email_capture_submitted",
  "email_capture_marketing_opted_in",
  "email_capture_marketing_confirmed",
  "marketing_email_clicked",
  "campaign_email_clicked",
  "bundle_offer_clicked",
  "campaign_chat_started",
  "contact_form_submitted",
  "account_signin_succeeded",
  "account_signin_linked",
  "account_signin_link_refused",
  "account_export_requested",
  "account_erased",
  "order_status_lookup",
  "mo_order_marker_unresolved",
]);

const SERVER_ONLY = new Set(SERVER_ONLY_EVENTS);

/** @param {unknown} event */
export function isServerOnlyEvent(event) {
  return typeof event === "string" && SERVER_ONLY.has(event.trim());
}

// ---------------------------------------------------------------------------
// Sign-in diagnosis (docs/frontend/05-engagement-and-kpi.md §12.1)
// ---------------------------------------------------------------------------

/**
 * Where one session's sign-in ended, from its events. First match wins.
 * Rows of 05 §12.1: complete (linked), complete_retry (row 7: linked without
 * return ok — the silent retry), refused_* (row 6), link_failed_local (row 5:
 * the widget never called /api/auth/link — or the redeem hit a 503, which
 * /api/auth/link does not record), stale_widget (row 4a: return ok but
 * no redeem — an old widget), no_return (row 4b: the widget did not mount on
 * the return page or lost the code), abandoned (row 3: started, never
 * succeeded at Shopify), dismissed_while_waiting (row 1), start_lost (row 2).
 *
 * @param {{ gateClicked?: boolean, dismissedAfterClick?: boolean, started?: boolean,
 *           succeeded?: boolean, returnOk?: boolean, returnLinkFailed?: boolean,
 *           returnOther?: boolean, linked?: boolean, linkedViaShop?: boolean,
 *           refusedInvalid?: boolean, refusedMismatch?: boolean }} f
 */
export function classifySigninSession(f) {
  if (f.linked) {
    if (f.returnOk) return "complete";
    // Only the App Proxy (whoami) link — no sign-in round trip at all.
    if (f.linkedViaShop && !f.succeeded && !f.started) return "shop_recognised";
    return "complete_retry";
  }
  if (f.refusedMismatch) return "refused_mismatch";
  if (f.refusedInvalid) return "refused_invalid";
  if (f.returnLinkFailed) return "link_failed_local";
  if (f.succeeded && f.returnOk) return "stale_widget";
  if (f.succeeded && !f.returnOk && !f.returnOther) return "no_return";
  if (f.succeeded) return "returned_error";
  if (f.started) return f.returnOther ? "returned_error" : "abandoned";
  if (f.gateClicked) return f.dismissedAfterClick ? "dismissed_while_waiting" : "start_lost";
  return "none";
}

/** Display order and German labels + the likely cause (05 §12.1). */
export const SIGNIN_DIAGNOSIS = Object.freeze([
  { key: "complete", label: "Im Chat angemeldet", cause: "Code eingelöst, Rückkehr gemeldet.", ok: true },
  { key: "shop_recognised", label: "Vom Shop erkannt", cause: "Im Shop angemeldet, über die App Proxy (whoami) ohne Klick im Chat angemeldet.", ok: true },
  { key: "complete_retry", label: "Angemeldet (zweiter Versuch)", cause: "Erster Einlöseversuch scheiterte (503/Netz), der stille zweite Versuch gelang.", ok: true },
  { key: "refused_mismatch", label: "Code für andere Sitzung", cause: "Die Anmeldung endete in einer anderen Sitzung (anderes Gerät oder Tab) — oder ein fremder Link.", ok: false },
  { key: "refused_invalid", label: "Code abgelaufen oder benutzt", cause: "Code älter als 10 Minuten, schon benutzt oder unbekannt.", ok: false },
  { key: "link_failed_local", label: "Widget hat nicht eingelöst", cause: "Sitzungs-ID im Tab geändert, Code fehlte, localStorage nicht verfügbar — oder der Server war beim Einlösen gestört (503, wird nicht als Ablehnung gezählt).", ok: false },
  { key: "stale_widget", label: "Altes Widget", cause: "Rückkehr „ok“ ohne Einlösen — ein Widget vor dem 04.10.2026 (zwischengespeichert oder zurückgesetzt).", ok: false },
  { key: "no_return", label: "Keine Rückkehr gemeldet", cause: "Das Widget lief auf der Rückkehrseite nicht (ausgeschlossene Vorlage, Skriptfehler) oder der Code war älter als 10 Minuten.", ok: false },
  { key: "returned_error", label: "Rückkehr mit Fehler", cause: "Shopify meldete einen Fehler oder „login_required“.", ok: false },
  { key: "abandoned", label: "Bei Shopify abgebrochen", cause: "Anmeldung bei Shopify nicht abgeschlossen — oder die Rücksprungadresse wurde abgelehnt.", ok: false },
  { key: "dismissed_while_waiting", label: "Beim Warten geschlossen", cause: "„Anmelden“ geklickt, das Popup aber geschlossen, bevor die Antwort fertig war.", ok: false },
  { key: "start_lost", label: "Start nicht angekommen", cause: "Das Start-Event ging bei der Weiterleitung verloren oder die Weiterleitung schlug fehl.", ok: false },
]);
