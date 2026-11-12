// Rundmail analysis („Versand“ tab of a Rundmail, docs/CAMPAIGNS.md §9.6) —
// the pure rules: which order counts for which Rundmail (attribution), the
// recipient filters and sorts, the URL state, the status chip, the timeline
// of one recipient, the time series and the CSV export. No I/O (plain .mjs,
// tested in rundmail-analytics.test.mjs); the queries are
// rundmail-analytics-store.ts, which spells the SAME attribution rule out in
// SQL (set-based, for 10,000+ recipients) — change both together.
//
// ── The attribution rule ─────────────────────────────────────────────────────
// An order of a customer counts for the Rundmail send S to that customer when
//   1. it is not cancelled (customer_orders.cancelled_at IS NULL);
//   2. it was placed after S (processed_at > S.sent_at) and within the chosen
//      window (processed_at ≤ S.sent_at + window; „bis heute“ = no limit);
//   3. S is the LAST Rundmail touch before it: no other Rundmail send to the
//      same customer lies between S and the order (later sent_at, or the same
//      sent_at and a higher send id). An order inside the windows of two
//      Rundmails therefore counts once, for the later one. The later send's
//      window always contains the order when the earlier one's does (same
//      window length), so the rule needs no second window check.
// Revenue of an order = total_cents − refunded_cents (never below 0).
// Flags (counted, never a condition): „mit Code“ — one of the Rundmail's
// coupon codes is among the order's discount codes (case-insensitive) — the
// hardest evidence; „nach Klick“ — the recipient clicked this Rundmail
// (first click, campaign_sends.clicked_at) before the order.
// Personal campaign mails (Aktion, Lebenszyklus, Einzelansprache) are no
// competing touch here: they are attributed through their own MK- codes on
// the KPI screen. Opens are not measured (no tracking pixel, on purpose).

import { formatAdmin, ADMIN_DATE_TIME_SHORT, ADMIN_DAY_MONTH, ADMIN_TIME, ADMIN_TIME_ZONE } from "./admin-datetime.mjs";
import { walkMailBlocks } from "./mail-template-doc.mjs";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

// ── windows ──────────────────────────────────────────────────────────────────

/** The attribution windows the operator can choose (`?window=`). */
export const RUNDMAIL_WINDOWS = Object.freeze([
  { key: "1", days: 1, label: "1 Tag" },
  { key: "3", days: 3, label: "3 Tage" },
  { key: "7", days: 7, label: "7 Tage" },
  { key: "14", days: 14, label: "14 Tage" },
  { key: "heute", days: null, label: "bis heute" },
]);
/** @typedef {"1" | "3" | "7" | "14" | "heute"} RundmailWindowKey */
export const DEFAULT_RUNDMAIL_WINDOW = "7";

/**
 * @param {unknown} value
 * @returns {RundmailWindowKey}
 */
export function parseRundmailWindow(value) {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && RUNDMAIL_WINDOWS.some((w) => w.key === v)
    ? /** @type {RundmailWindowKey} */ (v)
    : DEFAULT_RUNDMAIL_WINDOW;
}

/**
 * The window in days, or null for „bis heute“.
 * @param {unknown} key
 * @returns {number | null}
 */
export function rundmailWindowDays(key) {
  return RUNDMAIL_WINDOWS.find((w) => w.key === parseRundmailWindow(key))?.days ?? null;
}

/**
 * The window in whole hours for the SQL (`sent_at + hours * interval '1 hour'`
 * — exact 24-hour days, independent of the session time zone), or null.
 * @param {unknown} key
 * @returns {number | null}
 */
export function rundmailWindowHours(key) {
  const days = rundmailWindowDays(key);
  return days == null ? null : days * 24;
}

/** @param {unknown} key */
export function rundmailWindowLabel(key) {
  return RUNDMAIL_WINDOWS.find((w) => w.key === parseRundmailWindow(key))?.label ?? "7 Tage";
}

// ── the rule ─────────────────────────────────────────────────────────────────

/** @param {unknown} v */
function ms(v) {
  if (v == null || v === "") return NaN;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : NaN;
}

/**
 * The last Rundmail touch before an order: the latest of `sends` sent before
 * `processedAt` (the same instant: the higher id), or null.
 * @template {{ id: number, sentAt: string | Date | null }} S
 * @param {string | Date | null} processedAt
 * @param {ReadonlyArray<S>} sends  every Rundmail send to the person
 * @returns {S | null}
 */
export function lastRundmailTouch(processedAt, sends) {
  const t = ms(processedAt);
  if (!Number.isFinite(t)) return null;
  /** @type {S | null} */
  let best = null;
  let bestAt = -Infinity;
  for (const s of sends) {
    const at = ms(s.sentAt);
    if (!Number.isFinite(at) || !(at < t)) continue;
    if (at > bestAt || (at === bestAt && best !== null && s.id > best.id)) {
      best = s;
      bestAt = at;
    }
  }
  return best;
}

