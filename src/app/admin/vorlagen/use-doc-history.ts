"use client";

// useDocHistory — the document of the template / Rundmail editor with its
// multi-step „Rückgängig“ (lib/mail-designer-client.mjs docHistoryReducer):
//
//   setDoc      — a hand edit (BlockEditor's onChange; value or updater, like
//                 useState): no undo step;
//   replaceDoc  — an AI result or „Vorlage laden“: the replaced document
//                 becomes an undo step (at most 20);
//   undo        — back one step;
//   resetDoc    — loaded or saved: no steps.
//
// One reducer, so an AI result that arrives while the operator edits pushes
// exactly the document it replaces.

import * as React from "react";
import { docHistoryReducer } from "@/lib/mail-designer-client.mjs";

interface DocHistoryState<D> {
  doc: D;
  undo: D[];
}

type DocHistoryAction<D> =
  | { type: "set"; doc: D | ((prev: D) => D) }
  | { type: "replace"; doc: D }
  | { type: "undo" }
  | { type: "reset"; doc: D };

export interface DocHistory<D> {
  doc: D;
  /** steps „Rückgängig“ can go back */
  undoSteps: number;
  setDoc: React.Dispatch<React.SetStateAction<D>>;
  replaceDoc: (doc: D) => void;
  undo: () => void;
  resetDoc: (doc: D) => void;
}

export function useDocHistory<D>(initial: D): DocHistory<D> {
  const [state, dispatch] = React.useReducer(
    docHistoryReducer as (state: DocHistoryState<D>, action: DocHistoryAction<D>) => DocHistoryState<D>,
    initial,
    (doc: D): DocHistoryState<D> => ({ doc, undo: [] })
  );
  const setDoc = React.useCallback<React.Dispatch<React.SetStateAction<D>>>((doc) => dispatch({ type: "set", doc }), []);
  const replaceDoc = React.useCallback((doc: D) => dispatch({ type: "replace", doc }), []);
  const undo = React.useCallback(() => dispatch({ type: "undo" }), []);
  const resetDoc = React.useCallback((doc: D) => dispatch({ type: "reset", doc }), []);
  return { doc: state.doc, undoSteps: state.undo.length, setDoc, replaceDoc, undo, resetDoc };
}
