// The AI designer („KI-Gestalter“) in the browser — the pure half of
// admin/vorlagen/use-designer-session.ts and use-doc-history.ts. Pure and
// tested (mail-designer-client.test.mjs):
//
//   * designerHistory — the finished exchanges of the conversation that go
//     with every request (at most the last 8 turns). The server always reads
//     the CURRENT document — hand edits included — so the history only says
//     what was asked and answered; a turn that failed or was cancelled
//     changed nothing and stays out; an answer whose result was taken back
//     with „Rückgängig“ goes with that mark.
//   * interpretDesignerEvent — one line of the NDJSON stream of POST
//     /api/admin/vorlagen/assist → progress / result / error; heartbeats and
//     unknown lines → null. The result document is normalised, so the
//     editor never holds one the renderer would refuse.
//   * docHistoryReducer — the multi-step „Rückgängig“ of the template and
//     Rundmail editors: every AI result and „Vorlage laden“ pushes the
//     document it replaces (at most DESIGNER_UNDO_LIMIT steps), tagged with
//     the AI turn whose result replaced it; hand edits do not (as before —
//     „Rückgängig“ goes back to the state before the last replacement);
//     saving starts afresh.
//   * undoDesignerTurn — „Rückgängig“ took back an AI result: its reply is
//     marked and a short notice ends the conversation.
//   * designerNotesText — the AI's notes as the plain text the panel shows
//     (never Markdown: model output must not become a link in the admin).
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
 * One turn of the conversation as the panel shows it. `undone`: „Rückgängig“
 * took this reply's result back; `undo`: the notice that says so.
 * @typedef {{ id: number, role: "user", text: string, attachments: string[] }} DesignerUserTurn
 * @typedef {{ id: number, role: "assistant", text: string, subject: string | null, preheader: string | null, warnings: string[], undone?: boolean }} DesignerAssistantTurn
 * @typedef {{ id: number, role: "error" | "notice", text: string, undo?: boolean }} DesignerNoticeTurn
 * @typedef {DesignerUserTurn | DesignerAssistantTurn | DesignerNoticeTurn} DesignerTurn
 */

/** The mark an undone answer carries in the history sent to the AI. */
export const DESIGNER_UNDONE_MARK = "(Rückgängig gemacht: Die Person hat diese Änderung zurückgenommen — sie ist nicht mehr in der Mail.)";

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

/** @param {{ text?: unknown, subject?: unknown, preheader?: unknown, undone?: unknown }} t */
function assistantHistoryText(t) {
  const lines = [(typeof t.text === "string" && t.text.trim()) || "Erledigt."];
  // first, so cutting a long answer never cuts the mark
  if (t.undone === true) lines.unshift(DESIGNER_UNDONE_MARK);
  if (typeof t.subject === "string" && t.subject) lines.push(`Betreff-Vorschlag: „${t.subject}“`);
  if (typeof t.preheader === "string" && t.preheader) lines.push(`Vorschauzeile-Vorschlag: „${t.preheader}“`);
  return lines.join("\n");
}

/** The notice „Rückgängig“ adds — it belongs to no exchange. @param {unknown} t */
function isUndoNotice(t) {
  return Boolean(t) && typeof t === "object" && /** @type {{ role?: unknown, undo?: unknown }} */ (t).role === "notice" && /** @type {{ undo?: unknown }} */ (t).undo === true;
}

/**
 * The conversation sent with the next request: every operator turn that got
 * an answer, with that answer — the last `max` turns (an even number, so it
 * starts with the operator). Failed, cancelled and unanswered turns stay out;
 * an answer whose result „Rückgängig“ took back says so (DESIGNER_UNDONE_MARK),
 * and the notice of an undo made while a request ran does not split that
 * request from its answer.
 * @param {ReadonlyArray<{ role: string, text?: unknown, attachments?: unknown, subject?: unknown, preheader?: unknown, undone?: unknown, undo?: unknown }>} turns
 * @param {number} [max]
 * @returns {Array<{ role: "user" | "assistant", text: string }>}
 */
export function designerHistory(turns, max = DESIGNER_HISTORY_TURNS) {
  const list = Array.isArray(turns) ? turns : [];
  /** @type {Array<{ role: "user" | "assistant", text: string }>} */
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    if (u?.role !== "user") continue;
    let j = i + 1;
    while (j < list.length && isUndoNotice(list[j])) j++;
    const a = list[j];
    if (a?.role !== "assistant") continue;
    out.push({ role: "user", text: clip(userHistoryText(u), DESIGNER_HISTORY_CHARS) });
    out.push({ role: "assistant", text: clip(assistantHistoryText(a), DESIGNER_HISTORY_CHARS) });
    i = j;
  }
  const keep = Math.max(0, Math.floor(max / 2) * 2);
  return keep === 0 ? [] : out.slice(-keep);
}

