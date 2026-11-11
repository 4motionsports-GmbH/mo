"use client";

// useDesignerSession — the state of one editing session with the AI designer
// („KI-Gestalter“, DesignerPanel): the conversation, the attachments, the
// draft instruction and the running request. It lives in the WORKSPACE (the
// template editor, the Rundmail), not in the panel, so closing the panel or
// switching the Rundmail tab keeps the conversation — and a running request
// keeps running; leaving the editor aborts it.
//
// A request (POST /api/admin/vorlagen/assist, streamed NDJSON via
// adminStream) carries the instruction, the CURRENT document (hand edits
// included), the last 8 turns of the conversation, every attachment (they
// stay for the whole conversation until removed — re-sent each turn) and,
// in the Rundmail, subject, preview line and language. The result goes to
// `onResult` with the id of its answer (the workspace pushes the replaced
// document onto its undo stack, tagged with that id); the AI's notes become
// a reply in the conversation. When „Rückgängig“ takes such a step back, the
// workspace calls `noteUndo(id)`: the reply is marked, a notice says so, and
// the next request tells the AI. Files picked, dropped or pasted together
// are sorted before any is read — one toast for the refused ones, and they
// never take one of the 6 places. Pure rules: lib/mail-designer-client.mjs,
// lib/mail-designer-attachments.mjs.

import * as React from "react";
import {
  DESIGNER_INSTRUCTION_CHARS,
  designerCanSend,
  designerHistory,
  interpretDesignerEvent,
  undoDesignerTurn,
  type DesignerResultEvent,
  type DesignerTurn,
} from "@/lib/mail-designer-client.mjs";
import {
  DESIGNER_ATTACHMENT_LIMITS,
  pastedImageName,
  requestBudgetMessage,
  sortAttachmentFiles,
} from "@/lib/mail-designer-attachments.mjs";
import { plural } from "@/lib/admin-format.mjs";
import type { normalizeMailTemplateDoc } from "@/lib/mail-template-doc.mjs";
import { toast } from "../ui";
import { errorMessage } from "../lib/admin-fetch";
import { STREAM_BROKEN_MESSAGE, StreamBrokenError, adminStream } from "../lib/admin-stream";
import { AttachmentPrepError, prepareDesignerAttachment, type PreparedAttachment } from "./designer-attachments";

type MailDoc = ReturnType<typeof normalizeMailTemplateDoc>;

/** Where the designer works: a Rundmail, a design for Mo's personal mails, a template (either later). */
export type DesignerUse = "bulk" | "personal" | "template";

/** A result for the workspace; `turnId` — the id of its answer in the conversation (the tag of its undo step). */
export type DesignerResult = Omit<DesignerResultEvent, "kind"> & { turnId: number };

/** What the Rundmail tells the AI about the mail around the document. */
export interface DesignerContext {
  subject: string;
  preheader: string;
  /** the Rundmail's „Sprache“ — „en“: the AI writes the texts, subject and preview line in English */
  language?: "de" | "en";
}

/** One attachment: still being prepared in the browser, or ready to send. */
export interface DesignerAttachmentEntry {
  id: string;
  name: string;
  /** name|size|lastModified of the source file — a second copy is refused */
  key: string;
  prepared: PreparedAttachment | null;
}

export interface DesignerSession {
  turns: DesignerTurn[];
  attachments: DesignerAttachmentEntry[];
  draft: string;
  setDraft: (value: string) => void;
  /** a problem that blocks sending (request too large, files still being read) — shown above the input */
  notice: string | null;
  running: boolean;
  /** when the running request started (Date.now()) */
  startedAt: number | null;
  /** the latest progress text of the running request */
  progress: string | null;
  canSend: boolean;
  /** Attach files (picked, dropped or pasted). */
  addFiles: (files: Iterable<File>, origin?: "pick" | "drop" | "paste") => void;
  removeAttachment: (id: string) => void;
  send: () => void;
  abort: () => void;
  /** „Neues Gespräch“ — conversation, attachments and draft go. */
  reset: () => void;
  /**
   * „Rückgängig“ took back the result of answer `turnId` (useDocHistory's
   * undo() returns it; null — „Vorlage laden“ — is ignored): the answer is
   * marked as undone, a notice ends the conversation, the next request tells
   * the AI.
   */
  noteUndo: (turnId: number | null) => void;
}

const ENDPOINT = "/api/admin/vorlagen/assist";
const EDITED_MEANWHILE =
  "Während die KI gearbeitet hat, wurde die Mail von Hand geändert — diese Änderungen sind durch das Ergebnis ersetzt. „Rückgängig“ holt sie zurück.";

function revoke(entry: DesignerAttachmentEntry) {
  if (entry.prepared?.thumbUrl) URL.revokeObjectURL(entry.prepared.thumbUrl);
}

