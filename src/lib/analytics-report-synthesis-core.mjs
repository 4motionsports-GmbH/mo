// The decision layer of the Komplettanalyse — pure, no I/O, no model call.
// Two strategist passes (lib/ai-models.mjs tier `strategist`, Opus 5.5) turn
// the business snapshot plus the conversation insights into decisions:
//
//   pass 1 „Entscheidungen“ (phase `decisions`) — executive summary, the 3–5
//          decisions to take now, how the revenue through Mo came about, the
//          funnel bottlenecks, what changed since the previous report,
//          segment and campaign insights;
//   pass 2 „Maßnahmen“ (phase `plan`) — prioritised recommendations (impact,
//          effort, confidence, owner, success metric, admin link), experiments,
//          risks and data-quality caveats.
//
// This module owns the structured-output schemas (zod, no min/max keywords —
// Anthropic structured output rejects them; the normalisers clamp instead),
// the normalisers that make any model output safe to store and render, the
// prompts, the comparison with the previously stored report, the effort
// ladder for retries and the version helpers that keep older reports
// renderable. analytics-report-generate.ts runs the passes; ReportView and the
// PDF render the result.

import { z } from "zod";
import {
  LINK_TARGETS,
  adminLinkFor,
  flattenSnapshot,
  formatMetricValue,
  metricDelta,
  renderSnapshotForPrompt,
  scrubPii,
} from "./business-snapshot-core.mjs";

/** Version of the stored `sections` payload. 1 = before the decision layer. */
export const REPORT_SECTIONS_VERSION = 2;

// ── Vocabularies ──────────────────────────────────────────────────────────────

export const OWNERS = Object.freeze(["operator", "developer", "frontend", "lawyer"]);
export const OWNER_LABELS = Object.freeze({
  operator: "Betrieb",
  developer: "Entwicklung",
  frontend: "Frontend",
  lawyer: "Anwalt",
});
/** What each owner means — the InfoTip text and the prompt's definition. */
export const OWNER_DESCRIPTIONS = Object.freeze({
  operator: "Betrieb im Admin: Kampagnen, Eingang, Kunden, Wissen beantworten, Schalter umlegen lassen.",
  developer: "Backend-Entwicklung: Code, Mos Prompt und Werkzeuge, Messung, neue Funktionen.",
  frontend: "Widget und Shopify-Theme (Frontend-Agent).",
  lawyer: "Rechtliche Prüfung: Einwilligung, Werbung, Datenschutz.",
});

export const LEVELS = Object.freeze(["hoch", "mittel", "niedrig"]);
export const LEVEL_LABELS = Object.freeze({ hoch: "hoch", mittel: "mittel", niedrig: "niedrig" });
export const EFFORTS = Object.freeze(["klein", "mittel", "gross"]);
export const EFFORT_LABELS = Object.freeze({ klein: "klein", mittel: "mittel", gross: "groß" });
export const DIRECTIONS = Object.freeze(["besser", "schlechter", "gleich", "unklar"]);

/** Bounds the normalisers enforce (the schemas cannot carry them). */
export const LIMITS = Object.freeze({
  decisions: 5,
  drivers: 6,
  bottlenecks: 6,
  changes: 8,
  segments: 6,
  campaigns: 6,
  recommendations: 10,
  experiments: 5,
  risks: 8,
  dataQuality: 6,
  shortText: 160,
  text: 900,
  longText: 1600,
});

const LINK_HELP = LINK_TARGETS.filter((k) => k !== "none")
  .map((k) => `${k} = ${adminLinkFor(k)?.label}`)
  .join("; ");

// ── Schemas (structured output) ───────────────────────────────────────────────

const owner = () => z.enum(OWNERS).describe("Wer handelt: operator, developer, frontend oder lawyer.");
const level = (what) => z.enum(LEVELS).describe(what);
const link = () =>
  z.enum(LINK_TARGETS).describe(`Admin-Bildschirm, in dem gehandelt wird (sonst none): ${LINK_HELP}.`);

