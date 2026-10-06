// Pure helpers for the closed improvement loop ("Verbesserung" tab,
// docs/IMPROVEMENT_LOOP.md). No I/O, no DB, no model — imported by the data
// layer (improvement-store.ts), the engine (improvement-generate.ts), the
// directives store, the admin UI AND the node:test suite, so it stays a plain
// .mjs.
//
// It owns: the run versions and the phase state-machine, the owner lanes of a
// suggestion (who acts), the legacy lane/category vocabularies (runs before
// 2026-10-06 stay renderable), the status vocabulary, priority (impact ×
// confidence ÷ effort, damped by risk) and the backlog matrix, the suggestion
// fingerprint (cross-run dedup), the directive bounds and the compact report
// extract fed to the strategist.
//
// The effect measurement lives in improvement-effects.mjs, the decision layer
// (normalisers, prompts, Komplettanalyse import) in improvement-decision.mjs.

import { periodLabel, scrubPii } from "./business-snapshot-core.mjs";
import { daysBetween, parseYmd, shiftYmd } from "./kpi-range.mjs";

// ── Run versions ──────────────────────────────────────────────────────────────
// v1 (until 2026-10-06): a run read one Komplettanalyse, compared a handful of
//     conversation rates with the previous run and wrote suggestions in two
//     lanes (shop / mo) on the analyst tier.
// v2: a run is built on the business snapshot of a period, measures every
//     adopted directive and implemented change against its success metric, and
//     writes decision-grade suggestions on the strategist tier. The version is
//     stored in `baseline_json.version` (no migration — docs/IMPROVEMENT_LOOP.md).

export const RUN_VERSION = 2;

/** 2 for runs built on the business snapshot, 1 for older runs. */
export function runVersion(baseline) {
  return Number(baseline?.version) >= 2 ? 2 : 1;
}

// ── Phase state-machine (v2) ──────────────────────────────────────────────────
// Stepped like the Komplettanalyse: ONE bounded unit of work per /step request.
//   daten               — collect the business snapshot (pure DB; the Shopify
//                         code lookup bounded) and import the open
//                         recommendations of the chosen Komplettanalyse
//   messung             — measure adopted directives / implemented changes
//                         (one before/after snapshot per window, time-boxed)
//   wirkungscheck       — strategist: assess the measured changes (only when
//                         a measurement has a verdict to assess)
//   vorschlaege_chat    — strategist: suggestions for chat, prompt & widget
//   vorschlaege_betrieb — strategist: suggestions for operations, campaigns,
//                         development and legal + the run's headline
// One strategist call per step, never two (the step claim of migration 0045).

export const RUN_PHASES = Object.freeze(["daten", "messung", "wirkungscheck", "vorschlaege_chat", "vorschlaege_betrieb", "done"]);

/** The phases that make one strategist (Opus) call. */
export const STRATEGIST_PHASES = Object.freeze(["wirkungscheck", "vorschlaege_chat", "vorschlaege_betrieb"]);

/** German phase labels — v2 phases plus the legacy v1 ones (old running runs). */
export const RUN_PHASE_LABELS = Object.freeze({
  daten: "Geschäftsdaten sammeln",
  messung: "Wirkung umgesetzter Änderungen messen",
  wirkungscheck: "Wirkungs-Check",
  vorschlaege_chat: "Vorschläge: Chat, Prompt & Widget",
  vorschlaege_betrieb: "Vorschläge: Betrieb, Kampagnen, Entwicklung & Recht",
  done: "Fertig",
  wirkung: "Wirkungs-Check der bisherigen Maßnahmen",
  vorschlaege: "Vorschläge erarbeiten",
  vorschlaege_shop: "Vorschläge für den Online-Shop erarbeiten",
  vorschlaege_mo: "Vorschläge für Mo erarbeiten",
});

/**
 * The phase after `phase`. The Wirkungs-Check runs only when the measurement
 * produced something to assess.
 * @param {string} phase
 * @param {{ hasAssessable?: boolean }} [ctx]
 */
export function nextRunPhase(phase, { hasAssessable = false } = {}) {
  switch (phase) {
    case "daten":
      return "messung";
    case "messung":
      return hasAssessable ? "wirkungscheck" : "vorschlaege_chat";
    case "wirkungscheck":
      return "vorschlaege_chat";
    case "vorschlaege_chat":
      return "vorschlaege_betrieb";
    default:
      return "done";
  }
}

/** Position of a phase in RUN_PHASES (−1 for legacy / unknown phases). */
export function runPhaseIndex(phase) {
  return RUN_PHASES.indexOf(phase);
}

