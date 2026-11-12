"use client";

// useEditorDraft — the unsaved changes of the template editor and of a
// Rundmail's „Inhalt“, kept as a draft in THIS browser (localStorage; pure
// rules and the stored format: lib/editor-drafts.mjs; docs/ADMIN_DASHBOARD.md
// §3.12, §3.2). Never on the server: a saved template can be the live design
// of Mo's personal mails, and every save of a Rundmail's content needs a new
// test mail — „Speichern“ stays the step that publishes.
//
//   resume({ saved, base, apply }) — once, when the saved state is there: a
//       draft made on that same saved version is put back (`apply`, notice
//       „restored“); one made before a later save is only offered (notice
//       „offer“); a broken one, or one equal to the saved state, is removed.
//   writing — while `dirty`, the content is written EDITOR_DRAFT_DEBOUNCE_MS
//       after the last change, with `base` (the saved version it is made on),
//       and at once when the editor unmounts (in-app navigation) or the page
//       is hidden / unloaded; back at the saved state the draft is removed
//       (an offered one waits for the decision); `enabled` false (a released
//       Rundmail) keeps nothing.
//   leaving — while `dirty`, closing or reloading the tab asks first (the
//       browser's own prompt, beforeunload).
//   dismiss / discard / discardOffer — close the notice; „Verwerfen“ and
//       after „Speichern“; drop only the offered draft.
//
// Every storage access is guarded: a private window, blocked or full storage
// or a draft over ~1.5 MB only set `failed` (EditorDraftStatus says so) — the
// editor works as before. useStoredEditorDrafts lists the drafts of one kind
// (the template list's badges) and prunes old ones.

import * as React from "react";
import { X } from "lucide-react";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import {
  EDITOR_DRAFT_DEBOUNCE_MS,
  EDITOR_DRAFT_PREFIX,
  editorDraftKey,
  editorDraftRestore,
  editorDraftsToPrune,
  listEditorDrafts,
  parseEditorDraft,
  serializeEditorDraft,
  stableStringify,
  type EditorDraftBase,
  type EditorDraftKind,
} from "@/lib/editor-drafts.mjs";
import { Button, Callout, IconButton, InfoTip } from "../ui";

// ── storage — every access guarded ───────────────────────────────────────────

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // storage blocked (the getter itself throws)
  }
}

function readStored(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(key: string, raw: string): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(key, raw);
  } catch {
    return false; // full (QuotaExceededError) or blocked
  }
  changed();
  return true;
}

function removeStored(key: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    return;
  }
  changed();
}

function storedDraftEntries(): Array<{ key: string; raw: string | null }> {
  const s = storage();
  if (!s) return [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const key = s.key(i);
      if (key?.startsWith(EDITOR_DRAFT_PREFIX)) keys.push(key);
    }
    return keys.map((key) => ({ key, raw: readStored(key) }));
  } catch {
    return [];
  }
}

/** Removes broken drafts, those older than 30 days and all beyond the newest 20 (`keep` stays). */
function pruneStoredDrafts(keep: string | null = null): void {
  for (const key of editorDraftsToPrune(storedDraftEntries(), Date.now(), { keep })) removeStored(key);
}

// ── change notifications: this tab's writes, other tabs via `storage` ───────

let storeVersion = 0;
const listeners = new Set<() => void>();

function changed(): void {
  storeVersion += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  storeVersion += 1; // another tab may have written while nothing listened
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && !e.key.startsWith(EDITOR_DRAFT_PREFIX)) return;
    storeVersion += 1;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const indexCache = new Map<EditorDraftKind, { version: number; value: string }>();

/** „id:savedAt id:savedAt …“ of one kind's drafts — a string, so the snapshot compares by value. */
function draftIndex(kind: EditorDraftKind): string {
  const hit = indexCache.get(kind);
  if (hit && hit.version === storeVersion) return hit.value;
  const value = listEditorDrafts(storedDraftEntries(), kind)
    .filter((d) => d.id !== null)
    .map((d) => `${d.id}:${d.savedAt}`)
    .join(" ");
  indexCache.set(kind, { version: storeVersion, value });
  return value;
}

const noDrafts = () => "";

/**
 * The drafts of one kind on this device: id → when it was written. Empty on
 * the server and in the first render (no hydration mismatch); prunes old
 * drafts once per mount.
 */
export function useStoredEditorDrafts(kind: EditorDraftKind): Map<number, number> {
  const getSnapshot = React.useCallback(() => draftIndex(kind), [kind]);
  const index = React.useSyncExternalStore(subscribe, getSnapshot, noDrafts);
  React.useEffect(() => {
    pruneStoredDrafts();
  }, []);
  return React.useMemo(() => {
    const out = new Map<number, number>();
    for (const part of index.split(" ")) {
      const [id, at] = part.split(":").map(Number);
      if (id > 0 && at > 0) out.set(id, at);
    }
    return out;
  }, [index]);
}