export const decisionsSchema = z.object({
  headline: z.string().describe("Ein Satz: die wichtigste Erkenntnis des Zeitraums, mit Zahl."),
  summary: z
    .string()
    .describe("Executive Summary in 3–5 Sätzen: Lage, Umsatz über Mo, größter Hebel, größtes Risiko — mit Zahlen und Vergleich zur Vorperiode."),
  decisions: z
    .array(
      z.object({
        title: z.string().describe("Die Entscheidung als Imperativ, max. ~12 Wörter."),
        rationale: z.string().describe("Warum jetzt — 1–3 Sätze mit den belegenden Zahlen aus den Daten."),
        owner: owner(),
        impact: level("Erwartete Wirkung auf Umsatz oder Kundenbasis."),
        confidence: level("Wie belastbar die Datenlage ist (kleine Stichproben = niedrig)."),
        metric: z.string().describe("Woran man in 2–4 Wochen sieht, ob es wirkt (Kennzahl + Zielrichtung)."),
        link: link(),
      })
    )
    .describe("Die 3–5 Entscheidungen, die jetzt zu treffen sind, wichtigste zuerst."),
  revenue: z.object({
    summary: z.string().describe("Wie der Umsatz über Mo zustande kam (2–4 Sätze, Zahlen, Vorperiode)."),
    drivers: z
      .array(z.object({ title: z.string(), detail: z.string().describe("1–2 Sätze mit Zahlen.") }))
      .describe("Die 2–5 Treiber bzw. Bremsen des Umsatzes über Mo."),
  }),
  bottlenecks: z
    .array(
      z.object({
        stage: z.string().describe("Funnel-Stufe, z. B. „Popup → im Chat angemeldet“."),
        finding: z.string().describe("Was dort verloren geht und warum vermutlich (1–2 Sätze)."),
        evidence: z.string().describe("Die Zahlen: Wert, Basis n, Vorperiode."),
        impact: level("Wie viel Umsatz oder Kundenbasis hier verloren geht."),
        link: link(),
      })
    )
    .describe("Die 2–5 größten Engpässe im Funnel, größter zuerst."),
  changes: z.object({
    summary: z.string().describe("Was sich seit dem letzten gespeicherten Bericht verändert hat (2–3 Sätze); ohne Vorbericht: gegenüber der Vorperiode."),
    items: z
      .array(
        z.object({
          title: z.string(),
          detail: z.string().describe("1–2 Sätze, mit Zahlen; ob frühere Empfehlungen sichtbar wirken."),
          direction: z.enum(DIRECTIONS).describe("besser, schlechter, gleich oder unklar (z. B. Messänderung)."),
        })
      )
      .describe("Die 3–6 wichtigsten Veränderungen."),
  }),
  segments: z
    .array(
      z.object({
        segment: z.string().describe("Segment oder Persona, z. B. „Zurückholen“ oder „Großgeräte-Käufer“."),
        insight: z.string().describe("Was die Daten über diese Gruppe sagen (1–2 Sätze)."),
        action: z.string().describe("Was daraus folgt (1 Satz)."),
        link: link(),
      })
    )
    .describe("2–5 Erkenntnisse zu Kundengruppen, Lebenszyklus und Personas."),
  campaigns: z.object({
    summary: z.string().describe("Kampagnen-Leistung im Zeitraum (2–3 Sätze); ohne Versand: was fehlt."),
    items: z
      .array(z.object({ campaign: z.string(), insight: z.string(), action: z.string() }))
      .describe("Je Kampagne (höchstens 5) Erkenntnis und Folgerung."),
  }),
});

