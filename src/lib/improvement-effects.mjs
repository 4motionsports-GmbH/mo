// The Wirkungs-Check's measurement — pure, no I/O. Did an adopted directive or
// an implemented change move its success metric? Answered honestly:
//
//   · a before/after window around the change day, measured on the business
//     snapshot (business-snapshot-core) — the "after" window starts the day
//     after the change and runs up to the metric's horizon (never into today,
//     a partial day); the "before" window is the equally long period right
//     before it (the snapshot's own previous period, so the change day itself
//     counts to "before" — conservative);
//   · a significance test on the sample sizes of BOTH windows: two proportions
//     for rates (base / previousBase), Poisson for counts, a Poisson rate test
//     for per-chat ratios, the order count for revenue amounts; averages and
//     scores get no test — direction only;
//   · a measurement change (a release that changed what the number means, a
//     section note of the snapshot, a measurement switch flipped) inside the
//     windows → "nicht vergleichbar": never an effect across it;
//   · confounders — other changes, product releases, switches in the window —
//     are named and lower the confidence;
//   · the verdict says "besser / schlechter / unverändert", never "caused by".
//
// The data layer (improvement-measure.ts) fetches one snapshot per window;
// everything else is here, tested (improvement-effects.test.mjs).
//
// Dates are UTC calendar days, as on the KPI screen and in the snapshot.

import { KPI_RELEASES, germanDay } from "./kpi-releases.mjs";
import {
  MIN_RATE_BASE,
  finite,
  flattenSnapshot,
  formatMetricDelta,
  metricDelta,
  previousPeriod,
} from "./business-snapshot-core.mjs";
import { COMPARISON_KEYS } from "./analytics-report-synthesis-core.mjs";
import { daysBetween, shiftYmd, toYmd } from "./kpi-range.mjs";
import { ownerLaneOf } from "./improvement-core.mjs";

// ── Bounds ────────────────────────────────────────────────────────────────────

/** An after-window shorter than this gets no verdict ("zu früh"). */
export const MIN_EFFECT_DAYS = 7;
/** Default horizon of a change without its own (days after the change). */
export const DEFAULT_HORIZON_DAYS = 14;
export const MIN_HORIZON_DAYS = 7;
export const MAX_HORIZON_DAYS = 90;
/** Changes older than this are not measured again. */
export const CHANGE_LOOKBACK_DAYS = 120;
/** At most this many changes per run (newest first) — one snapshot per window. */
export const MAX_MEASURED_CHANGES = 8;
/** |z| at or above this is a statistically clear change (≈ p < 0.05, two-sided). */
export const Z_SIGNIFICANT = 1.96;
/** Counts with fewer events in both windows together are a small sample. */
export const MIN_COUNT_EVENTS = 20;
/** Below this a rate moved "not at all" (percentage points). */
export const MOVE_POINTS = 1;
/** Below this an amount or count moved "not at all" (relative). */
export const MOVE_REL = 0.05;

// ── Verdicts ──────────────────────────────────────────────────────────────────

export const VERDICTS = Object.freeze([
  "besser_belastbar",
  "besser_tendenz",
  "unveraendert",
  "veraendert",
  "schlechter_tendenz",
  "schlechter_belastbar",
  "nicht_vergleichbar",
  "zu_frueh",
  "nicht_messbar",
]);

export const VERDICT_LABELS = Object.freeze({
  besser_belastbar: "Deutlich besser",
  besser_tendenz: "Eher besser",
  unveraendert: "Unverändert",
  veraendert: "Verändert",
  schlechter_tendenz: "Eher schlechter",
  schlechter_belastbar: "Deutlich schlechter",
  nicht_vergleichbar: "Nicht vergleichbar",
  zu_frueh: "Zu früh",
  nicht_messbar: "Nicht messbar",
});

/** Verdicts the strategist can assess (the rest is "wait" or "no data"). */
export const ASSESSABLE_VERDICTS = Object.freeze([
  "besser_belastbar",
  "besser_tendenz",
  "unveraendert",
  "veraendert",
  "schlechter_tendenz",
  "schlechter_belastbar",
  "nicht_vergleichbar",
]);

export const CONFIDENCE_LEVELS = Object.freeze(["hoch", "mittel", "niedrig"]);

// ── Areas: what a release or switch changes ───────────────────────────────────
// An area is a metric-key prefix ("revenue", "capture") or a full key
// ("capture.doiRate"). `measurement` = the release changed what the number
// MEANS (counting, attribution, denominators) — no before/after across it.
// `product` = the release changed behaviour — a confounder, named, lowers the
// confidence. Every KPI release must be classified here (tested).

