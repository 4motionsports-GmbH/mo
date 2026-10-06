// The decision layer of the Verbesserung (v2) — pure, no I/O, no model call.
//
// The strategist (lib/ai-models.mjs tier `strategist`, Opus 5.5) runs up to
// three passes per run (improvement-generate.ts):
//   wirkungscheck       — reads the deterministic measurement of every adopted
//                         directive / implemented change (improvement-effects)
//                         and recommends keep / adjust / roll back / watch;
//   vorschlaege_chat    — decision-grade suggestions for chat & prompt,
//                         widget and Mo's tools (reads Mo's self-snapshot);
//   vorschlaege_betrieb — the same for operations, campaigns, development and
//                         legal, plus the run's headline.
//
// This module owns the suggestion shape (evidence with numbers from the
// snapshot, expected impact, a success metric that IS a snapshot key so the
// next run can measure it, effort / risk / confidence, owner lane, admin
// link), the normalisers that make any model output safe to store, the import
// of a Komplettanalyse's open recommendations, the prompts and the cost /
// duration estimate. Zod schemas: improvement-schemas.mjs (kept out of the
// client bundle).

import {
  HEADLINE_METRICS,
  LINK_TARGETS,
  finite,
  flattenSnapshot,
  formatMetricDelta,
  formatMetricValue,
  renderSnapshotForPrompt,
  scrubPii,
} from "./business-snapshot-core.mjs";
import {
  EFFORT_LABELS,
  LEVELS,
  MAX_DIRECTIVE_CHARS,
  MAX_SUGGESTIONS_PER_LANE,
  OWNER_LANES,
  OWNER_LANE_DESCRIPTIONS,
  OWNER_LANE_LABELS,
  PASS_LANES,
  SUGGESTION_STATUS_LABELS,
  ownerLaneOf,
  priorityScore,
  priorityTier,
  storageLaneFor,
  suggestionFingerprint,
} from "./improvement-core.mjs";
import {
  DEFAULT_HORIZON_DAYS,
  MAX_HORIZON_DAYS,
  MIN_HORIZON_DAYS,
  VERDICT_LABELS,
  extractMetricKeys,
} from "./improvement-effects.mjs";
import { num } from "./admin-format.mjs";
import { usdCostForUsage } from "./ai-pricing.mjs";
import { modelFor } from "./ai-models.mjs";

/** Version of a suggestion's stored details (`evidence_json`). */
export const SUGGESTION_DETAILS_VERSION = 2;

// ── Strategist call budgets ───────────────────────────────────────────────────

/** The improve/step route's maxDuration (s) — keep in sync with api/admin/improve/step. */
export const IMPROVEMENT_STEP_MAX_DURATION_S = 300;
/** Abort a strategist call after this long so the step can record it and retry lower on the effort ladder. */
export const IMPROVEMENT_STRATEGIST_TIMEOUT_MS = 240_000;
/** Answer budgets (the tier's thinking headroom comes on top, maxOutputTokensFor). */
export const EFFECT_REVIEW_ANSWER_TOKENS = 2500;
export const SUGGESTIONS_ANSWER_TOKENS = 5000;
/** One measurement step stops fetching window snapshots after this long (the rest follows next step). */
export const MEASURE_STEP_BUDGET_MS = 120_000;

// ── Vocabularies ──────────────────────────────────────────────────────────────

export const REVIEW_RECOMMENDATIONS = Object.freeze(["beibehalten", "anpassen", "zuruecknehmen", "beobachten"]);
export const REVIEW_LABELS = Object.freeze({
  beibehalten: "Beibehalten",
  anpassen: "Anpassen",
  zuruecknehmen: "Zurücknehmen",
  beobachten: "Weiter beobachten",
});

export const ORIGIN_KINDS = Object.freeze(["engine", "report"]);

const LIMITS = Object.freeze({
  title: 140,
  why: 900,
  action: 1200,
  expectedImpact: 320,
  riskNote: 300,
  evidenceText: 260,
  evidence: 4,
  headline: 240,
  summary: 1400,
  assessment: 700,
  nextStep: 300,
});

// ── Text helpers ──────────────────────────────────────────────────────────────

