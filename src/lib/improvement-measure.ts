// The Wirkungs-Check's I/O: which changes to measure (directives with their
// version events, implemented suggestions) and one business snapshot per
// before/after window — the decisions themselves are pure
// (improvement-effects.mjs). Pure DB: the window snapshots run without the
// Shopify code lookup, so both windows count the order ledger alone
// (like-for-like). Time-boxed per step; the rest follows on the next step.

import { getBusinessSnapshot, type BusinessSnapshot } from "./business-snapshot";
import { listDirectivesWithEvents } from "./directives-store";
import { listSuggestionsForChanges } from "./improvement-store";
import { buildChangeList, changeWindow, measureChange, MIN_EFFECT_DAYS, windowKey } from "./improvement-effects.mjs";
import type { Measurement, MeasuredChange, SwitchChange } from "./improvement-types";

/** The changes to measure, newest first (improvement-effects buildChangeList). */
export async function collectChanges(reference: Record<string, unknown>, today: string): Promise<MeasuredChange[]> {
  const [directives, suggestions] = await Promise.all([listDirectivesWithEvents(), listSuggestionsForChanges()]);
  return buildChangeList({ directives, suggestions, flat: reference, today }) as MeasuredChange[];
}

/**
 * Measure the changes not measured yet, one window snapshot per distinct
 * window, until `budgetMs` is used up. Returns the new measurements (in the
 * order of `changes`).
 */
export async function measurePending({
  changes,
  measured,
  today,
  switchHistory,
  reference,
  budgetMs,
}: {
  changes: MeasuredChange[];
  measured: Measurement[];
  today: string;
  switchHistory: SwitchChange[];
  reference: Record<string, unknown>;
  budgetMs: number;
}): Promise<Measurement[]> {
  const started = Date.now();
  const done = new Set(measured.map((m) => m.ref));
  const cache = new Map<string, BusinessSnapshot>();
  const added: Measurement[] = [];
  for (const change of changes) {
    if (done.has(change.ref)) continue;
    // Always make progress: the first change of a step is measured even when
    // the budget is tiny.
    if (added.length > 0 && Date.now() - started > budgetMs) break;
    const w = changeWindow(change, today);
    let snapshot: BusinessSnapshot | null = null;
    if (w.days >= MIN_EFFECT_DAYS) {
      const key = windowKey(w);
      snapshot = cache.get(key) ?? (await getBusinessSnapshot({ from: w.from, to: w.to }));
      cache.set(key, snapshot);
    }
    added.push(
      measureChange(change, { snapshot, today, allChanges: changes, switchHistory, reference }) as Measurement
    );
  }
  return added;
}
