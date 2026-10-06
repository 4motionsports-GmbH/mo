// The business snapshot — everything a business decision needs from the
// CURRENT backend, for a period and the equally long period right before it,
// as one compact, versioned, PII-free structure. Pure (no I/O): the data layer
// (business-snapshot.ts) collects the raw getter results — the same store
// functions the KPI screen calls, so every number matches the KPI screen — and
// hands them to buildBusinessSnapshot(); the Komplettanalyse renders, prints
// and feeds the snapshot to the strategist model; the Verbesserung reads it as
// its baseline. Field list and rules: docs/BUSINESS_SNAPSHOT.md.
//
// Shape (SNAPSHOT_VERSION 1):
//   { version, generatedAt, period, previous, sections[], funnels[], caveats[],
//     switches[], releases[] }
//   section = { key, title, scope: "period" | "lifetime", link, metrics[],
//               tables[], notes[], previousNotes[] }
//   metric  = { key, label, unit, value, previous, base?, good, hint? }
//
// Metric keys ("revenue.total", "chat.engagement", …) are a stable API: never
// rename one; add a new key instead. Units: count | eur | rate (0–1) | ratio
// (plain multiple, e.g. clicks per chat) | hours | score (1–5).
//
// Privacy: only counts, sums, rates and operator-defined names (campaigns,
// call sites, segment keys) — never a person, an e-mail address or message
// text. scrubPii() is the guard for the few free texts the report adds.

import { eur, num, ratio, hours as fmtHours } from "./admin-format.mjs";
import { daysBetween, germanDate, shiftYmd } from "./kpi-range.mjs";
import { isRealisedFinancialStatus } from "./kpi-revenue-core.mjs";

export const SNAPSHOT_VERSION = 1;

/** A rate whose base is below this is flagged as a small sample. */
export const MIN_RATE_BASE = 30;

/** Analysis coverage below which the quality distributions are not representative. */
export const MIN_ANALYSIS_COVERAGE = 0.5;

// ── Labels ────────────────────────────────────────────────────────────────────

/** German labels of the AI call sites (ai-usage-store AiCallSite). Unknown keys render raw. */
export const AI_CALL_SITE_LABELS = Object.freeze({
  chat: "Beratungs-Chat",
  embeddings: "Embeddings (Produktsuche)",
  tts: "Sprachausgabe (TTS)",
  summary_email: "Zusammenfassungs-E-Mail",
  summary_download: "Zusammenfassung (Download)",
  marketing_draft: "Marketing-Entwürfe",
  campaign_draft: "Kampagnen-Entwürfe",
  campaign_letter: "Kampagnen-Briefe",
  customer_profile: "Kundenprofile",
  top_questions: "Top-Fragen (Personas)",
  conversation_analysis: "Gesprächsanalyse",
  conversation_insights: "Insights-Rollup",
  analytics_report: "Komplettanalyse",
  qa_draft: "Wissen: Entwürfe",
  qa_translate: "Wissen: Übersetzung",
  bundle_suggestions: "Bundle-Vorschläge",
  hero_image: "KI-Titelbilder",
  campaign_assist: "Kampagnen: Zielgruppe & Briefing",
  inbox_suggestion: "Eingang: Vorschläge",
  inbox_mail_reply: "Eingang: E-Mail beantworten",
  customer_ask: "Kunden: Frag Mo",
  improvement: "Verbesserung",
});

/** mo_orders.attribution_source → German. */
export const ORDER_SOURCE_LABELS = Object.freeze({
  widget: "Widget-Warenkorb (Beratung)",
  summary_email: "Zusammenfassungs-Mail",
  marketing_email: "Persönliche Marketing-Mail",
  bundle: "Set-Angebot",
  discount_code: "Mo-Rabattcode",
});

export const SEGMENT_LABELS = Object.freeze({
  frisch: "Frisch gekauft",
  ausbauen_frueh: "Ausbauen — früh",
  ausbauen: "Ausbauen",
  weiterentwickeln: "Weiterentwickeln",
  zurueckholen: "Zurückholen",
  ruhen: "Ruhen lassen",
  unbekannt: "Unbekannt",
  keine_bestellung: "Ohne Bestellung",
});

export const VALUE_TIER_LABELS = Object.freeze({
  klein: "Kleinteile",
  komponente: "Komponenten",
  grossgeraet: "Großgeräte",
  unbekannt: "Unbekannt",
});

export const INBOX_KIND_LABELS = Object.freeze({
  antwort_offen: "E-Mail beantworten",
  nicht_zugeordnet: "E-Mail nicht zugeordnet",
  datenauskunft: "Datenauskunft angefordert",
  abgleich_konflikt: "Shopify-Abgleich prüfen",
  kaufabsicht: "Kaufabsicht ohne Kauf",
  unzufrieden: "Unzufriedenheit",
  angebot_laeuft_ab: "Angebot läuft ab",
  klick_ohne_kauf: "Geklickt, nicht gekauft",
  zubehoer_fenster: "Zubehör-Fenster",
  wiederkauf_faellig: "Wiederkauf fällig",
  abwanderung: "Abwanderungsgefahr",
  top_kunde: "Top-Kunde",
  einwilligung_fehlt: "Aktiv, ohne Einwilligung",
  zustellproblem: "Zustellproblem",
});

const QUALITY_KEYS = Object.freeze({
  handled_well: "Gut gelöst",
  satisfied: "Zufrieden",
  unmet_need: "Offener Bedarf",
  dropped_off: "Abgesprungen",
  unclear: "Unklar",
});

const SIGNIN_WAY_LABELS = Object.freeze({
  signin: "Über „Anmelden“",
  shop: "Über Shop-Login erkannt",
  unknown: "Ohne Anmelde-Event",
});

const CONSENT_SOURCE_LABELS = Object.freeze({
  shopify: "Shop (Checkout, Konto, Newsletter)",
  mo: "Mo (Chat, Formular, Anmeldung)",
  admin: "Admin",
  sonstige: "Übernahme / unbekannt",
});

function consentSourceGroup(source) {
  const s = String(source ?? "");
  if (s === "shopify") return "shopify";
  if (s === "mo" || s.startsWith("mo_")) return "mo";
  if (s === "admin") return "admin";
  return "sonstige";
}

// ── Small numeric helpers ─────────────────────────────────────────────────────

/** @param {unknown} v @returns {number | null} */
export function finite(v) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** n / d, or null when either is missing or d is 0. */
export function safeRate(n, d) {
  const a = finite(n);
  const b = finite(d);
  if (a === null || b === null || b <= 0) return null;
  return a / b;
}

function sum(values) {
  let total = 0;
  let any = false;
  for (const v of values) {
    const n = finite(v);
    if (n !== null) {
      total += n;
      any = true;
    }
  }
  return any ? total : null;
}