function text(v, max) {
  const s = scrubPii(typeof v === "string" ? v : v == null ? "" : String(v))
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function pick(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

// ── Metrics in a suggestion ───────────────────────────────────────────────────

/**
 * A snapshot metric frozen into a suggestion (evidence, success-metric
 * baseline): the card renders it without the snapshot, and the number is the
 * snapshot's — never the model's.
 */
export function frozenMetric(flat, key) {
  const m = key ? flat?.[key] : null;
  if (!m) return null;
  return {
    key,
    label: m.label,
    unit: m.unit,
    good: m.good,
    section: m.section ?? null,
    value: finite(m.value),
    previous: finite(m.previous),
    base: finite(m.base),
    previousBase: finite(m.previousBase),
  };
}

function normaliseTarget(target, unit) {
  const t = finite(target);
  if (t === null) return null;
  // Rates are shares (0–1); a model that writes 18 for 18 % gets corrected.
  if (unit === "rate" && t > 1 && t <= 100) return Math.round((t / 100) * 10000) / 10000;
  return t;
}

function clampHorizon(h, fallback = DEFAULT_HORIZON_DAYS) {
  const n = Math.round(Number(h));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_HORIZON_DAYS, Math.max(MIN_HORIZON_DAYS, n));
}

/** "in 2 Wochen" / "binnen 30 Tagen" / "in 4 weeks" → days, or null. */
export function parseHorizonDays(textValue) {
  const t = String(textValue ?? "");
  const weeks = /(\d{1,2})\s*(?:Wochen|Woche|weeks?)\b/i.exec(t);
  if (weeks) return clampHorizon(Number(weeks[1]) * 7);
  const days = /(\d{1,3})\s*(?:Tagen|Tage|Tag|days?)\b/i.exec(t);
  if (days) return clampHorizon(Number(days[1]));
  const months = /(\d{1,2})\s*(?:Monaten|Monate|Monat|months?)\b/i.exec(t);
  if (months) return clampHorizon(Number(months[1]) * 30);
  return null;
}

// ── Suggestions ───────────────────────────────────────────────────────────────

/**
 * Make one suggestion (model output or a Komplettanalyse import) safe to
 * store: texts scrubbed and bounded, enums defaulted, the lane restricted to
 * the pass, the directive only for chat & prompt, every metric key checked
 * against the snapshot (unknown keys dropped, numbers frozen from the
 * snapshot), the priority computed. Returns null for an item without title,
 * reason or action.
 *
 * @param {unknown} raw
 * @param {{ flat?: Record<string, any>, lanes?: readonly string[], origin?: Record<string, any> }} [ctx]
 */
export function normalizeSuggestion(raw, { flat = {}, lanes = OWNER_LANES, origin = { kind: "engine" } } = {}) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, any>} */ (raw) : null;
  if (!o) return null;
  const title = text(o.title, LIMITS.title);
  const why = text(o.why, LIMITS.why);
  const action = text(o.action, LIMITS.action);
  if (!title || !why || !action) return null;
  const known = new Set(Object.keys(flat));

  const rawDirective = typeof o.directive === "string" ? o.directive.trim() : "";
  let lane = lanes.includes(o.lane) ? o.lane : rawDirective && lanes.includes("chat") ? "chat" : lanes[0];
  if (!OWNER_LANES.includes(lane)) lane = "operator";
  const directive = lane === "chat" && rawDirective ? text(rawDirective, MAX_DIRECTIVE_CHARS) : null;

  const expectedImpact = text(o.expectedImpact, LIMITS.expectedImpact);

  const evidence = (Array.isArray(o.evidence) ? o.evidence : [])
    .map((e) => {
      const item = typeof e === "string" ? { metricKey: null, text: e } : e && typeof e === "object" ? e : null;
      if (!item) return null;
      const key = typeof item.metricKey === "string" && known.has(item.metricKey.trim()) ? item.metricKey.trim() : null;
      const t = text(item.text, LIMITS.evidenceText);
      if (!t && !key) return null;
      return { key, text: t, metric: frozenMetric(flat, key) };
    })
    .filter(Boolean)
    .slice(0, LIMITS.evidence);

  const sm = o.successMetric && typeof o.successMetric === "object" ? o.successMetric : {};
  let smKey = typeof sm.key === "string" && known.has(sm.key.trim()) ? sm.key.trim() : null;
  if (!smKey) smKey = extractMetricKeys(`${expectedImpact} ${why} ${typeof sm.text === "string" ? sm.text : ""}`, known)[0] ?? null;
  const baseline = frozenMetric(flat, smKey);
  const successMetric = {
    key: smKey,
    label: baseline?.label ?? null,
    unit: baseline?.unit ?? null,
    baseline,
    target: smKey ? normaliseTarget(sm.target, baseline?.unit) : null,
    direction: sm.direction === "down" || sm.direction === "up" ? sm.direction : baseline?.good === "down" ? "down" : "up",
    horizonDays: clampHorizon(sm.horizonDays),
    text: typeof sm.text === "string" ? text(sm.text, LIMITS.expectedImpact) : null,
  };

  const impact = pick(o.impact, LEVELS, "mittel");
  const effort = pick(o.effort, LEVELS, "mittel");
  const confidence = pick(o.confidence, LEVELS, "mittel");
  const risk = o.risk === null && origin?.kind === "report" ? null : pick(o.risk, LEVELS, "niedrig");
  const score = priorityScore({ impact, effort, confidence, risk });
  return {
    lane,
    title,
    fingerprint: suggestionFingerprint(title),
    why,
    action,
    directive: directive || null,
    expectedImpact: expectedImpact || null,
    impact,
    effort,
    confidence,
    risk,
    riskNote: text(o.riskNote, LIMITS.riskNote) || null,
    evidence,
    successMetric,
    link: pick(o.link, LINK_TARGETS, "none"),
    refersTo: typeof o.refersTo === "string" && /^[DSK]\d{1,9}$/.test(o.refersTo.trim()) ? o.refersTo.trim() : null,
    origin: origin ?? { kind: "engine" },
    priority: score,
    tier: priorityTier(score),
  };
}