/**
 * Was the order placed after the send and within the window?
 * @param {string | Date | null} processedAt
 * @param {string | Date | null} sentAt
 * @param {number | null} windowDays  null = „bis heute“
 */
export function inRundmailWindow(processedAt, sentAt, windowDays) {
  const t = ms(processedAt);
  const s = ms(sentAt);
  if (!Number.isFinite(t) || !Number.isFinite(s) || !(t > s)) return false;
  return windowDays == null || t <= s + windowDays * DAY_MS;
}

/** Revenue of an order in cents: total − refunded, never below 0. */
export function orderNetCents(/** @type {{ totalCents?: unknown, refundedCents?: unknown }} */ order) {
  const total = Number(order?.totalCents ?? 0);
  const refunded = Number(order?.refundedCents ?? 0);
  return Math.max(0, (Number.isFinite(total) ? total : 0) - (Number.isFinite(refunded) ? refunded : 0));
}

/** @param {unknown} code */
function normCode(code) {
  return String(code ?? "").trim().toUpperCase();
}

/**
 * Did the order use one of the Rundmail's codes (case-insensitive)?
 * @param {{ discountCodes?: ReadonlyArray<unknown> | null }} order
 * @param {ReadonlyArray<string>} codes  the Rundmail's codes
 */
export function orderUsedCode(order, codes) {
  if (!codes.length) return false;
  const set = new Set(codes.map(normCode).filter(Boolean));
  return (order?.discountCodes ?? []).some((c) => set.has(normCode(c)));
}

/**
 * Did the recipient click the Rundmail before the order?
 * @param {string | Date | null} processedAt
 * @param {string | Date | null} clickedAt  the send's FIRST click
 */
export function clickedBeforeOrder(processedAt, clickedAt) {
  const t = ms(processedAt);
  const c = ms(clickedAt);
  return Number.isFinite(t) && Number.isFinite(c) && c < t;
}

/**
 * @typedef {"zaehlt" | "storniert" | "davor" | "ausserhalb" | "spaetere_rundmail"} OrderVerdict
 */

/**
 * The rule for ONE order and ONE send (see the header): does it count, and if
 * not, why. `personSends` are all Rundmail sends to the same person (the send
 * itself may be among them).
 * @template {{ id: number, sentAt: string | Date | null }} S
 * @param {{ processedAt: string | Date | null, cancelledAt?: string | Date | null }} order
 * @param {S} send
 * @param {ReadonlyArray<S>} personSends
 * @param {number | null} windowDays
 * @returns {{ verdict: OrderVerdict, counts: boolean, touch: S | null }}
 */
export function attributeOrder(order, send, personSends, windowDays) {
  const touch = lastRundmailTouch(order.processedAt, [send, ...personSends.filter((s) => s.id !== send.id)]);
  if (order.cancelledAt) return { verdict: "storniert", counts: false, touch };
  const t = ms(order.processedAt);
  const s = ms(send.sentAt);
  if (!(t > s)) return { verdict: "davor", counts: false, touch };
  if (!inRundmailWindow(order.processedAt, send.sentAt, windowDays)) return { verdict: "ausserhalb", counts: false, touch };
  if (touch && touch.id !== send.id) return { verdict: "spaetere_rundmail", counts: false, touch };
  return { verdict: "zaehlt", counts: true, touch: send };
}

/** German note per verdict (the detail of one recipient). */
export const ORDER_VERDICT_LABELS = Object.freeze({
  zaehlt: "zählt für diese Rundmail",
  storniert: "storniert — zählt nicht",
  davor: "vor dem Versand",
  ausserhalb: "außerhalb des Zeitraums",
  spaetere_rundmail: "zählt für eine spätere Rundmail",
});

/**
 * The orders of ONE recipient with their verdicts and flags — the detail view
 * (the list and the figures run the same rule in SQL).
 * @template {{ id: number, sentAt: string | Date | null, clickedAt?: string | Date | null }} S
 * @template {{ processedAt: string | Date | null, cancelledAt?: string | Date | null, totalCents?: unknown, refundedCents?: unknown, discountCodes?: ReadonlyArray<unknown> | null }} O
 * @param {{ send: S, personSends: ReadonlyArray<S>, orders: ReadonlyArray<O>, windowDays: number | null, codes: ReadonlyArray<string> }} input
 * @returns {Array<O & { verdict: OrderVerdict, counts: boolean, touchId: number | null, netCents: number, withCode: boolean, afterClick: boolean }>}
 */