function round(v, digits = 4) {
  const n = finite(v);
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// ── Periods ───────────────────────────────────────────────────────────────────

/** "10.08.2026 – 08.09.2026" (one date for a single day). */
export function periodLabel(from, to) {
  return from === to ? germanDate(from) : `${germanDate(from)} – ${germanDate(to)}`;
}

/**
 * The equally long period directly before [from, to] (inclusive days).
 * @param {{ from: string, to: string }} range
 * @returns {{ from: string, to: string, days: number, label: string }}
 */
export function previousPeriod(range) {
  const days = Math.max(1, daysBetween(range.from, range.to));
  const to = shiftYmd(range.from, -1);
  const from = shiftYmd(to, -(days - 1));
  return { from, to, days, label: periodLabel(from, to) };
}

/** Normalised { from, to, days, label } for a range. */
export function describePeriod(range) {
  const days = Math.max(1, daysBetween(range.from, range.to));
  return { from: range.from, to: range.to, days, label: periodLabel(range.from, range.to) };
}

// ── Metrics ───────────────────────────────────────────────────────────────────

/**
 * @typedef {"count" | "eur" | "rate" | "ratio" | "hours" | "score"} MetricUnit
 * @typedef {{
 *   key: string, label: string, unit: MetricUnit,
 *   value: number | null, previous: number | null,
 *   base?: number | null, good: "up" | "down" | "none", hint?: string,
 * }} SnapshotMetric
 */

/**
 * Build one metric. `previous` is null for lifetime figures or when the
 * previous period is not comparable; `base` is the denominator of a rate.
 * @returns {SnapshotMetric}
 */
export function metric(key, label, unit, value, previous = null, opts = {}) {
  /** @type {SnapshotMetric} */
  const m = {
    key,
    label,
    unit,
    value: round(value),
    previous: round(previous),
    good: opts.good ?? "up",
  };
  if (opts.base !== undefined) m.base = finite(opts.base);
  if (opts.hint) m.hint = opts.hint;
  return m;
}

/**
 * The change of a metric against its previous value. Rates move in percentage
 * points; everything else relative. `favourable` is null when the direction
 * has no business meaning or nothing moved.
 * @param {SnapshotMetric} m
 * @returns {{ abs: number, rel: number | null, points: number | null, favourable: boolean | null, isNew: boolean } | null}
 */
export function metricDelta(m) {
  const cur = finite(m?.value);
  const prev = finite(m?.previous);
  if (cur === null || prev === null) return null;
  const abs = cur - prev;
  const rel = prev !== 0 ? abs / Math.abs(prev) : null;
  const points = m.unit === "rate" ? abs * 100 : null;
  const isNew = prev === 0 && cur !== 0;
  let favourable = null;
  if (abs !== 0 && m.good !== "none") favourable = m.good === "up" ? abs > 0 : abs < 0;
  return { abs, rel, points, favourable, isNew };
}

/** German rendering of a metric value. */
export function formatMetricValue(unit, value) {
  const v = finite(value);
  if (v === null) return "—";
  switch (unit) {
    case "eur":
      return eur(v, Math.abs(v) < 10 ? 2 : 0);
    case "rate":
      return ratio(v, 1);
    case "ratio":
      return num(v, 2);
    case "hours":
      return fmtHours(v);
    case "score":
      return `${num(v, 1)} / 5`;
    default:
      return num(v, 0);
  }
}

/** German rendering of a metric's change ("+12 %", "+3,4 Pp.", "neu"), or "". */
export function formatMetricDelta(m) {
  const d = metricDelta(m);
  if (!d) return "";
  if (d.points !== null) {
    const p = Math.round(d.points * 10) / 10;
    if (p === 0) return "±0 Pp.";
    return `${p > 0 ? "+" : ""}${num(p, 1)} Pp.`;
  }
  if (d.isNew) return "neu";
  if (d.rel === null) return "";
  const r = Math.round(d.rel * 100);
  if (r === 0) return "±0 %";
  return `${r > 0 ? "+" : ""}${num(r, 0)} %`;
}

/** True when a rate rests on fewer than MIN_RATE_BASE observations. */
export function isSmallSample(m) {
  if (!m || m.unit !== "rate") return false;
  const b = finite(m.base);
  return b !== null && b < MIN_RATE_BASE;
}

// ── Admin links ───────────────────────────────────────────────────────────────

/**
 * Where the operator acts on a finding. Keys are what the model may choose
 * (analytics-report-synthesis-core LINK_TARGETS); `kpi` targets carry the
 * report period so the KPI screen opens on the same window.
 */
export const ADMIN_LINKS = Object.freeze({
  kpi: { label: "KPIs", tab: "kpi", anchor: null },
  kpi_umsatz: { label: "KPIs · Umsatz", tab: "kpi", anchor: "umsatz-webhook" },
  kpi_beratung: { label: "KPIs · Beratung", tab: "kpi", anchor: "kern" },
  kpi_seitenkontext: { label: "KPIs · Seitenkontext", tab: "kpi", anchor: "seitenkontext" },
  kpi_anmeldung: { label: "KPIs · Anmelde-Popup", tab: "kpi", anchor: "anmelde-popup" },
  kpi_einwilligung: { label: "KPIs · Einwilligung", tab: "kpi", anchor: "consent" },
  kpi_capture: { label: "KPIs · E-Mail-Capture", tab: "kpi", anchor: "capture" },
  kpi_kampagnen: { label: "KPIs · Kampagnen", tab: "kpi", anchor: "kampagne" },
  kpi_kosten: { label: "KPIs · KI-Kosten", tab: "kpi", anchor: "ki-kosten" },
  kampagnen: { label: "Kampagnen", tab: "kampagne", params: {} },
  kampagne_neu: { label: "Neue Kampagne", tab: "kampagne", params: { edit: "new" } },
  kunden: { label: "Kunden", tab: "kunden", params: {} },
  kunden_abwanderung: { label: "Kunden · Abwanderung", tab: "kunden", params: { kview: "abwanderung" } },
  kunden_ohne_einwilligung: {
    label: "Kunden · Aktiv ohne Einwilligung",
    tab: "kunden",
    params: { kview: "aktiv_ohne_einwilligung" },
  },
  kunden_top: { label: "Kunden · Top", tab: "kunden", params: { kview: "top" } },
  kunden_neu: { label: "Kunden · Neu", tab: "kunden", params: { kview: "neu" } },
  eingang: { label: "Eingang", tab: "eingang", params: {} },
  wissen: { label: "Wissen", tab: "wissen", params: {} },
  gespraeche: { label: "Gespräche", tab: "gespraeche", params: {} },
  feedback: { label: "Feedback", tab: "feedback", params: {} },
  verbesserung: { label: "Verbesserung", tab: "verbesserung", params: {} },
  einstellungen: { label: "Einstellungen", tab: "einstellungen", params: {} },
});

/** All link keys incl. "none" (no screen fits). */
export const LINK_TARGETS = Object.freeze([...Object.keys(ADMIN_LINKS), "none"]);

/**
 * The admin URL of a link key for a report period, or null ("none", unknown).
 * @param {string} key
 * @param {{ from: string, to: string } | null} [range]
 * @returns {{ href: string, label: string } | null}
 */
export function adminLinkFor(key, range = null) {
  const def = /** @type {Record<string, any>} */ (ADMIN_LINKS)[key];
  if (!def) return null;
  const sp = new URLSearchParams();
  if (def.tab !== "eingang") sp.set("tab", def.tab);
  if (def.tab === "kpi" && range && range.from && range.to) {
    sp.set("kpiRange", "custom");
    sp.set("kpiFrom", range.from);
    sp.set("kpiTo", range.to);
  }
  for (const [k, v] of Object.entries(def.params ?? {})) sp.set(k, String(v));
  const query = sp.toString();
  const href = `/admin${query ? `?${query}` : ""}${def.anchor ? `#kpi-${def.anchor}` : ""}`;
  return { href, label: def.label };
}

// ── Privacy ───────────────────────────────────────────────────────────────────

/**
 * Mask what could identify a person in a free text before it reaches a model
 * prompt or a stored report: e-mail addresses, phone numbers, URLs with query
 * strings, IBANs, long digit runs (order / customer numbers) and Shopify
 * order names (#1234).
 * @param {unknown} text
 * @returns {string}
 */
export function scrubPii(text) {
  return String(text ?? "")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[E-Mail]")
    .replace(/https?:\/\/\S+/g, "[Link]")
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/g, "[IBAN]")
    .replace(/(?:\+|00)\d[\d\s/-]{7,}\d/g, "[Telefon]")
    .replace(/\b0\d{2,5}[\s/-]?\d{4,}\b/g, "[Telefon]")
    .replace(/#\d{3,}\b/g, "#[Nr.]")
    .replace(/\b\d{6,}\b/g, "[Nr.]");
}

// ── Raw-row helpers (used by the data layer, tested here) ─────────────────────

/**
 * Aggregate the period's mo_orders rows: realised orders and revenue by the
 * marker's source, by Mo code family (MS5- personal mail, MK- campaign) and by
 * campaign (an MK- code mapped through `codeToCampaign`, code → campaign id).
 * Unpaid rows are skipped — getMoAttributionKpis counts them separately.
 *
 * @param {Array<{ attribution_source?: string | null, financial_status?: string | null, total_price?: unknown, discount_codes?: string[] | null }>} rows
 * @param {Record<string, number | string | null>} [codeToCampaign] upper-cased code → campaign id
 */
export function summarizeMoOrderRows(rows, codeToCampaign = {}) {
  /** @type {Map<string, { orders: number, revenue: number }>} */
  const bySource = new Map();
  /** @type {Map<string, { orders: number, revenue: number }>} */
  const byCampaign = new Map();
  const ms5 = { orders: 0, revenue: 0 };
  const mk = { orders: 0, revenue: 0 };
  const add = (acc, amount) => {
    acc.orders += 1;
    acc.revenue = Math.round((acc.revenue + amount) * 100) / 100;
  };
  for (const r of rows ?? []) {
    if (!isRealisedFinancialStatus(r.financial_status)) continue;
    const amount = Math.max(0, finite(r.total_price) ?? 0);
    const source = String(r.attribution_source ?? "unknown");
    if (!bySource.has(source)) bySource.set(source, { orders: 0, revenue: 0 });
    add(bySource.get(source), amount);
    const codes = (r.discount_codes ?? []).map((c) => String(c).trim().toUpperCase());
    if (codes.some((c) => c.startsWith("MS5-"))) add(ms5, amount);
    const mkCodes = codes.filter((c) => c.startsWith("MK-"));
    if (mkCodes.length) {
      add(mk, amount);
      const campaign = mkCodes.map((c) => codeToCampaign[c]).find((v) => v !== undefined);
      const key = campaign == null ? "none" : String(campaign);
      if (!byCampaign.has(key)) byCampaign.set(key, { orders: 0, revenue: 0 });
      add(byCampaign.get(key), amount);
    }
  }
  return {
    bySource: [...bySource.entries()].map(([source, v]) => ({ source, ...v })),
    codeOrders: { ms5, mk },
    byCampaign: Object.fromEntries(byCampaign),
  };
}

// ── The builder ───────────────────────────────────────────────────────────────

const EMPTY = Object.freeze({});

function tierTotals(attr) {
  if (!attr) return { orders: null, revenue: null };
  const tiers = [attr.direct, attr.assisted, attr.influenced];
  return {
    orders: sum(tiers.map((t) => t?.orderCount)),
    revenue: sum(tiers.map((t) => t?.revenueAmount)),
  };
}

/** Rows of a [{ key, …cols }] list matched by key between two periods. */
function pairRows(cur, prev, keyOf) {
  const prevMap = new Map((prev ?? []).map((r) => [keyOf(r), r]));
  const keys = [...new Set([...(cur ?? []).map(keyOf), ...(prev ?? []).map(keyOf)])];
  return keys.map((k) => ({ key: k, cur: (cur ?? []).find((r) => keyOf(r) === k) ?? null, prev: prevMap.get(k) ?? null }));
}

function table(key, title, columns, rows, note) {
  const t = { key, title, columns, rows };
  if (note) t.note = note;
  return t;
}

function revenueSection(raw) {
  const c = raw.cur ?? EMPTY;
  const p = raw.prev ?? EMPTY;
  const ct = tierTotals(c.attribution);
  const pt = tierTotals(p.attribution);
  const unresolved = (a) => (a ? sum([a.unresolvedOrders?.unknownToken, a.unresolvedOrders?.outsideWindow]) : null);
  const metrics = [
    metric("revenue.total", "Mo-zugeordneter Umsatz (bezahlt)", "eur", ct.revenue, pt.revenue),
    metric("revenue.orders", "Bestellungen über Mo (bezahlt)", "count", ct.orders, pt.orders),
    metric("revenue.aov", "Ø Bestellwert über Mo", "eur", safeRate(ct.revenue, ct.orders), safeRate(pt.revenue, pt.orders)),
    metric("revenue.direct", "davon Direkt (Code oder Mo-Link)", "eur", c.attribution?.direct?.revenueAmount, p.attribution?.direct?.revenueAmount),
    metric("revenue.assisted", "davon Beraten & gekauft", "eur", c.attribution?.assisted?.revenueAmount, p.attribution?.assisted?.revenueAmount),
    metric("revenue.influenced", "davon Beraten, anderes gekauft", "eur", c.attribution?.influenced?.revenueAmount, p.attribution?.influenced?.revenueAmount),
    metric("revenue.ms5", "Über MS5-Codes (persönliche Mail)", "eur", c.codeOrders?.ms5?.revenue, p.codeOrders?.ms5?.revenue),
    metric("revenue.mk", "Über MK-Codes (Kampagnen)", "eur", c.codeOrders?.mk?.revenue, p.codeOrders?.mk?.revenue),
    metric("revenue.unrealised", "Markierte Bestellungen noch nicht bezahlt", "count", c.attribution?.unrealisedOrders, p.attribution?.unrealisedOrders, { good: "none" }),
    metric("revenue.unresolved", "Markiert, aber keiner Beratung zuzuordnen", "count", unresolved(c.attribution), unresolved(p.attribution), { good: "down" }),
  ];
  const shop = raw.shopify?.revenue;
  if (shop && shop.shopifyConfigured !== false) {
    metrics.push(
      metric("revenue.codesShopify", "Umsatz über Mo-Rabattcodes (Shopify-Prüfung)", "eur", shop.revenueAmount, null, {
        hint: shop.sampled ? "Stichprobe der 100 neuesten Codes" : undefined,
      })
    );
  }
  const tierRows = [
    ["direct", "Direkt"],
    ["assisted", "Beraten & gekauft"],
    ["influenced", "Beraten, anderes gekauft"],
  ].map(([k, label]) => ({
    key: k,
    label,
    values: { orders: finite(c.attribution?.[k]?.orderCount), revenue: finite(c.attribution?.[k]?.revenueAmount) },
    previous: { orders: finite(p.attribution?.[k]?.orderCount), revenue: finite(p.attribution?.[k]?.revenueAmount) },
  }));
  const sourceRows = pairRows(c.ordersBySource, p.ordersBySource, (r) => String(r.source)).map(({ key, cur, prev }) => ({
    key,
    label: ORDER_SOURCE_LABELS[key] ?? key,
    values: { orders: finite(cur?.orders) ?? 0, revenue: finite(cur?.revenue) ?? 0 },
    previous: { orders: finite(prev?.orders) ?? 0, revenue: finite(prev?.revenue) ?? 0 },
  }));
  sourceRows.sort((a, b) => (b.values.revenue ?? 0) - (a.values.revenue ?? 0));
  const cols = [
    { key: "orders", label: "Bestellungen", unit: "count" },
    { key: "revenue", label: "Umsatz", unit: "eur" },
  ];
  return {
    key: "revenue",
    title: "Umsatz über Mo",
    scope: "period",
    link: "kpi_umsatz",
    metrics,
    tables: [
      table("revenue.tiers", "Nach Zuordnungsstufe", cols, tierRows),
      table("revenue.sources", "Nach Quelle der Markierung", cols, sourceRows),
    ],
  };
}

function chatSection(raw) {
  const c = raw.cur ?? EMPTY;
  const p = raw.prev ?? EMPTY;
  const cc = c.core;
  const pc = p.core;
  const chats = (core) => finite(core?.totalChats);
  const enShare = (loc) => {
    const rows = loc?.chats ?? [];
    const total = sum(rows.map((r) => r.count));
    const en = rows.find((r) => r.locale === "en")?.count ?? 0;
    return safeRate(en, total);
  };
  const metrics = [
    metric("chat.reach", "Reichweite (Sitzungen mit Widget)", "count", cc?.sessionsWithTelemetry, pc?.sessionsWithTelemetry),
    metric("chat.opened", "Chat geöffnet (Sitzungen)", "count", cc?.openedSessions, pc?.openedSessions),
    metric("chat.wrote", "Geschrieben (Sitzungen)", "count", cc?.wroteSessions, pc?.wroteSessions),
    metric("chat.engagement", "Geöffnet → geschrieben", "rate", cc?.engagementRate, pc?.engagementRate, { base: cc?.openedSessions }),
    metric("chat.chats", "Gespräche", "count", chats(cc), chats(pc)),
    metric("chat.avgMessages", "Ø Nachrichten je Gespräch", "ratio", cc?.avgMessagesPerChat, pc?.avgMessagesPerChat, { good: "none" }),
    metric("chat.productClicks", "Produktklicks", "count", cc?.productCtaClicks, pc?.productCtaClicks),
    metric("chat.clicksPerChat", "Produktklicks je Gespräch", "ratio", cc?.productCtaRatePerChat, pc?.productCtaRatePerChat),
    metric("chat.cartClicks", "Warenkorb-Klicks", "count", cc?.addToCartClicks, pc?.addToCartClicks),
    metric("chat.cartPerChat", "Warenkorb-Klicks je Gespräch", "ratio", cc?.addToCartRatePerChat, pc?.addToCartRatePerChat),
    metric("chat.abandoned", "Abgebrochene Gespräche", "rate", cc?.abandonedRate, pc?.abandonedRate, { good: "down", base: chats(cc) }),
    metric("chat.recommended", "Gespräche mit Produktempfehlung", "count", c.reportKpis?.checkoutOffered, p.reportKpis?.checkoutOffered),
    metric("chat.pageContext", "Fragen auf Produktseiten (Sitzungen)", "count", c.pageContext?.sessions, p.pageContext?.sessions),
    metric(
      "chat.pageContextResolved",
      "Produkt der Seite erkannt",
      "rate",
      safeRate(c.pageContext?.resolved, c.pageContext?.sessions),
      safeRate(p.pageContext?.resolved, p.pageContext?.sessions),
      { base: c.pageContext?.sessions }
    ),
    metric("chat.englishShare", "Anteil englischer Gespräche", "rate", enShare(c.locales), enShare(p.locales), {
      good: "none",
      base: sum((c.locales?.chats ?? []).map((r) => r.count)),
    }),
  ];
  return { key: "chat", title: "Beratung im Chat", scope: "period", link: "kpi_beratung", metrics, tables: [] };
}

function signinSection(raw) {
  const c = raw.cur ?? EMPTY;
  const p = raw.prev ?? EMPTY;
  const lg = (x) => x?.loginGate;
  const acc = (x) => x?.account;
  const metrics = [
    metric("signin.popupShown", "Anmelde-Popup gezeigt (Sitzungen)", "count", lg(c)?.shown, lg(p)?.shown, { good: "none" }),
    metric("signin.popupClicked", "„Anmelden“ geklickt (Sitzungen)", "count", lg(c)?.clicked, lg(p)?.clicked),
    metric("signin.popupLinked", "Über das Popup im Chat angemeldet", "count", lg(c)?.linked, lg(p)?.linked),
    metric("signin.popupRate", "Popup → im Chat angemeldet", "rate", safeRate(lg(c)?.linked, lg(c)?.shown), safeRate(lg(p)?.linked, lg(p)?.shown), {
      base: lg(c)?.shown,
    }),
    metric("signin.linkedSignin", "Im Chat angemeldet über „Anmelden“ (Sitzungen)", "count", acc(c)?.linkedSessions?.signin, acc(p)?.linkedSessions?.signin),
    metric("signin.linkedShop", "Über Shop-Login angemeldet (Sitzungen)", "count", acc(c)?.linkedSessions?.shop, acc(p)?.linkedSessions?.shop),
    metric("signin.recognised", "Vom Shop erkannt (Sitzungen)", "count", acc(c)?.shopRecognition?.recognised, acc(p)?.shopRecognition?.recognised),
    metric(
      "signin.redeemRate",
      "Shop-Codes eingelöst",
      "rate",
      safeRate(acc(c)?.shopRecognition?.redeemed, acc(c)?.shopRecognition?.withCode),
      safeRate(acc(p)?.shopRecognition?.redeemed, acc(p)?.shopRecognition?.withCode),
      { base: acc(c)?.shopRecognition?.withCode }
    ),
    metric("signin.refused", "Abgelehnte Anmelde-Codes", "count", acc(c)?.refusedLinks, acc(p)?.refusedLinks, { good: "down" }),
    metric("signin.shopifySignins", "Shopify-Anmeldungen (inkl. still)", "count", acc(c)?.signins, acc(p)?.signins),
    metric("account.exports", "Datenexporte (Selbstauskunft)", "count", acc(c)?.exports, acc(p)?.exports, { good: "none" }),
    metric("account.erasures", "Selbst gelöschte Konten", "count", acc(c)?.erasures, acc(p)?.erasures, { good: "down" }),
    metric("account.contactForms", "Kontaktformulare", "count", acc(c)?.contactFormSubmissions, acc(p)?.contactFormSubmissions, { good: "none" }),
  ];
  return { key: "signin", title: "Anmeldung & Wiedererkennung", scope: "period", link: "kpi_anmeldung", metrics, tables: [] };
}

function consentSection(raw) {
  const c = raw.cur ?? EMPTY;
  const p = raw.prev ?? EMPTY;
  const way = (x, field) => {
    const w = x?.consentGate?.signinByWay;
    return w ? sum(["signin", "shop", "unknown"].map((k) => w[k]?.[field])) : null;
  };
  const cap = (x) => x?.capture;
  const metrics = [
    metric("consent.popupShown", "Einwilligungs-Popup gezeigt (Sitzungen)", "count", way(c, "shown"), way(p, "shown"), { good: "none" }),
    metric("consent.popupAccepted", "Einwilligungs-Popup akzeptiert (Sitzungen)", "count", way(c, "accepted"), way(p, "accepted")),
    metric("consent.popupRate", "Popup-Akzeptanz", "rate", safeRate(way(c, "accepted"), way(c, "shown")), safeRate(way(p, "accepted"), way(p, "shown")), {
      base: way(c, "shown"),
    }),
    metric("consent.popupOptIns", "Opt-ins nach Anmeldung (Server)", "count", way(c, "optedIn"), way(p, "optedIn")),
    metric("consent.newSubscribers", "Neue Einwilligungen (alle Wege)", "count", c.newSubscribers, p.newSubscribers),
    metric("capture.asked", "E-Mail-Zusammenfassung angeboten", "count", cap(c)?.askShown, cap(p)?.askShown, { good: "none" }),
    metric("capture.submitted", "Formular gesendet", "count", cap(c)?.submitted, cap(p)?.submitted),
    metric("capture.submitRate", "Angebot → Formular", "rate", cap(c)?.submitRate, cap(p)?.submitRate, { base: cap(c)?.askShown }),
    metric("capture.optedIn", "Marketing-Haken im Formular", "count", cap(c)?.marketingOptedIn, cap(p)?.marketingOptedIn),
    metric("capture.doiSent", "DOI-Mails verschickt", "count", cap(c)?.doiSent, cap(p)?.doiSent, { good: "none" }),
    metric("capture.confirmed", "DOI bestätigt (Formular)", "count", cap(c)?.confirmed, cap(p)?.confirmed),
    metric("capture.doiRate", "DOI-Quote (Formular)", "rate", cap(c)?.doiRate, cap(p)?.doiRate, { base: cap(c)?.doiSent }),
  ];
  const tables = [];
  const ways = c.consentGate?.signinByWay;
  if (ways) {
    tables.push(
      table(
        "consent.byWay",
        "Einwilligungs-Popup nach Anmeldeweg",
        [
          { key: "shown", label: "Angezeigt", unit: "count" },
          { key: "accepted", label: "Akzeptiert", unit: "count" },
          { key: "rate", label: "Akzeptanz", unit: "rate" },
          { key: "optedIn", label: "Opt-in (Server)", unit: "count" },
        ],
        ["signin", "shop", "unknown"]
          .filter((k) => (finite(ways[k]?.shown) ?? 0) > 0 || (finite(ways[k]?.accepted) ?? 0) > 0)
          .map((k) => ({
            key: k,
            label: SIGNIN_WAY_LABELS[k],
            values: {
              shown: finite(ways[k]?.shown),
              accepted: finite(ways[k]?.accepted),
              rate: safeRate(ways[k]?.accepted, ways[k]?.shown),
              optedIn: finite(ways[k]?.optedIn),
            },
            previous: {
              shown: finite(p.consentGate?.signinByWay?.[k]?.shown),
              accepted: finite(p.consentGate?.signinByWay?.[k]?.accepted),
              rate: safeRate(p.consentGate?.signinByWay?.[k]?.accepted, p.consentGate?.signinByWay?.[k]?.shown),
              optedIn: finite(p.consentGate?.signinByWay?.[k]?.optedIn),
            },
          }))
      )
    );
  }
  const variants = c.consentGate?.byVariant ?? [];
  if (variants.length > 0) {
    tables.push(
      table(
        "consent.byVariant",
        "Einwilligungs-Popup nach Variante und Platzierung",
        [
          { key: "shown", label: "Angezeigt", unit: "count" },
          { key: "rate", label: "Akzeptanz", unit: "rate" },
          { key: "optedIn", label: "Opt-ins", unit: "count" },
          { key: "doiRate", label: "DOI-Quote", unit: "rate" },
        ],
        variants.map((v) => ({
          key: `${v.variant}·${v.placement}`,
          label: `${v.variant} · ${v.placement}`,
          values: {
            shown: finite(v.shown),
            rate: safeRate(v.accepted, v.shown),
            optedIn: finite(v.optedIn),
            doiRate: safeRate(v.doiConfirmed, v.doiRequired),
          },
        })),
        "Nur der aktuelle Zeitraum; Varianten-Daten gibt es erst seit dem Widget vom 06.10.2026."
      )
    );
  }
  return { key: "consent", title: "Einwilligung & E-Mail", scope: "period", link: "kpi_einwilligung", metrics, tables };
}

function campaignSection(raw) {
  const c = raw.cur ?? EMPTY;
  const p = raw.prev ?? EMPTY;
  const tot = (rows, f) => sum((rows ?? []).map((r) => r[f]));
  const cs = c.campaigns;
  const ps = p.campaigns;
  const ratingOf = (ratings) => {
    const rows = (ratings ?? []).filter((r) => r.kind === "campaign");
    const n = sum(rows.map((r) => r.count));
    const weighted = sum(rows.map((r) => (finite(r.avg) ?? 0) * (finite(r.count) ?? 0)));
    return { n, avg: safeRate(weighted, n) };
  };
  const cr = ratingOf(c.ratings);
  const pr = ratingOf(p.ratings);
  const metrics = [
    metric("campaigns.sent", "Kampagnen-Mails gesendet", "count", tot(cs, "sent"), tot(ps, "sent"), { good: "none" }),
    metric("campaigns.clicked", "Geklickt (Button oder Set)", "count", tot(cs, "clicked"), tot(ps, "clicked")),
    metric("campaigns.clickRate", "Klickrate (getrackte Mails)", "rate", safeRate(tot(cs, "clicked"), tot(cs, "tracked")), safeRate(tot(ps, "clicked"), tot(ps, "tracked")), {
      base: tot(cs, "tracked"),
    }),
    metric("campaigns.chatStarted", "Chat aus der Mail gestartet", "count", tot(cs, "chatStarted"), tot(ps, "chatStarted")),
    metric("campaigns.orders", "Bestellungen mit MK-Code", "count", tot(cs, "moOrders"), tot(ps, "moOrders")),
    metric("campaigns.revenue", "Umsatz mit MK-Code (bezahlt)", "eur", tot(cs, "moRevenue"), tot(ps, "moRevenue")),
    metric("campaigns.unsubscribed", "Abmeldungen nach Kampagnen-Mail", "count", tot(cs, "unsubscribed"), tot(ps, "unsubscribed"), { good: "down" }),
    metric("campaigns.unsubscribeRate", "Abmeldequote", "rate", safeRate(tot(cs, "unsubscribed"), tot(cs, "sent")), safeRate(tot(ps, "unsubscribed"), tot(ps, "sent")), {
      good: "down",
      base: tot(cs, "sent"),
    }),
    metric("campaigns.bounced", "Unzustellbar (Bounce)", "count", tot(cs, "bounced"), tot(ps, "bounced"), { good: "down" }),
    metric("campaigns.complained", "Spam-Beschwerden", "count", tot(cs, "complained"), tot(ps, "complained"), { good: "down" }),
    metric("campaigns.rating", "Ø Bewertung der Kampagnen-Mails", "score", cr.avg, pr.avg, { base: cr.n, hint: cr.n ? `${num(cr.n)} Bewertungen` : undefined }),
    metric("letters.sent", "Briefe versendet (Pingen)", "count", c.letters?.sent, p.letters?.sent, { good: "none" }),
    metric("letters.cost", "Porto der Briefe", "eur", c.letters ? (finite(c.letters.costCents) ?? 0) / 100 : null, p.letters ? (finite(p.letters.costCents) ?? 0) / 100 : null, {
      good: "none",
    }),
  ];
  const shop = raw.shopify?.campaign;
  if (shop && shop.shopifyConfigured !== false) {
    metrics.push(
      metric("campaigns.redeemedShopify", "MK-Codes eingelöst (Shopify-Prüfung)", "count", shop.converted, null, {
        hint: shop.sampled ? "Stichprobe der 100 neuesten Codes" : undefined,
      })
    );
  }
  const rows = pairRows(cs, ps, (r) => String(r.campaignId ?? r.name)).map(({ key, cur, prev }) => ({
    key,
    label: String(cur?.name ?? prev?.name ?? key),
    values: {
      sent: finite(cur?.sent) ?? 0,
      clickRate: safeRate(cur?.clicked, cur?.tracked),
      chatStarted: finite(cur?.chatStarted) ?? 0,
      orders: finite(cur?.moOrders) ?? 0,
      revenue: finite(cur?.moRevenue) ?? 0,
      unsubscribed: finite(cur?.unsubscribed) ?? 0,
      letters: finite(cur?.letters) ?? 0,
    },
    previous: {
      sent: finite(prev?.sent) ?? 0,
      clickRate: safeRate(prev?.clicked, prev?.tracked),
      chatStarted: finite(prev?.chatStarted) ?? 0,
      orders: finite(prev?.moOrders) ?? 0,
      revenue: finite(prev?.moRevenue) ?? 0,
      unsubscribed: finite(prev?.unsubscribed) ?? 0,
      letters: finite(prev?.letters) ?? 0,
    },
  }));
  rows.sort((a, b) => (b.values.sent ?? 0) - (a.values.sent ?? 0) || (b.previous.sent ?? 0) - (a.previous.sent ?? 0));
  return {
    key: "campaigns",
    title: "Kampagnen & Briefe",
    scope: "period",
    link: "kampagnen",
    metrics,
    tables: [
      table(
        "campaigns.byCampaign",
        "Kampagnen im Vergleich",
        [
          { key: "sent", label: "Gesendet", unit: "count" },
          { key: "clickRate", label: "Klickrate", unit: "rate" },
          { key: "chatStarted", label: "Chat gestartet", unit: "count" },
          { key: "orders", label: "Bestellungen", unit: "count" },
          { key: "revenue", label: "Umsatz", unit: "eur" },
          { key: "unsubscribed", label: "Abgemeldet", unit: "count" },
          { key: "letters", label: "Briefe", unit: "count" },
        ],
        rows.slice(0, 15),
        "Bestellungen und Umsatz: bezahlte Bestellungen im Zeitraum, die einen MK-Code dieser Kampagne eingelöst haben (Bestell-Webhook)."
      ),
    ],
  };
}

function inboxSection(raw) {
  const c = raw.cur?.inbox;
  const p = raw.prev?.inbox;
  const kindSum = (x, f) => (x ? sum((x.kinds ?? []).map((k) => k[f])) : null);
  const metrics = [
    metric("inbox.created", "Neue Hinweise", "count", c?.totalCreated, p?.totalCreated, { good: "none" }),
    metric("inbox.acted", "Gehandelt", "count", c?.totalActed, p?.totalActed),
    metric("inbox.actedShare", "Anteil gehandelt", "rate", safeRate(c?.totalActed, c?.totalCreated), safeRate(p?.totalActed, p?.totalCreated), {
      base: c?.totalCreated,
    }),
    metric("inbox.dismissed", "Verworfen", "count", kindSum(c, "dismissed"), kindSum(p, "dismissed"), { good: "none" }),
    metric("inbox.suggestions", "Mit KI-Vorschlag", "count", c?.suggestionsMade, p?.suggestionsMade, { good: "none" }),
    metric("inbox.ordersAfterActed", "Bestellung binnen 14 Tagen nach Handeln", "count", kindSum(c, "ordersAfterActed"), kindSum(p, "ordersAfterActed")),
    metric(
      "inbox.revenueAfterActed",
      "Umsatz binnen 14 Tagen nach Handeln",
      "eur",
      c ? (kindSum(c, "revenueAfterActedCents") ?? 0) / 100 : null,
      p ? (kindSum(p, "revenueAfterActedCents") ?? 0) / 100 : null
    ),
  ];
  const rows = (c?.kinds ?? []).map((k) => ({
    key: k.kind,
    label: INBOX_KIND_LABELS[k.kind] ?? k.kind,
    values: {
      created: finite(k.created),
      acted: finite(k.acted),
      dismissed: finite(k.dismissed),
      ordersAfterActed: finite(k.ordersAfterActed),
      revenue: (finite(k.revenueAfterActedCents) ?? 0) / 100,
    },
  }));
  return {
    key: "inbox",
    title: "Eingang",
    scope: "period",
    link: "eingang",
    metrics,
    tables: rows.length
      ? [
          table(
            "inbox.byKind",
            "Nach Art des Hinweises",
            [
              { key: "created", label: "Entstanden", unit: "count" },
              { key: "acted", label: "Gehandelt", unit: "count" },
              { key: "dismissed", label: "Verworfen", unit: "count" },
              { key: "ordersAfterActed", label: "Bestellung danach", unit: "count" },
              { key: "revenue", label: "Umsatz danach", unit: "eur" },
            ],
            rows
          ),
        ]
      : [],
  };
}

/** Mo-attributed revenue ÷ the ledger's shop revenue of a period (unguarded). */
function moShareRaw(x) {
  const mo = tierTotals(x?.attribution).revenue;
  const shop = x?.ledger ? (finite(x.ledger.revenueCents) ?? 0) / 100 : null;
  return safeRate(mo, shop);
}

function customerSection(raw) {
  const c = raw.cur ?? EMPTY;
  const p = raw.prev ?? EMPTY;
  const base = raw.lifetime?.customerBase;
  const effect = raw.lifetime?.moEffect;
  const ledger = (x) => x?.ledger;
  // Mo's share of the shop revenue. Above 100 % the ledger is incomplete (the
  // customer sync was off or behind) — then the share is unknown, not 140 %.
  const moShare = (x) => {
    const r = moShareRaw(x);
    return r !== null && r > 1 ? null : r;
  };
  const metrics = [
    metric("ledger.orders", "Shop-Bestellungen (alle Kanäle)", "count", ledger(c)?.orders, ledger(p)?.orders),
    metric("ledger.revenue", "Shop-Umsatz (Bestell-Ledger, netto Erstattungen)", "eur", ledger(c) ? (finite(ledger(c).revenueCents) ?? 0) / 100 : null, ledger(p) ? (finite(ledger(p).revenueCents) ?? 0) / 100 : null),
    metric("ledger.buyers", "Käufer:innen", "count", ledger(c)?.buyers, ledger(p)?.buyers),
    metric("ledger.newBuyers", "Erstkäufer:innen", "count", ledger(c)?.newBuyers, ledger(p)?.newBuyers),
    metric("ledger.returningBuyers", "Wiederkäufer:innen", "count", ledger(c)?.returningBuyers, ledger(p)?.returningBuyers),
    metric("ledger.repeatShare", "Anteil Wiederkäufer:innen", "rate", safeRate(ledger(c)?.returningBuyers, ledger(c)?.buyers), safeRate(ledger(p)?.returningBuyers, ledger(p)?.buyers), {
      base: ledger(c)?.buyers,
    }),
    metric("ledger.moShare", "Anteil Mo am Shop-Umsatz", "rate", moShare(c), moShare(p), {
      base: ledger(c)?.orders,
      hint: "Mo-zugeordneter Umsatz ÷ Shop-Umsatz im Ledger",
    }),
    metric("customers.total", "Kund:innen gesamt (Stand heute)", "count", base?.total, null, { good: "none" }),
    metric("customers.shopify", "davon Shopify-Kund:innen", "count", base?.shopifyCustomers, null, { good: "none" }),
    metric("customers.withMo", "Mit Mo gesprochen (Stand heute)", "count", base?.withMo, null),
    metric("customers.subscribed", "Mit Einwilligung (Stand heute)", "count", base?.consent?.subscribed ?? base?.subscribed, null),
    metric("customers.subscribedShare", "Anteil mit Einwilligung", "rate", safeRate(base?.consent?.subscribed ?? base?.subscribed, base?.total), null, {
      base: base?.total,
    }),
    metric("customers.churnHigh", "Abwanderung hoch (Stand heute)", "count", base?.churnHigh, null, { good: "down" }),
  ];
  if (effect) {
    metrics.push(
      metric("moEffect.repurchaseMo", "Wiederkaufquote mit Mo", "rate", effect.mo?.repurchaseRate, null, { base: effect.mo?.n }),
      metric("moEffect.repurchaseComparable", "Wiederkaufquote ohne Mo (vergleichbar)", "rate", effect.withoutMoMatched?.repurchaseRate ?? effect.withoutMo?.repurchaseRate, null, {
        good: "none",
        base: effect.withoutMo?.n,
      }),
      metric("moEffect.aovMo", "Ø Bestellwert mit Mo", "eur", effect.mo?.aovCents != null ? effect.mo.aovCents / 100 : null, null),
      metric(
        "moEffect.aovComparable",
        "Ø Bestellwert ohne Mo (vergleichbar)",
        "eur",
        (effect.withoutMoMatched?.aovCents ?? effect.withoutMo?.aovCents) != null ? (effect.withoutMoMatched?.aovCents ?? effect.withoutMo?.aovCents) / 100 : null,
        null,
        { good: "none" }
      ),
      metric("moEffect.wonByMo", "Über Mo gewonnen (erster Chat vor erstem Kauf)", "count", raw.lifetime?.wonByMo?.n, null),
      metric("moEffect.wonByMoRevenue", "Umsatz der über Mo Gewonnenen", "eur", raw.lifetime?.wonByMo ? (finite(raw.lifetime.wonByMo.revenueCents) ?? 0) / 100 : null, null)
    );
  }
  const tables = [];
  if (base?.bySegment?.length) {
    tables.push(
      table(
        "customers.segments",
        "Lebenszyklus (Stand heute)",
        [{ key: "n", label: "Kund:innen", unit: "count" }],
        base.bySegment.map((r) => ({ key: r.key, label: SEGMENT_LABELS[r.key] ?? r.key, values: { n: finite(r.n) } }))
      )
    );
  }
  if (base?.byValueTier?.length) {
    tables.push(
      table(
        "customers.valueTiers",
        "Wertstufe (Stand heute)",
        [{ key: "n", label: "Kund:innen", unit: "count" }],
        base.byValueTier.map((r) => ({ key: r.key, label: VALUE_TIER_LABELS[r.key] ?? r.key, values: { n: finite(r.n) } }))
      )
    );
  }
  const sources = raw.lifetime?.subscribersBySource ?? [];
  if (sources.length) {
    const grouped = new Map();
    for (const s of sources) {
      const g = consentSourceGroup(s.source);
      grouped.set(g, (grouped.get(g) ?? 0) + (finite(s.n) ?? 0));
    }
    tables.push(
      table(
        "customers.subscriberSources",
        "Abonnent:innen nach Herkunft der Einwilligung",
        [{ key: "n", label: "Abonnent:innen", unit: "count" }],
        [...grouped.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, label: CONSENT_SOURCE_LABELS[k] ?? k, values: { n } }))
      )
    );
  }
  if (effect?.tiers?.length) {
    tables.push(
      table(
        "moEffect.byTier",
        "Mo-Effekt nach Wertstufe (Wiederkaufquote)",
        [
          { key: "moN", label: "Mit Mo (n)", unit: "count" },
          { key: "mo", label: "Mit Mo", unit: "rate" },
          { key: "otherN", label: "Ohne Mo (n)", unit: "count" },
          { key: "other", label: "Ohne Mo", unit: "rate" },
        ],
        effect.tiers.map((t) => ({
          key: t.tier,
          label: VALUE_TIER_LABELS[t.tier] ?? t.tier,
          values: { moN: finite(t.mo?.n), mo: finite(t.mo?.repurchaseRate), otherN: finite(t.withoutMo?.n), other: finite(t.withoutMo?.repurchaseRate) },
        }))
      )
    );
  }
  return { key: "customers", title: "Kund:innen & Wiederkauf", scope: "period", link: "kunden", metrics, tables };
}

