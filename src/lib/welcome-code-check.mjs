// Pure core of `npm run check:welcome` (scripts/check-welcome-code.mjs) —
// OPTIN_REWARD_2026-10-08 T1: which Shopify discount is today's welcome code,
// with which settings, and did a chat DOI confirmation trigger its mail?
//
// No I/O here: the script fetches (Shopify Admin GraphQL, queries only; Mo's DB,
// SELECT only inside a READ ONLY transaction) and hands the rows to these
// helpers, which guard, shape, classify, mask and assess them. Tested in
// welcome-code-check.test.mjs.
//
// Privacy: nothing here ever returns another customer's e-mail address. A
// discount restricted to specific customers is described by COUNT only — its
// title and Shopify's summary, which can name them, are not shown; any address
// inside merchant- or Shopify-written free text (titles, summaries, event
// messages, tags) is masked; codes are masked unless the operator asks for
// them; the timeline only ever holds rows the script selected for the ONE
// address it was given.

import { ADMIN_DATE_TIME_PADDED, ADMIN_TIME_ZONE, formatAdmin } from "./admin-datetime.mjs";
import { money, num, plural } from "./admin-format.mjs";
import { isMoDiscountCode } from "./order-attribution.mjs";

const WELCOME_HINT_SOURCE =
  "willkommen|welcome|newsletter|neukunde|new[ _-]?customer|abonn|subscri|anmeld|sign[ _-]?up|erstbestell|first[ _-]?order";

/** Words that mark a welcome / newsletter discount in its title, code or tags. */
export const WELCOME_HINT_RE = new RegExp(WELCOME_HINT_SOURCE, "i");

/** The same words plus the names of mail apps, as a Postgres `~*` pattern —
 * for the aggregated tag count over `customers.shopify_tags` (a Flow or app
 * tag such as `welcome_code_issued` or `Mailchimp` points at the sender). */
export const SENDER_TAG_PATTERN = `${WELCOME_HINT_SOURCE}|mailchimp|klaviyo|omnisend|seguno|privy`;

/** The Shopify trigger window: an app write fires the „Customer subscribed to
 * email marketing" automations only while consentUpdatedAt is < 24 h old
 * (shopify.dev changelog, 23.05.2024). */
export const TRIGGER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A Shopify consent timestamp within this distance of Mo's is Mo's own write. */
export const SAME_WRITE_MS = 2 * 60 * 1000;

/** A welcome mail this soon after Mo's write fits „triggered by the chat confirmation". */
export const MAIL_FITS_MS = 60 * 60 * 1000;

/** @type {Intl.DateTimeFormatOptions} 08.10.2026, 14:03:12 */
const BERLIN_SECONDS = { ...ADMIN_DATE_TIME_PADDED, second: "2-digit" };

/** "08.10.2026, 14:03:12" in Europe/Berlin, or "—". */
export function berlin(value) {
  return formatAdmin(value, BERLIN_SECONDS);
}