export function attributeRecipientOrders({ send, personSends, orders, windowDays, codes }) {
  return orders.map((o) => {
    const r = attributeOrder(o, send, personSends, windowDays);
    return {
      ...o,
      verdict: r.verdict,
      counts: r.counts,
      touchId: r.touch ? r.touch.id : null,
      netCents: orderNetCents(o),
      withCode: orderUsedCode(o, codes),
      afterClick: clickedBeforeOrder(o.processedAt, send.clickedAt ?? null),
    };
  });
}

/**
 * Totals of the counted orders (verdict „zaehlt“) — the same figures the SQL
 * summary returns.
 * @param {ReadonlyArray<{ counts: boolean, netCents: number, withCode: boolean, afterClick: boolean, customerId?: unknown }>} rows
 */
export function summarizeAttributed(rows) {
  const counted = rows.filter((r) => r.counts);
  const buyers = new Set(counted.map((r) => r.customerId));
  const codeBuyers = new Set(counted.filter((r) => r.withCode).map((r) => r.customerId));
  const sum = (/** @type {typeof counted} */ list) => list.reduce((n, r) => n + r.netCents, 0);
  return {
    orders: counted.length,
    buyers: buyers.size,
    revenueCents: sum(counted),
    codeOrders: counted.filter((r) => r.withCode).length,
    codeBuyers: codeBuyers.size,
    codeRevenueCents: sum(counted.filter((r) => r.withCode)),
    clickOrders: counted.filter((r) => r.afterClick).length,
    clickRevenueCents: sum(counted.filter((r) => r.afterClick)),
  };
}

// ── codes ────────────────────────────────────────────────────────────────────

/**
 * The Rundmail's coupon codes: every coupon block (inside sections too) and
 * every Shopify /discount/<code> link of the frozen link table. Upper case,
 * unique, in order.
 * @param {unknown} doc  the (normalised) document
 * @param {ReadonlyArray<{ url?: unknown }>} [links]  campaign_mailings.links
 * @returns {string[]}
 */
