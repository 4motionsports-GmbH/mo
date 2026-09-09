import type { SuggestionItem } from "./SuggestionCard";

export interface RunListItem {
  id: number;
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

export interface DeltaRow {
  key: string;
  label: string;
  prev: number;
  cur: number;
  delta: number;
}

export interface RunDetail extends RunListItem {
  delta: { prevConversations: number; curConversations: number; rows: DeltaRow[] } | null;
  effectCheckMd: string | null;
  error: string | null;
  suggestions: SuggestionItem[];
}

export interface CompletedReportOption {
  id: number;
  title: string;
}
