// Widget-emitted KPI events the dashboard reads BY NAME (the storefront widget
// sends them through POST /api/kpi, which accepts any name), the ones the
// widget no longer sends, and the arithmetic of the sign-in popup funnel.
// Shapes in docs/frontend/API_CONTRACT.md §5. Server-emitted names live in
// kpi-events.ts.

// ---------------------------------------------------------------------------
// Sign-in popup for anonymous visitors (widget 2026-10-01)
// ---------------------------------------------------------------------------
//
// After an anonymous visitor's first answered message (once per browser
// session, never in voice mode) the widget asks them to sign in. All four
// carry `data: {}` — except that since the widget of 2026-10-08
// login_gate_shown carries `{teaser: true, variant?}` when the served sign-in
// copy's reward teaser rendered on it (OPTIN_REWARD §2.4).

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
// Server-only events (docs/frontend/API_CONTRACT.md §5) — POST /api/kpi drops them
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
  "account_shop_recognised",
  "page_context_applied",
  "page_context_answered",
  "consent_ask_eligible",
  "consent_copy_served",
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
 * succeeded at Shopify), dismissed_while_waiting (row 1), start_lost (row 2),
 * returned_error (row 9), shop_recognised / shop_renewed (row 10: an App Proxy
 * link without a sign-in round trip), shop_not_redeemed (row 11, checked last).
 *
 * @param {{ gateClicked?: boolean, dismissedAfterClick?: boolean, started?: boolean,
 *           succeeded?: boolean, returnOk?: boolean, returnLinkFailed?: boolean,
 *           returnOther?: boolean, linked?: boolean, linkedViaShop?: boolean,
 *           linkedViaShopNew?: boolean, shopCodeIssued?: boolean,
 *           refusedInvalid?: boolean, refusedMismatch?: boolean }} f
 * `linkedViaShopNew` false = every App Proxy link was a renewal of an existing
 * sign-in (undefined keeps the pre-P0.3 reading); `shopCodeIssued` = whoami
 * issued a code (a sign-in attempt even without any other event).
 */