export function rundmailCouponCodes(doc, links = []) {
  /** @type {string[]} */
  const out = [];
  const add = (/** @type {unknown} */ c) => {
    const code = normCode(c);
    if (code && code.length <= 60 && !out.includes(code)) out.push(code);
  };
  for (const { block } of walkMailBlocks(/** @type {any} */ (doc))) {
    if (block?.type === "coupon") add(/** @type {{ code?: unknown }} */ (block).code);
  }
  for (const l of links) {
    const m = /\/discount\/([^/?#]+)/i.exec(String(l?.url ?? ""));
    if (!m) continue;
    try {
      add(decodeURIComponent(m[1]));
    } catch {
      add(m[1]);
    }
  }
  return out;
}

// ── figures ──────────────────────────────────────────────────────────────────

/**
 * The rates of the figures (ratios 0–1; null without a sent mail).
 * @param {{ sent: number, clicked: number, bounced: number, complained: number, unsubscribed: number, buyers: number, revenueCents: number }} f
 */
export function rundmailRates(f) {
  const sent = Number(f.sent) || 0;
  const of = (/** @type {number} */ n) => (sent > 0 ? (Number(n) || 0) / sent : null);
  return {
    clickRate: of(f.clicked),
    bounceRate: of(f.bounced),
    complaintRate: of(f.complained),
    unsubscribeRate: of(f.unsubscribed),
    conversion: of(f.buyers),
    revenuePerRecipientCents: sent > 0 ? Math.round((Number(f.revenueCents) || 0) / sent) : null,
  };
}

// ── recipient list: filters, sorts, URL state ────────────────────────────────

/** Filters of the recipient list (`?rfilter=`). */
export const RECIPIENT_FILTERS = Object.freeze([
  { key: "all", label: "Alle" },
  { key: "sent", label: "Gesendet" },
  { key: "delivered", label: "Zugestellt" },
  { key: "clicked", label: "Geklickt" },
  { key: "ordered", label: "Bestellt" },
  { key: "bounced", label: "Bounce" },
  { key: "complained", label: "Beschwerde" },
  { key: "unsubscribed", label: "Abgemeldet" },
  { key: "not_sent", label: "Nicht gesendet" },
]);
/** @typedef {"all" | "sent" | "delivered" | "clicked" | "ordered" | "bounced" | "complained" | "unsubscribed" | "not_sent"} RecipientFilter */

/**
 * @param {unknown} value
 * @returns {RecipientFilter}
 */
export function parseRecipientFilter(value) {
  return typeof value === "string" && RECIPIENT_FILTERS.some((f) => f.key === value)
    ? /** @type {RecipientFilter} */ (value)
    : "all";
}

/**
 * Why a recipient was not sent (`campaign_contacts.excluded_reason`, set by
 * the runner and the audience refresh) — German labels; `sonstiges` = none.
 */
export const NOT_SENT_REASON_LABELS = Object.freeze({
  keine_einwilligung: "Keine Einwilligung (mehr)",
  kein_doi: "Kein nachweisbares Double-Opt-in",
  gesperrt: "Gesperrt (Abmeldung, Bounce, Beschwerde)",
  zu_haeufig: "Sperrfrist (zuletzt angeschrieben)",
  doppelt: "Adresse doppelt",
  ungueltige_adresse: "Ungültige Adresse",
  versand_fehler: "Von Resend abgelehnt",
  versand_unklar: "Ergebnis unklar — in Resend prüfen",
  abgebrochen: "Abgebrochen",
  zielgruppe: "Passt nicht mehr zur Zielgruppe",
  sonstiges: "Ohne Angabe",
});
/** The reasons that count as „Fehler“ (getMailingStats FAILED_REASONS). */
export const FAILED_REASONS = Object.freeze(["versand_fehler", "versand_unklar", "ungueltige_adresse"]);

/**
 * A reason key for the „Nicht gesendet“ filter, or null (= every reason).
 * @param {unknown} value
 * @returns {string | null}
 */
export function parseNotSentReason(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NOT_SENT_REASON_LABELS, value) ? value : null;
}

/** @param {unknown} reason */
export function notSentReasonLabel(reason) {
  const key = typeof reason === "string" && reason ? reason : "sonstiges";
  return /** @type {Record<string, string>} */ (NOT_SENT_REASON_LABELS)[key] ?? key;
}

/** Sortable columns of the recipient list (`?rsort=` + `?rdir=`). */
export const RECIPIENT_SORTS = Object.freeze({
  sent: { label: "Gesendet", defaultDir: "desc" },
  clicks: { label: "Klicks", defaultDir: "desc" },
  revenue: { label: "Umsatz", defaultDir: "desc" },
});
/** @typedef {"sent" | "clicks" | "revenue"} RecipientSort */
/** @typedef {"asc" | "desc"} SortDirection */
export const DEFAULT_RECIPIENT_SORT = "sent";

/**
 * @param {unknown} sort
 * @param {unknown} dir
 * @returns {{ sort: RecipientSort, dir: SortDirection }}
 */
export function parseRecipientSort(sort, dir) {
  const key = typeof sort === "string" && Object.prototype.hasOwnProperty.call(RECIPIENT_SORTS, sort)
    ? /** @type {RecipientSort} */ (sort)
    : DEFAULT_RECIPIENT_SORT;
  const d = dir === "asc" || dir === "desc" ? dir : /** @type {SortDirection} */ (RECIPIENT_SORTS[key].defaultDir);
  return { sort: key, dir: d };
}

/** Recipients per page of the list. */
export const RECIPIENT_PAGE_SIZE = 50;
/** Rows per query of the CSV export (keyset over the recipient id). */
export const RECIPIENT_EXPORT_CHUNK = 2000;

/** 1-based page, or 1. @param {unknown} value */
export function parseRecipientPage(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 1;
}

/** The search text (name or e-mail), trimmed, at most 100 characters. @param {unknown} value */
export function parseRecipientQuery(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 100) : "";
}