export const planSchema = z.object({
  recommendations: z
    .array(
      z.object({
        title: z.string().describe("Die Maßnahme als Imperativ, max. ~12 Wörter."),
        why: z.string().describe("Begründung mit den belegenden Zahlen (1–3 Sätze)."),
        action: z.string().describe("Konkrete erste Schritte (1–3 Sätze)."),
        expectedImpact: z.string().describe("Erwartete Wirkung, möglichst beziffert (z. B. „+2–4 Bestellungen/Monat“), mit Annahme."),
        impact: level("Wirkung."),
        effort: z.enum(EFFORTS).describe("Aufwand: klein, mittel oder gross."),
        confidence: level("Konfidenz."),
        owner: owner(),
        successMetric: z.string().describe("Erfolgsmessung: Kennzahl (mit Schlüssel, z. B. signin.popupRate), Zielwert, Zeitraum."),
        link: link(),
      })
    )
    .describe("5–10 Maßnahmen, nach Priorität sortiert (Wirkung × Konfidenz ÷ Aufwand)."),
  experiments: z
    .array(
      z.object({
        title: z.string(),
        hypothesis: z.string().describe("Wenn …, dann …, weil …"),
        design: z.string().describe("Aufbau: Varianten bzw. Kontrollgruppe, Zielgruppe, Umsetzung."),
        metric: z.string().describe("Primäre Kennzahl (mit Schlüssel)."),
        duration: z.string().describe("Laufzeit und benötigte Fallzahl je Gruppe, realistisch für das aktuelle Volumen."),
        successCriterion: z.string().describe("Ab wann gilt es als Erfolg bzw. Misserfolg."),
        owner: owner(),
      })
    )
    .describe("2–4 Experimente, die eine offene Frage klären."),
  risks: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        severity: level("Schwere."),
        mitigation: z.string().describe("Gegenmaßnahme."),
        owner: owner(),
      })
    )
    .describe("2–6 Risiken (Umsatz, Recht/Einwilligung, Technik, Reputation)."),
  dataQuality: z
    .array(z.object({ title: z.string(), detail: z.string() }))
    .describe("Messlücken und Vorbehalte, die die Empfehlungen einschränken (zusätzlich zu den gelieferten Hinweisen)."),
});

// ── Normalisers ───────────────────────────────────────────────────────────────

