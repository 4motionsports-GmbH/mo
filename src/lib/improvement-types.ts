// The shapes of a Verbesserungslauf (v2) as stored and served — the TypeScript
// side of improvement-core / -effects / -decision (pure .mjs). Type-only, so
// the admin client and the server share them without a runtime import.
// Storage (no migration, docs/IMPROVEMENT_LOOP.md): `baseline_json` holds
// RunBaselineV2, `delta_json` RunAnalysisV2, a v2 suggestion's decision fields
// live in `evidence_json` ({ version: 2, items, details }).

import type { BusinessSnapshot, MetricUnit } from "./business-snapshot";

export type OwnerLane = "chat" | "operator" | "campaign" | "frontend" | "developer" | "legal";
export type Level = "hoch" | "mittel" | "niedrig";
export type StrategistEffortName = "high" | "medium" | "low";

export type EffectVerdict =
  | "besser_belastbar"
  | "besser_tendenz"
  | "unveraendert"
  | "veraendert"
  | "schlechter_tendenz"
  | "schlechter_belastbar"
  | "nicht_vergleichbar"
  | "zu_frueh"
  | "nicht_messbar";

export type ReviewRecommendation = "beibehalten" | "anpassen" | "zuruecknehmen" | "beobachten";

export interface RunPeriod {
  from: string;
  to: string;
  days: number;
  label: string;
}

/** A snapshot metric frozen into a suggestion (evidence, success-metric baseline). */
export interface FrozenMetric {
  key: string;
  label: string;
  unit: MetricUnit;
  good: "up" | "down" | "none";
  section: string | null;
  value: number | null;
  previous: number | null;
  base: number | null;
  previousBase: number | null;
}

export interface EvidenceItem {
  key: string | null;
  text: string;
  metric: FrozenMetric | null;
}

export interface SuccessMetric {
  key: string | null;
  label: string | null;
  unit: MetricUnit | null;
  baseline: FrozenMetric | null;
  target: number | null;
  direction: "up" | "down";
  horizonDays: number;
  /** The original free-text target of an imported Komplettanalyse recommendation. */
  text: string | null;
}

export type SuggestionOrigin =
  | { kind: "engine" }
  | { kind: "report"; reportId: number; index: number; reportTitle: string };

export interface SuggestionDetails {
  lane: OwnerLane;
  confidence: Level;
  risk: Level | null;
  riskNote: string | null;
  successMetric: SuccessMetric;
  link: string;
  refersTo: string | null;
  origin: SuggestionOrigin;
}

// ── Measurement ───────────────────────────────────────────────────────────────

export interface MeasuredMetric {
  key: string;
  role: "primary" | "guardrail";
  label: string;
  unit: MetricUnit;
  good: "up" | "down" | "none";
  section: string | null;
  value: number | null;
  previous: number | null;
  base: number | null;
  previousBase: number | null;
  delta: { abs: number; rel: number | null; points: number | null } | null;
  deltaText: string;
  test: "proportion" | "poisson" | "poisson_rate" | "companion" | "none";
  z: number | null;
  testN: { after: number | null; before: number | null } | null;
  via: string | null;
  small: boolean;
  measurementChange: boolean;
  verdict: EffectVerdict;
  confidence: Level | null;
  significant: boolean;
  reasons: string[];
}

export interface Measurement {
  ref: string;
  kind: "directive" | "suggestion";
  id: number;
  suggestionId: number | null;
  title: string;
  lane: OwnerLane;
  date: string;
  until: string | null;
  state: "aktiv" | "geaendert" | "deaktiviert" | "umgesetzt";
  metricSource: "erfolgsmass" | "erwartete_wirkung" | "standard";
  window: {
    from: string;
    to: string;
    days: number;
    horizonDays: number;
    complete: boolean;
    before: { from: string; to: string } | null;
  };
  metrics: MeasuredMetric[];
  verdict: EffectVerdict;
  confidence: Level | null;
  sideEffects: Array<{ key: string; label: string; verdict: EffectVerdict; deltaText: string }>;
  confounders: Array<{ kind: "release" | "switch" | "change"; label: string; date: string | null; measurement: boolean; keys: string[] }>;
  target: { value: number; direction: "up" | "down"; reached: boolean | null } | null;
}

/** A change to measure (improvement-effects buildChangeList). */
export interface MeasuredChange {
  ref: string;
  kind: "directive" | "suggestion";
  id: number;
  suggestionId: number | null;
  title: string;
  lane: OwnerLane;
  date: string;
  until: string | null;
  state: Measurement["state"];
  metricSource: Measurement["metricSource"];
  metrics: Array<{ key: string; role: "primary" | "guardrail" }>;
  horizonDays: number;
  target: { value: number; direction: "up" | "down" } | null;
}

export interface SwitchChange {
  key: string;
  label: string;
  from: boolean | number;
  to: boolean | number;
  between: { from: string; to: string };
}

export interface EffectReview {
  summary: string | null;
  items: Array<{ ref: string; assessment: string; recommendation: ReviewRecommendation; nextStep: string | null }>;
}

// ── Stored run payloads ───────────────────────────────────────────────────────

export interface RunOptions {
  /** The Komplettanalyse whose conversation insights the chat pass reads (and whose recommendations may be imported). */
  reportId: number | null;
  importRecommendations: boolean;
}

/** `baseline_json` of a v2 run. */
export interface RunBaselineV2 {
  version: 2;
  period: RunPeriod;
  options: RunOptions;
  /** The business snapshot of the period (null until phase `daten` is done). */
  snapshot: BusinessSnapshot | null;
  /** 1 when an old running run was upgraded to v2. */
  upgradedFrom?: 1;
}

/** `delta_json` of a v2 run: measurement, the strategist's results and the stepper state. */
export interface RunAnalysisV2 {
  version: 2;
  measurement: {
    /** UTC day the windows were computed for (fixed for the whole run). */
    today: string | null;
    changes: MeasuredChange[] | null;
    measurements: Measurement[];
    switchHistory: SwitchChange[];
    previousRunId: number | null;
    done: boolean;
  };
  review: EffectReview | null;
  synthesis: { headline: string | null; summary: string | null } | null;
  /** Recommendations imported from the Komplettanalyse in this run. */
  imported: number;
  state: {
    attempts: Partial<Record<"wirkungscheck" | "vorschlaege_chat" | "vorschlaege_betrieb", number>>;
    efforts: Partial<Record<"wirkungscheck" | "vorschlaege_chat" | "vorschlaege_betrieb", StrategistEffortName | null>>;
    model: string | null;
    notes: string[];
    /**
     * Written before a strategist call, cleared by every write after it. Still
     * set on the next step = that step was killed (settleInFlightAttempt).
     */
    inFlight?: { pass: "wirkungscheck" | "vorschlaege_chat" | "vorschlaege_betrieb"; attempt: number; startedAt: string } | null;
  };
}