/**
 * A suggestion pass's output: headline + summary (the business pass) and up
 * to MAX_SUGGESTIONS_PER_LANE suggestions in the pass's lanes, best first.
 * @param {unknown} raw
 * @param {{ flat?: Record<string, any>, pass: "vorschlaege_chat" | "vorschlaege_betrieb" }} ctx
 */
export function normalizeSuggestionsPayload(raw, { flat = {}, pass }) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, any>} */ (raw) : {};
  const lanes = PASS_LANES[pass] ?? OWNER_LANES;
  const suggestions = (Array.isArray(o.suggestions) ? o.suggestions : [])
    .map((s) => normalizeSuggestion(s, { flat, lanes }))
    .filter(Boolean)
    .slice(0, MAX_SUGGESTIONS_PER_LANE);
  return {
    headline: text(o.headline, LIMITS.headline) || null,
    summary: text(o.summary, LIMITS.summary) || null,
    suggestions,
  };
}

/**
 * The columns of a v2 suggestion row: the coarse lane column (CHECK shop|mo),
 * the owner lane in `category`, and the decision fields in `evidence_json`
 * ({ version: 2, items, details }) — no migration (docs/IMPROVEMENT_LOOP.md).
 * @param {NonNullable<ReturnType<typeof normalizeSuggestion>>} s
 */
export function suggestionStorage(s) {
  return {
    lane: storageLaneFor(s.lane),
    category: s.lane,
    title: s.title,
    fingerprint: s.fingerprint,
    rationale: s.why,
    proposal: s.action,
    directive: s.directive,
    expectedEffect: s.expectedImpact,
    impact: s.impact,
    effort: s.effort,
    evidence: {
      version: SUGGESTION_DETAILS_VERSION,
      items: s.evidence,
      details: {
        lane: s.lane,
        confidence: s.confidence,
        risk: s.risk,
        riskNote: s.riskNote,
        successMetric: s.successMetric,
        link: s.link,
        refersTo: s.refersTo,
        origin: s.origin,
      },
    },
  };
}

/**
 * Read a stored `evidence_json`: v1 rows are a string array, v2 rows an
 * object with the decision details.
 * @param {unknown} json
 * @returns {{ version: 1 | 2, items: Array<{ key: string | null, text: string, metric: any }>, details: Record<string, any> | null }}
 */
export function readSuggestionDetails(json) {
  if (Array.isArray(json)) {
    return {
      version: 1,
      items: json.filter((e) => typeof e === "string").map((e) => ({ key: null, text: e, metric: null })),
      details: null,
    };
  }
  const o = json && typeof json === "object" ? /** @type {Record<string, any>} */ (json) : null;
  if (!o || Number(o.version) < 2) return { version: 1, items: [], details: null };
  const items = (Array.isArray(o.items) ? o.items : [])
    .filter((e) => e && typeof e === "object")
    .map((e) => ({ key: typeof e.key === "string" ? e.key : null, text: String(e.text ?? ""), metric: e.metric ?? null }));
  return { version: 2, items, details: o.details && typeof o.details === "object" ? o.details : {} };
}

// ── Wirkungs-Check review ─────────────────────────────────────────────────────

/**
 * The strategist's reading of the measured changes, restricted to the refs
 * that were measured (one item per ref).
 * @param {unknown} raw
 * @param {string[]} refs
 */
export function normalizeEffectReview(raw, refs) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, any>} */ (raw) : {};
  const allowed = new Set(refs ?? []);
  const seen = new Set();
  const items = [];
  for (const it of Array.isArray(o.items) ? o.items : []) {
    if (!it || typeof it !== "object") continue;
    const ref = typeof it.ref === "string" ? it.ref.trim() : "";
    if (!allowed.has(ref) || seen.has(ref)) continue;
    seen.add(ref);
    items.push({
      ref,
      assessment: text(it.assessment, LIMITS.assessment),
      recommendation: pick(it.recommendation, REVIEW_RECOMMENDATIONS, "beobachten"),
      nextStep: text(it.nextStep, LIMITS.nextStep) || null,
    });
  }
  return { summary: text(o.summary, LIMITS.summary) || null, items };
}

// ── Komplettanalyse import ────────────────────────────────────────────────────