const ATTRIBUTION = ["revenue", "journey.orderedAny", "journey.chatToOrder", "journey.revenuePerChat", "ledger.moShare", "costs.roi", "bundles.revenue"];

export const RELEASE_EFFECTS = Object.freeze({
  "widget-popups": { measurement: ["signin", "consent"], product: ["chat", "capture", "journey"] },
  "signin-code": { measurement: ["signin", "consent", "account"], product: [] },
  "customer-platform-widget": { measurement: ["signin", "consent", "account", "campaigns.chatStarted"], product: ["chat", "orderStatus", "quality"] },
  "attribution-unresolved": { measurement: ["revenue.unresolved"], product: [] },
  "attribution-window": { measurement: ATTRIBUTION, product: [] },
  "signedin-offer-off": { measurement: ["capture"], product: [] },
  "app-proxy-signin": { measurement: ["signin", "consent", "account"], product: [] },
  "optin-measurement": { measurement: ["consent", "capture"], product: [] },
  "consent-benefits-served": { measurement: [], product: ["consent"] },
  "page-context-typed": { measurement: [], product: ["chat", "journey"] },
  "attribution-token-renewal": { measurement: ATTRIBUTION, product: [] },
  "doi-mail-sent": { measurement: ["capture.doiRate", "capture.doiSent"], product: [] },
  "consent-ask-suppressed": { measurement: ["consent.popupShown", "consent.popupRate"], product: [] },
  "attribution-threads-maillinks": { measurement: ATTRIBUTION, product: [] },
});

/** What flipping a switch changes (switch keys of business-snapshot snapshotSwitches). */
export const SWITCH_EFFECTS = Object.freeze({
  shopifyConfigured: { measurement: ["revenue", "campaigns.redeemedShopify"], product: [] },
  customerSync: { measurement: ["ledger", "customers", "moEffect"], product: [] },
  consentWriteback: { measurement: [], product: ["consent"] },
  campaignSendsApproved: { measurement: [], product: ["campaigns", "letters"] },
  campaignRelease: { measurement: [], product: ["campaigns"] },
  physicalMailApproved: { measurement: [], product: ["letters"] },
  appProxySignin: { measurement: ["signin", "consent", "account"], product: [] },
  attributionSessionAnchor: { measurement: ATTRIBUTION, product: [] },
  pageContext: { measurement: [], product: ["chat", "journey"] },
  pageContextHoldoutPct: { measurement: [], product: ["chat", "journey"] },
  chatOrderStatus: { measurement: [], product: ["orderStatus", "quality", "chat"] },
  emailConfigured: { measurement: [], product: ["capture", "campaigns", "consent"] },
  anthropicConfigured: { measurement: [], product: ["chat", "quality", "journey", "inbox", "knowledge"] },
});

/** True when `key` lies in `area` ("revenue" covers "revenue.total"). */
export function keyInArea(key, area) {
  const k = String(key ?? "");
  return k === area || k.startsWith(`${area}.`);
}

function touches(areas, key) {
  return (areas ?? []).some((a) => keyInArea(key, a));
}

// ── Default success metrics per lane ──────────────────────────────────────────
// A change without its own success metric is measured on its lane's outcome
// (and labelled "Standardkennzahl"). Guardrails watch for side effects.

export const DEFAULT_LANE_METRICS = Object.freeze({
  chat: "quality.handledWell",
  operator: "revenue.total",
  campaign: "campaigns.revenue",
  frontend: "chat.engagement",
  developer: "journey.chatToOrder",
  legal: "consent.newSubscribers",
});

export const LANE_GUARDRAILS = Object.freeze({
  chat: ["journey.chatToOrder", "quality.unmetNeed"],
  operator: ["journey.chatToOrder"],
  campaign: ["campaigns.unsubscribeRate"],
  frontend: ["journey.chatToOrder"],
  developer: ["quality.handledWell"],
  legal: [],
});

// ── Statistics ────────────────────────────────────────────────────────────────

/** Two-proportion z (pooled). null without variance and without a difference. */
export function twoProportionZ(p1, n1, p0, n0) {
  if (!(n1 > 0) || !(n0 > 0)) return null;
  const pool = (p1 * n1 + p0 * n0) / (n1 + n0);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n0));
  if (!(se > 0)) return p1 === p0 ? 0 : null;
  return (p1 - p0) / se;
}

/** Poisson z for two counts over equally long windows. */
export function poissonZ(c1, c0) {
  const t = c1 + c0;
  if (!(t > 0)) return null;
  return (c1 - c0) / Math.sqrt(t);
}

