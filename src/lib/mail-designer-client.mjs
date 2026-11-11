// The AI designer („KI-Gestalter“) in the browser — the pure half of
// admin/vorlagen/use-designer-session.ts and use-doc-history.ts. Pure and
// tested (mail-designer-client.test.mjs):
//
//   * designerHistory — the finished exchanges of the conversation that go
//     with every request (at most the last 8 turns). The server always reads
//     the CURRENT document — hand edits included — so the history only says
//     what was asked and answered; a turn that failed or was cancelled
//     changed nothing and stays out.
//   * interpretDesignerEvent — one line of the NDJSON stream of POST
//     /api/admin/vorlagen/assist → progress / result / error; heartbeats and
//     unknown lines → null. The result document is normalised, so the
//     editor never holds one the renderer would refuse.
//   * docHistoryReducer — the multi-step „Rückgängig“ of the template and
//     Rundmail editors: every AI result and „Vorlage laden“ pushes the
//     document it replaces (at most DESIGNER_UNDO_LIMIT steps); hand edits
//     do not (as before — „Rückgängig“ goes back to the state before the
//     last replacement); saving starts afresh.
//   * elapsedLabel — „42 s“, „2:05 Min.“ for the progress line.

import { normalizeMailTemplateDoc } from "./mail-template-doc.mjs";

/** Turns of the conversation sent with a request (4 exchanges). */
export const DESIGNER_HISTORY_TURNS = 8;
/** Longest text of one history turn. */
export const DESIGNER_HISTORY_CHARS = 4000;
/** Longest instruction. */
export const DESIGNER_INSTRUCTION_CHARS = 6000;
/** Steps „Rückgängig“ keeps. */
export const DESIGNER_UNDO_LIMIT = 20;

/** A result line without a document. */
export const DESIGNER_INCOMPLETE_MESSAGE = "Die Antwort der KI war unvollständig — bitte erneut versuchen.";
/** An error line without a message. */
export const DESIGNER_FAILED_MESSAGE = "Die KI-Gestaltung ist fehlgeschlagen — bitte erneut versuchen.";

/**
 * One turn of the conversation as the panel shows it.
 * @typedef {{ id: number, role: "user", text: string, attachments: string[] }} DesignerUserTurn
 * @typedef {{ id: number, role: "assistant", text: string, subject: string | null, preheader: string | null, warnings: string[] }} DesignerAssistantTurn
 * @typedef {{ id: number, role: "error" | "notice", text: string }} DesignerNoticeTurn
 * @typedef {DesignerUserTurn | DesignerAssistantTurn | DesignerNoticeTurn} DesignerTurn
 */

/**
 * @typedef {ReturnType<typeof normalizeMailTemplateDoc>} DesignerDoc
 * @typedef {{ kind: "progress", stage: string, text: string }} DesignerProgressEvent
 * @typedef {{ kind: "result", doc: DesignerDoc, notes: string, subject: string | null, preheader: string | null, warnings: string[] }} DesignerResultEvent
 * @typedef {{ kind: "error", message: string }} DesignerErrorEvent
 * @typedef {DesignerProgressEvent | DesignerResultEvent | DesignerErrorEvent} DesignerEvent
 */

/** @param {unknown} v @param {number} max */
function clip(v, max) {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** @param {unknown} v @param {number} max */
function oneLine(v, max) {
  return clip(typeof v === "string" ? v.replace(/\s+/g, " ") : "", max);
}

/** @param {unknown} v @param {number} max */
function optionalLine(v, max) {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max).trim() : "";
  return s || null;
}

/** @param {{ text?: unknown, attachments?: unknown }} t */
function userHistoryText(t) {
  const text = typeof t.text === "string" ? t.text.trim() : "";
  const names = Array.isArray(t.attachments) ? t.attachments.filter((n) => typeof n === "string" && n) : [];
  const files = names.length ? `[Anhänge: ${names.join(", ")}]` : "";
  return [text, files].filter(Boolean).join("\n") || "(ohne Text)";
}

/** @param {{ text?: unknown, subject?: unknown, preheader?: unknown }} t */
function assistantHistoryText(t) {
  const lines = [(typeof t.text === "string" && t.text.trim()) || "Erledigt."];
  if (typeof t.subject === "string" && t.subject) lines.push(`Betreff-Vorschlag: „${t.subject}“`);
  if (typeof t.preheader === "string" && t.preheader) lines.push(`Vorschauzeile-Vorschlag: „${t.preheader}“`);
  return lines.join("\n");
}