function qualitySection(raw) {
  const c = raw.cur ?? EMPTY;
  const p = raw.prev ?? EMPTY;
  const qShare = (x, key) => {
    const rows = x?.quality?.qualities ?? [];
    const total = sum(rows.map((r) => r.count));
    const hit = rows.find((r) => r.quality === key)?.count ?? 0;
    return safeRate(hit, total);
  };
  const analyzed = (x) => finite(x?.quality?.analyzedCount);
  const ratingAll = (x) => {
    const rows = x?.ratings ?? [];
    const n = sum(rows.map((r) => r.count));
    const weighted = sum(rows.map((r) => (finite(r.avg) ?? 0) * (finite(r.count) ?? 0)));
    return { n, avg: safeRate(weighted, n) };
  };
  const cr = ratingAll(c);
  const pr = ratingAll(p);
  const os = (x) => x?.orderStatus;
  const osOk = (x) => os(x)?.byOutcome?.find((r) => r.outcome === "ok")?.count ?? (os(x) ? 0 : null);
  const metrics = [
    metric("quality.coverage", "Analyse-Abdeckung", "rate", safeRate(c.quality?.analyzedCount, c.quality?.total), safeRate(p.quality?.analyzedCount, p.quality?.total), {
      base: c.quality?.total,
    }),
    metric("quality.handledWell", "Gut gelöst", "rate", qShare(c, "handled_well"), qShare(p, "handled_well"), { base: analyzed(c) }),
    metric("quality.unmetNeed", "Offener Bedarf", "rate", qShare(c, "unmet_need"), qShare(p, "unmet_need"), { good: "down", base: analyzed(c) }),
    metric("quality.droppedOff", "Abgesprungen", "rate", qShare(c, "dropped_off"), qShare(p, "dropped_off"), { good: "down", base: analyzed(c) }),
    metric("quality.noReply", "Gespräche ohne Antwort (Fehler-Proxy)", "count", c.reportKpis?.withError, p.reportKpis?.withError, { good: "down" }),
    metric("knowledge.gaps", "Wissenslücken gefunden", "count", c.qa?.createdInWindow, p.qa?.createdInWindow, { good: "none" }),
    metric("knowledge.published", "Antworten veröffentlicht", "count", c.qa?.publishedInWindow, p.qa?.publishedInWindow),
    metric("knowledge.hoursToAnswer", "Median bis zur Antwort", "hours", c.qa?.medianHoursToAnswer, p.qa?.medianHoursToAnswer, { good: "down" }),
    metric("knowledge.open", "Offene Wissensfragen (Stand heute)", "count", c.qa?.queue?.open, null, { good: "down" }),
    metric("knowledge.scanBacklog", "Noch nicht auf Lücken geprüfte Gespräche", "count", c.qa?.scanBacklog, null, { good: "down" }),
    metric("feedback.total", "Feedback aus dem Widget", "count", c.feedback?.total, p.feedback?.total, { good: "none" }),
    metric("feedback.rating", "Ø E-Mail-Bewertung (alle Mails)", "score", cr.avg, pr.avg, { base: cr.n, hint: cr.n ? `${num(cr.n)} Bewertungen` : undefined }),
    metric("orderStatus.lookups", "Bestellstatus-Abfragen im Chat", "count", os(c)?.lookups, os(p)?.lookups, { good: "none" }),
    metric("orderStatus.answered", "Bestellstatus beantwortet", "rate", safeRate(osOk(c), os(c)?.lookups), safeRate(osOk(p), os(p)?.lookups), {
      base: os(c)?.lookups,
    }),
  ];
  const tables = [];
  const qualities = c.quality?.qualities ?? [];
  if (qualities.length) {
    tables.push(
      table(
        "quality.distribution",
        "Qualitätssignale (analysierte Gespräche)",
        [{ key: "n", label: "Gespräche", unit: "count" }],
        qualities.map((q) => ({
          key: q.quality,
          label: QUALITY_KEYS[q.quality] ?? q.label ?? q.quality,
          values: { n: finite(q.count) },
          previous: { n: finite((p.quality?.qualities ?? []).find((x) => x.quality === q.quality)?.count) ?? 0 },
        }))
      )
    );
  }
  const categories = c.quality?.categories ?? [];
  if (categories.length) {
    tables.push(
      table(
        "quality.categories",
        "Themen (analysierte Gespräche)",
        [{ key: "n", label: "Gespräche", unit: "count" }],
        categories.slice(0, 8).map((q) => ({
          key: q.category,
          label: q.label ?? q.category,
          values: { n: finite(q.count) },
          previous: { n: finite((p.quality?.categories ?? []).find((x) => x.category === q.category)?.count) ?? 0 },
        }))
      )
    );
  }
  const ratings = c.ratings ?? [];
  if (ratings.length) {
    tables.push(
      table(
        "feedback.ratings",
        "E-Mail-Bewertungen nach Mail-Art",
        [
          { key: "count", label: "Bewertungen", unit: "count" },
          { key: "avg", label: "Ø (1–5)", unit: "score" },
        ],
        ratings.map((r) => ({ key: r.kind, label: r.kind, values: { count: finite(r.count), avg: finite(r.avg) } }))
      )
    );
  }
  return { key: "quality", title: "Qualität, Wissen & Feedback", scope: "period", link: "gespraeche", metrics, tables };
}