// ── the editor's draft ───────────────────────────────────────────────────────

export interface EditorDraftNoticeState<C> {
  /** restored: put back on opening; offer: the object was saved after the draft was made — not applied */
  mode: "restored" | "offer";
  savedAt: number;
  content: C;
}

export interface EditorDraftResume<C> {
  /** The saved state the editor opened with. */
  saved: C;
  /** Its version (the template's version, the Rundmail's content version). */
  base: EditorDraftBase;
  /** Put a draft into the editor (no undo step — it is where the editor starts). */
  apply: (content: C) => void;
  /** A stored draft's content before it is compared and applied (e.g. the document normalised). */
  normalize?: (content: C) => C;
}

export interface EditorDraft<C> {
  notice: EditorDraftNoticeState<C> | null;
  /** The last write failed — storage blocked or full, or the draft too large. */
  failed: boolean;
  resume: (args: EditorDraftResume<C>) => void;
  /** Write a pending change now → whether the current unsaved state is kept on this device. */
  flush: () => boolean;
  /** Close the notice (a restored state stays in the editor). */
  dismiss: () => void;
  /** Remove the draft and the notice (Verwerfen, after Speichern). */
  discard: () => void;
  /** Remove only the offered draft (its „Verwerfen“) — changes made since stay drafted. */
  discardOffer: () => void;
}