export function classifySigninSession(f) {
  if (f.linked) {
    if (f.returnOk) return "complete";
    // Only the App Proxy (whoami) link — no sign-in round trip at all.
    if (f.linkedViaShop && !f.succeeded && !f.started) {
      return f.linkedViaShopNew === false ? "shop_renewed" : "shop_recognised";
    }
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
  if (f.shopCodeIssued) return "shop_not_redeemed";
  return "none";
}

/** Display order and German labels + the likely cause (05 §12.1). */
export const SIGNIN_DIAGNOSIS = Object.freeze([
  { key: "complete", label: "Im Chat angemeldet", cause: "Code eingelöst, Rückkehr gemeldet.", ok: true },
  { key: "shop_recognised", label: "Vom Shop erkannt", cause: "Im Shop angemeldet, über die App Proxy (whoami) ohne Klick im Chat angemeldet — neue Anmeldung dieser Sitzung.", ok: true },
  { key: "shop_renewed", label: "Bereits angemeldet, vom Shop bestätigt", cause: "Die Sitzung war schon angemeldet; whoami hat sie in einem neuen Tab erneut bestätigt — keine neue Anmeldung.", ok: true },
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
  { key: "shop_not_redeemed", label: "Shop-Code nicht eingelöst", cause: "whoami hat einen Code ausgegeben, das Widget hat ihn nicht eingelöst — altes Widget ohne Code-Einlösung (Drift), Sitzungswechsel während der Anfrage oder Störung beim Einlösen.", ok: false },
]);

// ---------------------------------------------------------------------------
// Consent popup by framing variant and placement (OI3)
// ---------------------------------------------------------------------------

/** Sessions per arm below which a variant row is not compared. */
export const MIN_VARIANT_SESSIONS = 100;

/**
 * Merge raw per-(variant, placement) rows into display keys: unknown or forged
 * values become „unbekannt“, missing ones „ohne“ — arbitrary strings posted to
 * /api/kpi never get their own admin row.
 * @param {Array<Record<string, unknown>>} rows
 * @param {(id: string) => boolean} isKnownVariant
 * @param {(p: string) => string | null} normalizePlacementFn
 */
export function normalizeConsentVariantRows(rows, isKnownVariant, normalizePlacementFn) {
  /** @type {Map<string, Record<string, number | string>>} */
  const merged = new Map();
  const fields = ["shown", "accepted", "declined", "dismissed", "acceptedWithoutShown", "rewardShown", "rewardAccepted", "optedIn", "alreadyConfirmed", "doiRequired", "doiConfirmed", "variantMismatch"];
  for (const r of rows ?? []) {
    const rawV = String(r.variant ?? "");
    const rawP = String(r.placement ?? "");
    const variant = rawV === "" ? "ohne (älteres Widget)" : isKnownVariant(rawV) ? rawV : "unbekannt";
    const placement = rawP === "" ? "ohne" : normalizePlacementFn(rawP) ?? "unbekannt";
    const key = `${variant}|${placement}`;
    const cur = merged.get(key) ?? { variant, placement, ...Object.fromEntries(fields.map((f) => [f, 0])) };
    for (const f of fields) cur[f] = Number(cur[f]) + (Number(r[f]) || 0);
    merged.set(key, cur);
  }
  return [...merged.values()];
}

/**
 * Shown sessions of a variant row whose ask carried NO reward hint although the
 * variant defines one (served text invalid, English, or the switch off) — 0 for
 * a variant without a reward. `rewardShown` = shown sessions whose
 * consent_gate_shown carried `reward: true` (OPTIN_REWARD §2.4).
 * @param {{ shown?: unknown, rewardShown?: unknown }} row
 * @param {boolean} variantHasReward
 */
export function rewardRenderGap(row, variantHasReward) {
  if (!variantHasReward) return 0;
  const n = (v) => Math.max(0, Math.floor(Number(v) || 0));
  return Math.max(0, n(row?.shown) - n(row?.rewardShown));
}

/**
 * Rates of one variant row: accept rate on shown sessions; DOI rate on opt-ins
 * that needed a DOI (already-confirmed answers are left out).
 * @param {{ shown: number, accepted: number, doiRequired: number, doiConfirmed: number }} row
 */
export function consentVariantRates(row) {
  return {
    acceptRate: rate(row.accepted, row.shown),
    doiRate: rate(row.doiConfirmed, row.doiRequired),
    comparable: Number(row.shown) >= MIN_VARIANT_SESSIONS,
  };
}

// ---------------------------------------------------------------------------
// Sign-in popup with and without the reward teaser (OPTIN_REWARD T6)
// ---------------------------------------------------------------------------

/** Display keys of the teaser split, in display order. */
export const LOGIN_TEASER_HINTS = Object.freeze(["mit Hinweis", "ohne Hinweis", "gemischt"]);

const LOGIN_TEASER_FIELDS = Object.freeze(["shown", "clicked", "declined", "dismissed", "signedIn", "linked", "optedIn", "confirmed"]);

/**
 * A stored variant id → its display key: none → „—“, forged or undefined →
 * „unbekannt“ (arbitrary strings posted to /api/kpi never get their own row).
 * @param {unknown} raw @param {(id: string) => boolean} isKnownVariant
 */
function displayVariant(raw, isKnownVariant) {
  const v = raw == null ? "" : String(raw);
  if (v === "") return "—";
  return /^[a-z0-9_-]{1,32}$/.test(v) && isKnownVariant(v) ? v : "unbekannt";
}

/** @param {Record<string, unknown>} r @returns {Record<string, number>} */
function teaserCounts(r) {
  return Object.fromEntries(LOGIN_TEASER_FIELDS.map((f) => [f, Math.max(0, Math.floor(Number(r?.[f]) || 0))]));
}

/**
 * Sign-in popup sessions by their FIRST popup: with the reward teaser („mit
 * Hinweis“), without („ohne Hinweis“ — variant a, English, a copy slower than
 * the widget's 1.2 s wait, invalid copy) or both across the session
 * („gemischt“), × the teaser's variant (only a teaser carries one: „—“ without).
 * Input rows are the store's per-(teaser, mixed, variant, servedVariant) session
 * counts; rows with the same display key merge. Rates via loginGateRates
 * (overallRate = im Chat angemeldet ÷ angezeigt).
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {(id: string) => boolean} isKnownVariant
 * @returns {Array<{ hint: string, variant: string, shown: number, clicked: number, declined: number,
 *   dismissed: number, signedIn: number, linked: number, optedIn: number, confirmed: number,
 *   rates: ReturnType<typeof loginGateRates> }>}
 */
export function normalizeLoginTeaserRows(rows, isKnownVariant) {
  /** @type {Map<string, Record<string, any>>} */
  const merged = new Map();
  for (const r of rows ?? []) {
    const c = teaserCounts(r);
    if (c.shown === 0) continue; // only sessions that saw the popup
    const hint = r.mixed === true ? "gemischt" : r.teaser === true ? "mit Hinweis" : "ohne Hinweis";
    const variant = hint === "ohne Hinweis" ? "—" : displayVariant(r.variant, isKnownVariant);
    const key = `${hint}|${variant}`;
    const cur = merged.get(key) ?? { hint, variant, ...Object.fromEntries(LOGIN_TEASER_FIELDS.map((f) => [f, 0])) };
    for (const f of LOGIN_TEASER_FIELDS) cur[f] += c[f];
    merged.set(key, cur);
  }
  return [...merged.values()]
    .sort((a, b) => LOGIN_TEASER_HINTS.indexOf(a.hint) - LOGIN_TEASER_HINTS.indexOf(b.hint) || String(a.variant).localeCompare(String(b.variant)))
    .map((r) => /** @type {any} */ ({ ...r, rates: loginGateRates(/** @type {any} */ (r)) }));
}

/**
 * The same sessions by the variant the server served them with the sign-in
 * copy (consent_copy_served — recorded only while several variants are
 * active); sessions without one are left out. `withTeaser` = of the shown
 * sessions, those whose first popup carried the teaser.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {(id: string) => boolean} isKnownVariant
 * @returns {Array<{ variant: string, withTeaser: number, shown: number, clicked: number, declined: number,
 *   dismissed: number, signedIn: number, linked: number, optedIn: number, confirmed: number,
 *   rates: ReturnType<typeof loginGateRates> }>}
 */
export function normalizeServedVariantRows(rows, isKnownVariant) {
  /** @type {Map<string, Record<string, any>>} */
  const merged = new Map();
  for (const r of rows ?? []) {
    if (r.servedVariant == null || r.servedVariant === "") continue;
    const c = teaserCounts(r);
    if (c.shown === 0) continue;
    const variant = displayVariant(r.servedVariant, isKnownVariant);
    const cur = merged.get(variant) ?? { variant, withTeaser: 0, ...Object.fromEntries(LOGIN_TEASER_FIELDS.map((f) => [f, 0])) };
    for (const f of LOGIN_TEASER_FIELDS) cur[f] += c[f];
    if (r.teaser === true) cur.withTeaser += c.shown;
    merged.set(variant, cur);
  }
  return [...merged.values()]
    .sort((a, b) => String(a.variant).localeCompare(String(b.variant)))
    .map((r) => /** @type {any} */ ({ ...r, rates: loginGateRates(/** @type {any} */ (r)) }));
}

// ---------------------------------------------------------------------------
// Shop-login recognition (App Proxy, P0.3)
// ---------------------------------------------------------------------------

/** Drift alarm: at least this many sessions with a shop code, and more than this share unredeemed. */
export const SHOP_REDEEM_ALARM = Object.freeze({ minSessions: 20, maxUnlinkedShare: 0.2 });

/**
 * Rates of the shop-login recognition (sessions). `alarm` when the widget
 * leaves too many issued codes unredeemed — typically an old widget build.
 * @param {{ recognised: number, withToken: number, withCode: number, redeemed: number }} c
 * @returns {{ redeemRate: number | null, tokenShare: number | null, unlinked: number,
 *   unlinkedShare: number | null, alarm: boolean }}
 */
export function shopRecognitionRates({ recognised, withToken, withCode, redeemed }) {
  const codes = Math.max(0, Number(withCode) || 0);
  const linked = Math.min(codes, Math.max(0, Number(redeemed) || 0));
  const unlinked = codes - linked;
  const unlinkedShare = rate(unlinked, codes);
  return {
    redeemRate: rate(linked, codes),
    tokenShare: rate(withToken, recognised),
    unlinked,
    unlinkedShare,
    alarm: codes >= SHOP_REDEEM_ALARM.minSessions && unlinkedShare != null && unlinkedShare > SHOP_REDEEM_ALARM.maxUnlinkedShare,
  };
}