function costSection(raw) {
  const c = raw.cur?.aiCost;
  const p = raw.prev?.aiCost;
  const moRev = tierTotals(raw.cur?.attribution).revenue;
  const moRevPrev = tierTotals(raw.prev?.attribution).revenue;
  const metrics = [
    metric("costs.total", "KI-Kosten gesamt", "eur", c?.totalSpendEur, p?.totalSpendEur, { good: "down" }),
    metric("costs.chat", "davon Chat (Beratung)", "eur", c?.chatSpendEur, p?.chatSpendEur, { good: "none" }),
    metric("costs.admin", "davon Admin & Marketing", "eur", c?.adminSpendEur, p?.adminSpendEur, { good: "none" }),
    metric("costs.perConsultation", "Ø KI-Kosten je Beratung", "eur", c?.avgCostPerConsultationEur, p?.avgCostPerConsultationEur, { good: "down" }),
    metric("costs.cacheHitRate", "Prompt-Cache-Trefferquote (Chat)", "rate", c?.cache?.hitRate, p?.cache?.hitRate, { base: null }),
    metric("costs.cacheSaved", "Ersparnis durch Prompt-Cache", "eur", c?.cache?.savedEur, p?.cache?.savedEur),
    metric("costs.roi", "Mo-Umsatz je 1 € KI-Kosten", "eur", safeRate(moRev, c?.totalSpendEur), safeRate(moRevPrev, p?.totalSpendEur), {
      hint: "Mo-zugeordneter Umsatz ÷ KI-Kosten (alle Aufrufe)",
    }),
  ];
  const rows = pairRows(c?.perCallSite, p?.perCallSite, (r) => String(r.callSite))
    .map(({ key, cur, prev }) => ({
      key,
      label: AI_CALL_SITE_LABELS[key] ?? key,
      values: { eur: finite(cur?.spendEur) ?? 0 },
      previous: { eur: finite(prev?.spendEur) ?? 0 },
    }))
    .sort((a, b) => (b.values.eur ?? 0) - (a.values.eur ?? 0))
    .slice(0, 12);
  return {
    key: "costs",
    title: "KI-Kosten & Rendite",
    scope: "period",
    link: "kpi_kosten",
    metrics,
    tables: rows.length ? [table("costs.byCallSite", "Nach Einsatzort", [{ key: "eur", label: "Kosten", unit: "eur" }], rows)] : [],
  };
}