/** A positive id, or null. @param {unknown} value */
export function parsePositiveId(value) {
  const s = String(value ?? "");
  if (!/^\d{1,15}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** The ILIKE pattern of a search text (%, _ and \ escaped). @param {string} q */
export function likePattern(q) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The URL parameters of the analysis (the Rundmail's `?view=versand`). */
export const ANALYTICS_URL_KEYS = Object.freeze({
  window: "window",
  filter: "rfilter",
  reason: "rgrund",
  q: "rq",
  sort: "rsort",
  dir: "rdir",
  page: "rpage",
  recipient: "recipient",
});

/**
 * @typedef {{
 *   window: RundmailWindowKey,
 *   filter: RecipientFilter,
 *   reason: string | null,
 *   q: string,
 *   sort: RecipientSort,
 *   dir: SortDirection,
 *   page: number,
 *   recipient: number | null,
 * }} AnalyticsUrlState
 */

/**
 * Read the analysis state from the URL (unknown values → defaults).
 * @param {(key: string) => string | null | undefined} get
 * @returns {AnalyticsUrlState}
 */
export function readAnalyticsUrlState(get) {
  const k = ANALYTICS_URL_KEYS;
  const filter = parseRecipientFilter(get(k.filter));
  const { sort, dir } = parseRecipientSort(get(k.sort), get(k.dir));
  return {
    window: parseRundmailWindow(get(k.window)),
    filter,
    reason: filter === "not_sent" ? parseNotSentReason(get(k.reason)) : null,
    q: parseRecipientQuery(get(k.q)),
    sort,
    dir,
    page: parseRecipientPage(get(k.page)),
    recipient: parsePositiveId(get(k.recipient)),
  };
}

/**
 * The URL parameters for a state: [key, value] to set, [key, null] to remove
 * (a default is never written, so a plain link stays short).
 * @param {AnalyticsUrlState} state
 * @returns {Array<[string, string | null]>}
 */
export function analyticsUrlEntries(state) {
  const k = ANALYTICS_URL_KEYS;
  const sortDefault = RECIPIENT_SORTS[state.sort]?.defaultDir;
  return [
    [k.window, state.window === DEFAULT_RUNDMAIL_WINDOW ? null : state.window],
    [k.filter, state.filter === "all" ? null : state.filter],
    [k.reason, state.filter === "not_sent" && state.reason ? state.reason : null],
    [k.q, state.q ? state.q : null],
    [k.sort, state.sort === DEFAULT_RECIPIENT_SORT ? null : state.sort],
    [k.dir, state.dir === sortDefault ? null : state.dir],
    [k.page, state.page > 1 ? String(state.page) : null],
    [k.recipient, state.recipient ? String(state.recipient) : null],
  ];
}

// ── status chip ──────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   status: string,
 *   excludedReason?: string | null,
 *   sentAt?: string | null,
 *   deliveredAt?: string | null,
 *   bouncedAt?: string | null,
 *   bounceType?: string | null,
 *   complainedAt?: string | null,
 *   clickedAt?: string | null,
 * }} RecipientStateInput
 */

/**
 * The status chip of a recipient — the same chips as the „Gesendet“ list of a
 * campaign (kampagne/SentHistory.tsx deliveryState) for sent mails, plus the
 * states before and instead of a send.
 * @param {RecipientStateInput} r
 * @returns {{ key: string, label: string, tone: "neutral" | "accent" | "success" | "warning" | "info" | "destructive", detail: string | null }}
 */
export function recipientState(r) {
  if (!r.sentAt) {
    if (r.status === "pending") return { key: "pending", label: "Ausstehend", tone: "neutral", detail: "Noch nicht gesendet." };
    if (r.status === "sending") return { key: "sending", label: "Wird gesendet", tone: "info", detail: "Im aktuellen Paket." };
    const reason = r.excludedReason || "sonstiges";
    if (FAILED_REASONS.includes(reason)) return { key: "failed", label: "Fehler", tone: "destructive", detail: notSentReasonLabel(reason) };
    return { key: "not_sent", label: "Nicht gesendet", tone: "neutral", detail: notSentReasonLabel(reason) };
  }
  if (r.bouncedAt) {
    const type = r.bounceType === "hard" ? "hart" : r.bounceType === "soft" ? "weich" : "unbekannter Typ";
    return { key: "bounced", label: "Bounce", tone: "destructive", detail: `${type} · ${formatAdmin(r.bouncedAt, ADMIN_DATE_TIME_SHORT)}` };
  }
  if (r.complainedAt) return { key: "complained", label: "Beschwerde", tone: "warning", detail: formatAdmin(r.complainedAt, ADMIN_DATE_TIME_SHORT) };
  if (r.clickedAt) return { key: "clicked", label: "Geklickt", tone: "accent", detail: `Erster Klick ${formatAdmin(r.clickedAt, ADMIN_DATE_TIME_SHORT)}` };
  if (r.deliveredAt) return { key: "delivered", label: "Zugestellt", tone: "success", detail: formatAdmin(r.deliveredAt, ADMIN_DATE_TIME_SHORT) };
  return { key: "sent", label: "Gesendet", tone: "neutral", detail: "Noch keine Zustellbestätigung." };
}

/** A frozen link target as people read it: no scheme, no query. @param {unknown} url */
export function linkDisplay(url) {
  return String(url ?? "").replace(/^https?:\/\//i, "").replace(/[?#].*$/, "").replace(/\/$/, "") || "—";
}

// ── timeline of one recipient ────────────────────────────────────────────────

/**
 * @typedef {{
 *   kind: "sent" | "delivered" | "click" | "order" | "bounce" | "complaint" | "unsubscribe" | "not_sent",
 *   at: string | null,
 *   title: string,
 *   detail: string | null,
 *   orderIndex?: number,
 * }} TimelineEntry
 */

/**
 * Everything that happened with one recipient of a Rundmail, oldest first:
 * sent, delivered, every click (with its link), the orders after it (with
 * their verdict), bounce, complaint, unsubscribe — or why nothing was sent.
 * @param {{
 *   status: string,
 *   excludedReason?: string | null,
 *   skippedAt?: string | null,
 *   sentAt?: string | null,
 *   deliveredAt?: string | null,
 *   bouncedAt?: string | null,
 *   bounceType?: string | null,
 *   complainedAt?: string | null,
 *   unsubscribedAt?: string | null,
 *   clicks?: ReadonlyArray<{ at: string | null, url: string | null }>,
 *   orders?: ReadonlyArray<{ processedAt: string | null, orderName?: string | null, netCents: number, verdict: OrderVerdict }>,
 * }} r
 * @returns {TimelineEntry[]}
 */
export function recipientTimeline(r) {
  /** @type {TimelineEntry[]} */
  const out = [];
  if (!r.sentAt) {
    if (r.status === "skipped" || r.status === "suppressed") {
      out.push({ kind: "not_sent", at: r.skippedAt ?? null, title: "Nicht gesendet", detail: notSentReasonLabel(r.excludedReason) });
    }
    return out;
  }
  out.push({ kind: "sent", at: r.sentAt, title: "Gesendet", detail: null });
  if (r.deliveredAt) out.push({ kind: "delivered", at: r.deliveredAt, title: "Zugestellt", detail: null });
  (r.clicks ?? []).forEach((c, i) => {
    out.push({ kind: "click", at: c.at, title: i === 0 ? "Erster Klick" : "Klick", detail: c.url ? linkDisplay(c.url) : "Link unbekannt" });
  });
  (r.orders ?? []).forEach((o, i) => {
    out.push({
      kind: "order",
      at: o.processedAt,
      title: `Bestellung${o.orderName ? ` ${o.orderName}` : ""}`,
      detail: ORDER_VERDICT_LABELS[o.verdict] ?? null,
      orderIndex: i,
    });
  });
  if (r.bouncedAt) {
    out.push({ kind: "bounce", at: r.bouncedAt, title: r.bounceType === "hard" ? "Bounce (hart)" : r.bounceType === "soft" ? "Bounce (weich)" : "Bounce", detail: null });
  }
  if (r.complainedAt) out.push({ kind: "complaint", at: r.complainedAt, title: "Beschwerde (als Spam gemeldet)", detail: null });
  if (r.unsubscribedAt) out.push({ kind: "unsubscribe", at: r.unsubscribedAt, title: "Abgemeldet", detail: null });
  const rank = { sent: 0, delivered: 1, click: 2, order: 3, bounce: 4, complaint: 5, unsubscribe: 6, not_sent: 7 };
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const ta = ms(a.e.at);
      const tb = ms(b.e.at);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return rank[a.e.kind] - rank[b.e.kind] || a.i - b.i;
    })
    .map(({ e }) => e);
}

