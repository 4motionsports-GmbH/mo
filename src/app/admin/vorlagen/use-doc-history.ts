"use client";

// useDocHistory — the document of the template / Rundmail editor with its
// multi-step „Rückgängig“ (lib/mail-designer-client.mjs docHistoryReducer):
//
//   setDoc      — a hand edit (BlockEditor's onChange; value or updater, like
//                 useState — an updater sees the document as it is when it
//                 lands, e.g. a picture upload that finishes after an AI
//                 result): no undo step;
//   replaceDoc  — an AI result (tagged with its answer's turn id) or „Vorlage
//                 laden“ (no tag): the replaced document becomes an undo step
//                 (at most 20);
//   undo        — back one step; returns the tag of the step it took back, so
//                 the KI-Gestalter can say so in its conversation
//                 (useDesignerSession.noteUndo);
//   resetDoc    — loaded or saved: no steps.
//
// One reducer, so an AI result that arrives while the operator edits pushes
// exactly the document it replaces.

import * as React from "react";
import { docHistoryReducer, lastUndoTag } from "@/lib/mail-designer-client.mjs";

interface DocHistoryState<D> {
  doc: D;
  undo: Array<{ doc: D; tag: number | null }>;
}

type DocHistoryAction<D> =
  | { type: "set"; doc: D | ((prev: D) => D) }
  | { type: "replace"; doc: D; tag?: number | null }
  | { type: "undo" }
  | { type: "reset"; doc: D };

export interface DocHistory<D> {
  doc: D;
  /** steps „Rückgängig“ can go back */
  undoSteps: number;
  setDoc: React.Dispatch<React.SetStateAction<D>>;
  /** `tag`: the id of the AI answer whose result this is — null / left out for „Vorlage laden“ */
  replaceDoc: (doc: D, tag?: number | null) => void;
  /** Back one step → the tag of the step taken back (null: not an AI result, or nothing to undo). */
  undo: () => number | null;
  resetDoc: (doc: D) => void;
}

export function useDocHistory<D>(initial: D): DocHistory<D> {
  const [state, dispatch] = React.useReducer(
    docHistoryReducer as (state: DocHistoryState<D>, action: DocHistoryAction<D>) => DocHistoryState<D>,
    initial,
    (doc: D): DocHistoryState<D> => ({ doc, undo: [] })
  );
  const setDoc = React.useCallback<React.Dispatch<React.SetStateAction<D>>>((doc) => dispatch({ type: "set", doc }), []);
  const replaceDoc = React.useCallback((doc: D, tag: number | null = null) => dispatch({ type: "replace", doc, tag }), []);
  // The step „Rückgängig“ takes back is the top of the state the button was
  // rendered from — a click always sees the latest render.
  const topTag = lastUndoTag(state);
  const undo = React.useCallback(() => {
    dispatch({ type: "undo" });
    return topTag;
  }, [topTag]);
  const resetDoc = React.useCallback((doc: D) => dispatch({ type: "reset", doc }), []);
  return { doc: state.doc, undoSteps: state.undo.length, setDoc, replaceDoc, undo, resetDoc };
}