// ── Funnels ───────────────────────────────────────────────────────────────────

function step(label, value, previous) {
  return { label, value: finite(value), previous: finite(previous) };
}

function buildFunnels(raw) {
  const c = raw.cur ?? EMPTY;
  const p = raw.prev ?? EMPTY;
  const way = (x, f) => {
    const w = x?.consentGate?.signinByWay;
    return w ? sum(["signin", "shop", "unknown"].map((k) => w[k]?.[f])) : null;
  };
  const tot = (rows, f) => sum((rows ?? []).map((r) => r[f]));
  const funnels = [
    {
      key: "chat",
      title: "Chat (Sitzungen)",
      link: "kpi_beratung",
      steps: [
        step("Widget gesehen", c.core?.sessionsWithTelemetry, p.core?.sessionsWithTelemetry),
        step("Chat geöffnet", c.core?.openedSessions, p.core?.openedSessions),
        step("Geschrieben", c.core?.wroteSessions, p.core?.wroteSessions),
      ],
    },
    {
      key: "signin",
      title: "Anmelde-Popup (Sitzungen)",
      link: "kpi_anmeldung",
      steps: [
        step("Angezeigt", c.loginGate?.shown, p.loginGate?.shown),
        step("„Anmelden“ geklickt", c.loginGate?.clicked, p.loginGate?.clicked),
        step("Bei Shopify angemeldet", c.loginGate?.signedIn, p.loginGate?.signedIn),
        step("Im Chat angemeldet", c.loginGate?.linked, p.loginGate?.linked),
      ],
    },
    {
      key: "consent",
      title: "Einwilligung nach Anmeldung (Sitzungen)",
      link: "kpi_einwilligung",
      steps: [
        step("Popup angezeigt", way(c, "shown"), way(p, "shown")),
        step("Akzeptiert", way(c, "accepted"), way(p, "accepted")),
        step("Opt-in beim Server", way(c, "optedIn"), way(p, "optedIn")),
      ],
    },
    {
      key: "capture",
      title: "E-Mail-Formular (Ereignisse)",
      link: "kpi_capture",
      steps: [
        step("Angeboten", c.capture?.askShown, p.capture?.askShown),
        step("Formular gesendet", c.capture?.submitted, p.capture?.submitted),
        step("Marketing-Haken", c.capture?.marketingOptedIn, p.capture?.marketingOptedIn),
        step("DOI bestätigt", c.capture?.confirmed, p.capture?.confirmed),
      ],
    },
    {
      key: "campaign",
      title: "Kampagnen-Mails",
      link: "kampagnen",
      steps: [
        step("Gesendet", tot(c.campaigns, "sent"), tot(p.campaigns, "sent")),
        step("Geklickt", tot(c.campaigns, "clicked"), tot(p.campaigns, "clicked")),
        step("Chat gestartet", tot(c.campaigns, "chatStarted"), tot(p.campaigns, "chatStarted")),
        step("Bestellt (MK-Code)", tot(c.campaigns, "moOrders"), tot(p.campaigns, "moOrders")),
      ],
    },
  ];
  return funnels.filter((f) => f.steps.some((s) => (s.value ?? 0) > 0 || (s.previous ?? 0) > 0));
}