function text(v, max = LIMITS.text) {
  const s = scrubPii(typeof v === "string" ? v : v == null ? "" : String(v))
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function pick(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

function list(v, max, mapItem, keep) {
  return (Array.isArray(v) ? v : [])
    .filter((x) => x && typeof x === "object")
    .map(mapItem)
    .filter(keep)
    .slice(0, max);
}

/**
 * Make pass 1's output safe to store: strings trimmed, scrubbed and bounded,
 * enums defaulted, lists capped, items without a title dropped.
 * @param {unknown} raw
 */
export function normalizeDecisions(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, any>} */ (raw) : {};
  return {
    headline: text(o.headline, LIMITS.shortText * 2),
    summary: text(o.summary, LIMITS.longText),
    decisions: list(
      o.decisions,
      LIMITS.decisions,
      (d) => ({
        title: text(d.title, LIMITS.shortText),
        rationale: text(d.rationale),
        owner: pick(d.owner, OWNERS, "operator"),
        impact: pick(d.impact, LEVELS, "mittel"),
        confidence: pick(d.confidence, LEVELS, "mittel"),
        metric: text(d.metric, LIMITS.shortText * 2),
        link: pick(d.link, LINK_TARGETS, "none"),
      }),
      (d) => d.title !== ""
    ),
    revenue: {
      summary: text(o.revenue?.summary, LIMITS.longText),
      drivers: list(
        o.revenue?.drivers,
        LIMITS.drivers,
        (d) => ({ title: text(d.title, LIMITS.shortText), detail: text(d.detail) }),
        (d) => d.title !== ""
      ),
    },
    bottlenecks: list(
      o.bottlenecks,
      LIMITS.bottlenecks,
      (b) => ({
        stage: text(b.stage, LIMITS.shortText),
        finding: text(b.finding),
        evidence: text(b.evidence, LIMITS.shortText * 2),
        impact: pick(b.impact, LEVELS, "mittel"),
        link: pick(b.link, LINK_TARGETS, "none"),
      }),
      (b) => b.stage !== ""
    ),
    changes: {
      summary: text(o.changes?.summary, LIMITS.longText),
      items: list(
        o.changes?.items,
        LIMITS.changes,
        (c) => ({ title: text(c.title, LIMITS.shortText), detail: text(c.detail), direction: pick(c.direction, DIRECTIONS, "unklar") }),
        (c) => c.title !== ""
      ),
    },
    segments: list(
      o.segments,
      LIMITS.segments,
      (s) => ({
        segment: text(s.segment, LIMITS.shortText),
        insight: text(s.insight),
        action: text(s.action),
        link: pick(s.link, LINK_TARGETS, "none"),
      }),
      (s) => s.segment !== ""
    ),
    campaigns: {
      summary: text(o.campaigns?.summary, LIMITS.longText),
      items: list(
        o.campaigns?.items,
        LIMITS.campaigns,
        (c) => ({ campaign: text(c.campaign, LIMITS.shortText), insight: text(c.insight), action: text(c.action) }),
        (c) => c.campaign !== ""
      ),
    },
  };
}

/** Make pass 2's output safe to store (see normalizeDecisions). */
export function normalizePlan(raw) {
  const o = raw && typeof raw === "object" ? /** @type {Record<string, any>} */ (raw) : {};
  return {
    recommendations: list(
      o.recommendations,
      LIMITS.recommendations,
      (r) => ({
        title: text(r.title, LIMITS.shortText),
        why: text(r.why),
        action: text(r.action),
        expectedImpact: text(r.expectedImpact, LIMITS.shortText * 2),
        impact: pick(r.impact, LEVELS, "mittel"),
        effort: pick(r.effort, EFFORTS, "mittel"),
        confidence: pick(r.confidence, LEVELS, "mittel"),
        owner: pick(r.owner, OWNERS, "operator"),
        successMetric: text(r.successMetric, LIMITS.shortText * 2),
        link: pick(r.link, LINK_TARGETS, "none"),
      }),
      (r) => r.title !== ""
    ),
    experiments: list(
      o.experiments,
      LIMITS.experiments,
      (e) => ({
        title: text(e.title, LIMITS.shortText),
        hypothesis: text(e.hypothesis),
        design: text(e.design),
        metric: text(e.metric, LIMITS.shortText * 2),
        duration: text(e.duration, LIMITS.shortText * 2),
        successCriterion: text(e.successCriterion),
        owner: pick(e.owner, OWNERS, "developer"),
      }),
      (e) => e.title !== ""
    ),
    risks: list(
      o.risks,
      LIMITS.risks,
      (r) => ({
        title: text(r.title, LIMITS.shortText),
        detail: text(r.detail),
        severity: pick(r.severity, LEVELS, "mittel"),
        mitigation: text(r.mitigation),
        owner: pick(r.owner, OWNERS, "operator"),
      }),
      (r) => r.title !== ""
    ),
    dataQuality: list(
      o.dataQuality,
      LIMITS.dataQuality,
      (d) => ({ title: text(d.title, LIMITS.shortText), detail: text(d.detail) }),
      (d) => d.title !== ""
    ),
  };
}

/** The empty decision result (no key, no data, both passes failed). */
export function emptyDecision() {
  return { ...normalizeDecisions({}), ...normalizePlan({}) };
}

/**
 * The stored decision object of a report: both passes merged with how they
 * ran. `status` is "complete" (both passes), "partial" (one failed) or
 * "unavailable" (none ran — e.g. no Anthropic key).
 *
 * @param {{
 *   decisions?: unknown, plan?: unknown, model?: string | null,
 *   efforts?: { decisions?: string | null, plan?: string | null },
 *   notes?: string[], generatedAt?: string | null,
 * }} [input]
 */
export function assembleDecision({ decisions = null, plan = null, model = null, efforts = {}, notes = [], generatedAt = null } = {}) {
  const d = decisions ? normalizeDecisions(decisions) : normalizeDecisions({});
  const p = plan ? normalizePlan(plan) : normalizePlan({});
  const status = decisions && plan ? "complete" : decisions || plan ? "partial" : "unavailable";
  return {
    status,
    model,
    efforts: { decisions: efforts.decisions ?? null, plan: efforts.plan ?? null },
    generatedAt,
    notes: [...new Set((notes ?? []).map((n) => text(n, LIMITS.text)).filter(Boolean))],
    ...d,
    ...p,
  };
}

// ── Effort ladder (timeouts) ──────────────────────────────────────────────────

/**
 * Effort per attempt of a strategist pass: the first try thinks hardest; a
 * pass that timed out is retried with less thinking so it fits the step.
 */
export const STRATEGIST_EFFORTS = /** @type {readonly ("high" | "medium" | "low")[]} */ (Object.freeze(["high", "medium", "low"]));

/**
 * Effort for the n-th attempt (0-based) or null once the ladder is exhausted.
 * @param {unknown} attempt
 * @returns {"high" | "medium" | "low" | null}
 */
export function strategistEffortForAttempt(attempt) {
  const i = Math.floor(Number(attempt));
  return Number.isFinite(i) && i >= 0 && i < STRATEGIST_EFFORTS.length ? STRATEGIST_EFFORTS[i] : null;
}

/** The step route's maxDuration (s) — keep in sync with api/admin/analytics/step. */
export const STEP_MAX_DURATION_S = 300;
/** Abort a strategist call after this long so the step can record it and retry. */
export const STRATEGIST_TIMEOUT_MS = 240_000;
/** Answer budgets (thinking headroom comes on top, maxOutputTokensFor). */
export const DECISIONS_ANSWER_TOKENS = 6000;
export const PLAN_ANSWER_TOKENS = 7000;

// ── Versions ──────────────────────────────────────────────────────────────────

/** The payload version of stored sections (1 for reports before the decision layer). */
export function reportSectionsVersion(sections) {
  const v = Number(sections?.version);
  return Number.isInteger(v) && v >= 2 ? v : 1;
}

/** True when the stored report carries the decision layer (snapshot or decision). */
export function isDecisionReport(sections) {
  return reportSectionsVersion(sections) >= 2 && Boolean(sections?.snapshot || sections?.decision);
}

// ── Comparison with the previous stored report ────────────────────────────────

/** Snapshot metrics compared report-to-report (the rest stays in the snapshot). */
export const COMPARISON_KEYS = Object.freeze([
  "revenue.total",
  "revenue.orders",
  "revenue.aov",
  "ledger.moShare",
  "chat.chats",
  "chat.engagement",
  "chat.clicksPerChat",
  "chat.cartPerChat",
  "signin.popupRate",
  "signin.linkedSignin",
  "signin.linkedShop",
  "consent.popupRate",
  "consent.newSubscribers",
  "capture.submitRate",
  "capture.doiRate",
  "campaigns.sent",
  "campaigns.clickRate",
  "campaigns.revenue",
  "quality.handledWell",
  "quality.unmetNeed",
  "costs.total",
  "costs.roi",
]);

/** Legacy (v1) report KPIs, comparable between any two reports. */
function legacyMetrics(sections) {
  const k = sections?.kpis ?? {};
  const qualities = Array.isArray(sections?.qualities) ? sections.qualities : [];
  const qTotal = qualities.reduce((s, q) => s + (Number(q.count) || 0), 0);
  const share = (label) => {
    const hit = qualities.find((q) => q.label === label);
    return qTotal > 0 ? (Number(hit?.count) || 0) / qTotal : null;
  };
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    "legacy.conversations": { label: "Gespräche", unit: "count", value: n(k.conversations), good: "up" },
    "legacy.emailCaptured": { label: "Gespräche mit E-Mail-Angabe", unit: "count", value: n(k.emailCaptured), good: "up" },
    "legacy.cartUsed": { label: "Gespräche mit Warenkorb-Klick", unit: "count", value: n(k.cartUsed), good: "up" },
    "legacy.checkoutOffered": { label: "Gespräche mit Produktauswahl", unit: "count", value: n(k.checkoutOffered), good: "up" },
    "legacy.withError": { label: "Ohne Antwort (Fehler-Proxy)", unit: "count", value: n(k.withError), good: "down" },
    "legacy.handledWell": { label: "Gut gelöst", unit: "rate", value: share("Gut gelöst"), good: "up" },
    "legacy.unmetNeed": { label: "Offener Bedarf", unit: "rate", value: share("Offener Bedarf"), good: "down" },
    "legacy.spend": { label: "KI-Kosten (alle Aufrufe)", unit: "eur", value: n(sections?.spend?.totalEur), good: "down" },
  };
}