// ── The run's period ──────────────────────────────────────────────────────────

/** Presets of the new-run panel: full days up to yesterday (no partial today). */
export const RUN_PERIOD_PRESETS = Object.freeze({ "7d": 7, "14d": 14, "30d": 30, "90d": 90 });
export const MAX_RUN_PERIOD_DAYS = 366;

/**
 * The period a run is built on: a Komplettanalyse's period ("report"), a
 * preset of full days ending yesterday, or a custom range (swapped when
 * reversed, never after yesterday, at most MAX_RUN_PERIOD_DAYS). null when the
 * input is unusable.
 * @param {{ preset?: string | null, from?: string | null, to?: string | null, reportRange?: { from: string, to: string } | null }} input
 * @param {string} today YYYY-MM-DD (UTC)
 * @returns {{ from: string, to: string, days: number, label: string } | null}
 */
export function resolveRunPeriod({ preset = "30d", from = null, to = null, reportRange = null } = {}, today) {
  const yesterday = shiftYmd(today, -1);
  const shape = (a, b) => ({ from: a, to: b, days: daysBetween(a, b), label: periodLabel(a, b) });
  if (preset === "report") {
    if (!reportRange || parseYmd(reportRange.from) == null || parseYmd(reportRange.to) == null) return null;
    return shape(reportRange.from, reportRange.to);
  }
  const days = /** @type {Record<string, number>} */ (RUN_PERIOD_PRESETS)[preset ?? ""];
  if (days) return shape(shiftYmd(yesterday, -(days - 1)), yesterday);
  if (preset !== "custom" || parseYmd(from) == null || parseYmd(to) == null) return null;
  let a = /** @type {string} */ (from);
  let b = /** @type {string} */ (to);
  if (a > b) [a, b] = [b, a];
  if (b > yesterday) b = yesterday;
  if (a > b) return null;
  if (daysBetween(a, b) > MAX_RUN_PERIOD_DAYS) a = shiftYmd(b, -(MAX_RUN_PERIOD_DAYS - 1));
  return shape(a, b);
}

// ── Owner lanes (v2) — who acts on a suggestion ───────────────────────────────

export const OWNER_LANES = Object.freeze(["chat", "operator", "campaign", "frontend", "developer", "legal"]);

export const OWNER_LANE_LABELS = Object.freeze({
  chat: "Chat & Prompt",
  operator: "Betrieb",
  campaign: "Kampagnen & Marketing",
  frontend: "Widget & Shop",
  developer: "Entwicklung",
  legal: "Recht",
});

/** What each lane means — InfoTip text and the strategist's definition. */
export const OWNER_LANE_DESCRIPTIONS = Object.freeze({
  chat: "Mos Verhalten: eine Anweisung an Mo (mit einem Klick live) oder eine Änderung am Kern-Prompt (Code).",
  operator: "Betrieb im Admin: Eingang, Kunden, Wissen beantworten, Set-Angebote, Schalter umlegen lassen.",
  campaign: "Kampagnen-Mails und Briefe: Zielgruppen, Angebote, Versandzeitpunkte.",
  frontend: "Widget und Shopify-Theme (Aufgabe für den Frontend-Agenten): Popups, Texte, Platzierung, Seitenkontext.",
  developer: "Backend-Entwicklung: Mos Werkzeuge, Messung, Integrationen, neue Funktionen.",
  legal: "Rechtliche Prüfung: Einwilligung, Werbung, Datenschutz.",
});

/** Which owner lanes each suggestion pass may fill. */
export const PASS_LANES = Object.freeze({
  vorschlaege_chat: Object.freeze(["chat", "frontend", "developer"]),
  vorschlaege_betrieb: Object.freeze(["operator", "campaign", "developer", "legal"]),
});

// ── Legacy vocabularies (v1 suggestions) ──────────────────────────────────────

/** Validated per-lane category keys + German display labels (v1). */
export const SHOP_CATEGORIES = {
  sortiment: "Sortiment & Verfügbarkeit",
  produktdaten: "Produktdaten & Inhalte",
  preis_angebot: "Preis & Angebote",
  ux_storefront: "Storefront & UX",
  marketing: "Marketing & Kampagnen",
  prozess: "Prozesse & Service",
};

export const MO_CATEGORIES = {
  anweisung: "Verhaltens-Anweisung (sofort aktivierbar)",
  prompt_kern: "Kern-Prompt (Code-Änderung)",
  wissen: "Wissenslücke",
  tools: "Tool-Verhalten",
  persona: "Personas & Zielgruppen",
  faehigkeit: "Neue Fähigkeit",
};