// ── Switches + caveats ────────────────────────────────────────────────────────

const SWITCH_DEFS = Object.freeze([
  ["shopifyConfigured", "Shopify verbunden", null],
  ["customerSync", "Shopify-Kundenabgleich", "SHOPIFY_CUSTOMER_SYNC_ENABLED"],
  ["consentWriteback", "Einwilligung an Shopify zurückschreiben", "SHOPIFY_CONSENT_WRITEBACK"],
  ["campaignSendsApproved", "Kampagnen-Versand freigegeben", "CAMPAIGN_SENDS_APPROVED"],
  ["campaignRelease", "Geplanter Kampagnen-Versand", null],
  ["physicalMailApproved", "Briefversand freigegeben", "PHYSICAL_MAIL_SENDS_APPROVED"],
  ["appProxySignin", "Anmeldung über Shop-Login (App Proxy)", "APP_PROXY_SIGNIN_ENABLED"],
  ["attributionSessionAnchor", "Zuordnungsfenster ab letzter Beratung", "MO_ATTRIBUTION_SESSION_ANCHOR"],
  ["pageContext", "Seitenkontext im Chat", "CHAT_PAGE_CONTEXT_ENABLED"],
  ["pageContextHoldoutPct", "Kontrollgruppe Seitenkontext (%)", "CHAT_PAGE_CONTEXT_HOLDOUT_PCT"],
  ["chatOrderStatus", "Bestellstatus im Chat", "CHAT_ORDER_STATUS_ENABLED"],
  ["emailConfigured", "E-Mail-Versand konfiguriert", null],
  ["anthropicConfigured", "KI (Anthropic) konfiguriert", null],
]);