function daysOf(r) {
  const d = Math.round((Date.parse(`${r?.to}T00:00:00Z`) - Date.parse(`${r?.from}T00:00:00Z`)) / 86_400_000) + 1;
  return Number.isFinite(d) && d > 0 ? d : null;
}

/**
 * Compare the report being assembled with the previously stored, completed
 * report. Both with a snapshot → the COMPARISON_KEYS; otherwise the legacy
 * KPIs every report carries. Counts and amounts are compared per day when the
 * two periods differ in length (rates as they are). Also lists what the
 * previous report decided and recommended, so the model can judge follow-up.
 *
 * @param {{ snapshot?: any, kpis?: any, qualities?: any, spend?: any, from: string, to: string }} current
 * @param {{ id: number, title: string, from: string, to: string, completedAt?: string | null, sections: any } | null} previous
 */
export function buildReportComparison(current, previous) {
  if (!previous || !previous.sections) return null;
  const curDays = daysOf(current);
  const prevDays = daysOf(previous);
  const sameLength = curDays !== null && curDays === prevDays;
  const perDay = (unit, v, days) => (v === null || v === undefined ? null : !sameLength && unit !== "rate" && unit !== "ratio" && days ? v / days : v);

  /** @type {Array<{ key: string, label: string, unit: string, now: number | null, then: number | null, good: string }>} */
  let metrics = [];
  let basis = "legacy";
  if (current.snapshot && previous.sections.snapshot) {
    basis = "snapshot";
    const a = flattenSnapshot(current.snapshot);
    const b = flattenSnapshot(previous.sections.snapshot);
    for (const key of COMPARISON_KEYS) {
      if (!a[key] || !b[key]) continue;
      metrics.push({
        key,
        label: a[key].label,
        unit: a[key].unit,
        now: perDay(a[key].unit, a[key].value, curDays),
        then: perDay(b[key].unit, b[key].value, prevDays),
        good: a[key].good,
      });
    }
  } else {
    const a = legacyMetrics(current);
    const b = legacyMetrics(previous.sections);
    for (const [key, m] of Object.entries(a)) {
      metrics.push({ key, label: m.label, unit: m.unit, now: perDay(m.unit, m.value, curDays), then: perDay(m.unit, b[key].value, prevDays), good: m.good });
    }
  }
  metrics = metrics.filter((m) => m.now !== null || m.then !== null);

  const prevDecision = previous.sections.decision ?? null;
  return {
    previousReportId: previous.id,
    title: String(previous.title ?? ""),
    from: previous.from,
    to: previous.to,
    completedAt: previous.completedAt ?? null,
    basis,
    sameLength,
    perDay: !sameLength,
    metrics,
    previousDecisions: (prevDecision?.decisions ?? []).slice(0, LIMITS.decisions).map((d) => ({ title: String(d.title ?? ""), owner: d.owner ?? null })),
    previousRecommendations: (prevDecision?.recommendations ?? [])
      .slice(0, LIMITS.recommendations)
      .map((r) => ({ title: String(r.title ?? ""), owner: r.owner ?? null, successMetric: String(r.successMetric ?? "") })),
  };
}