/**
 * The conversation sent with the next request: every operator turn that got
 * an answer, with that answer — the last `max` turns (an even number, so it
 * starts with the operator). Failed, cancelled and unanswered turns stay out.
 * @param {ReadonlyArray<{ role: string, text?: unknown, attachments?: unknown, subject?: unknown, preheader?: unknown }>} turns
 * @param {number} [max]
 * @returns {Array<{ role: "user" | "assistant", text: string }>}
 */
export function designerHistory(turns, max = DESIGNER_HISTORY_TURNS) {
  const list = Array.isArray(turns) ? turns : [];
  /** @type {Array<{ role: "user" | "assistant", text: string }>} */
  const out = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const u = list[i];
    const a = list[i + 1];
    if (u?.role !== "user" || a?.role !== "assistant") continue;
    out.push({ role: "user", text: clip(userHistoryText(u), DESIGNER_HISTORY_CHARS) });
    out.push({ role: "assistant", text: clip(assistantHistoryText(a), DESIGNER_HISTORY_CHARS) });
    i++;
  }
  const keep = Math.max(0, Math.floor(max / 2) * 2);
  return keep === 0 ? [] : out.slice(-keep);
}

/**
 * Can the operator send? An instruction of at least 3 characters, or at
 * least one attachment (e.g. only a screenshot to rebuild).
 * @param {unknown} instruction
 * @param {number} attachmentCount
 */
export function designerCanSend(instruction, attachmentCount) {
  const text = typeof instruction === "string" ? instruction.trim() : "";
  return text.length >= 3 || attachmentCount > 0;
}

/**
 * One streamed line of POST /api/admin/vorlagen/assist → what the panel does
 * with it; null for a heartbeat or anything it does not know.
 * @param {unknown} raw
 * @returns {DesignerEvent | null}
 */
export function interpretDesignerEvent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (r.type === "progress") {
    if (r.stage === "heartbeat") return null;
    const text = oneLine(r.text, 160);
    return text ? { kind: "progress", stage: typeof r.stage === "string" ? r.stage : "", text } : null;
  }
  if (r.type === "result") {
    if (!r.doc || typeof r.doc !== "object" || Array.isArray(r.doc)) return { kind: "error", message: DESIGNER_INCOMPLETE_MESSAGE };
    const warnings = Array.isArray(r.warnings)
      ? r.warnings.filter((w) => typeof w === "string" && w.trim()).map((w) => oneLine(w, 400)).slice(0, 12)
      : [];
    return {
      kind: "result",
      doc: normalizeMailTemplateDoc(r.doc),
      notes: clip(r.notes, 4000),
      subject: optionalLine(r.subject, 150),
      preheader: optionalLine(r.preheader, 150),
      warnings,
    };
  }
  if (r.type === "error") return { kind: "error", message: oneLine(r.message, 600) || DESIGNER_FAILED_MESSAGE };
  return null;
}

/** Same document? (the editors compare documents as JSON — the normaliser's key order is fixed) */
export function sameDoc(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * The document of an editor with its „Rückgängig“ steps.
 *   set     — a hand edit (a value or an updater): no step;
 *   replace — an AI result or „Vorlage laden“: the replaced document becomes
 *             a step (not when nothing changes; the oldest step goes beyond
 *             DESIGNER_UNDO_LIMIT);
 *   undo    — back one step;
 *   reset   — loaded or saved: no steps.
 * @template D
 * @param {{ doc: D, undo: D[] }} state
 * @param {{ type: "set", doc: D | ((prev: D) => D) } | { type: "replace", doc: D } | { type: "undo" } | { type: "reset", doc: D }} action
 * @returns {{ doc: D, undo: D[] }}
 */
export function docHistoryReducer(state, action) {
  switch (action?.type) {
    case "set": {
      const next = typeof action.doc === "function" ? /** @type {(prev: D) => D} */ (action.doc)(state.doc) : action.doc;
      return next === state.doc ? state : { doc: next, undo: state.undo };
    }
    case "replace": {
      if (state.doc == null) return { doc: action.doc, undo: state.undo };
      if (sameDoc(state.doc, action.doc)) return state;
      return { doc: action.doc, undo: [...state.undo, state.doc].slice(-DESIGNER_UNDO_LIMIT) };
    }
    case "undo": {
      if (state.undo.length === 0) return state;
      return { doc: state.undo[state.undo.length - 1], undo: state.undo.slice(0, -1) };
    }
    case "reset":
      return { doc: action.doc, undo: [] };
    default:
      return state;
  }
}

/**
 * How long a request has been running: „0 s“ … „59 s“, then „1:05 Min.“.
 * @param {unknown} ms
 */
export function elapsedLabel(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} Min.`;
}