const V1_CATEGORY_LANES = Object.freeze({
  anweisung: "chat",
  prompt_kern: "chat",
  persona: "chat",
  wissen: "operator",
  tools: "developer",
  faehigkeit: "developer",
  sortiment: "operator",
  produktdaten: "operator",
  preis_angebot: "operator",
  prozess: "operator",
  ux_storefront: "frontend",
  marketing: "campaign",
});

/**
 * The owner lane of any stored suggestion: v2 rows keep it in `category`, v1
 * rows map their (lane, category).
 * @param {{ lane?: string, category?: string }} s
 */
export function ownerLaneOf(s) {
  const category = String(s?.category ?? "");
  if (OWNER_LANES.includes(category)) return category;
  return V1_CATEGORY_LANES[category] ?? (s?.lane === "mo" ? "chat" : "operator");
}

/** The stored coarse lane column (CHECK shop|mo): "mo" when it changes Mo's behaviour. */
export function storageLaneFor(ownerLane) {
  return ownerLane === "chat" ? "mo" : "shop";
}

// ── Statuses ──────────────────────────────────────────────────────────────────

export const SUGGESTION_STATUSES = ["open", "accepted", "implemented", "dismissed"];

// Plain-language labels — the UI's mental model is a simple to-do list:
// Neu (nobody decided yet) → Geplant (we'll do it) → Erledigt (it's live) /
// Verworfen (we won't). The stored status keys are unchanged.
export const SUGGESTION_STATUS_LABELS = {
  open: "Neu",
  accepted: "Geplant",
  implemented: "Erledigt",
  dismissed: "Verworfen",
};

// ── Levels and priority ───────────────────────────────────────────────────────

/** Impact, effort, confidence and risk share one stored scale (DB CHECK for impact/effort). */
export const LEVELS = Object.freeze(["hoch", "mittel", "niedrig"]);

/** Effort reads as size: niedrig → klein, hoch → groß. */
export const EFFORT_LABELS = Object.freeze({ niedrig: "klein", mittel: "mittel", hoch: "groß" });

const IMPACT_WEIGHT = { hoch: 3, mittel: 2, niedrig: 1 };
const CONFIDENCE_WEIGHT = { hoch: 1, mittel: 0.75, niedrig: 0.5 };
const EFFORT_WEIGHT = { niedrig: 1, mittel: 1.6, hoch: 2.5 };
const RISK_WEIGHT = { niedrig: 1, mittel: 0.9, hoch: 0.75 };

/**
 * Priority score: impact × confidence ÷ effort, damped by risk (0.1 … 3).
 * Unknown values count as "mittel"; an unknown risk does not damp.
 * @param {{ impact?: string, effort?: string, confidence?: string | null, risk?: string | null }} s
 */
export function priorityScore(s) {
  const impact = IMPACT_WEIGHT[s?.impact] ?? IMPACT_WEIGHT.mittel;
  const confidence = CONFIDENCE_WEIGHT[s?.confidence ?? ""] ?? CONFIDENCE_WEIGHT.mittel;
  const effort = EFFORT_WEIGHT[s?.effort] ?? EFFORT_WEIGHT.mittel;
  const risk = RISK_WEIGHT[s?.risk ?? ""] ?? 1;
  return Math.round(((impact * confidence * risk) / effort) * 100) / 100;
}

/** Priority tier 1–3 of a score (1 = do first). */
export function priorityTier(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 3;
  if (n >= 1.5) return 1;
  if (n >= 0.75) return 2;
  return 3;
}

/**
 * Open and planned suggestions (any run) by owner lane and priority tier — the
 * "what is still on the table" overview. Lanes without items are left out;
 * order follows OWNER_LANES.
 * @param {Array<{ status: string, lane?: string, category?: string, impact?: string, effort?: string, confidence?: string | null, risk?: string | null }>} items
 */
export function backlogMatrix(items) {
  /** @type {Record<string, { lane: string, label: string, total: number, planned: number, tiers: Record<1|2|3, number> }>} */
  const byLane = {};
  let total = 0;
  for (const s of items ?? []) {
    if (s?.status !== "open" && s?.status !== "accepted") continue;
    const lane = ownerLaneOf(s);
    const row = (byLane[lane] ??= { lane, label: OWNER_LANE_LABELS[lane], total: 0, planned: 0, tiers: { 1: 0, 2: 0, 3: 0 } });
    row.total += 1;
    if (s.status === "accepted") row.planned += 1;
    row.tiers[/** @type {1|2|3} */ (priorityTier(priorityScore(s)))] += 1;
    total += 1;
  }
  return { total, lanes: OWNER_LANES.filter((l) => byLane[l]).map((l) => byLane[l]) };
}