/** Poisson rate z: events c per exposure e (e.g. clicks per chat). */
export function poissonRateZ(c1, e1, c0, e0) {
  if (!(e1 > 0) || !(e0 > 0)) return null;
  const se = Math.sqrt(c1 / (e1 * e1) + c0 / (e0 * e0));
  const diff = c1 / e1 - c0 / e0;
  if (!(se > 0)) return diff === 0 ? 0 : null;
  return diff / se;
}

/** Per-chat ratios: numerator count and exposure count. */
const RATIO_PARTS = Object.freeze({
  "chat.clicksPerChat": ["chat.productClicks", "chat.chats"],
  "chat.cartPerChat": ["chat.cartClicks", "chat.chats"],
});

/** Amounts tested through the count of the same orders. */
const COMPANION_COUNTS = Object.freeze({
  "revenue.total": "revenue.orders",
  "campaigns.revenue": "campaigns.orders",
  "inbox.revenueAfterActed": "inbox.ordersAfterActed",
  "ledger.revenue": "ledger.orders",
});

const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

/**
 * The significance test of a metric's change (current vs previous window of
 * the same length). `small` marks a sample too small for the normal
 * approximation — the verdict is then never "belastbar".
 *
 * @param {{ key: string, unit: string, value: number|null, previous: number|null, base?: number|null, previousBase?: number|null }} m
 * @param {Record<string, any>} [flat] the flattened snapshot (ratio / companion parts)
 * @returns {{ test: "proportion"|"poisson"|"poisson_rate"|"companion"|"none", z: number|null, n: { after: number|null, before: number|null } | null, small: boolean, via?: string }}
 */