/** The switches in force (values only, no secrets) as display rows. */
export function describeSwitches(switches) {
  const s = switches ?? {};
  return SWITCH_DEFS.filter(([key]) => key in s).map(([key, label, env]) => {
    const value = s[key];
    return { key, label, env, value: typeof value === "number" ? value : Boolean(value) };
  });
}

/**
 * The deterministic data-quality caveats of a snapshot: release dates between
 * the two periods, section notes, missing data, small samples, coverage, the
 * switches that change what a number means, and the standing honesty rules.
 */
function buildCaveats(raw, sections) {
  /** @type {Array<{ level: "info" | "warning", title: string, detail: string, sections?: string[] }>} */
  const out = [];
  for (const r of raw.releases ?? []) {
    out.push({ level: "info", title: `${germanDate(r.date)} · ${r.title}`, detail: r.detail });
  }
  for (const s of sections) {
    for (const n of s.notes ?? []) out.push({ level: "warning", title: s.title, detail: n, sections: [s.key] });
    if ((s.previousNotes ?? []).length > 0) {
      out.push({
        level: "warning",
        title: `${s.title}: Vorperiode nur eingeschränkt vergleichbar`,
        detail: s.previousNotes.join(" "),
        sections: [s.key],
      });
    }
  }
  const missing = [];
  const c = raw.cur ?? EMPTY;
  if (!c.attribution) missing.push("Umsatz über Mo");
  if (!c.core) missing.push("Chat-Kennzahlen");
  if (!c.aiCost) missing.push("KI-Kosten");
  if (!raw.lifetime?.customerBase) missing.push("Kundenbasis");
  if (!c.ledger) missing.push("Bestell-Ledger");
  if (missing.length) {
    out.push({
      level: "warning",
      title: "Fehlende Daten",
      detail: `Keine Daten für: ${missing.join(", ")} (Datenbank nicht erreichbar oder Abschnitt nicht eingerichtet).`,
    });
  }
  const small = [];
  for (const s of sections) for (const m of s.metrics) if (isSmallSample(m)) small.push(`${m.label} (n = ${num(m.base)})`);
  if (small.length) {
    out.push({
      level: "warning",
      title: "Kleine Stichproben",
      detail: `Unter ${MIN_RATE_BASE} Fällen — Quoten schwanken stark und sind kein Trend: ${small.join("; ")}.`,
    });
  }
  const coverage = safeRate(c.quality?.analyzedCount, c.quality?.total);
  if (coverage !== null && coverage < MIN_ANALYSIS_COVERAGE) {
    out.push({
      level: "warning",
      title: "Geringe Analyse-Abdeckung",
      detail: `Nur ${ratio(coverage, 0)} der Gespräche sind analysiert — Qualitätssignale und Themen sind nicht repräsentativ.`,
      sections: ["quality"],
    });
  }
  const share = moShareRaw(c);
  if (share !== null && share > 1) {
    out.push({
      level: "warning",
      title: "Bestell-Ledger unvollständig",
      detail: `Der Bestell-Ledger enthält weniger Umsatz als Mo zugeordnet ist (${ratio(share, 0)}) — „Anteil Mo am Shop-Umsatz“ ist deshalb nicht berechnet, Shop-Umsatz und Wiederkauf sind Untergrenzen.`,
      sections: ["customers"],
    });
  }
  const sw = raw.switches ?? {};
  if (sw.customerSync === false) {
    out.push({
      level: "warning",
      title: "Shopify-Kundenabgleich aus",
      detail: "Bestell-Ledger, Lebenszyklus und Wiederkauf enthalten nur, was ohne Abgleich ankam — Shop-Umsatz und Wiederkauf sind dann unvollständig.",
      sections: ["customers"],
    });
  }
  if (sw.attributionSessionAnchor === false) {
    out.push({
      level: "info",
      title: "Zuordnungsfenster ab Erstellung der Markierung",
      detail: "MO_ATTRIBUTION_SESSION_ANCHOR ist aus: Widget-Markierungen zählen 30 Tage ab ihrer Erstellung, nicht ab der letzten Beratung.",
      sections: ["revenue"],
    });
  }
  if (sw.pageContext && !(Number(sw.pageContextHoldoutPct) > 0)) {
    out.push({
      level: "info",
      title: "Seitenkontext ohne Kontrollgruppe",
      detail: "Der Seitenkontext läuft ohne Kontrollgruppe — seine Wirkung auf Klicks und Käufe ist nicht messbar, nur die Abdeckung.",
      sections: ["chat"],
    });
  }
  if (raw.shopify && (raw.shopify.revenue?.sampled || raw.shopify.campaign?.sampled)) {
    out.push({
      level: "info",
      title: "Shopify-Prüfung als Stichprobe",
      detail: "Die Shopify-Prüfung der Rabattcodes umfasst die 100 neuesten Codes; nicht beantwortete Codes zählen als unbekannt, nicht als 0.",
    });
  }
  out.push(
    {
      level: "info",
      title: "Öffnungen werden nicht gemessen",
      detail: "Kampagnen-Mails haben bewusst kein Tracking-Pixel — gemessen werden Klicks, Chat-Starts, Abmeldungen und eingelöste Codes.",
      sections: ["campaigns"],
    },
    {
      level: "info",
      title: "Kundenbasis und Mo-Effekt sind Gesamtwerte",
      detail: "Kundenbasis, Lebenszyklus und Mo-Effekt zeigen den Stand heute (ohne Vorperiode). Der Mo-Effekt ist eine Korrelation, kein Beweis: wer chattet, ist oft ohnehin interessierter.",
      sections: ["customers"],
    },
    {
      level: "info",
      title: "Nur markierte Bestellungen zählen für Mo",
      detail: "„Umsatz über Mo“ kennt nur Bestellungen mit Mo-Markierung oder Mo-Code; Käufe nach einer Beratung auf einem anderen Gerät bleiben unsichtbar — eine Untergrenze.",
      sections: ["revenue"],
    }
  );
  return out;
}