const REPORT_EFFORT = Object.freeze({ klein: "niedrig", mittel: "mittel", gross: "hoch" });
const CAMPAIGN_LINKS = new Set(["kampagnen", "kampagne_neu", "kpi_kampagnen"]);

/** The owner lane of a Komplettanalyse recommendation. */
export function laneForReportRecommendation(rec) {
  if (rec?.link === "verbesserung") return "chat";
  if (CAMPAIGN_LINKS.has(rec?.link)) return "campaign";
  switch (rec?.owner) {
    case "frontend":
      return "frontend";
    case "lawyer":
      return "legal";
    case "developer":
      return "developer";
    default:
      return "operator";
  }
}

/**
 * The recommendations of a decision report (v2) as suggestions of this run —
 * those not imported before (same report and position) and not already in
 * the backlog (fingerprint of a non-dismissed suggestion). The success metric
 * is the first snapshot key the recommendation names; its free-text target
 * stays visible.
 *
 * @param {any} sections the report's stored sections
 * @param {{
 *   reportId: number, reportTitle: string, flat: Record<string, any>,
 *   existing?: Array<{ fingerprint: string, status: string, origin?: { kind?: string, reportId?: number, index?: number } | null }>,
 * }} ctx
 */
export function importReportRecommendations(sections, { reportId, reportTitle, flat, existing = [] }) {
  const recs = Array.isArray(sections?.decision?.recommendations) ? sections.decision.recommendations : [];
  const known = new Set(Object.keys(flat ?? {}));
  const imported = new Set(
    existing
      .filter((e) => e.origin?.kind === "report" && Number(e.origin.reportId) === Number(reportId))
      .map((e) => Number(e.origin?.index))
  );
  const fingerprints = new Set(existing.filter((e) => e.status !== "dismissed").map((e) => e.fingerprint));
  const out = [];
  recs.forEach((rec, index) => {
    if (!rec || typeof rec !== "object" || imported.has(index)) return;
    const keys = extractMetricKeys(`${rec.successMetric ?? ""} ${rec.why ?? ""}`, known);
    const evidenceKeys = extractMetricKeys(rec.why, known);
    const s = normalizeSuggestion(
      {
        title: rec.title,
        why: rec.why,
        action: rec.action,
        expectedImpact: rec.expectedImpact,
        impact: rec.impact,
        effort: REPORT_EFFORT[rec.effort] ?? "mittel",
        confidence: rec.confidence,
        risk: null,
        link: rec.link,
        lane: laneForReportRecommendation(rec),
        evidence: [{ metricKey: evidenceKeys[0] ?? keys[0] ?? null, text: rec.why }],
        successMetric: {
          key: keys[0] ?? null,
          target: null,
          horizonDays: parseHorizonDays(rec.successMetric) ?? 28,
          text: rec.successMetric,
        },
      },
      { flat, lanes: OWNER_LANES, origin: { kind: "report", reportId: Number(reportId), index, reportTitle: text(reportTitle, 160) } }
    );
    if (!s || fingerprints.has(s.fingerprint)) return;
    fingerprints.add(s.fingerprint);
    out.push(s);
  });
  return out;
}