/**
 * „Rückgängig“ took back the result of the AI answer `turnId` (the tag of the
 * undo step, docHistoryReducer): that answer is marked `undone` — the panel
 * shows it, designerHistory tells the AI — and a short notice is added at the
 * end, naming the instruction it answered. The same array when there is
 * nothing to mark: the answer is gone („Neues Gespräch“), or already undone.
 * @param {DesignerTurn[]} turns
 * @param {unknown} turnId
 * @param {number} noticeId  the id of the notice turn
 * @returns {DesignerTurn[]}
 */
export function undoDesignerTurn(turns, turnId, noticeId) {
  const list = Array.isArray(turns) ? turns : [];
  const at = list.findIndex((t) => t?.role === "assistant" && t.id === turnId);
  if (at < 0) return turns;
  const answer = /** @type {DesignerAssistantTurn} */ (list[at]);
  if (answer.undone === true) return turns;
  /** @type {DesignerUserTurn | undefined} */
  let asked;
  for (let k = at - 1; k >= 0; k--) {
    const t = list[k];
    if (t?.role === "user") {
      asked = t;
      break;
    }
    if (!isUndoNotice(t)) break;
  }
  const instruction = oneLine(asked?.text, 80);
  const files = Array.isArray(asked?.attachments) && asked.attachments.length > 0;
  const what = instruction ? `„${instruction}“` : files ? "die Gestaltung nach den Anhängen" : "die Antwort der KI";
  /** @type {DesignerNoticeTurn} */
  const notice = { id: noticeId, role: "notice", undo: true, text: `Rückgängig gemacht: ${what} — die Mail ist wieder wie davor.` };
  return [...list.slice(0, at), { ...answer, undone: true }, ...list.slice(at + 1), notice];
}

/**
 * The AI's notes as the plain text the panel shows. Notes are model output —
 * the admin never turns them into a link (the operator could be sent to a
 * foreign page from inside the trusted panel), so they are not rendered as
 * Markdown. What a model may still write in Markdown is reduced to its text:
 * **bold** / __bold__ → bold, [label](address) → „label (address)“ — the
 * address stays readable, nothing is clickable.
 * @param {unknown} text
 */
export function designerNotesText(text) {
  const s = typeof text === "string" ? text : "";
  return s
    .replace(/\[([^\]\n]+)\]\(\s*([^()\s]+)\s*\)/g, (_, label, url) => (label.trim() === url ? url : `${label} (${url})`))
    .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, "$2");
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
 * The document of an editor with its „Rückgängig“ steps. A step is the
 * document a replacement replaced, with the `tag` the replacement came with —
 * the id of the AI answer whose result it was (undoDesignerTurn), null for
 * „Vorlage laden“.
 *   set     — a hand edit (a value or an updater — an updater sees the
 *             document as it is then, e.g. a picture upload that finishes
 *             after an AI result): no step;
 *   replace — an AI result or „Vorlage laden“: the replaced document becomes
 *             a step (not when nothing changes; the oldest step goes beyond
 *             DESIGNER_UNDO_LIMIT);
 *   undo    — back one step (lastUndoTag says whose result it takes back);
 *   reset   — loaded or saved: no steps.
 * @template D
 * @param {{ doc: D, undo: Array<{ doc: D, tag: number | null }> }} state
 * @param {{ type: "set", doc: D | ((prev: D) => D) } | { type: "replace", doc: D, tag?: number | null } | { type: "undo" } | { type: "reset", doc: D }} action
 * @returns {{ doc: D, undo: Array<{ doc: D, tag: number | null }> }}
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
      const tag = typeof action.tag === "number" ? action.tag : null;
      return { doc: action.doc, undo: [...state.undo, { doc: state.doc, tag }].slice(-DESIGNER_UNDO_LIMIT) };
    }
    case "undo": {
      if (state.undo.length === 0) return state;
      return { doc: state.undo[state.undo.length - 1].doc, undo: state.undo.slice(0, -1) };
    }
    case "reset":
      return { doc: action.doc, undo: [] };
    default:
      return state;
  }
}

/**
 * The tag of the step the next „Rückgängig“ takes back (the AI answer whose
 * result it undoes), null for „Vorlage laden“ or when there is none.
 * @param {{ undo?: ReadonlyArray<{ tag?: unknown }> } | null | undefined} state
 * @returns {number | null}
 */
export function lastUndoTag(state) {
  const steps = Array.isArray(state?.undo) ? state.undo : [];
  const tag = steps.length > 0 ? steps[steps.length - 1]?.tag : null;
  return typeof tag === "number" ? tag : null;
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