/** A comparison row's change (same rules as the snapshot: points for rates). */
export function comparisonDelta(row) {
  return metricDelta({ value: row.now, previous: row.then, unit: row.unit, good: row.good });
}

/** The comparison as German text for the strategist prompt. */
export function renderComparisonForPrompt(comparison) {
  if (!comparison) return "Kein früherer Bericht gespeichert — vergleiche nur mit der Vorperiode.";
  const lines = [
    `Vorbericht #${comparison.previousReportId} „${scrubPii(comparison.title)}“ (Zeitraum ${comparison.from} bis ${comparison.to}; Basis ${comparison.basis === "snapshot" ? "Geschäftsdaten" : "ältere Kennzahlen"}${comparison.perDay ? "; unterschiedlich lange Zeiträume — Mengen je Tag" : ""}):`,
  ];
  for (const m of comparison.metrics) {
    const d = comparisonDelta(m);
    const change = d ? (d.points !== null ? `${d.points > 0 ? "+" : ""}${d.points.toFixed(1)} Pp.` : d.rel !== null ? `${d.rel > 0 ? "+" : ""}${Math.round(d.rel * 100)} %` : "neu") : "";
    lines.push(`- ${m.label} [${m.key}]: jetzt ${formatMetricValue(m.unit, m.now)}, damals ${formatMetricValue(m.unit, m.then)}${change ? ` (${change})` : ""}`);
  }
  if (comparison.previousDecisions.length) {
    lines.push("Damals empfohlene Entscheidungen:");
    for (const d of comparison.previousDecisions) lines.push(`- ${scrubPii(d.title)}${d.owner ? ` (${OWNER_LABELS[d.owner] ?? d.owner})` : ""}`);
  }
  if (comparison.previousRecommendations.length) {
    lines.push("Damals empfohlene Maßnahmen (mit Erfolgsmessung):");
    for (const r of comparison.previousRecommendations) lines.push(`- ${scrubPii(r.title)}${r.successMetric ? ` — Messung: ${scrubPii(r.successMetric)}` : ""}`);
  }
  return lines.join("\n");
}

// ── Prompts ───────────────────────────────────────────────────────────────────

