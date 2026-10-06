// Client-side shapes of the Verbesserung screen — the JSON the improve routes
// return (lib/improvement-store mapping; v2 payloads typed in
// lib/improvement-types).

import type { EvidenceItem, Measurement, OwnerLane, SuggestionDetails } from "@/lib/improvement-types";

export interface SuggestionItem {
  id: number;
  runId: number;
  lane: "shop" | "mo";
  category: string;
  ownerLane: OwnerLane;
  title: string;
  rationaleMd: string;
  proposalMd: string;
  directiveText: string | null;
  expectedEffect: string | null;
  impact: string;
  effort: string;
  detailsVersion: 1 | 2;
  evidence: EvidenceItem[];
  details: SuggestionDetails | null;
  priority: number;
  tier: 1 | 2 | 3;
  status: "open" | "accepted" | "implemented" | "dismissed";
  statusNote: string | null;
  statusChangedAt: string | null;
  createdAt: string;
}

export interface RunListItem {
  id: number;
  version: 1 | 2;
  reportId: number | null;
  reportTitle: string;
  rangeFrom: string;
  rangeTo: string;
  status: "running" | "complete" | "failed";
  phase: string;
  promptHash: string;
  costEur: number;
  suggestionCount: number;
  createdAt: string;
  completedAt: string | null;
}

/** v1: the rate table of the old runs. */
export interface DeltaRow {
  key: string;
  label: string;
  prev: number;
  cur: number;
  delta: number;
}

export interface RunDetail extends RunListItem {
  /** v1 rates or v2 RunBaselineV2 (period, options, snapshot). */
  baseline: Record<string, unknown> | null;
  /** v1 { rows } or v2 RunAnalysisV2. */
  delta: Record<string, unknown> | null;
  effectCheckMd: string | null;
  error: string | null;
  suggestions: SuggestionItem[];
}

export interface CompletedReportOption {
  id: number;
  title: string;
  from: string;
  to: string;
  /** A decision report (v2) — it has recommendations to import. */
  decision: boolean;
  recommendations: { total: number; open: number };
}

/** The up-front estimate shown in the new-run panel. */
export interface RunEstimate {
  eurWithEffectCheck: number;
  eurWithoutEffectCheck: number;
  minutes: [number, number];
  /** Changes the next run would measure (directives and implemented suggestions of the last 120 days). */
  changesToMeasure: number;
}

/** The measured effect of a directive in the newest Verbesserungslauf. */
export interface DirectiveEffect {
  runId: number;
  runCreatedAt: string;
  measurement: Measurement;
}