/**
 * Release-note keys (kpi-releases.mjs releaseNotesFor) per snapshot section.
 * The data layer resolves them for both periods and passes the strings in
 * `raw.releaseNotes[sectionKey] = { current: string[], previous: string[] }`.
 */
export const SECTION_RELEASE_NOTES = Object.freeze({
  revenue: ["attribution"],
  signin: ["anmelde-popup", "konto"],
  consent: ["consent", "capture"],
  campaigns: ["campaign"],
});

/**
 * Shape the raw getter results into the snapshot. Pure and total: any part
 * may be null (no database, a failed getter) and renders as null values plus
 * a "Fehlende Daten" caveat — never a throw.
 *
 * @param {Record<string, any>} raw
 */
export function buildBusinessSnapshot(raw) {
  const r = raw ?? {};
  const period = r.period ?? null;
  const previous = r.previous ?? (period ? previousPeriod(period) : null);
  const sections = [
    revenueSection(r),
    chatSection(r),
    signinSection(r),
    consentSection(r),
    campaignSection(r),
    customerSection(r),
    inboxSection(r),
    qualitySection(r),
    costSection(r),
  ].map((s) => {
    const notes = r.releaseNotes?.[s.key] ?? {};
    return {
      ...s,
      notes: [...new Set(notes.current ?? [])],
      previousNotes: [...new Set(notes.previous ?? [])],
    };
  });
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: r.generatedAt ?? null,
    period,
    previous,
    sections,
    funnels: buildFunnels(r),
    caveats: buildCaveats(r, sections),
    switches: describeSwitches(r.switches),
    releases: (r.releases ?? []).map((x) => ({ date: x.date, key: x.key, title: x.title })),
  };
}

// ── Reading a snapshot ────────────────────────────────────────────────────────

/** The section of a snapshot by key, or null. */
export function snapshotSection(snapshot, key) {
  return (snapshot?.sections ?? []).find((s) => s.key === key) ?? null;
}

/** The metric of a snapshot by its key ("revenue.total"), or null. */
export function snapshotMetric(snapshot, key) {
  for (const s of snapshot?.sections ?? []) {
    const m = (s.metrics ?? []).find((x) => x.key === key);
    if (m) return m;
  }
  return null;
}

/**
 * Every metric as a flat map key → metric (with its section key). The stable
 * interface for baselines (Verbesserung) and report-to-report comparisons.
 * @returns {Record<string, SnapshotMetric & { section: string }>}
 */
export function flattenSnapshot(snapshot) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const s of snapshot?.sections ?? []) {
    for (const m of s.metrics ?? []) out[m.key] = { ...m, section: s.key };
  }
  return out;
}

/** The headline metrics (report header, PDF title page, prompt summary). */
export const HEADLINE_METRICS = Object.freeze([
  "revenue.total",
  "revenue.orders",
  "ledger.moShare",
  "chat.chats",
  "chat.engagement",
  "chat.clicksPerChat",
  "consent.newSubscribers",
  "costs.total",
  "costs.roi",
]);

// ── Prompt rendering ──────────────────────────────────────────────────────────

function metricLine(m) {
  const value = formatMetricValue(m.unit, m.value);
  const bits = [];
  if (m.previous !== null && m.previous !== undefined) {
    const d = formatMetricDelta(m);
    bits.push(`Vorperiode ${formatMetricValue(m.unit, m.previous)}${d ? `, ${d}` : ""}`);
  }
  if (m.unit === "rate" && m.base !== undefined && m.base !== null) bits.push(`n = ${num(m.base)}`);
  if (isSmallSample(m)) bits.push("kleine Stichprobe");
  if (m.hint) bits.push(m.hint);
  return `- ${m.label} [${m.key}]: ${value}${bits.length ? ` (${bits.join("; ")})` : ""}`;
}

function tableLines(t) {
  const lines = [`Tabelle „${t.title}“ [${t.key}]:`];
  for (const row of t.rows) {
    const cells = t.columns.map((col) => {
      const v = formatMetricValue(col.unit, row.values?.[col.key]);
      const pv = row.previous ? row.previous[col.key] : undefined;
      return pv !== undefined && pv !== null ? `${col.label} ${v} (VP ${formatMetricValue(col.unit, pv)})` : `${col.label} ${v}`;
    });
    lines.push(`  - ${row.label}: ${cells.join(" · ")}`);
  }
  if (t.note) lines.push(`  (${t.note})`);
  return lines;
}

/**
 * The snapshot as compact German Markdown for the strategist prompt — every
 * metric with its key, value, previous period and change, the tables, the
 * funnels and the caveats. Aggregates only; bounded by `maxChars`.
 * @param {ReturnType<typeof buildBusinessSnapshot>} snapshot
 * @param {{ maxChars?: number }} [opts]
 */
export function renderSnapshotForPrompt(snapshot, { maxChars = 40_000 } = {}) {
  if (!snapshot) return "(keine Geschäftsdaten)";
  const out = [];
  out.push(
    `Zeitraum: ${snapshot.period?.label ?? "?"} (${snapshot.period?.days ?? "?"} Tage) · Vorperiode: ${snapshot.previous?.label ?? "?"}`
  );
  for (const s of snapshot.sections ?? []) {
    out.push("", `## ${s.title} [Bereich ${s.key}; Admin-Link ${s.link}]`);
    for (const m of s.metrics ?? []) {
      if (m.value === null && m.previous === null) continue;
      out.push(metricLine(m));
    }
    for (const t of s.tables ?? []) if (t.rows.length) out.push(...tableLines(t));
    for (const n of s.notes ?? []) out.push(`Hinweis: ${n}`);
    for (const n of s.previousNotes ?? []) out.push(`Hinweis Vorperiode: ${n}`);
  }
  if ((snapshot.funnels ?? []).length) {
    out.push("", "## Funnels (aktuell; Vorperiode in Klammern)");
    for (const f of snapshot.funnels) {
      const steps = f.steps.map((st) => `${st.label} ${num(st.value)} (${num(st.previous)})`).join(" → ");
      out.push(`- ${f.title}: ${steps}`);
    }
  }
  if ((snapshot.switches ?? []).length) {
    out.push("", "## Schalter (Stand heute, nicht historisch)");
    out.push(
      snapshot.switches
        .map((s) => `${s.label}: ${typeof s.value === "number" ? num(s.value) : s.value ? "an" : "aus"}`)
        .join(" · ")
    );
  }
  if ((snapshot.caveats ?? []).length) {
    out.push("", "## Datenqualität & Messhinweise");
    for (const c of snapshot.caveats) out.push(`- ${c.level === "warning" ? "⚠ " : ""}${c.title}: ${c.detail}`);
  }
  const text = out.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (gekürzt)` : text;
}