/** How many recommendations of a report are still to import (for the new-run panel). */
export function countImportable(sections, reportId, existing) {
  const recs = Array.isArray(sections?.decision?.recommendations) ? sections.decision.recommendations : [];
  const imported = new Set(
    (existing ?? [])
      .filter((e) => e.origin?.kind === "report" && Number(e.origin.reportId) === Number(reportId))
      .map((e) => Number(e.origin?.index))
  );
  return { total: recs.length, open: recs.filter((_, i) => !imported.has(i)).length };
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const LANE_LINES = OWNER_LANES.map((l) => `- ${l} (${OWNER_LANE_LABELS[l]}): ${OWNER_LANE_DESCRIPTIONS[l]}`);

/** The system prompt of all three strategist passes of a Verbesserungslauf. */
export const IMPROVEMENT_SYSTEM = [
  "Du bist der Verbesserungs-Stratege von motion sports (Onlineshop für Fitness- und Kraftsportgeräte, Shopify). Du hilfst den Inhabern, „Mo“ — den KI-Berater im Shop-Chat — und das Geschäft rund um Mo Schritt für Schritt besser zu machen, und prüfst ehrlich, ob umgesetzte Änderungen wirken.",
  "",
  "Was Mo ist: Mo berät im Chat-Widget auf der Shopify-Seite, empfiehlt Produkte (Produktkarten, Warenkorb-Links, Set-Angebote), kennt auf Produktseiten das Produkt der Seite (Seitenkontext), beantwortet Fragen zum Bestellstatus, bietet eine E-Mail-Zusammenfassung an, lädt anonyme Besucher:innen zur Anmeldung ein (auch über den Shop-Login per App Proxy erkannt) und fragt Angemeldete per Popup nach der Werbe-Einwilligung (Double-Opt-in, Varianten). Der Admin verschickt Kampagnen-Mails (MK-Codes) und persönliche Mails (MS5-Codes) an Kund:innen mit Einwilligung, optional Briefe. Bestellungen mit Mo-Markierung oder Mo-Code werden Mo zugeordnet (Direkt, Beraten & gekauft, Beraten, anderes gekauft). Der Eingang schlägt dem Betrieb Kund:innen vor, die heute Aufmerksamkeit brauchen; im Wissen beantwortet der Betrieb Wissenslücken, die Mo im Chat hatte.",
  "",
  "Der Verbesserungs-Kreislauf: Du schlägst nur vor. Ein Mensch entscheidet jede Karte (übernehmen, einplanen, verwerfen); eine Anweisung an Mo wird erst nach einem Klick live, der Kern-Prompt ändert sich nur per Code. Der nächste Lauf misst jede umgesetzte Änderung an ihrer Erfolgskennzahl (Vorher/Nachher-Fenster mit Signifikanztest) — deshalb braucht jeder Vorschlag eine Erfolgskennzahl, die als Schlüssel in den Geschäftsdaten steht.",
  "",
  "Bereiche (lane) — wer handelt:",
  ...LANE_LINES,
  "",
  "Regeln:",
  "- Nutze ausschließlich die gelieferten Daten. Jede Zahl, die du nennst, stammt aus den Daten; nenne bei Quoten die Basis (n) und die Vorperiode. Erfinde keine Zahlen, keine Benchmarks und keine Funktionen, die es nicht gibt.",
  "- Kennzahlen immer mit ihrem Schlüssel in eckigen Klammern, z. B. [signin.popupRate]. Erfolgskennzahl und Belege nur mit Schlüsseln, die in den Daten stehen.",
  "- Messhinweise beachten: kleine Stichproben, Releases (Messänderungen) und Schalter. Behaupte keine Wirkung über eine Messänderung hinweg und keine Kausalität — eine Bewegung „passt zu“ einer Änderung, mehr nicht. Senke die Konfidenz, wo die Daten dünn sind.",
  "- Keine personenbezogenen Daten: keine Namen, E-Mail-Adressen oder Bestellnummern — nur Gruppen und Zahlen.",
  "- Rechtliches (Einwilligung, Werbung, Datenschutz) nie eigenmächtig lockern; wo nötig, Bereich legal.",
  `- Anweisungen an Mo (directive, nur Bereich chat): höchstens ${MAX_DIRECTIVE_CHARS} Zeichen, an Mo gerichtet („Wenn …, dann …“), sofort umsetzbar; nie rechtliche Zusagen, Medizin-Beratung, Rabatte oder Versprechen, die der Shop nicht hält. Mos Kernregeln gehen immer vor.`,
  "- Wiederhole nichts, was schon im Backlog steht (auch Verworfenes nicht, außer neue Daten sprechen klar dafür) — verweise stattdessen mit refersTo darauf, wenn du es konkretisierst.",
  "- Deutsch, klar und knapp, wie für eine Geschäftsführung: erst die Aussage, dann die Zahl. Keine Floskeln.",
].join("\n");

function fmt(unit, v) {
  return formatMetricValue(unit, v);
}

function nText(n) {
  if (!n) return "";
  const a = n.after != null ? `n = ${n.after}` : "";
  const b = n.before != null ? `vorher n = ${n.before}` : "";
  return [a, b].filter(Boolean).join(", ");
}

/** The headline metrics of a snapshot as one compact block. */
export function renderHeadlineForPrompt(snapshot) {
  const flat = flattenSnapshot(snapshot);
  return HEADLINE_METRICS.map((k) => flat[k])
    .filter(Boolean)
    .map((m) => `- ${m.label} [${m.key}]: ${fmt(m.unit, m.value)}${m.previous != null ? ` (Vorperiode ${fmt(m.unit, m.previous)}${formatMetricDelta(m) ? `, ${formatMetricDelta(m)}` : ""})` : ""}`)
    .join("\n");
}

/** What moved in the period (snapshotMovers) as text. */
export function renderMoversForPrompt(movers) {
  if (!movers) return "(keine Daten)";
  const line = (m) =>
    `- ${m.label} [${m.key}]: ${fmt(m.unit, m.value)} (Vorperiode ${fmt(m.unit, m.previous)}, ${m.deltaText}${m.significant ? "; statistisch klar" : "; im Rahmen des Zufalls"}${m.small ? "; kleine Stichprobe" : ""})`;
  return [
    "Besser geworden:",
    ...(movers.improved.length ? movers.improved.map(line) : ["- (nichts Nennenswertes)"]),
    "Schlechter geworden:",
    ...(movers.worsened.length ? movers.worsened.map(line) : ["- (nichts Nennenswertes)"]),
    ...(movers.notComparable.length
      ? [`Nicht vergleichbar (Messänderung im Zeitraum): ${movers.notComparable.map((m) => `${m.label} [${m.key}]`).join(", ")}`]
      : []),
  ].join("\n");
}

const SOURCE_LABELS = { erfolgsmass: "Erfolgskennzahl des Vorschlags", erwartete_wirkung: "aus der erwarteten Wirkung", standard: "Standardkennzahl des Bereichs (kein Erfolgsmaß hinterlegt)" };

/** The deterministic measurement (improvement-effects measureChange) as text. */
export function renderMeasurementsForPrompt(measurements, review = null) {
  if (!Array.isArray(measurements) || measurements.length === 0) return "(keine umgesetzten Änderungen im Messzeitraum)";
  const byRef = new Map((review?.items ?? []).map((i) => [i.ref, i]));
  const blocks = measurements.map((m) => {
    const head = `[${m.ref}] ${m.kind === "directive" ? "Anweisung" : "Maßnahme"} (${OWNER_LANE_LABELS[m.lane] ?? m.lane}) seit ${m.date}${m.until ? ` bis ${m.until} (deaktiviert)` : ""}: „${scrubPii(m.title)}“`;
    const w = m.window?.days
      ? `Fenster: nachher ${m.window.from} bis ${m.window.to} (${m.window.days} Tage${m.window.complete ? "" : `, läuft noch bis ${m.window.horizonDays} Tage`}), vorher ${m.window.before?.from} bis ${m.window.before?.to}`
      : "Fenster: noch keine vollständigen Tage nach der Änderung";
    const metrics = (m.metrics ?? []).map(
      (x) =>
        `  - ${x.role === "primary" ? `Erfolgskennzahl (${SOURCE_LABELS[m.metricSource] ?? m.metricSource})` : "Nebenwirkung"} ${x.label} [${x.key}]: vorher ${fmt(x.unit, x.previous)}, nachher ${fmt(x.unit, x.value)}${x.deltaText ? ` (${x.deltaText})` : ""}${nText(x.testN) ? `; ${nText(x.testN)}` : ""}${x.z != null ? `; z = ${num(x.z, 2)}` : ""} → ${VERDICT_LABELS[x.verdict] ?? x.verdict}${x.confidence ? `, Konfidenz ${x.confidence}` : ""}${x.reasons?.length ? ` (${x.reasons.join(" ")})` : ""}`
    );
    const conf = (m.confounders ?? []).map((c) => `  - ${c.measurement ? "Messänderung" : "Störfaktor"}: ${c.label}`);
    const target = m.target ? [`  - Ziel: ${m.target.direction === "down" ? "≤" : "≥"} ${fmt(m.metrics?.[0]?.unit, m.target.value)} — ${m.target.reached === null ? "nicht prüfbar" : m.target.reached ? "erreicht" : "nicht erreicht"}`] : [];
    const r = byRef.get(m.ref);
    const rev = r ? [`  - Einschätzung: ${r.assessment} → ${REVIEW_LABELS[r.recommendation]}${r.nextStep ? `; nächster Schritt: ${r.nextStep}` : ""}`] : [];
    return [head, `  ${w}`, ...metrics, ...conf, ...target, ...rev].join("\n");
  });
  return blocks.join("\n");
}

/**
 * The backlog (open, planned, done, dismissed — any run) for the strategist:
 * what not to repeat, what to build on.
 * @param {Array<{ id: number, title: string, status: string, lane?: string, category?: string, impact?: string, effort?: string, confidence?: string | null, risk?: string | null, successMetricKey?: string | null, origin?: any, statusNote?: string | null }>} items
 */
export function renderBacklogForPrompt(items) {
  if (!Array.isArray(items) || items.length === 0) return "(leer)";
  return items
    .map((s) => {
      const lane = ownerLaneOf(s);
      const bits = [
        `[S${s.id}]`,
        `${OWNER_LANE_LABELS[lane]}`,
        `„${scrubPii(s.title)}“`,
        `Status: ${SUGGESTION_STATUS_LABELS[s.status] ?? s.status}`,
        `P${priorityTier(priorityScore(s))}`,
      ];
      if (s.successMetricKey) bits.push(`Erfolg: [${s.successMetricKey}]`);
      if (s.origin?.kind === "report") bits.push(`aus Komplettanalyse #${s.origin.reportId}`);
      if (s.statusNote) bits.push(`Notiz: ${scrubPii(s.statusNote)}`);
      return `- ${bits.join(" · ")}`;
    })
    .join("\n");
}

/** Mo's directives (active and recently deactivated) with their refs. */
export function renderDirectivesForPrompt(directives) {
  if (!Array.isArray(directives) || directives.length === 0) return "(keine)";
  return directives.map((d) => `- [D${d.id}] ${d.active ? "aktiv" : "inaktiv"}: ${scrubPii(d.content)}`).join("\n");
}

/** Pass `wirkungscheck`: system + prompt. */
export function buildEffectReviewPrompt({ snapshot, movers, measurements, directives = [] }) {
  return {
    system: IMPROVEMENT_SYSTEM,
    prompt: [
      `# Zeitraum ${snapshot?.period?.label ?? "?"} (Vorperiode ${snapshot?.previous?.label ?? "?"})`,
      renderHeadlineForPrompt(snapshot),
      "",
      "# Was sich im Zeitraum bewegt hat",
      renderMoversForPrompt(movers),
      "",
      "# Gemessene Änderungen (deterministisch gemessen — Urteile und Konfidenz stehen fest)",
      renderMeasurementsForPrompt(measurements),
      "",
      "# Anweisungen an Mo",
      renderDirectivesForPrompt(directives),
      "",
      "# Aufgabe",
      "Erstelle den Wirkungs-Check:",
      "1. items: für JEDE gemessene Änderung (ref wie oben, z. B. D3 oder S12) eine Einschätzung in 1–2 Sätzen — was die Messung zeigt und was nicht (Stichprobe, Störfaktoren, Messänderung, Ziel). Übernimm das Urteil der Messung; widersprich nur mit einem Grund aus den Daten.",
      "   recommendation: beibehalten (wirkt oder schadet nicht und ist gewollt), anpassen (Richtung stimmt nicht oder Nebenwirkung), zuruecknehmen (schadet belastbar), beobachten (zu früh, zu wenig Daten, nicht vergleichbar). nextStep: der konkrete nächste Schritt (z. B. Text der Anweisung schärfen, ab einem Datum neu messen, Kontrollgruppe).",
      "2. summary: das Gesamtbild in 3–5 Sätzen — was wirkt, was nicht, was offen ist; keine Kausalität behaupten.",
    ].join("\n"),
  };
}

/**
 * Pass `vorschlaege_chat` or `vorschlaege_betrieb`: system + prompt.
 * @param {"vorschlaege_chat" | "vorschlaege_betrieb"} pass
 */
export function buildSuggestionPrompt(pass, input) {
  const {
    snapshot,
    movers,
    measurements = [],
    review = null,
    backlog = [],
    directives = [],
    selfSnapshot = null,
    reportExtract = null,
    reportTitle = null,
    earlier = [],
  } = input;
  const lanes = PASS_LANES[pass];
  const isChat = pass === "vorschlaege_chat";
  const parts = [
    "# Geschäftsdaten (Zeitraum und Vorperiode)",
    renderSnapshotForPrompt(snapshot, { maxChars: 26_000 }),
    "",
    "# Was sich im Zeitraum bewegt hat",
    renderMoversForPrompt(movers),
    "",
    "# Wirkung umgesetzter Änderungen",
    renderMeasurementsForPrompt(measurements, review),
    ...(review?.summary ? ["", `Gesamtbild des Wirkungs-Checks: ${review.summary}`] : []),
    "",
    "# Backlog (alle bisherigen Vorschläge, auch aus der Komplettanalyse)",
    renderBacklogForPrompt(backlog),
    "",
    "# Anweisungen an Mo",
    renderDirectivesForPrompt(directives),
  ];
  if (isChat && selfSnapshot) {
    const clamped = selfSnapshot.length > 32_000 ? `${selfSnapshot.slice(0, 32_000)}\n… (gekürzt)` : selfSnapshot;
    parts.push("", "# Mos aktuelle Konfiguration (Selbstbild: System-Prompt, Werkzeuge, Personas)", clamped);
  }
  if (reportExtract) {
    parts.push("", `# Gesprächs-Insights der Komplettanalyse${reportTitle ? ` „${scrubPii(reportTitle)}“` : ""}`, reportExtract);
  }
  if (!isChat && earlier.length) {
    parts.push(
      "",
      "# In diesem Lauf bereits erarbeitet (Chat, Prompt & Widget — nicht wiederholen)",
      earlier.map((s) => `- ${OWNER_LANE_LABELS[s.lane] ?? s.lane}: ${s.title}`).join("\n")
    );
  }
  const focus = isChat
    ? "Prüfe dabei ausdrücklich, wo die Daten es tragen: den Weg vom Chat zur Bestellung (Journey-Funnel, Warenkorb-Klicks, Set-Angebote), den Seitenkontext auf Produktseiten, Wissenslücken und offenen Bedarf, den Bestellstatus im Chat, Feedback aus dem Widget, das Anmelde-Popup und die Erkennung über den Shop-Login, das Einwilligungs-Popup und seine Varianten, die E-Mail-Zusammenfassung und die KI-Kosten je Beratung."
    : "Prüfe dabei ausdrücklich, wo die Daten es tragen: den Umsatz durch Mo nach Stufen und Wegen (Code, Mo-Link, Widget, Kampagne, Set), Kampagnen und Briefe (Klicks, Bestellungen, Abmeldungen, Bewertungen), die Einwilligungsbasis und die DOI-Quote, den Eingang (gehandelt, Umsatz nach Handeln), Wiederkauf und Segmente, Messlücken (z. B. Kontrollgruppen), rechtliche Fragen der Einwilligung und die KI-Kosten im Verhältnis zum Umsatz.";
  parts.push(
    "",
    "# Aufgabe",
    `Erarbeite die bis zu ${MAX_SUGGESTIONS_PER_LANE} wirksamsten Vorschläge für die Bereiche ${lanes.map((l) => `${l} (${OWNER_LANE_LABELS[l]})`).join(", ")} — wichtigste zuerst (Wirkung × Konfidenz ÷ Aufwand). Lieber wenige starke als viele schwache; keine Allgemeinplätze.`,
    focus,
    "Jeder Vorschlag:",
    "- title: Imperativ, höchstens ~12 Wörter. why: 1–3 Sätze mit den belegenden Zahlen. action: die konkreten ersten Schritte, so genau, dass ein Mensch sie direkt umsetzen kann.",
    isChat
      ? `- directive: nur im Bereich chat, wenn eine Anweisung an Mo genügt — der fertige Anweisungstext (≤ ${MAX_DIRECTIVE_CHARS} Zeichen); sonst null. Eine Änderung am Kern-Prompt beschreibst du in action (Abschnitt, neuer Wortlaut) mit directive null.`
      : "- directive: immer null in diesen Bereichen.",
    "- evidence: 1–4 Belege, jeder mit metricKey (Schlüssel aus den Daten, sonst leer) und text (die Zahl mit Basis und Vorperiode).",
    "- expectedImpact: die erwartete Wirkung, möglichst beziffert, mit Annahme.",
    "- successMetric: key = EIN Schlüssel aus den Daten, an dem der nächste Lauf den Erfolg misst; target = Zielwert in der Einheit der Kennzahl (Quoten als Anteil 0–1, Beträge in €, Anzahlen als Zahl) oder null; direction = up oder down; horizonDays = nach wie vielen Tagen messbar (7–90, bei wenig Volumen länger).",
    "- impact, effort (Aufwand), confidence, risk: hoch, mittel oder niedrig; riskNote: das Risiko in einem Satz (oder leer).",
    "- link: der Admin-Bildschirm, in dem gehandelt wird (sonst none). refersTo: D<id> oder S<id>, wenn der Vorschlag eine bestehende Anweisung oder einen Backlog-Eintrag konkretisiert oder ersetzt; sonst null.",
    isChat
      ? "headline und summary: leer lassen (die Lage schreibt der zweite Durchgang)."
      : "headline: ein Satz — die wichtigste Erkenntnis des Zeitraums, mit Zahl. summary: 3–5 Sätze — was besser und was schlechter wurde, was die umgesetzten Änderungen gebracht haben, der größte Hebel und das größte Risiko."
  );
  return { system: IMPROVEMENT_SYSTEM, prompt: parts.join("\n") };
}

// ── Estimates ─────────────────────────────────────────────────────────────────
// Rough token figures per strategist pass (output includes the thinking at
// effort high) — shown as "ca. X €" before the operator starts a run.

const STRATEGIST_MODEL = modelFor("strategist");
const EST = Object.freeze({
  wirkungscheck: { in: 14000, out: 8000 },
  vorschlaege_chat: { in: 36000, out: 13000 },
  vorschlaege_betrieb: { in: 24000, out: 13000 },
});

/** Estimated USD cost of a run's strategist passes. */
export function estimateImprovementCostUsd(prices, { withEffectCheck = true } = {}) {
  const unit = (k) => usdCostForUsage({ model: STRATEGIST_MODEL, inputTokens: EST[k].in, outputTokens: EST[k].out }, prices);
  return (withEffectCheck ? unit("wirkungscheck") : 0) + unit("vorschlaege_chat") + unit("vorschlaege_betrieb");
}

/** Rough wall-clock minutes [low, high]: snapshots + measurement + 2–3 Opus passes of 1–4 min. */
export function estimateImprovementMinutes({ withEffectCheck = true, changes = 0 } = {}) {
  const passes = withEffectCheck ? 3 : 2;
  const measure = Math.min(8, Math.max(0, Number(changes) || 0));
  return [Math.max(2, Math.round(0.3 + measure * 0.05 + passes * 1)), Math.max(4, Math.round(1 + measure * 0.2 + passes * 4))];
}

/** Label for an effort value (stored hoch|mittel|niedrig, shown as size). */
export function effortLabel(effort) {
  return EFFORT_LABELS[effort] ?? effort;
}