// ── time series ──────────────────────────────────────────────────────────────

/** Steps of the „Versand“ chart, in minutes. */
const SEND_STEPS = [1, 10, 60, 1440];
const MAX_BUCKETS = 180;

/**
 * The bucket size of the „Versand“ chart: per minute for a send of up to an
 * hour, per 10 minutes for a longer one (the usual case for a few thousand at
 * „Behutsam“), per hour / day when it ran (or was paused) for longer — at
 * most 180 columns.
 * @param {number} firstMs
 * @param {number} lastMs
 */
export function sendStepMinutes(firstMs, lastMs) {
  const span = Math.max(0, lastMs - firstMs);
  for (const step of SEND_STEPS) {
    if (step === 1 && span > HOUR_MS) continue;
    if (Math.floor(span / (step * MINUTE_MS)) + 1 <= MAX_BUCKETS) return step;
  }
  return 1440;
}

/**
 * Mails sent per bucket, every bucket from the first to the last send (empty
 * ones as 0). Rows are per minute (epoch minutes, as the SQL groups them).
 * Buckets start on whole minutes / 10 minutes / hours (UTC — the same in
 * Berlin) or Berlin midnight for days.
 * @param {ReadonlyArray<{ minute: number, count: number }>} rows
 * @returns {{ stepMinutes: number, points: Array<{ t: string, value: number }> }}
 */
export function buildSendSeries(rows) {
  const valid = rows.filter((r) => Number.isFinite(r.minute) && Number(r.count) > 0);
  if (valid.length === 0) return { stepMinutes: 10, points: [] };
  const first = Math.min(...valid.map((r) => r.minute)) * MINUTE_MS;
  const last = Math.max(...valid.map((r) => r.minute)) * MINUTE_MS;
  const step = sendStepMinutes(first, last);
  if (step === 1440) {
    const byDay = new Map();
    for (const r of valid) {
      const day = berlinDay(r.minute * MINUTE_MS);
      byDay.set(day, (byDay.get(day) ?? 0) + Number(r.count));
    }
    return { stepMinutes: 1440, points: dayRange(berlinDay(first), berlinDay(last)).map((d) => ({ t: d, value: byDay.get(d) ?? 0 })) };
  }
  const stepMs = step * MINUTE_MS;
  const byBucket = new Map();
  for (const r of valid) {
    const b = Math.floor((r.minute * MINUTE_MS) / stepMs) * stepMs;
    byBucket.set(b, (byBucket.get(b) ?? 0) + Number(r.count));
  }
  const points = [];
  for (let b = Math.floor(first / stepMs) * stepMs; b <= last; b += stepMs) {
    points.push({ t: new Date(b).toISOString(), value: byBucket.get(b) ?? 0 });
  }
  return { stepMinutes: step, points };
}