/** The shared system prompt of both strategist passes (role, business, rules). */
export const STRATEGIST_SYSTEM = [
  "Du bist der Strategie-Analyst von motion sports (Onlineshop für Fitness- und Kraftsportgeräte, Shopify) und berätst die Inhaber bei Geschäftsentscheidungen rund um „Mo“, den KI-Berater im Shop-Chat.",
  "",
  "Was Mo ist: Mo berät im Chat-Widget auf der Shopify-Seite, empfiehlt Produkte (Produktkarten, Warenkorb-Links, Set-Angebote), bietet eine E-Mail-Zusammenfassung an, lädt anonyme Besucher:innen zur Anmeldung ein und fragt Angemeldete nach der Werbe-Einwilligung (Double-Opt-in). Der Admin verschickt Kampagnen-Mails (MK-Codes) und persönliche Mails (MS5-Codes) an Kund:innen mit Einwilligung, optional Briefe (Pingen). Bestellungen mit Mo-Markierung oder Mo-Code werden Mo zugeordnet: Direkt, Beraten & gekauft, Beraten, anderes gekauft. Der Eingang schlägt dem Betrieb Kund:innen vor, die heute Aufmerksamkeit brauchen.",
  "",
  "Ziel der Inhaber: mehr profitabler Umsatz über Mo, eine wachsende Basis von Kund:innen mit Einwilligung, Kampagnen, die verkaufen statt nerven, und rechtlich saubere Abläufe — bei vertretbaren KI-Kosten.",
  "",
  "Regeln:",
  "- Nutze ausschließlich die gelieferten Daten. Jede Zahl, die du nennst, stammt aus den Daten; nenne bei Quoten die Basis (n) und den Vergleich zur Vorperiode. Erfinde keine Zahlen, keine Benchmarks und keine Funktionen, die es nicht gibt.",
  "- Nenne Kennzahlen mit ihrem Schlüssel in eckigen Klammern, wenn es dem Handeln hilft (z. B. [signin.popupRate]).",
  "- Beachte die Hinweise zur Datenqualität: kleine Stichproben, Messänderungen (Releases) und Schalter. Erkläre eine Bewegung nicht als Trend, wenn ein Release oder eine kleine Basis sie erklärt; senke dann die Konfidenz.",
  "- Korrelation ist kein Beweis (z. B. Mo-Effekt). Sage, was gemessen ist und was vermutet wird.",
  "- Keine personenbezogenen Daten: keine Namen, E-Mail-Adressen oder Bestellnummern — nur Gruppen und Zahlen.",
  "- Rechtliches (Einwilligung, Werbung, Datenschutz) nie eigenmächtig lockern; wo nötig, Eigentümer „lawyer“.",
  "- Eigentümer: operator = " + OWNER_DESCRIPTIONS.operator + " developer = " + OWNER_DESCRIPTIONS.developer + " frontend = " + OWNER_DESCRIPTIONS.frontend + " lawyer = " + OWNER_DESCRIPTIONS.lawyer,
  "- Deutsch, klar und knapp, wie für eine Geschäftsführung: erst die Aussage, dann die Zahl. Keine Floskeln.",
].join("\n");

function clamp(s, max) {
  const t = scrubPii(String(s ?? "")).trim();
  return t.length > max ? `${t.slice(0, max)}\n… (gekürzt)` : t;
}

/** The data block both passes read (snapshot, comparison, insights, personas, notes). */
export function buildStrategistDataBlock({ snapshot, comparison = null, insightsMd = null, customerKnowledgeMd = null, personas = [], notes = [] }) {
  const personaLines = (Array.isArray(personas) ? personas : []).slice(0, 8).map((p) => {
    const favs = (p.favoriteProducts ?? []).slice(0, 3).map((f) => f.name).join(", ");
    const top = p.topQuestionsMd ? ` · Themen: ${clamp(p.topQuestionsMd, 500).replace(/\n+/g, " ")}` : "";
    return `- ${p.personaDisplay}: ${p.chatCount} Gespräch(e)${favs ? ` · häufig empfohlen: ${favs}` : ""}${top}`;
  });
  return [
    "# Geschäftsdaten (Zeitraum und Vorperiode)",
    renderSnapshotForPrompt(snapshot),
    "",
    "# Vergleich mit dem letzten gespeicherten Bericht",
    renderComparisonForPrompt(comparison),
    "",
    "# Aggregierte Gesprächs-Insights (aus analysierten Gesprächen)",
    insightsMd ? clamp(insightsMd, 6000) : "(keine)",
    "",
    "# Aggregiertes Kundenwissen (pseudonym)",
    customerKnowledgeMd ? clamp(customerKnowledgeMd, 5000) : "(keines)",
    "",
    "# Personas im Zeitraum",
    personaLines.length ? personaLines.join("\n") : "(keine)",
    ...(notes?.length ? ["", "# Hinweise zur Erstellung", ...notes.map((n) => `- ${scrubPii(n)}`)] : []),
  ].join("\n");
}