export function useDesignerSession({
  use,
  doc,
  context = null,
  onResult,
}: {
  use: DesignerUse;
  /** the document as it is now (null while it loads) */
  doc: MailDoc | null;
  /** Rundmail: subject, preview line and language, so the AI can fit the mail to them and suggest better ones */
  context?: DesignerContext | null;
  onResult: (result: DesignerResult) => void;
}): DesignerSession {
  const [turns, setTurns] = React.useState<DesignerTurn[]>([]);
  const [attachments, setAttachments] = React.useState<DesignerAttachmentEntry[]>([]);
  const [draft, setDraft] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const [run, setRun] = React.useState<{ startedAt: number; progress: string | null } | null>(null);

  // The workspace's latest callback and document for the async request —
  // read when the result arrives, not when it was sent (the operator may
  // have edited the mail meanwhile).
  const latest = React.useRef({ onResult, doc });
  React.useEffect(() => {
    latest.current = { onResult, doc };
  });

  // The attachment list as the truth for async preparation (several files at
  // once); the state mirrors it for rendering.
  const listRef = React.useRef<DesignerAttachmentEntry[]>([]);
  const commit = React.useCallback((fn: (prev: DesignerAttachmentEntry[]) => DesignerAttachmentEntry[]) => {
    listRef.current = fn(listRef.current);
    setAttachments(listRef.current);
  }, []);

  const seq = React.useRef(0);
  const nextId = React.useCallback(() => ++seq.current, []);
  const pasted = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const runningRef = React.useRef(false);
  const alive = React.useRef(true);

  React.useEffect(() => {
    alive.current = true;
    const list = listRef;
    return () => {
      alive.current = false;
      abortRef.current?.abort();
      for (const entry of list.current) revoke(entry);
    };
  }, []);

  const addTurn = React.useCallback((turn: DesignerTurn) => {
    if (alive.current) setTurns((prev) => [...prev, turn]);
  }, []);

  const addFiles = React.useCallback(
    (files: Iterable<File>, origin: "pick" | "drop" | "paste" = "pick") => {
      const list = Array.from(files).map((file) => ({
        file,
        name:
          origin === "paste" && (!file.name || /^image\.\w+$/i.test(file.name))
            ? pastedImageName(++pasted.current, file.type)
            : file.name || "Anhang",
        key: `${file.name}|${file.size}|${file.lastModified}`,
      }));
      // Decided at once, before any file is read: copies of attached files,
      // then type and size (synchronous) — a file that cannot be attached
      // never takes one of the places — then the limit. A pasted picture is
      // never a copy (two screenshots from the clipboard are two attachments).
      const plan = sortAttachmentFiles(
        list.map((f) => ({ name: f.name, type: f.file.type, size: f.file.size, key: origin === "paste" ? null : f.key })),
        { count: listRef.current.length, keys: listRef.current.map((e) => e.key) }
      );
      const quoted = (indexes: number[]) => indexes.map((i) => `„${list[i].name}“`).join(", ");
      if (plan.copies.length > 0) {
        toast({
          variant: "info",
          title: plan.copies.length === 1 ? `${quoted(plan.copies)} ist schon angehängt.` : `Schon angehängt: ${quoted(plan.copies)}`,
        });
      }
      if (plan.refused.length > 0) {
        // One toast for every file that was turned away, each with its reason.
        toast({
          variant: "error",
          title: plan.refused.length === 1 ? "Nicht angehängt" : `${plural(plan.refused.length, "Datei", "Dateien")} nicht angehängt`,
          description:
            plan.refused.length === 1
              ? plan.refused[0].message
              : React.createElement(
                  "ul",
                  { className: "flex flex-col gap-1" },
                  plan.refused.map((r) => React.createElement("li", { key: r.index }, r.message))
                ),
          duration: 9000,
        });
      }
      if (plan.attach.length > 0) setNotice(null);
      for (const i of plan.attach) {
        const { file, name, key } = list[i];
        const id = `a${nextId()}`;
        commit((prev) => [...prev, { id, name, key, prepared: null }]);
        prepareDesignerAttachment(file, name)
          .then((prepared) => {
            if (!alive.current || !listRef.current.some((e) => e.id === id)) {
              // left the editor or removed meanwhile
              if (prepared.thumbUrl) URL.revokeObjectURL(prepared.thumbUrl);
              return;
            }
            commit((prev) => prev.map((e) => (e.id === id ? { ...e, prepared } : e)));
          })
          .catch((err: unknown) => {
            commit((prev) => prev.filter((e) => e.id !== id));
            if (!alive.current) return;
            toast({
              variant: "error",
              title: "Nicht angehängt",
              description: err instanceof AttachmentPrepError ? err.message : `„${name}“ konnte nicht gelesen werden.`,
              duration: 7000,
            });
          });
      }
      if (plan.overLimit.length > 0) {
        toast({
          variant: "warning",
          title: `Höchstens ${DESIGNER_ATTACHMENT_LIMITS.maxCount} Anhänge`,
          description: `Nicht angehängt: ${quoted(plan.overLimit)} — bitte erst einen Anhang entfernen.`,
          duration: 7000,
        });
      }
    },
    [commit, nextId]
  );

  const removeAttachment = React.useCallback(
    (id: string) => {
      const entry = listRef.current.find((e) => e.id === id);
      if (entry) revoke(entry);
      commit((prev) => prev.filter((e) => e.id !== id));
      setNotice(null);
    },
    [commit]
  );

  const reset = React.useCallback(() => {
    if (runningRef.current) return;
    for (const entry of listRef.current) revoke(entry);
    commit(() => []);
    setTurns([]);
    setDraft("");
    setNotice(null);
  }, [commit]);

  const abort = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const noteUndo = React.useCallback(
    (turnId: number | null) => {
      if (turnId == null || !alive.current) return;
      const noticeId = nextId();
      setTurns((prev) => undoDesignerTurn(prev, turnId, noticeId));
    },
    [nextId]
  );

  const send = () => {
    if (runningRef.current || !doc) return;
    const entries = listRef.current;
    if (entries.some((e) => !e.prepared)) {
      setNotice("Die Anhänge werden noch vorbereitet — bitte einen Moment.");
      return;
    }
    const ready = entries.map((e) => e.prepared as PreparedAttachment);
    const instruction = draft.trim().slice(0, DESIGNER_INSTRUCTION_CHARS);
    if (!designerCanSend(instruction, ready.length)) return;

    const sentDoc = JSON.stringify(doc);
    const json = JSON.stringify({
      instruction,
      doc,
      use,
      history: designerHistory(turns),
      attachments: ready.map((a) => ({ name: a.name, mediaType: a.mediaType, data: a.data })),
      ...(context
        ? { context: { subject: context.subject, preheader: context.preheader, ...(context.language ? { language: context.language } : {}) } }
        : {}),
    });
    const tooBig = requestBudgetMessage({
      requestBytes: new Blob([json]).size,
      attachments: ready.map((a) => ({ name: a.name, size: a.data.length, fileSize: a.size })),
    });
    if (tooBig) {
      setNotice(tooBig);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    runningRef.current = true;
    setNotice(null);
    setDraft("");
    setTurns((prev) => [...prev, { id: nextId(), role: "user", text: instruction, attachments: ready.map((a) => a.name) }]);
    setRun({ startedAt: Date.now(), progress: null });

    // On a failure the instruction comes back into the (empty) input, so
    // „Gestalten“ is one click away.
    const fail = (text: string, role: "error" | "notice" = "error") => {
      addTurn({ id: nextId(), role, text });
      if (alive.current) setDraft((d) => (d.trim() ? d : instruction));
    };

    let settled = false;
    void (async () => {
      try {
        await adminStream(ENDPOINT, {
          json,
          signal: controller.signal,
          onEvent: (raw) => {
            if (settled || !alive.current) return;
            const event = interpretDesignerEvent(raw);
            if (!event) return;
            if (event.kind === "progress") {
              setRun((r) => (r ? { ...r, progress: event.text } : r));
              return;
            }
            settled = true;
            if (event.kind === "error") {
              fail(event.message);
              return;
            }
            // The answer's id goes with the result: the workspace tags its undo step with it (noteUndo).
            const turnId = nextId();
            const result: DesignerResult = {
              turnId,
              doc: event.doc,
              notes: event.notes,
              subject: event.subject,
              preheader: event.preheader,
              warnings: event.warnings,
            };
            // Hand edits made while the AI worked are replaced by its result —
            // say so (they are one „Rückgängig“ away).
            const editedMeanwhile = JSON.stringify(latest.current.doc) !== sentDoc;
            latest.current.onResult(result);
            addTurn({
              id: turnId,
              role: "assistant",
              text: result.notes,
              subject: result.subject,
              preheader: result.preheader,
              warnings: editedMeanwhile ? [EDITED_MEANWHILE, ...result.warnings] : result.warnings,
            });
          },
        });
        if (!settled) fail(STREAM_BROKEN_MESSAGE);
      } catch (err) {
        if (settled || !alive.current) return;
        if (controller.signal.aborted) fail("Abgebrochen — die Mail ist unverändert.", "notice");
        else if (err instanceof StreamBrokenError) fail(STREAM_BROKEN_MESSAGE);
        else fail(errorMessage(err, "Die KI-Gestaltung ist fehlgeschlagen."));
      } finally {
        runningRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
        if (alive.current) setRun(null);
      }
    })();
  };

  const allPrepared = attachments.every((e) => e.prepared);
  return {
    turns,
    attachments,
    draft,
    setDraft,
    notice,
    running: run !== null,
    startedAt: run?.startedAt ?? null,
    progress: run?.progress ?? null,
    canSend: run === null && doc !== null && allPrepared && designerCanSend(draft, attachments.length),
    addFiles,
    removeAttachment,
    send,
    abort,
    reset,
    noteUndo,
  };
}