/**
 * Hourly columns for a range of up to four days, daily ones beyond.
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {"hour" | "day"}
 */
export function activityGranularity(fromMs, toMs) {
  return toMs - fromMs <= 4 * DAY_MS ? "hour" : "day";
}

/** At most this many days in the activity chart (the most recent ones). */
export const ACTIVITY_MAX_DAYS = 366;

/**
 * Clicks, counted orders and their revenue per hour or per Berlin day, every
 * bucket from `fromMs` to `toMs` (empty ones as 0).
 * @param {ReadonlyArray<{ hour: number, clicks?: number, orders?: number, revenueCents?: number }>} rows  per epoch hour
 * @param {{ fromMs: number, toMs: number }} range
 * @returns {{ granularity: "hour" | "day", points: Array<{ t: string, clicks: number, orders: number, revenueCents: number }> }}
 */
export function buildActivitySeries(rows, { fromMs, toMs }) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return { granularity: "hour", points: [] };
  const granularity = activityGranularity(fromMs, toMs);
  const add = (/** @type {Map<string | number, { clicks: number, orders: number, revenueCents: number }>} */ map, key, r) => {
    const cur = map.get(key) ?? { clicks: 0, orders: 0, revenueCents: 0 };
    cur.clicks += Number(r.clicks) || 0;
    cur.orders += Number(r.orders) || 0;
    cur.revenueCents += Number(r.revenueCents) || 0;
    map.set(key, cur);
  };
  const zero = { clicks: 0, orders: 0, revenueCents: 0 };
  if (granularity === "hour") {
    const map = new Map();
    for (const r of rows) if (Number.isFinite(r.hour)) add(map, r.hour, r);
    const points = [];
    for (let h = Math.floor(fromMs / HOUR_MS); h <= Math.floor(toMs / HOUR_MS); h++) {
      points.push({ t: new Date(h * HOUR_MS).toISOString(), ...(map.get(h) ?? zero) });
    }
    return { granularity, points };
  }
  const map = new Map();
  for (const r of rows) if (Number.isFinite(r.hour)) add(map, berlinDay(r.hour * HOUR_MS), r);
  const days = dayRange(berlinDay(fromMs), berlinDay(toMs)).slice(-ACTIVITY_MAX_DAYS);
  return { granularity, points: days.map((d) => ({ t: d, ...(map.get(d) ?? zero) })) };
}

const berlinDayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: ADMIN_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The Berlin calendar day of an instant, YYYY-MM-DD. @param {number} at */
export function berlinDay(at) {
  return berlinDayFormat.format(new Date(at));
}

/**
 * Every calendar day from `from` to `to` (YYYY-MM-DD, inclusive).
 * @param {string} from
 * @param {string} to
 * @returns {string[]}
 */