export function useEditorDraft<C extends object>({
  kind,
  id,
  base,
  current,
  dirty,
  enabled = true,
}: {
  kind: EditorDraftKind;
  id: number;
  /** The saved version the current state is made on. */
  base: EditorDraftBase;
  /** The editor's content — memoised, a new object only when it changes; null while loading. */
  current: C | null;
  /** The editor's own „unsaved changes“. */
  dirty: boolean;
  /** false: nothing is kept, a stored draft is removed (a released Rundmail). */
  enabled?: boolean;
}): EditorDraft<C> {
  const key = editorDraftKey(kind, id);
  const [notice, setNotice] = React.useState<EditorDraftNoticeState<C> | null>(null);
  const [failed, setFailed] = React.useState(false);
  // resume ran (or there is nothing to resume): from now on the editor's state is drafted
  const readyRef = React.useRef(false);
  const pendingRef = React.useRef<(() => boolean) | null>(null);
  // what this editor knows is stored under the key (null: nothing)
  const storedRef = React.useRef<{ body: string; base: EditorDraftBase } | null>(null);
  // the stored draft of an earlier visit stays even while the editor is clean: an offered one
  // until the operator decides, a restored one until the editor shows it (the render after
  // `apply` — an effect pass in between still sees the clean state)
  const keepRef = React.useRef<"offer" | "restore" | null>(null);
  const failedRef = React.useRef(false);

  const resume = React.useCallback(
    ({ saved, base: savedBase, apply, normalize }: EditorDraftResume<C>) => {
      if (readyRef.current) return;
      readyRef.current = true;
      const raw = readStored(key);
      if (raw === null) return;
      const draft = parseEditorDraft(raw, kind);
      let content: C | null = null;
      if (draft) {
        try {
          content = normalize ? normalize(draft.content as C) : (draft.content as C);
        } catch {
          content = null;
        }
      }
      const decision = draft && content ? editorDraftRestore({ base: draft.base, content }, saved, savedBase) : "none";
      if (!draft || !content || decision === "none") {
        removeStored(key); // broken, or nothing but the saved state
        return;
      }
      storedRef.current = { body: stableStringify(draft.content) ?? "", base: draft.base };
      if (decision === "auto") {
        keepRef.current = "restore";
        apply(content);
        setNotice({ mode: "restored", savedAt: draft.savedAt, content });
      } else {
        keepRef.current = "offer";
        setNotice({ mode: "offer", savedAt: draft.savedAt, content });
      }
      pruneStoredDrafts(key);
    },
    [key, kind]
  );

  React.useEffect(() => {
    if (!enabled) {
      // The content is fixed (a released Rundmail): nothing to keep.
      readyRef.current = true;
      pendingRef.current = null;
      storedRef.current = null;
      keepRef.current = null;
      removeStored(key);
      return;
    }
    if (!readyRef.current || current === null) return;
    if (!dirty) {
      // Back at the saved state: no draft — unless one of an earlier visit is still to be shown or decided.
      pendingRef.current = null;
      if (keepRef.current === null && storedRef.current !== null) {
        storedRef.current = null;
        removeStored(key);
      }
      return;
    }
    if (keepRef.current === "restore") keepRef.current = null; // the restored draft is in the editor now
    const content = current;
    const write = (): boolean => {
      pendingRef.current = null;
      let body: string | null = null;
      try {
        body = stableStringify(content) ?? null;
      } catch {
        body = null;
      }
      const stored = storedRef.current;
      let ok: boolean;
      if (body !== null && stored !== null && stored.body === body && stored.base === base) {
        ok = true; // already stored (a draft just put back) — it keeps its time
      } else {
        const raw = body === null ? null : serializeEditorDraft({ content, base, savedAt: Date.now() });
        ok = raw !== null && writeStored(key, raw);
        if (!ok && raw !== null) {
          // Full: make room among the other drafts, then once more.
          pruneStoredDrafts(key);
          ok = writeStored(key, raw);
        }
        if (ok) {
          if (stored === null) pruneStoredDrafts(key); // a new draft: at most 20
          storedRef.current = { body: body ?? "", base };
        } else {
          // Not kept (too large, full, blocked) — an older draft would bring back stale work.
          storedRef.current = null;
          removeStored(key);
        }
        keepRef.current = null; // the editor's state replaced an offered draft
      }
      failedRef.current = !ok;
      setFailed(!ok);
      return ok;
    };
    pendingRef.current = write;
    const handle = window.setTimeout(() => pendingRef.current?.(), EDITOR_DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [enabled, dirty, current, base, key]);

  const flush = React.useCallback((): boolean => {
    const pending = pendingRef.current;
    return pending ? pending() : !failedRef.current;
  }, []);

  // Hidden or unloaded (tab closed, reload, a phone switching apps) — and the
  // editor unmounting (in-app navigation): write what is pending now.
  React.useEffect(() => {
    const onPageHide = () => {
      flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [flush]);

  // Closing or reloading the tab with unsaved changes asks first (the browser's own prompt).
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      flush();
      e.preventDefault();
      e.returnValue = ""; // older Chrome and Safari need it set
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, flush]);

  const dismiss = React.useCallback(() => setNotice(null), []);

  const discard = React.useCallback(() => {
    pendingRef.current = null;
    storedRef.current = null;
    keepRef.current = null;
    removeStored(key);
    setNotice(null);
  }, [key]);

  const discardOffer = React.useCallback(() => {
    if (keepRef.current === "offer") {
      keepRef.current = null;
      storedRef.current = null;
      removeStored(key);
    }
    setNotice(null);
  }, [key]);

  return { notice, failed, resume, flush, dismiss, discard, discardOffer };
}

// ── what the editor shows ────────────────────────────────────────────────────

/**
 * The notice at the top of the editor after it opened with a draft:
 * restored (info — „Verwerfen“ goes back to the saved version, ×) or offered
 * (warning — „Entwurf wiederherstellen“, „Verwerfen“). A restored notice
 * hides once the editor is back at the saved state.
 */
export function EditorDraftNotice<C>({
  notice,
  dirty,
  what,
  onRestore,
  onDiscard,
  onDismiss,
  className,
}: {
  notice: EditorDraftNoticeState<C> | null;
  dirty: boolean;
  /** „die Vorlage“, „die Rundmail“ */
  what: string;
  onRestore: () => void;
  onDiscard: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  if (!notice || (notice.mode === "restored" && !dirty)) return null;
  const at = formatAdmin(notice.savedAt, ADMIN_DATE_TIME_SHORT);
  if (notice.mode === "restored") {
    return (
      <Callout
        tone="info"
        className={className}
        action={
          <div className="flex items-center gap-1">
            <Button size="xs" variant="outline" onClick={onDiscard}>
              Verwerfen
            </Button>
            <IconButton label="Hinweis schließen" size="icon-sm" onClick={onDismiss}>
              <X />
            </IconButton>
          </div>
        }
      >
        Nicht gespeicherte Änderungen vom {at} wiederhergestellt.
      </Callout>
    );
  }
  return (
    <Callout
      tone="warning"
      className={className}
      action={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Button size="xs" variant="outline" onClick={onRestore}>
            Entwurf wiederherstellen
          </Button>
          <Button size="xs" variant="ghost" onClick={onDiscard}>
            Verwerfen
          </Button>
        </div>
      }
    >
      Es gibt nicht gespeicherte Änderungen vom {at}, aber {what} wurde danach gespeichert.
    </Callout>
  );
}

/** The muted line next to „Speichern“ while there are unsaved changes. */
export function EditorDraftStatus({ dirty, failed }: { dirty: boolean; failed: boolean }) {
  if (!dirty) return null;
  if (failed) {
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-warning">
        Entwurf nicht gesichert
        <InfoTip>
          Dieser Browser kann den Entwurf gerade nicht sichern — privates Fenster, Speicher voll oder gesperrt, oder die
          Mail ist zu groß. Ungespeicherte Änderungen gehen verloren, wenn du die Seite verlässt.
        </InfoTip>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
      Entwurf auf diesem Gerät gesichert
      <InfoTip>
        Ungespeicherte Änderungen werden automatisch in diesem Browser gesichert und beim nächsten Öffnen wiederhergestellt.
        Für alle sichtbar und in Mails verwendet wird erst, was du speicherst.
      </InfoTip>
    </span>
  );
}
