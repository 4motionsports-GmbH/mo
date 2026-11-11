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
// in the Rundmail, subject + preview line. The result goes to `onResult`
// (the workspace pushes the replaced document onto its undo stack); the
// AI's notes become a reply in the conversation. Pure rules:
// lib/mail-designer-client.mjs, lib/mail-designer-attachments.mjs.

import * as React from "react";
import {
  DESIGNER_INSTRUCTION_CHARS,
  designerCanSend,
  designerHistory,
  interpretDesignerEvent,
  type DesignerResultEvent,
  type DesignerTurn,
} from "@/lib/mail-designer-client.mjs";
import { DESIGNER_ATTACHMENT_LIMITS, pastedImageName, requestBudgetMessage } from "@/lib/mail-designer-attachments.mjs";
import type { normalizeMailTemplateDoc } from "@/lib/mail-template-doc.mjs";
import { toast } from "../ui";
import { errorMessage } from "../lib/admin-fetch";
import { STREAM_BROKEN_MESSAGE, StreamBrokenError, adminStream } from "../lib/admin-stream";
import { AttachmentPrepError, prepareDesignerAttachment, type PreparedAttachment } from "./designer-attachments";

type MailDoc = ReturnType<typeof normalizeMailTemplateDoc>;

/** Where the designer works: a Rundmail, a design for Mo's personal mails, a template (either later). */
export type DesignerUse = "bulk" | "personal" | "template";

export type DesignerResult = Omit<DesignerResultEvent, "kind">;

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
  /** Rundmail: subject and preview line, so the AI can fit the mail to them and suggest better ones */
  context?: { subject: string; preheader: string } | null;
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
      const skipped: string[] = [];
      for (const file of Array.from(files)) {
        const name = origin === "paste" && (!file.name || /^image\.\w+$/i.test(file.name))
          ? pastedImageName(++pasted.current, file.type)
          : file.name || "Anhang";
        const key = `${file.name}|${file.size}|${file.lastModified}`;
        if (origin !== "paste" && listRef.current.some((e) => e.key === key)) {
          toast({ variant: "info", title: `„${name}“ ist schon angehängt.` });
          continue;
        }
        if (listRef.current.length >= DESIGNER_ATTACHMENT_LIMITS.maxCount) {
          skipped.push(name);
          continue;
        }
        const id = `a${nextId()}`;
        commit((prev) => [...prev, { id, name, key, prepared: null }]);
        setNotice(null);
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
      if (skipped.length > 0) {
        toast({
          variant: "warning",
          title: `Höchstens ${DESIGNER_ATTACHMENT_LIMITS.maxCount} Anhänge`,
          description: `Nicht angehängt: ${skipped.map((n) => `„${n}“`).join(", ")} — bitte erst einen Anhang entfernen.`,
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
      ...(context ? { context: { subject: context.subject, preheader: context.preheader } } : {}),
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
            const result: DesignerResult = {
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
              id: nextId(),
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
  };
}