/** Pass 1 (decisions): system + prompt. */
export function buildDecisionsPrompt(input) {
  return {
    system: STRATEGIST_SYSTEM,
    prompt: [
      buildStrategistDataBlock(input),
      "",
      "# Aufgabe",
      "Erstelle den Entscheidungsteil der Komplettanalyse:",
      "1. headline + summary: die Lage auf einen Blick.",
      "2. decisions: die 3–5 Entscheidungen, die die Inhaber JETZT treffen sollten — konkret, mit Eigentümer, Wirkung, Konfidenz, Erfolgskennzahl und Admin-Link. Lieber wenige starke als viele schwache.",
      "3. revenue: wie der Umsatz über Mo zustande kam (Stufen, Quellen, Codes, Kampagnen, Sets) und was ihn treibt oder bremst.",
      "4. bottlenecks: wo im Funnel (Chat, Anmeldung, Einwilligung, E-Mail, Kampagne, Kauf) am meisten verloren geht — mit Zahlen.",
      "5. changes: was sich seit dem letzten Bericht verändert hat und ob die damaligen Empfehlungen sichtbar wirken (sonst: gegenüber der Vorperiode).",
      "6. segments: was Lebenszyklus, Wertstufen, Personas und Mo-Effekt für die Ansprache bedeuten.",
      "7. campaigns: welche Kampagnen verkaufen und welche nicht.",
    ].join("\n"),
  };
}

/** Pass 2 (plan): system + prompt; reads pass 1's result. */
export function buildPlanPrompt(input, decisions) {
  const d = decisions ? normalizeDecisions(decisions) : null;
  const summary = d
    ? [
        `Headline: ${d.headline}`,
        `Summary: ${d.summary}`,
        "Entscheidungen:",
        ...d.decisions.map((x, i) => `${i + 1}. ${x.title} (${x.owner}, Wirkung ${x.impact}, Konfidenz ${x.confidence}) — ${x.rationale}`),
        "Engpässe:",
        ...d.bottlenecks.map((b) => `- ${b.stage}: ${b.finding} [${b.evidence}]`),
      ].join("\n")
    : "(Der Entscheidungsteil ist nicht verfügbar — leite die Maßnahmen direkt aus den Daten ab.)";
  return {
    system: STRATEGIST_SYSTEM,
    prompt: [
      buildStrategistDataBlock(input),
      "",
      "# Bereits erstellter Entscheidungsteil",
      summary,
      "",
      "# Aufgabe",
      "Erstelle den Maßnahmenteil der Komplettanalyse, passend zu den Entscheidungen:",
      "1. recommendations: 5–10 priorisierte Maßnahmen (Wirkung × Konfidenz ÷ Aufwand, wichtigste zuerst), jede mit erwarteter Wirkung (beziffert, mit Annahme), Aufwand, Konfidenz, Eigentümer, Erfolgsmessung (Kennzahl mit Schlüssel, Zielwert, Zeitraum) und Admin-Link. Keine Doppelungen mit den Entscheidungen, sondern deren Umsetzung und weitere Hebel.",
      "2. experiments: 2–4 Experimente mit Hypothese, Aufbau, Kennzahl, Laufzeit und Fallzahl, die beim aktuellen Volumen realistisch sind (sonst sagen, dass es zu wenig Volumen gibt).",
      "3. risks: 2–6 Risiken mit Schwere und Gegenmaßnahme.",
      "4. dataQuality: Messlücken, die Entscheidungen einschränken, und wie man sie schließt — nur, was über die gelieferten Hinweise hinausgeht.",
    ].join("\n"),
  };
}