// ── Bounds ────────────────────────────────────────────────────────────────────

export const MAX_SUGGESTIONS_PER_RUN = 12;
/** Per pass (each suggestion pass is one strategist call). */
export const MAX_SUGGESTIONS_PER_LANE = 6;

// The live directive layer must stay a bounded prompt section: at most this
// many ACTIVE directives, each at most this long. Enforced in the store,
// re-stated in the admin UI.
export const MAX_ACTIVE_DIRECTIVES = 20;
export const MAX_DIRECTIVE_CHARS = 600;

// ── Fingerprint (cross-run dedup) ─────────────────────────────────────────────
// Same normalisation as qa-core's questionFingerprint: a suggestion that the
// engine re-derives with a slightly different title must not clutter the
// backlog twice. Dedup happens in code before insert (no unique index — a
// dismissed idea may legitimately return with new evidence).

export function suggestionFingerprint(title) {
  return String(title ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Drop new suggestions whose fingerprint matches any existing non-dismissed
 * suggestion (the engine also SEES the prior list, this is the hard guard).
 */
export function dedupeSuggestions(parsed, existingFingerprints) {
  const seen = new Set(existingFingerprints ?? []);
  const kept = [];
  for (const s of parsed) {
    if (!s.fingerprint || seen.has(s.fingerprint)) continue;
    seen.add(s.fingerprint);
    kept.push(s);
  }
  return kept;
}

// ── Report extract (conversation insights for the chat pass) ──────────────────

function clampText(v, max) {
  if (typeof v !== "string") return "";
  const t = v.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Compact Markdown extract of a Komplettanalyse's conversation chapters —
 * KPIs + distributions as data lines, personas, the insights, the top
 * questions and the aggregate customer knowledge. Bounded and scrubbed of
 * personal data (the business numbers come from the snapshot, not from here).
 */
export function renderReportExtract(sections, { maxNarrativeChars = 6000 } = {}) {
  const k = sections?.kpis ?? {};
  const lines = [
    `- Gespräche im Zeitraum: ${Number(k.conversations) || 0} (analysiert: ${Number(k.analyzed) || 0})`,
    `- Tiers: anonym ${k.tiers?.anonymous ?? 0} · nur E-Mail ${k.tiers?.emailOnly ?? 0} · angemeldet ${k.tiers?.signedIn ?? 0}`,
    `- E-Mail erfasst: ${Number(k.emailCaptured) || 0} · Warenkorb geklickt: ${Number(k.cartUsed) || 0} · Checkout angeboten: ${Number(k.checkoutOffered) || 0} · ohne Bot-Antwort: ${Number(k.withError) || 0}`,
  ];
  const dist = (rows) =>
    (Array.isArray(rows) ? rows : [])
      .map((r) => `${r.label}: ${r.count}`)
      .join(" · ") || "(keine)";
  lines.push(`- Kategorien: ${dist(sections?.categories)}`);
  lines.push(`- Qualität: ${dist(sections?.qualities)}`);
  for (const p of Array.isArray(sections?.personas) ? sections.personas : []) {
    const fav = (p.favoriteProducts ?? [])
      .map((f) => f.name)
      .slice(0, 3)
      .join(", ");
    lines.push(`- Persona ${p.personaDisplay}: ${p.chatCount} Gespräch(e)${fav ? ` · häufig empfohlen: ${fav}` : ""}`);
  }
  const out = [`### Kennzahlen\n${lines.join("\n")}`];
  if (sections?.insightsMd) {
    out.push(`### Aggregierte Insights\n${clampText(sections.insightsMd, maxNarrativeChars)}`);
  }
  const personaQ = (Array.isArray(sections?.personas) ? sections.personas : [])
    .filter((p) => p.topQuestionsMd)
    .map((p) => `**${p.personaDisplay}**\n${p.topQuestionsMd}`)
    .join("\n\n");
  if (personaQ) out.push(`### Top-Fragen je Persona\n${clampText(personaQ, maxNarrativeChars)}`);
  if (sections?.customerKnowledgeMd) {
    out.push(`### Aggregiertes Kundenwissen\n${clampText(sections.customerKnowledgeMd, maxNarrativeChars)}`);
  }
  if (Array.isArray(sections?.notes) && sections.notes.length > 0) {
    out.push(`### Hinweise\n${sections.notes.map((n) => `- ${n}`).join("\n")}`);
  }
  return scrubPii(out.join("\n\n"));
}