export function dayRange(from, to) {
  const parse = (/** @type {string} */ d) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  const out = [];
  const end = parse(to);
  for (let t = parse(from); t <= end && out.length < 5000; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const weekdayFormat = new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * The tooltip label of a bucket: „12.11., 10:00–10:10“, „Do., 12.11.2026“.
 * @param {string} t  ISO instant, or YYYY-MM-DD for a day
 * @param {number} stepMinutes
 */
export function bucketLabel(t, stepMinutes) {
  if (stepMinutes >= 1440 || /^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [y, m, d] = t.slice(0, 10).split("-").map(Number);
    return weekdayFormat.format(new Date(Date.UTC(y, m - 1, d)));
  }
  const start = ms(t);
  if (!Number.isFinite(start)) return t;
  const day = formatAdmin(start, ADMIN_DAY_MONTH);
  if (stepMinutes <= 1) return `${day}, ${formatAdmin(start, ADMIN_TIME)}`;
  return `${day}, ${formatAdmin(start, ADMIN_TIME)}–${formatAdmin(start + stepMinutes * MINUTE_MS, ADMIN_TIME)}`;
}

/**
 * The axis tick of a bucket: the clock time (and the day where a range spans
 * several days), or the day for daily buckets.
 * @param {string} t
 * @param {number} stepMinutes
 * @param {boolean} multiDay
 */
export function bucketTick(t, stepMinutes, multiDay) {
  if (stepMinutes >= 1440 || /^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const [, m, d] = t.slice(0, 10).split("-");
    return `${d}.${m}.`;
  }
  const at = ms(t);
  if (!Number.isFinite(at)) return t;
  const time = formatAdmin(at, ADMIN_TIME);
  return multiDay ? `${formatAdmin(at, ADMIN_DAY_MONTH)} ${time}` : time;
}

// ── CSV export ───────────────────────────────────────────────────────────────

/** Excel reads a UTF-8 file correctly only with the byte-order mark. */
export const CSV_BOM = "\uFEFF";
/** German Excel separates columns with „;“ (the comma is the decimal mark). */
export const CSV_SEPARATOR = ";";

/**
 * One CSV cell: quoted when it holds the separator, a quote or a line break;
 * a text that a spreadsheet would run as a formula (= + - @ at the start) gets
 * a leading apostrophe (CSV injection).
 * @param {unknown} value
 */
export function csvCell(value) {
  if (value == null) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One CSV line (CRLF, as Excel writes it). @param {ReadonlyArray<unknown>} cells */
export function csvLine(cells) {
  return `${cells.map(csvCell).join(CSV_SEPARATOR)}\r\n`;
}

const csvDateFormat = new Intl.DateTimeFormat("de-DE", {
  timeZone: ADMIN_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** „12.11.2026 10:03“ in Berlin time (Excel reads it as a date), or "". @param {unknown} value */
export function csvDateTime(value) {
  const t = ms(value);
  if (!Number.isFinite(t)) return "";
  return csvDateFormat.format(new Date(t)).replace(",", "");
}

/** Cents as „1234,56“ (German Excel reads it as a number). @param {unknown} cents */
export function csvEuro(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  const neg = n < 0;
  const abs = Math.abs(Math.round(n));
  return `${neg ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** The columns of the recipient export. */
export const RECIPIENT_CSV_HEADERS = Object.freeze([
  "Name",
  "E-Mail",
  "Kunden-ID",
  "Status",
  "Grund (nicht gesendet)",
  "Gesendet",
  "Zugestellt",
  "Erster Klick",
  "Klicks",
  "Bounce",
  "Beschwerde",
  "Abgemeldet",
  "Bestellungen",
  "Umsatz (EUR)",
  "davon mit Code",
  "Bestellnummern",
]);

/**
 * @typedef {{
 *   customerId: number | null,
 *   firstName: string | null,
 *   lastName: string | null,
 *   email: string,
 *   status: string,
 *   excludedReason: string | null,
 *   sentAt: string | null,
 *   deliveredAt: string | null,
 *   bouncedAt: string | null,
 *   bounceType: string | null,
 *   complainedAt: string | null,
 *   clickedAt: string | null,
 *   unsubscribedAt: string | null,
 *   clicks: number,
 *   orders: number,
 *   revenueCents: number,
 *   codeOrders: number,
 *   orderNames: string | null,
 * }} RecipientCsvRow
 */

/** „Anna Müller“, or "". @param {{ firstName?: string | null, lastName?: string | null }} r */
export function recipientName(r) {
  return [r.firstName, r.lastName].map((s) => String(s ?? "").trim()).filter(Boolean).join(" ");
}

/**
 * The cells of one recipient, in the order of RECIPIENT_CSV_HEADERS.
 * @param {RecipientCsvRow} r
 * @returns {string[]}
 */
export function recipientCsvCells(r) {
  const state = recipientState(r);
  const notSent = !r.sentAt && (r.status === "skipped" || r.status === "suppressed");
  const bounce = r.bouncedAt
    ? `${csvDateTime(r.bouncedAt)}${r.bounceType === "hard" ? " (hart)" : r.bounceType === "soft" ? " (weich)" : ""}`
    : "";
  return [
    recipientName(r),
    r.email,
    r.customerId == null ? "" : String(r.customerId),
    state.label,
    notSent ? notSentReasonLabel(r.excludedReason) : "",
    csvDateTime(r.sentAt),
    csvDateTime(r.deliveredAt),
    csvDateTime(r.clickedAt),
    r.sentAt ? String(r.clicks) : "",
    bounce,
    csvDateTime(r.complainedAt),
    csvDateTime(r.unsubscribedAt),
    r.sentAt ? String(r.orders) : "",
    r.sentAt ? csvEuro(r.revenueCents) : "",
    r.sentAt ? String(r.codeOrders) : "",
    r.orderNames ?? "",
  ];
}

/**
 * The file name of the export: „rundmail-black-week-empfaenger-7-tage-2026-11-12.csv“.
 * @param {string} slug
 * @param {unknown} windowKey
 * @param {number} [now]
 */
export function recipientCsvFilename(slug, windowKey, now = Date.now()) {
  const base = String(slug ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "rundmail";
  const win = parseRundmailWindow(windowKey) === "heute" ? "bis-heute" : `${parseRundmailWindow(windowKey)}-${rundmailWindowDays(windowKey) === 1 ? "tag" : "tage"}`;
  return `rundmail-${base}-empfaenger-${win}-${berlinDay(now)}.csv`;
}