/** Europe/Berlin's UTC offset (ms) at the instant `utcMs`. */
function berlinOffsetMs(utcMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ADMIN_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The operator's `--inbox` time as an ISO instant, or null. With a zone
 * ("…Z", "…+02:00") as given; without one — ISO "2026-10-06T16:16:40" or German
 * "06.10.2026 16:16" — read as Europe/Berlin wall time, like the mail client shows it.
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
export function parseInboxTime(text) {
  const s = String(text ?? "").trim();
  if (!s) return null;
  if (/(z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  const p = iso ? [iso[1], iso[2], iso[3], iso[4], iso[5], iso[6]] : de ? [de[3], de[2], de[1], de[4], de[5], de[6]] : null;
  if (!p) return null;
  const [y, mo, d, h, mi, sec] = p.map((v) => Number(v ?? 0));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi, sec);
  // the offset at the guessed instant (right on either side of a DST switch)
  return new Date(wall - berlinOffsetMs(wall - berlinOffsetMs(wall))).toISOString();
}

/** "m•••@example.com" — enough to recognise one's own test address. */
export function maskEmail(email) {
  const e = String(email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${e[0]}•••${e.slice(at)}`;
}

const EMAIL_IN_TEXT_RE = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi;

/** Free text (titles, summaries, event messages) with every address masked. */
export function redactEmails(text) {
  if (text == null) return null;
  return String(text).replace(EMAIL_IN_TEXT_RE, (m) => maskEmail(m));
}

/** Free text from Shopify: tags stripped, addresses masked, cut to `max`. */
export function cleanText(text, max = 160) {
  if (text == null) return null;
  const plain = String(text).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const red = redactEmails(plain) ?? "";
  return red.length > max ? `${red.slice(0, max - 1)}…` : red;
}

/** A redeemable code is a bearer secret: "WELC•••(12)" unless `show`. */
export function maskCode(code, show = false) {
  const c = String(code ?? "");
  if (show || c.length <= 4) return c;
  return `${c.slice(0, 4)}•••(${c.length})`;
}

// ---------------------------------------------------------------------------
// Read-only guards (the script refuses anything else before it is sent)
// ---------------------------------------------------------------------------

/** True for a GraphQL document that only reads: it starts with `query` or `{`
 * and names no `mutation` / `subscription` anywhere (strings and comments
 * ignored). */
export function isReadOnlyGraphql(doc) {
  const text = String(doc ?? "")
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/#[^\n\r]*/g, "");
  if (!/^\s*(query\b|\{)/.test(text)) return false;
  return !/\b(mutation|subscription)\b/i.test(text);
}

const SQL_WRITE_WORD_RE =
  /\b(insert|update|delete|merge|upsert|truncate|alter|drop|create|grant|revoke|copy|call|do|vacuum|analyze|lock|set|reset|refresh|comment|execute|prepare|deallocate|listen|notify|cluster|reindex|discard|import|load|security)\b/i;

/** True for one SELECT (or WITH … SELECT) statement without a write keyword
 * (string literals and comments ignored). `FOR UPDATE` is refused too. */
export function isSelectOnlySql(text) {
  const t = String(text ?? "")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n\r]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  if (!/^\s*(select|with)\b/i.test(t)) return false;
  if (/;\s*\S/.test(t)) return false;
  return !SQL_WRITE_WORD_RE.test(t);
}

/**
 * How long to wait before retrying a Shopify Admin request, or null when the
 * answer is final. Waits on HTTP 429 / a THROTTLED error (from the cost
 * extension: missing points ÷ restore rate, else Retry-After, else 2 s) and on
 * a 502/503/504; never longer than 20 s.
 * @param {{ status?: number, json?: any, retryAfter?: string | null }} res
 * @returns {number | null}
 */
export function throttleDelayMs({ status = 200, json = null, retryAfter = null } = {}) {
  const throttled =
    status === 429 || (Array.isArray(json?.errors) && json.errors.some((e) => e?.extensions?.code === "THROTTLED"));
  const transient = status === 502 || status === 503 || status === 504;
  if (!throttled && !transient) return null;
  const cost = json?.extensions?.cost;
  const t = cost?.throttleStatus;
  let ms = 2000;
  if (throttled && t && Number(t.restoreRate) > 0) {
    const need = Number(cost.requestedQueryCost ?? 200);
    const missing = Math.max(0, need - Number(t.currentlyAvailable ?? 0));
    ms = Math.ceil(missing / Number(t.restoreRate)) * 1000 + 250;
  } else if (retryAfter != null && Number.isFinite(Number(retryAfter))) {
    ms = Number(retryAfter) * 1000;
  }
  return Math.min(Math.max(ms, 250), 20_000);
}

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------

function moneyOf(m) {
  if (!m || m.amount == null) return null;
  const n = Number(m.amount);
  return Number.isFinite(n) ? money(n, m.currencyCode || "EUR") : null;
}

function percentOf(gets) {
  const v = gets?.value;
  if (!v || (v.__typename !== "DiscountPercentage" && typeof v.percentage !== "number")) return null;
  const n = Number(v.percentage);
  return Number.isFinite(n) ? Math.round(n * 10000) / 100 : null;
}

function describeValue(gets, percent) {
  const v = gets?.value;
  if (!v) return null;
  if (percent != null) return `${num(percent, 2)} %`;
  if (v.__typename === "DiscountAmount" || v.amount) {
    return `${moneyOf(v.amount) ?? "?"}${v.appliesOnEachItem ? " je Artikel" : ""}`;
  }
  if (v.__typename === "DiscountOnQuantity") return "Mengenrabatt";
  return v.__typename ?? null;
}

function describeItems(items) {
  if (!items) return null;
  if (items.__typename === "AllDiscountItems" || items.allItems) return "alle Artikel";
  if (items.__typename === "DiscountCollections" || items.collections) {
    const n = items.collections?.nodes ?? [];
    return `Kollektionen: ${n.map((c) => cleanText(c.title, 60)).join(", ") || "?"}${items.collections?.pageInfo?.hasNextPage ? ", …" : ""}`;
  }
  if (items.__typename === "DiscountProducts" || items.products) {
    const p = items.products?.nodes?.length ?? 0;
    return `${p}${items.products?.pageInfo?.hasNextPage ? "+" : ""} ausgewählte Produkte`;
  }
  return items.__typename ?? null;
}

/** `undefined` = not asked for (BXGY / app discounts have none) → null. */
function describeMinimum(min) {
  if (min === undefined) return null;
  if (!min) return "kein Mindestwert";
  if (min.greaterThanOrEqualToSubtotal) return `ab ${moneyOf(min.greaterThanOrEqualToSubtotal) ?? "?"} Warenwert`;
  if (min.greaterThanOrEqualToQuantity != null) return `ab ${min.greaterThanOrEqualToQuantity} Artikeln`;
  return "?";
}

/** Who may use it — counts only, never the customers themselves. */
function describeBuyers(context) {
  if (!context) return null;
  if (context.__typename === "DiscountBuyerSelectionAll" || context.all) return "alle Kunden";
  if (context.__typename === "DiscountCustomers" || Array.isArray(context.customers)) {
    return Array.isArray(context.customers) ? `nur ${plural(context.customers.length, "einzelner Kunde", "einzelne Kunden")}` : "nur einzelne Kunden";
  }
  if (context.__typename === "DiscountCustomerSegments" || Array.isArray(context.segments)) {
    return `Segmente: ${(context.segments ?? []).map((s) => cleanText(s.name, 60)).join(", ") || "?"}`;
  }
  return context.__typename ?? null;
}

/** Shown instead of the title of a discount restricted to individual customers. */
export const HIDDEN_TITLE = "(Titel ausgeblendet: Rabatt für einzelne Kunden)";

function describeCombines(cw) {
  if (!cw) return null;
  const on = [];
  if (cw.orderDiscounts) on.push("Bestellrabatte");
  if (cw.productDiscounts) on.push("Produktrabatte");
  if (cw.shippingDiscounts) on.push("Versandrabatte");
  return on.length ? `kombinierbar mit ${on.join(", ")}` : "nicht kombinierbar";
}

/**
 * @typedef {Object} DiscountDesc
 * @property {string} id
 * @property {string} type      DiscountCodeBasic | DiscountCodeFreeShipping | DiscountCodeBxgy | DiscountCodeApp
 * @property {string} title     addresses masked; hidden for a discount restricted to individual customers
 * @property {boolean} restricted  restricted to individual customers (its title may name them)
 * @property {boolean} titleHint   the (possibly hidden) title carries a welcome word
 * @property {string} status    ACTIVE | EXPIRED | SCHEDULED
 * @property {number | null} percent   5 for 5 %
 * @property {string | null} value     "5 %", "50,00 €", "Gratisversand"
 * @property {string | null} minimum   null = not asked for
 * @property {Array<{ code: string, shown: string, createdBy: string | null, used: number | null }>} codes
 * @property {number} codesCount
 * @property {string | null} buyers    "alle Kunden" / "N einzelne Kunden" (count only)
 * @property {string | null} summary   Shopify's text; null for a customer-restricted discount
 */

/**
 * Flatten one `discountNodes` / `discountNode` node (any code discount type)
 * into what the operator compares against the advertised terms.
 * @param {any} node  { id, discount: {...}, events?: { nodes } }
 * @param {{ showCodes?: boolean }} [opts]
 * @returns {DiscountDesc & Record<string, any>}
 */
export function describeDiscountNode(node, opts = {}) {
  const d = node?.discount ?? {};
  const codes = (d.codes?.nodes ?? []).map((c) => ({
    code: String(c.code ?? ""),
    shown: maskCode(c.code, opts.showCodes),
    createdBy: c.createdBy?.title ?? null,
    used: c.asyncUsageCount ?? null,
  }));
  const restricted = d.context?.__typename === "DiscountCustomers" || Array.isArray(d.context?.customers);
  const rawTitle = String(d.title ?? "");
  const percent = percentOf(d.customerGets);
  return {
    id: String(node?.id ?? ""),
    type: d.__typename ?? "?",
    // A per-person discount's title may carry that person's name — never shown.
    title: restricted ? HIDDEN_TITLE : cleanText(rawTitle, 120) ?? "",
    restricted,
    titleHint: WELCOME_HINT_RE.test(rawTitle),
    status: d.status ?? "?",
    createdAt: d.createdAt ?? null,
    startsAt: d.startsAt ?? null,
    endsAt: d.endsAt ?? null,
    percent,
    value: d.__typename === "DiscountCodeFreeShipping" ? "Gratisversand" : describeValue(d.customerGets, percent),
    items: describeItems(d.customerGets?.items),
    minimum: describeMinimum(d.minimumRequirement),
    usageLimit: d.usageLimit ?? null,
    oncePerCustomer: d.appliesOncePerCustomer ?? null,
    used: d.asyncUsageCount ?? null,
    codesCount: d.codesCount?.count ?? codes.length,
    codes,
    buyers: describeBuyers(d.context),
    combines: describeCombines(d.combinesWith),
    classes: Array.isArray(d.discountClasses) ? d.discountClasses : [],
    tags: Array.isArray(d.tags) ? d.tags.map((t) => cleanText(t, 60)) : [],
    appType: d.appDiscountType ? `${cleanText(d.appDiscountType.title, 60)} (App ${d.appDiscountType.app?.title ?? "?"})` : null,
    // Shopify's own summary can name the customers of a restricted code — drop it then.
    summary: restricted ? null : cleanText(d.summary, 240),
    totalSales: moneyOf(d.totalSales),
    events: (node?.events?.nodes ?? []).map((e) => ({
      at: e.createdAt ?? null,
      action: e.action ?? null,
      app: e.appTitle ?? null,
      byApp: Boolean(e.attributeToApp),
      byStaff: Boolean(e.attributeToUser),
      message: cleanText(e.message, 160),
    })),
  };
}

/** True when every known code of the discount is one of Mo's MS5-/MK- codes. */
export function isMoOwnDiscount(desc) {
  return desc.codes.length > 0 && desc.codes.every((c) => isMoDiscountCode(c.code));
}

/** "ein Code für alle", "Einzelcodes" or "Code nur für einzelne Kunden". */
export function codeKind(desc) {
  if (desc.restricted) return "Code nur für einzelne Kunden";
  return desc.codesCount > 1 ? "Einzelcodes" : "ein Code für alle";
}

/**
 * Why a discount may be the welcome code. Empty → not a candidate.
 * Mo's own MS5-/MK- codes are never candidates.
 * @param {DiscountDesc & Record<string, any>} desc
 * @returns {string[]}
 */
export function welcomeCandidateReasons(desc) {
  if (isMoOwnDiscount(desc)) return [];
  const reasons = [];
  if (desc.titleHint) reasons.push("Titel");
  if (desc.codes.some((c) => WELCOME_HINT_RE.test(c.code))) reasons.push("Code");
  if (desc.tags.some((t) => WELCOME_HINT_RE.test(String(t)))) reasons.push("Tag");
  if (desc.percent === 5) reasons.push("5 %");
  const apps = [...new Set(desc.codes.map((c) => c.createdBy).filter(Boolean))];
  if (apps.length) reasons.push(`Code von App: ${apps.join(", ")}`);
  if (desc.codesCount > 1 && !apps.length) reasons.push(`${desc.codesCount} Codes (Einzelcodes?)`);
  const eventApps = [...new Set(desc.events.filter((e) => e.byApp && e.app).map((e) => e.app))];
  if (eventApps.length) reasons.push(`angelegt/geändert von App: ${eventApps.join(", ")}`);
  return reasons;
}

/**
 * Group the codes used in orders without exposing single-use codes: a code
 * used at least `minShared` times is its own group (a shared code like
 * WILLKOMMEN5); rarer codes fold into their prefix ("MS5-…", "WELCOME-…",
 * "(Einzelcodes ohne Präfix)").
 * @param {Array<{ code: string, orders: number, customers: number, first: any, last: any }>} rows
 * @param {number} [minShared]
 */
export function codeUsageGroups(rows, minShared = 3) {
  const groups = new Map();
  const ts = (v) => (v == null ? NaN : new Date(v).getTime());
  for (const r of rows) {
    const code = String(r.code ?? "").trim().toUpperCase();
    if (!code) continue;
    const shared = Number(r.orders) >= minShared;
    const dash = code.indexOf("-");
    const key = shared ? code : dash > 0 ? `${code.slice(0, dash + 1)}…` : "(Einzelcodes ohne Präfix)";
    const g = groups.get(key) ?? { group: key, shared, codes: 0, orders: 0, customers: 0, first: null, last: null, mo: isMoDiscountCode(code) };
    g.codes += 1;
    g.orders += Number(r.orders) || 0;
    g.customers += Number(r.customers) || 0;
    if (r.first != null && (g.first == null || ts(r.first) < ts(g.first))) g.first = r.first;
    if (r.last != null && (g.last == null || ts(r.last) > ts(g.last))) g.last = r.last;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.orders - a.orders || a.group.localeCompare(b.group));
}

/** The label of a code group: a shared code is masked like any code (unless
 * `showCodes`); a prefix group is already partial. */
export function codeGroupLabel(group, showCodes = false) {
  return group.shared ? maskCode(group.group, showCodes) : group.group;
}

// ---------------------------------------------------------------------------
// One address: Shopify consent, timeline, assessment
// ---------------------------------------------------------------------------

/**
 * The customer's e-mail-marketing consent from the 2026-04 `defaultEmailAddress`,
 * field by field falling back to the deprecated `emailMarketingConsent`.
 * @param {any} customer
 * @returns {{ marketingState: string | null, optInLevel: string | null, consentUpdatedAt: string | null, from: string } | null}
 */
export function shopifyConsentOf(customer) {
  const dea = customer?.defaultEmailAddress ?? null;
  const emc = customer?.emailMarketingConsent ?? null;
  if (!dea && !emc) return null;
  const pick = (a, b) => (a != null && a !== "" ? a : b ?? null);
  return {
    marketingState: pick(dea?.marketingState, emc?.marketingState),
    optInLevel: pick(dea?.marketingOptInLevel, emc?.marketingOptInLevel),
    consentUpdatedAt: pick(dea?.marketingUpdatedAt, emc?.consentUpdatedAt),
    from: dea?.marketingState ? "defaultEmailAddress" : "emailMarketingConsent (veraltet)",
  };
}

/** One chronological list from Mo's and Shopify's rows ({ at, side, what }). */
export function buildTimeline(entries) {
  const ts = (e) => new Date(e.at).getTime();
  return entries
    .filter((e) => e && e.at && !Number.isNaN(ts(e)))
    .sort((a, b) => ts(a) - ts(b) || String(a.side).localeCompare(String(b.side)));
}

/** "18 s", "4 min", "25,0 h". */
export function duration(ms) {
  const abs = Math.abs(ms);
  if (abs < 60_000) return `${Math.round(ms / 1000)} s`;
  const m = Math.round(ms / 60_000);
  if (Math.abs(m) < 120) return `${m} min`;
  return `${num(m / 60, 1)} h`;
}

/**
 * Read the evidence for test case 8 / 8b: did Mo's DOI confirmation write the
 * Shopify consent in time to fire the welcome automation, and does the
 * welcome mail's arrival fit that write? Timing only — cause and effect come
 * from the automation's activity report.
 *
 * @param {{
 *   moConfirmedAt?: string | Date | null,   // email_captures.doi_confirmed_at (latest)
 *   outbox?: Array<{ kind: string, status: string, payloadAt?: string | null, payloadState?: string | null, doneAt?: string | Date | null }>,
 *   shopify?: { marketingState?: string | null, optInLevel?: string | null, consentUpdatedAt?: string | null } | null,
 *   inboxAt?: string | null,                // when the welcome mail arrived (operator input)
 *   moChecked?: boolean,                    // false when Mo's database was not read (--no-db)
 * }} input
 * @returns {string[]} findings, most important first
 */
export function assessWelcomeTrigger(input = {}) {
  const { shopify = null, inboxAt = null, moChecked = true } = input;
  const confirmedAt = moChecked ? (input.moConfirmedAt ?? null) : null;
  const outbox = moChecked ? (input.outbox ?? []) : [];
  const out = [];
  if (!moChecked) out.push("Mo: Datenbank nicht gelesen (--no-db) — nur Shopifys Sicht, ohne Mos Bestätigung und Outbox.");
  const t = (v) => (v ? new Date(v).getTime() : NaN);
  const subs = outbox.filter((o) => o.payloadState === "subscribed" && (o.kind === "consent_update" || o.kind === "customer_create"));
  const done = subs.filter((o) => o.status === "done").sort((a, b) => t(b.doneAt) - t(a.doneAt))[0] ?? null;
  const kindText = (o) =>
    o.kind === "customer_create" ? "customerCreate — Kunde neu angelegt oder vorhandenen verknüpft (Testfall 8b)" : "Einwilligung aktualisiert (Testfall 8)";

  if (moChecked && !confirmedAt) {
    out.push("Mo: keine DOI-Bestätigung für diese Adresse — Testfall 8 nicht anwendbar (oder die Bestätigung ist vor der Aufbewahrungsfrist gelöscht).");
  }
  if (confirmedAt && subs.length === 0) {
    out.push(
      "Mo: Bestätigung vorhanden, aber KEINE Outbox-Zeile „subscribed“ — Mo hat nichts an Shopify geschrieben (Schalter SHOPIFY_CONSENT_WRITEBACK aus, Person war schon abonniert, oder kein Kundensatz)."
    );
  }
  if (subs.length > 0 && !done) {
    out.push(`Mo: Outbox-Zeile(n) „subscribed“ noch nicht erledigt (${subs.map((o) => o.status).join(", ")}) — Shopify kennt die Einwilligung noch nicht.`);
  }
  if (done) {
    const lag = t(done.doneAt) - t(done.payloadAt);
    if (Number.isFinite(lag)) {
      out.push(
        lag > TRIGGER_WINDOW_MS
          ? `Mo → Shopify: geschrieben ${duration(lag)} NACH dem Bestätigungszeitpunkt — consentUpdatedAt war älter als 24 h; laut Shopify-Changelog feuert die Willkommens-Automation dann NICHT.`
          : `Mo → Shopify: geschrieben ${duration(lag)} nach der Bestätigung (${kindText(done)}) — innerhalb des 24-h-Fensters.`
      );
    }
    const stale = t(confirmedAt) - t(done.payloadAt);
    if (Number.isFinite(stale) && stale > SAME_WRITE_MS) {
      out.push(
        `Mo: der letzte Schreibvorgang gehört zu einer früheren Bestätigung (${berlin(done.payloadAt)}); die jüngste vom ${berlin(confirmedAt)} hat nichts geschrieben (war schon abonniert).`
      );
    }
  }
  if (shopify) {
    const st = shopify.marketingState ?? "?";
    out.push(`Shopify: ${st}${shopify.optInLevel ? ` / ${shopify.optInLevel}` : ""}, zuletzt geändert ${berlin(shopify.consentUpdatedAt)}.`);
    if (st === "PENDING") {
      out.push("Shopify wartet auf den Klick in seiner EIGENEN Bestätigungsmail (Shop-Anmeldung, C.29) — bis dahin ist die Person in Shopify nicht abonniert.");
    }
    if (done && shopify.consentUpdatedAt && done.payloadAt) {
      const diff = Math.abs(t(shopify.consentUpdatedAt) - t(done.payloadAt));
      if (Number.isFinite(diff)) {
        out.push(
          diff <= SAME_WRITE_MS
            ? "Shopify-Zeitstempel = Mos Bestätigungszeit → die aktuelle Einwilligung in Shopify stammt von Mo."
            : `Shopify-Zeitstempel weicht ${duration(diff)} von Mos Bestätigungszeit ab → eine spätere/andere Quelle hat die Einwilligung zuletzt gesetzt.`
        );
      }
    }
  }
  if (inboxAt) {
    const shopRef = !moChecked && shopify?.consentUpdatedAt ? t(shopify.consentUpdatedAt) : NaN;
    const ref = done ? t(done.doneAt) : confirmedAt ? t(confirmedAt) : shopRef;
    const mail = t(inboxAt);
    if (!Number.isFinite(mail)) out.push("Willkommensmail: Zeitpunkt nicht lesbar.");
    else if (!Number.isFinite(ref)) {
      out.push(
        moChecked
          ? "Willkommensmail ohne Mo-Bestätigung oder -Schreibvorgang als Bezug → der Auslöser liegt außerhalb von Mo (Shop-Formular, Kasse, Import)."
          : "Willkommensmail: ohne Mos Datenbank und ohne Shopify-Zeitstempel kein Bezugspunkt."
      );
    } else {
      const d = mail - ref;
      const what = done ? "Mos Schreibvorgang" : confirmedAt ? "Mos Bestätigung" : "Shopifys letzter Einwilligungsänderung";
      if (d < 0) out.push(`Willkommensmail kam ${duration(-d)} VOR ${what} → anderer Auslöser (Shop-Formular, Kasse, Import).`);
      else if (d <= MAIL_FITS_MS) {
        out.push(`Willkommensmail ${duration(d)} nach ${what} → passt zu „von der Chat-Bestätigung ausgelöst“ (mit dem Aktivitätsbericht der Automation gegenprüfen).`);
      } else out.push(`Willkommensmail ${duration(d)} nach ${what} → Zusammenhang unklar (Wartezeit in der Automation? Serie?).`);
    }
  } else if (done) {
    out.push("Willkommensmail: Eingangszeit mit --inbox <Zeit> angeben (Berliner Zeit, z. B. „06.10.2026 16:16“), dann wird sie eingeordnet.");
  }
  return out;
}