export function effectStats(m, flat = {}) {
  const v = finite(m?.value);
  const p = finite(m?.previous);
  if (v === null || p === null) return { test: "none", z: null, n: null, small: true };
  if (m.unit === "rate") {
    const n1 = finite(m.base);
    const n0 = finite(m.previousBase);
    if (n1 === null || n0 === null || n1 <= 0 || n0 <= 0) {
      return { test: "none", z: null, n: n1 !== null || n0 !== null ? { after: n1, before: n0 } : null, small: true };
    }
    return {
      test: "proportion",
      z: twoProportionZ(v, n1, p, n0),
      n: { after: n1, before: n0 },
      small: n1 < MIN_RATE_BASE || n0 < MIN_RATE_BASE,
    };
  }
  if (m.unit === "count") {
    return { test: "poisson", z: poissonZ(v, p), n: { after: v, before: p }, small: v + p < MIN_COUNT_EVENTS };
  }
  const parts = /** @type {Record<string, string[]>} */ (RATIO_PARTS)[m.key];
  if (parts) {
    const [num, exp] = parts.map((k) => flat?.[k]);
    const c1 = finite(num?.value);
    const c0 = finite(num?.previous);
    const e1 = finite(exp?.value);
    const e0 = finite(exp?.previous);
    if (c1 !== null && c0 !== null && e1 !== null && e0 !== null) {
      return {
        test: "poisson_rate",
        z: poissonRateZ(c1, e1, c0, e0),
        n: { after: e1, before: e0 },
        small: e1 < MIN_RATE_BASE || e0 < MIN_RATE_BASE || c1 + c0 < MIN_COUNT_EVENTS,
        via: exp.key,
      };
    }
  }
  const companionKey = /** @type {Record<string, string>} */ (COMPANION_COUNTS)[m.key];
  const companion = companionKey ? flat?.[companionKey] : null;
  if (companion) {
    const c1 = finite(companion.value);
    const c0 = finite(companion.previous);
    if (c1 !== null && c0 !== null) {
      // The orders must move the same way as the amount, or nothing is clear.
      const z = poissonZ(c1, c0);
      const agree = sign(v - p) === sign(c1 - c0);
      return {
        test: "companion",
        z: z === null ? null : agree ? z : 0,
        n: { after: c1, before: c0 },
        small: c1 + c0 < MIN_COUNT_EVENTS,
        via: companionKey,
      };
    }
  }
  const b = finite(m.base);
  return { test: "none", z: null, n: null, small: b !== null && b < MIN_RATE_BASE };
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * The verdict of one metric's change.
 * @param {any} m snapshot metric (value = after window, previous = before window)
 * @param {ReturnType<typeof effectStats>} stats
 * @param {{ days: number, minDays?: number, measurementChange?: boolean, confounders?: number }} ctx
 * @returns {{ verdict: string, confidence: "hoch"|"mittel"|"niedrig"|null, significant: boolean, reasons: string[] }}
 */
export function classifyMetricEffect(m, stats, { days, minDays = MIN_EFFECT_DAYS, measurementChange = false, confounders = 0 }) {
  if (days < minDays) {
    return {
      verdict: "zu_frueh",
      confidence: null,
      significant: false,
      reasons: [`Erst ${days} ${days === 1 ? "Tag" : "Tage"} Daten nach der Änderung — gemessen wird ab ${minDays} Tagen.`],
    };
  }
  const v = finite(m?.value);
  const p = finite(m?.previous);
  if (!m || v === null || p === null) {
    return { verdict: "nicht_messbar", confidence: null, significant: false, reasons: ["Für mindestens eines der beiden Fenster gibt es keinen Wert."] };
  }
  if (m.unit === "count" && v === 0 && p === 0) {
    return { verdict: "nicht_messbar", confidence: null, significant: false, reasons: ["In beiden Fenstern kein einziges Ereignis."] };
  }
  if (measurementChange) {
    return {
      verdict: "nicht_vergleichbar",
      confidence: null,
      significant: false,
      reasons: ["Im Vergleichszeitraum hat sich die Messung dieser Kennzahl geändert — ein Vorher/Nachher wäre nicht ehrlich."],
    };
  }
  const d = metricDelta(m);
  const reasons = [];
  const significant = !stats.small && stats.z !== null && Math.abs(stats.z) >= Z_SIGNIFICANT;
  const moved = !d ? false : m.unit === "rate" ? Math.abs(d.points ?? 0) >= MOVE_POINTS : d.rel === null ? d.abs !== 0 : Math.abs(d.rel) >= MOVE_REL;
  let verdict;
  if (!d || (!significant && !moved)) verdict = "unveraendert";
  else if (d.favourable === null) verdict = "veraendert";
  else if (significant) verdict = d.favourable ? "besser_belastbar" : "schlechter_belastbar";
  else verdict = d.favourable ? "besser_tendenz" : "schlechter_tendenz";

  // 2 = hoch, 1 = mittel, 0 = niedrig
  let level = significant ? 2 : stats.test === "none" ? 0 : 1;
  if (stats.test === "none") reasons.push("Kein statistischer Test möglich (Durchschnitt oder Betrag ohne Fallzahl) — nur die Richtung zählt.");
  else if (!significant && moved) reasons.push("Die Veränderung liegt im Bereich des Zufalls (|z| < 1,96).");
  if (stats.small) {
    level = 0;
    reasons.push("Kleine Stichprobe — eine Bewegung dieser Größe kann Zufall sein.");
  }
  if (confounders > 0) {
    level = Math.max(0, level - 1);
    reasons.push(`${confounders === 1 ? "Eine weitere Änderung" : `${confounders} weitere Änderungen`} im Vergleichszeitraum — die Bewegung ist nicht allein dieser Änderung zuzuordnen.`);
  }
  if (days < DEFAULT_HORIZON_DAYS) {
    level = Math.max(0, level - 1);
    reasons.push(`Kurzes Fenster (${days} Tage).`);
  }
  return { verdict, confidence: /** @type {const} */ (["niedrig", "mittel", "hoch"])[level], significant, reasons };
}

// ── Changes (what to measure) ─────────────────────────────────────────────────

/** UTC calendar day of a timestamp (Date, ISO string), or null. */
export function dayOf(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : toYmd(d);
}

const KEY_RE = /\b([a-z][a-zA-Z]+\.[a-z][a-zA-Z]+)\b/g;

/** Snapshot keys named in a text ("[signin.popupRate]", "campaigns.revenue ≥ …"), in order. */
export function extractMetricKeys(text, knownKeys) {
  const known = knownKeys instanceof Set ? knownKeys : new Set(knownKeys ?? []);
  const out = [];
  for (const m of String(text ?? "").matchAll(KEY_RE)) {
    if (known.has(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * The metric a v1 free-text expectation names by its label ("Qualität
 * „Abgesprungen“ sinkt" → quality.droppedOff). Longest label wins; only
 * labels of at least 8 characters and with a direction.
 * @param {string | null | undefined} text
 * @param {Record<string, { label: string, good: string }>} flat
 */
export function metricByLabel(text, flat) {
  const t = String(text ?? "").toLowerCase();
  if (!t) return null;
  let best = null;
  for (const [key, m] of Object.entries(flat ?? {})) {
    const label = String(m?.label ?? "").toLowerCase();
    if (label.length < 8 || m.good === "none") continue;
    if (t.includes(label) && (!best || label.length > best.len)) best = { key, len: label.length };
  }
  return best?.key ?? null;
}

function clampHorizon(h) {
  const n = Math.round(Number(h));
  if (!Number.isFinite(n)) return DEFAULT_HORIZON_DAYS;
  return Math.min(MAX_HORIZON_DAYS, Math.max(MIN_HORIZON_DAYS, n));
}

/**
 * The metrics a change is measured on: its success metric (v2), a key or a
 * label named in its expected effect (v1), or its lane's default — plus up
 * to two guardrails of the lane.
 */
export function metricsForChange({ lane, successMetric = null, expectedEffect = null }, flat) {
  const known = new Set(Object.keys(flat ?? {}));
  let primary = null;
  let source = "standard";
  if (successMetric?.key && known.has(successMetric.key)) {
    primary = successMetric.key;
    source = "erfolgsmass";
  } else {
    const named = extractMetricKeys(expectedEffect, known)[0] ?? metricByLabel(expectedEffect, flat);
    if (named) {
      primary = named;
      source = "erwartete_wirkung";
    }
  }
  if (!primary) primary = DEFAULT_LANE_METRICS[lane] ?? DEFAULT_LANE_METRICS.chat;
  const guardrails = (LANE_GUARDRAILS[lane] ?? []).filter((k) => k !== primary && known.has(k)).slice(0, 2);
  return {
    source,
    metrics: [{ key: primary, role: "primary" }, ...guardrails.map((key) => ({ key, role: "guardrail" }))],
  };
}

/**
 * The changes to measure: adopted directives (their latest wording or
 * activation; a deactivated one for the time it was live) and implemented
 * suggestions that are not directives. Newest first, at most `maxChanges`,
 * nothing older than `lookbackDays`.
 *
 * @param {{
 *   directives: Array<{ id: number, content: string, active: boolean, suggestionId: number | null,
 *     events: Array<{ action: string, at: string }> }>,
 *   suggestions: Array<{ id: number, title: string, lane: string, category: string, status: string,
 *     statusChangedAt: string | null, expectedEffect: string | null,
 *     details?: { successMetric?: { key: string | null, target?: number | null, direction?: string, horizonDays?: number } | null } | null }>,
 *   flat: Record<string, any>,
 *   today: string,
 *   lookbackDays?: number,
 *   maxChanges?: number,
 * }} input
 */
export function buildChangeList({ directives = [], suggestions = [], flat = {}, today, lookbackDays = CHANGE_LOOKBACK_DAYS, maxChanges = MAX_MEASURED_CHANGES }) {
  const oldest = shiftYmd(today, -lookbackDays);
  const byId = new Map(suggestions.map((s) => [s.id, s]));
  const viaDirective = new Set();
  const out = [];

  for (const d of directives) {
    const events = (d.events ?? [])
      .map((e) => ({ ...e, ms: Date.parse(String(e.at)) }))
      .filter((e) => Number.isFinite(e.ms))
      .sort((a, b) => a.ms - b.ms);
    if (events.length === 0) continue;
    const lastOff = d.active ? null : [...events].reverse().find((e) => e.action === "deactivated") ?? null;
    const live = events.filter((e) => e.action !== "deactivated" && (!lastOff || e.ms < lastOff.ms));
    const start = live[live.length - 1];
    if (!start) continue;
    const date = /** @type {string} */ (dayOf(start.at));
    if (date < oldest) continue;
    const linked = d.suggestionId != null ? byId.get(d.suggestionId) ?? null : null;
    if (linked) viaDirective.add(linked.id);
    const { source, metrics } = metricsForChange(
      { lane: "chat", successMetric: linked?.details?.successMetric ?? null, expectedEffect: linked?.expectedEffect ?? null },
      flat
    );
    const sm = linked?.details?.successMetric ?? null;
    out.push({
      ref: `D${d.id}`,
      kind: "directive",
      id: d.id,
      suggestionId: linked?.id ?? null,
      title: String(d.content ?? "").trim().slice(0, 240),
      lane: "chat",
      date,
      until: lastOff ? dayOf(lastOff.at) : null,
      state: d.active ? (start.action === "updated" ? "geaendert" : "aktiv") : "deaktiviert",
      metricSource: source,
      metrics,
      horizonDays: clampHorizon(sm?.horizonDays ?? DEFAULT_HORIZON_DAYS),
      target: source === "erfolgsmass" && finite(sm?.target) !== null ? { value: Number(sm?.target), direction: sm?.direction === "down" ? "down" : "up" } : null,
    });
  }

  for (const s of suggestions) {
    if (s.status !== "implemented" || viaDirective.has(s.id)) continue;
    const date = dayOf(s.statusChangedAt);
    if (!date || date < oldest) continue;
    const lane = ownerLaneOf(s);
    const sm = s.details?.successMetric ?? null;
    const { source, metrics } = metricsForChange({ lane, successMetric: sm, expectedEffect: s.expectedEffect }, flat);
    out.push({
      ref: `S${s.id}`,
      kind: "suggestion",
      id: s.id,
      suggestionId: s.id,
      title: String(s.title ?? "").trim().slice(0, 240),
      lane,
      date,
      until: null,
      state: "umgesetzt",
      metricSource: source,
      metrics,
      horizonDays: clampHorizon(sm?.horizonDays ?? DEFAULT_HORIZON_DAYS),
      target: source === "erfolgsmass" && finite(sm?.target) !== null ? { value: Number(sm?.target), direction: sm?.direction === "down" ? "down" : "up" } : null,
    });
  }

  return out.sort((a, b) => b.date.localeCompare(a.date) || a.ref.localeCompare(b.ref)).slice(0, maxChanges);
}

// ── Windows ───────────────────────────────────────────────────────────────────

/**
 * The before/after windows of a change: after = the day after the change up
 * to its horizon (or the day before it was switched off), never including
 * today; before = the equally long period right before (previousPeriod).
 * @param {{ date: string, until?: string | null, horizonDays: number }} change
 * @param {string} today YYYY-MM-DD (UTC)
 */
export function changeWindow(change, today) {
  const from = shiftYmd(change.date, 1);
  let to = shiftYmd(from, change.horizonDays - 1);
  const capped = change.until ? shiftYmd(change.until, -1) : null;
  if (capped && capped < to) to = capped;
  const yesterday = shiftYmd(today, -1);
  if (to > yesterday) to = yesterday;
  const days = to >= from ? daysBetween(from, to) : 0;
  const before = days > 0 ? previousPeriod({ from, to }) : null;
  return {
    from,
    to: days > 0 ? to : from,
    days,
    horizonDays: change.horizonDays,
    complete: days >= change.horizonDays || Boolean(capped && to === capped),
    before: before ? { from: before.from, to: before.to } : null,
  };
}

/** The key under which windows share one snapshot. */
export function windowKey(w) {
  return `${w.from}..${w.to}`;
}

// ── Switch history ────────────────────────────────────────────────────────────

/**
 * Switches whose value differs between the previous run's snapshot and this
 * one — they flipped somewhere between the two runs (not exactly known).
 * @param {Array<{ key: string, label: string, value: boolean | number }> | null | undefined} before
 * @param {Array<{ key: string, label: string, value: boolean | number }> | null | undefined} after
 * @param {{ from: string, to: string }} between days of the two runs
 * @returns {Array<{ key: string, label: string, from: boolean | number, to: boolean | number, between: { from: string, to: string } }>}
 */
export function switchChanges(before, after, between) {
  if (!Array.isArray(before) || !Array.isArray(after)) return [];
  const prev = new Map(before.map((s) => [s.key, s.value]));
  return after
    .filter((s) => prev.has(s.key) && prev.get(s.key) !== s.value)
    .map((s) => ({ key: s.key, label: s.label, from: /** @type {boolean | number} */ (prev.get(s.key)), to: s.value, between }));
}

// ── Measuring one change ──────────────────────────────────────────────────────

function sectionNotes(snapshot, sectionKey) {
  const s = (snapshot?.sections ?? []).find((x) => x.key === sectionKey);
  return [...(s?.notes ?? []), ...(s?.previousNotes ?? [])];
}

function inSpan(date, w) {
  return Boolean(w.before) && date > w.before.from && date <= w.to;
}

/**
 * Releases, switch flips and other changes inside a window, per metric key:
 * which change the measurement (→ "nicht vergleichbar") and which are
 * confounders.
 */
function windowEvents(change, w, { allChanges = [], switchHistory = [], releases = KPI_RELEASES }) {
  const rel = releases.filter((r) => inSpan(r.date, w));
  // A switch flipped somewhere in (between.from, between.to]; it matters when
  // that span overlaps the compared span (before.from, to].
  const sw = switchHistory.filter((s) => s.between && s.between.to > (w.before?.from ?? w.from) && s.between.from < w.to);
  const others = allChanges.filter((c) => c.ref !== change.ref && inSpan(c.date, w));
  return { rel, sw, others };
}

/**
 * Measure one change on the snapshot of its window. Pure: the caller fetched
 * `snapshot` for [window.from, window.to] (its previous period is the
 * before-window).
 *
 * @param {ReturnType<typeof buildChangeList>[number]} change
 * @param {{
 *   snapshot: any | null, today: string,
 *   allChanges?: ReturnType<typeof buildChangeList>,
 *   switchHistory?: ReturnType<typeof switchChanges>,
 *   releases?: ReadonlyArray<{ date: string, key: string, title: string }>,
 *   reference?: Record<string, any>,
 * }} ctx `reference` is the run snapshot's flat map — labels and units of a
 *   metric the window snapshot does not have (no window yet).
 */
export function measureChange(change, { snapshot, today, allChanges = [], switchHistory = [], releases = KPI_RELEASES, reference = {} }) {
  const w = changeWindow(change, today);
  const flat = snapshot ? flattenSnapshot(snapshot) : {};
  const { rel, sw, others } = w.days > 0 ? windowEvents(change, w, { allChanges, switchHistory, releases }) : { rel: [], sw: [], others: [] };

  /** @type {Array<{ kind: "release" | "switch" | "change", label: string, date: string | null, measurement: boolean, keys: string[] }>} */
  const confounders = [];
  const metrics = change.metrics.map(({ key, role }) => {
    const m = flat[key] ?? null;
    const measurementBy = [];
    const productBy = [];
    for (const r of rel) {
      const fx = /** @type {Record<string, { measurement: string[], product: string[] }>} */ (RELEASE_EFFECTS)[r.key];
      if (!fx) productBy.push({ kind: "release", label: r.title, date: r.date });
      else if (touches(fx.measurement, key)) measurementBy.push({ kind: "release", label: r.title, date: r.date });
      else if (touches(fx.product, key)) productBy.push({ kind: "release", label: r.title, date: r.date });
    }
    for (const s of sw) {
      const fx = /** @type {Record<string, { measurement: string[], product: string[] }>} */ (SWITCH_EFFECTS)[s.key];
      const label = `Schalter „${s.label}“ zwischen ${germanDay(s.between.from)} und ${germanDay(s.between.to)} umgestellt`;
      if (fx && touches(fx.measurement, key)) measurementBy.push({ kind: "switch", label, date: null });
      else if (!fx || touches(fx.product, key)) productBy.push({ kind: "switch", label, date: null });
    }
    for (const o of others) productBy.push({ kind: "change", label: `${o.kind === "directive" ? "Anweisung" : "Maßnahme"} „${o.title.slice(0, 80)}“ (${germanDay(o.date)})`, date: o.date });
    const notes = m ? sectionNotes(snapshot, m.section) : [];
    const measurementChange = measurementBy.length > 0 || notes.length > 0;
    for (const c of [...measurementBy.map((x) => ({ ...x, measurement: true })), ...productBy.map((x) => ({ ...x, measurement: false }))]) {
      const hit = confounders.find((y) => y.label === c.label && y.measurement === c.measurement);
      if (hit) {
        if (!hit.keys.includes(key)) hit.keys.push(key);
      } else confounders.push({ ...c, keys: [key] });
    }
    const stats = m ? effectStats(m, flat) : { test: /** @type {const} */ ("none"), z: null, n: null, small: true };
    const cls = classifyMetricEffect(m, stats, { days: w.days, measurementChange, confounders: productBy.length });
    if (measurementChange && notes.length && measurementBy.length === 0) cls.reasons.push(...notes);
    const d = m ? metricDelta(m) : null;
    const meta = m ?? reference?.[key] ?? null;
    return {
      key,
      role,
      label: meta?.label ?? key,
      unit: meta?.unit ?? "count",
      good: meta?.good ?? "up",
      section: meta?.section ?? null,
      value: m ? finite(m.value) : null,
      previous: m ? finite(m.previous) : null,
      base: m ? finite(m.base) : null,
      previousBase: m ? finite(m.previousBase) : null,
      delta: d ? { abs: d.abs, rel: d.rel, points: d.points } : null,
      deltaText: m ? formatMetricDelta(m) : "",
      test: stats.test,
      z: stats.z === null ? null : Math.round(stats.z * 100) / 100,
      testN: stats.n,
      via: stats.via ?? null,
      small: stats.small,
      measurementChange,
      ...cls,
    };
  });

  const primary = metrics[0];
  const target =
    change.target && primary && primary.value !== null
      ? {
          ...change.target,
          reached: change.target.direction === "down" ? primary.value <= change.target.value : primary.value >= change.target.value,
        }
      : change.target
        ? { ...change.target, reached: null }
        : null;

  return {
    ref: change.ref,
    kind: change.kind,
    id: change.id,
    suggestionId: change.suggestionId,
    title: change.title,
    lane: change.lane,
    date: change.date,
    until: change.until,
    state: change.state,
    metricSource: change.metricSource,
    window: w,
    metrics,
    verdict: primary?.verdict ?? "nicht_messbar",
    confidence: primary?.confidence ?? null,
    sideEffects: metrics
      .filter((m) => m.role === "guardrail" && (m.verdict === "schlechter_belastbar" || m.verdict === "schlechter_tendenz"))
      .map((m) => ({ key: m.key, label: m.label, verdict: m.verdict, deltaText: m.deltaText })),
    confounders,
    target,
  };
}

/**
 * A change that needs no snapshot (window too short) — measured on nothing,
 * so every metric reads "zu früh".
 */
export function measureWithoutSnapshot(change, today, reference = {}) {
  return measureChange(change, { snapshot: null, today, reference });
}

/** Counts of measurements per verdict, and whether any is assessable. */
export function summariseMeasurements(measurements) {
  /** @type {Record<string, number>} */
  const byVerdict = {};
  for (const m of measurements ?? []) byVerdict[m.verdict] = (byVerdict[m.verdict] ?? 0) + 1;
  return {
    total: (measurements ?? []).length,
    byVerdict,
    assessable: (measurements ?? []).some((m) => ASSESSABLE_VERDICTS.includes(m.verdict)),
  };
}

// ── Run overview: what moved in the period ────────────────────────────────────

/** Decision metrics the overview ranks (the report comparison keys plus a few outcomes). */
export const MOVER_KEYS = Object.freeze([
  ...COMPARISON_KEYS,
  ...[
    "revenue.direct",
    "bundles.revenue",
    "chat.abandoned",
    "chat.pageContextResolved",
    "quality.droppedOff",
    "knowledge.hoursToAnswer",
    "feedback.rating",
    "campaigns.unsubscribeRate",
    "campaigns.rating",
    "inbox.actedShare",
    "inbox.revenueAfterActed",
    "orderStatus.answered",
    "ledger.repeatShare",
    "costs.perConsultation",
  ].filter((k) => !COMPARISON_KEYS.includes(k)),
]);

/**
 * What got better and what got worse in the run's period against the
 * previous period — decision metrics only, with the same test as the
 * measurement; metrics whose measurement changed (section notes, measurement
 * releases inside the two periods) are listed apart, never as a mover.
 * Significant moves first, then by |z|.
 * @param {any} snapshot
 * @param {{ limit?: number, releases?: ReadonlyArray<{ date: string, key: string, title: string }> }} [opts]
 */
export function snapshotMovers(snapshot, { limit = 6, releases = null } = {}) {
  const empty = { improved: [], worsened: [], notComparable: [], steady: 0 };
  if (!snapshot?.period) return empty;
  const flat = flattenSnapshot(snapshot);
  const span = { from: snapshot.previous?.from ?? snapshot.period.from, to: snapshot.period.to };
  const rel = (releases ?? snapshot.releases ?? []).filter((r) => r.date > span.from && r.date <= span.to);
  const improved = [];
  const worsened = [];
  const notComparable = [];
  let steady = 0;
  for (const key of MOVER_KEYS) {
    const m = flat[key];
    if (!m || m.good === "none" || finite(m.value) === null || finite(m.previous) === null) continue;
    const measured = sectionNotes(snapshot, m.section).length > 0 || rel.some((r) => touches(/** @type {any} */ (RELEASE_EFFECTS)[r.key]?.measurement, key));
    if (measured) {
      notComparable.push({ key, label: m.label });
      continue;
    }
    const stats = effectStats(m, flat);
    const cls = classifyMetricEffect(m, stats, { days: snapshot.period.days ?? 30, minDays: 1 });
    const item = {
      key,
      label: m.label,
      unit: m.unit,
      good: m.good,
      section: m.section,
      value: m.value,
      previous: m.previous,
      base: m.base ?? null,
      previousBase: m.previousBase ?? null,
      deltaText: formatMetricDelta(m),
      z: stats.z === null ? null : Math.round(stats.z * 100) / 100,
      test: stats.test,
      small: stats.small,
      significant: cls.significant,
      verdict: cls.verdict,
    };
    if (cls.verdict === "besser_belastbar" || cls.verdict === "besser_tendenz") improved.push(item);
    else if (cls.verdict === "schlechter_belastbar" || cls.verdict === "schlechter_tendenz") worsened.push(item);
    else steady += 1;
  }
  const rank = (a, b) =>
    Number(b.significant) - Number(a.significant) ||
    Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0) ||
    MOVER_KEYS.indexOf(a.key) - MOVER_KEYS.indexOf(b.key);
  return {
    improved: improved.sort(rank).slice(0, limit),
    worsened: worsened.sort(rank).slice(0, limit),
    notComparable,
    steady,
  };
}
