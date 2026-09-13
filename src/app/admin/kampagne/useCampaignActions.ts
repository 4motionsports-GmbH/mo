"use client";

// The Kampagne desk state machine: the working queue (an id-keyed selection,
// filter chips, the review checks per card), the in-flight map (one busy
// state PER CARD instead of one lock for the whole screen), the Postausgang
// (sends that left the queue and are still on their way), the background
// Vorbereiten job, the batched background regenerate, and every mutation.
//
// All mutations go through the guarded /api/admin/campaign/* routes with the
// SAME payloads as before the desk; the legal gates are enforced SERVER-side —
// a disabled button here is UX, never the guarantee. A refused send comes
// back to the top of the queue with the server's reason as a blocked
// Prüfpunkt, so nothing is ever lost silently.
//
// Bulk operations that change the server-side queue (Sync, Vorbereiten, Neu
// aufbauen, Wiederherstellen, Entwurf erstellen) call router.refresh(); the
// server re-renders the screen and the working copy re-syncs from the fresh
// props while keeping the operator's position, filter and local edits.

import * as React from "react";
import { useRouter } from "next/navigation";
import { EMAIL_TEXT_MODE_LABELS, DEFAULT_EMAIL_TEXT_MODE } from "@/lib/email-text-mode.mjs";
import { emailProseToText } from "@/lib/email-prose.mjs";
import { abGroupOf, reviewChecks, reviewVerdict } from "@/lib/campaign-review-checks.mjs";
import {
  deskProgress,
  matchesQueueFilter,
  nextSelectionAfterRemoval,
  queueFilterCounts,
  selectionAfterListChange,
  stepSelection,
  upsertOutbox,
} from "@/lib/campaign-desk-core.mjs";
import { toast } from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import type { EmailTextModeValue } from "../EmailTextModeToggle";
import { forgetPreviews } from "./useRenderedPreview";
import {
  PREPARE_CHUNK,
  PREPARE_TOTAL,
  contactName,
  type CampaignBundle,
  type CampaignCountsProps,
  type CampaignDeskProps,
  type CampaignHistoryItemProps,
  type CampaignQueueItemProps,
  type CampaignRecommendation,
  type CampaignSkippedItemProps,
  type CardBusy,
  type DeskView,
  type OutboxEntry,
  type QueueFilter,
} from "./types";

// ─── review checks (typed view of the pure module's result) ─────────────────

export type ReviewLevel = "blocked" | "hint" | "info";
export type ReviewFix =
  | "skip"
  | "regenerate"
  | "narrow_basis"
  | "swap_products"
  | "rebuild_bundle"
  | "generate_hero"
  | "shorten_subject"
  | null;
export interface ReviewCheck {
  key: string;
  level: ReviewLevel;
  title: string;
  detail: string | null;
  fix: ReviewFix;
  meta?: Record<string, unknown>;
}
export type ReviewVerdict = "blocked" | "hints" | "ready";

// ─── local helpers ──────────────────────────────────────────────────────────

/** Send-confirmation only on the FIRST send of the day (localStorage-keyed). */
function needsFirstSendConfirm(): boolean {
  try {
    const key = "ms-campaign-first-send";
    const today = new Date().toISOString().slice(0, 10);
    return window.localStorage.getItem(key) !== today;
  } catch {
    return false;
  }
}
function rememberFirstSendConfirm(): void {
  try {
    window.localStorage.setItem("ms-campaign-first-send", new Date().toISOString().slice(0, 10));
  } catch {
    // best-effort only
  }
}

const PREPARE_SETTINGS_KEY = "ms-campaign-prepare";

export interface PrepareSettings {
  count: number;
  depth: number;
  textMode: EmailTextModeValue;
  withHero: boolean;
}

const DEFAULT_PREPARE_SETTINGS: PrepareSettings = {
  count: PREPARE_TOTAL,
  depth: 0,
  textMode: DEFAULT_EMAIL_TEXT_MODE as EmailTextModeValue,
  withHero: false,
};

function loadPrepareSettings(): PrepareSettings {
  try {
    const raw = window.localStorage.getItem(PREPARE_SETTINGS_KEY);
    if (!raw) return DEFAULT_PREPARE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PrepareSettings>;
    return {
      count: [25, 50, 100].includes(Number(parsed.count)) ? Number(parsed.count) : PREPARE_TOTAL,
      depth: Number.isInteger(parsed.depth) ? Number(parsed.depth) : 0,
      textMode: (["detailed", "compact", "minimal"] as const).includes(
        parsed.textMode as EmailTextModeValue
      )
        ? (parsed.textMode as EmailTextModeValue)
        : DEFAULT_PREPARE_SETTINGS.textMode,
      withHero: parsed.withHero === true,
    };
  } catch {
    return DEFAULT_PREPARE_SETTINGS;
  }
}
function savePrepareSettings(settings: PrepareSettings): void {
  try {
    window.localStorage.setItem(PREPARE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // best-effort only
  }
}

/** Keep the desk's position in the URL (?contact=, ?view=, ?filter=). */
function syncDeskUrl(contactId: number | null, view: DeskView, filter: QueueFilter): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (contactId === null) url.searchParams.delete("contact");
  else url.searchParams.set("contact", String(contactId));
  if (view === "pruefen") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  if (filter === "all") url.searchParams.delete("filter");
  else url.searchParams.set("filter", filter);
  const next = url.toString();
  if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
}

export interface EmailView {
  title: string;
  description: string;
  url: string;
}

export interface PrepareJob {
  phase: "drafts" | "heroes" | "done";
  total: number;
  done: number;
  prepared: number;
  failed: number;
  suppressed: number;
  heroTotal: number;
  heroDone: number;
  heroFailed: number;
  cancelled: boolean;
}

export interface BulkProgress {
  label: string;
  done: number;
  total: number;
}

interface RegenerateOptions {
  depth?: number;
  refreshRecommendations?: boolean;
  purchaseSelection?: string[] | null;
  /** Explicit new text mode; omitted = the draft keeps its stored mode. */
  textMode?: EmailTextModeValue;
}

interface DraftResponse {
  draft?: {
    subject: string;
    body: string;
    discountPercent: number;
    discountExpiresAt: string | null;
    textMode: EmailTextModeValue | null;
    segment: string | null;
    segmentDays: number | null;
    lowConfidence: boolean;
    purchaseSummary: CampaignQueueItemProps["purchaseSummary"];
    purchaseSelectedIds: string[] | null;
    heroImageUrl?: string | null;
    heroHeadline?: string | null;
    updatedAt?: string | null;
  };
  recommendations?: CampaignRecommendation[];
  bundle?: CampaignBundle | null;
}

interface BundleOfferResponse {
  id: number;
  title: string | null;
  components: Array<{ title: string }>;
  bundlePrice: string;
  componentsSum: string;
  currency: string;
  expiresAt: string | null;
}

const fail = (title: string, err: unknown) =>
  toast({ variant: "error", title, description: errorMessage(err) });

const REGENERATE_BATCH_MS = 1500;
const OUTBOX_FADE_MS = 8000;

export function useCampaignActions({
  counts,
  queue,
  skipped,
  sendsApproved,
  allowSingleOptIn,
  heroDesignActive,
  minSendIntervalDays,
  initialContactId,
  initialView,
  initialFilter,
}: Pick<
  CampaignDeskProps,
  | "counts"
  | "queue"
  | "skipped"
  | "sendsApproved"
  | "allowSingleOptIn"
  | "heroDesignActive"
  | "minSendIntervalDays"
  | "initialContactId"
  | "initialView"
  | "initialFilter"
>) {
  const router = useRouter();

  // ── working copies of the server data ────────────────────────────────────
  const [items, setItems] = React.useState(queue);
  const [skippedList, setSkippedList] = React.useState(skipped);
  const [countsLocal, setCountsLocal] = React.useState<CampaignCountsProps>(counts);
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  // Ids removed locally (sent, skipped, in flight) — a server refresh must not
  // resurrect them while their request is still on its way.
  const removedRef = React.useRef(new Set<number>());

  // ── view state ───────────────────────────────────────────────────────────
  const [view, setView] = React.useState<DeskView>(initialView);
  const [filter, setFilterState] = React.useState<QueueFilter>(initialFilter);
  const [currentId, setCurrentId] = React.useState<number | null>(() => {
    if (initialContactId !== null && queue.some((q) => q.contactId === initialContactId)) {
      return initialContactId;
    }
    return queue[0]?.contactId ?? null;
  });
  const [editMode, setEditMode] = React.useState(false);
  const [focusMode, setFocusMode] = React.useState(false);

  // ── in-flight state ──────────────────────────────────────────────────────
  const [busyById, setBusyById] = React.useState<Record<number, CardBusy>>({});
  const [outbox, setOutbox] = React.useState<OutboxEntry[]>([]);
  const [restoring, setRestoring] = React.useState<Set<number>>(() => new Set());
  const [jobBusy, setJobBusy] = React.useState<null | "sync" | "reset">(null);
  const [prepareJob, setPrepareJob] = React.useState<PrepareJob | null>(null);
  const prepareCancelled = React.useRef(false);
  const [prepareSettings, setPrepareSettingsState] =
    React.useState<PrepareSettings>(DEFAULT_PREPARE_SETTINGS);
  const [bulkProgress, setBulkProgress] = React.useState<BulkProgress | null>(null);
  const [copiedId, setCopiedId] = React.useState<number | null>(null);
  const [confirmSendId, setConfirmSendId] = React.useState<number | null>(null);
  const [resetOpen, setResetOpen] = React.useState(false);
  // Rendered-HTML viewer (full-size draft preview + sent-email view). Own busy
  // flag — a read-only preview never blocks the desk.
  const [emailView, setEmailView] = React.useState<EmailView | null>(null);
  const [emailViewBusy, setEmailViewBusy] = React.useState(false);

  React.useEffect(() => {
    setPrepareSettingsState(loadPrepareSettings());
  }, []);
  const setPrepareSettings = React.useCallback((patch: Partial<PrepareSettings>) => {
    setPrepareSettingsState((prev) => {
      const next = { ...prev, ...patch };
      savePrepareSettings(next);
      return next;
    });
  }, []);

  // Re-sync the working copies whenever the SERVER hands over fresh data
  // (router.refresh() after a bulk job). Session-only facts (an edit, a
  // refused send) and locally removed cards survive the refresh; the
  // position and the filter are kept (see the selection effect below).
  React.useEffect(() => {
    setItems((prev) => {
      const localById = new Map(prev.map((it) => [it.contactId, it]));
      return queue
        .filter((q) => !removedRef.current.has(q.contactId))
        .map((q) => {
          const local = localById.get(q.contactId);
          if (!local) return q;
          return {
            ...q,
            ...(local.edited ? { subject: local.subject, body: local.body, edited: true } : {}),
            sendError: local.sendError ?? null,
          };
        });
    });
  }, [queue]);
  React.useEffect(() => setSkippedList(skipped), [skipped]);
  React.useEffect(() => setCountsLocal(counts), [counts]);

  // ── checks, verdicts, filters ────────────────────────────────────────────
  const checksById = React.useMemo(() => {
    const ctx = {
      sendsApproved,
      allowSingleOptIn,
      heroDesignActive,
      minSendIntervalDays,
      now: Date.now(),
    };
    const map = new Map<number, ReviewCheck[]>();
    for (const it of items) map.set(it.contactId, reviewChecks(it, ctx) as ReviewCheck[]);
    return map;
  }, [items, sendsApproved, allowSingleOptIn, heroDesignActive, minSendIntervalDays]);

  const checksOf = React.useCallback(
    (contactId: number): ReviewCheck[] => checksById.get(contactId) ?? [],
    [checksById]
  );
  const verdictOf = React.useCallback(
    (item: { contactId: number }): ReviewVerdict =>
      reviewVerdict(checksById.get(item.contactId) ?? []) as ReviewVerdict,
    [checksById]
  );

  const visibleItems = React.useMemo(
    () => items.filter((it) => matchesQueueFilter(it, filter, verdictOf(it))),
    [items, filter, verdictOf]
  );
  const visibleIds = React.useMemo(() => visibleItems.map((it) => it.contactId), [visibleItems]);
  const visibleIdsRef = React.useRef(visibleIds);
  visibleIdsRef.current = visibleIds;
  const filterCounts = React.useMemo(
    () => queueFilterCounts(items, verdictOf) as Record<string, number>,
    [items, verdictOf]
  );

  // Keep the selection valid when the visible list changes underneath it
  // (filter switch, server refresh): stay on the card when it is still
  // visible, else fall back to the first visible one.
  React.useEffect(() => {
    setCurrentId((cur) => selectionAfterListChange(visibleIds, cur));
  }, [visibleIds]);

  const current = React.useMemo(
    () => (currentId === null ? null : (items.find((it) => it.contactId === currentId) ?? null)),
    [items, currentId]
  );
  const currentIndex = currentId === null ? -1 : visibleIds.indexOf(currentId);
  const nextItem = React.useMemo(() => {
    if (currentIndex < 0) return null;
    return visibleItems[currentIndex + 1] ?? null;
  }, [visibleItems, currentIndex]);

  React.useEffect(() => {
    syncDeskUrl(view === "pruefen" ? currentId : null, view, filter);
  }, [currentId, view, filter]);

  const progress = React.useMemo(
    () => deskProgress(countsLocal.sentToday, items.length),
    [countsLocal.sentToday, items.length]
  );

  // ── selection ────────────────────────────────────────────────────────────
  const select = React.useCallback((contactId: number) => {
    setCurrentId(contactId);
    setEditMode(false);
  }, []);
  const next = React.useCallback(() => {
    setCurrentId((cur) => stepSelection(visibleIdsRef.current, cur, 1));
    setEditMode(false);
  }, []);
  const prev = React.useCallback(() => {
    setCurrentId((cur) => stepSelection(visibleIdsRef.current, cur, -1));
    setEditMode(false);
  }, []);
  const setFilter = React.useCallback((nextFilter: QueueFilter) => {
    setFilterState(nextFilter);
  }, []);
  /** Jump straight to a queue card (rail click / global search „Öffnen“).
   * Clears the filter when the target is hidden by it. */
  const jumpToContact = React.useCallback((contactId: number) => {
    const inQueue = itemsRef.current.some((it) => it.contactId === contactId);
    if (!inQueue) return;
    if (!visibleIdsRef.current.includes(contactId)) setFilterState("all");
    setView("pruefen");
    setCurrentId(contactId);
    setEditMode(false);
  }, []);

  // ── per-card patching ────────────────────────────────────────────────────
  const patchItem = React.useCallback(
    (contactId: number, patch: Partial<CampaignQueueItemProps>) => {
      setItems((prevItems) =>
        prevItems.map((it) => (it.contactId === contactId ? { ...it, ...patch } : it))
      );
    },
    []
  );
  const setBusy = React.useCallback((contactId: number, kind: CardBusy | null) => {
    setBusyById((prevBusy) => {
      if (kind === null) {
        if (!(contactId in prevBusy)) return prevBusy;
        const nextBusy = { ...prevBusy };
        delete nextBusy[contactId];
        return nextBusy;
      }
      return { ...prevBusy, [contactId]: kind };
    });
  }, []);
  const busyOf = React.useCallback(
    (contactId: number | null): CardBusy | null =>
      contactId === null ? null : (busyById[contactId] ?? null),
    [busyById]
  );

  /** Take a card out of the working queue and move the selection to the card
   * that took its place (never back to the top). */
  const removeItem = React.useCallback((contactId: number) => {
    removedRef.current.add(contactId);
    setCurrentId((cur) =>
      cur === contactId ? nextSelectionAfterRemoval(visibleIdsRef.current, contactId) : cur
    );
    setItems((prevItems) => prevItems.filter((it) => it.contactId !== contactId));
    setEditMode(false);
  }, []);
  /** Put a card back (top of the queue), e.g. after a refused send. */
  const restoreItem = React.useCallback((item: CampaignQueueItemProps) => {
    removedRef.current.delete(item.contactId);
    setItems((prevItems) => [item, ...prevItems.filter((it) => it.contactId !== item.contactId)]);
  }, []);

  /** Server-side queue changed (sync / prepare / reset / unskip / draft): let
   * the server re-render the screen; the working copy re-syncs. */
  const reloadFromServer = React.useCallback(() => router.refresh(), [router]);

  // ── edits (persisted via /update, debounced per card) ────────────────────
  const saveTimers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const persistEdit = React.useCallback((contactId: number, subject: string, body: string) => {
    const pending = saveTimers.current.get(contactId);
    if (pending) clearTimeout(pending);
    saveTimers.current.set(
      contactId,
      setTimeout(() => {
        saveTimers.current.delete(contactId);
        adminFetch("/api/admin/campaign/update", { body: { contactId, subject, body } }).catch(
          (err) => fail("Änderung nicht gespeichert", err)
        );
      }, 600)
    );
  }, []);
  const editItem = React.useCallback(
    (contactId: number, patch: Partial<Pick<CampaignQueueItemProps, "subject" | "body">>) => {
      const item = itemsRef.current.find((it) => it.contactId === contactId);
      if (!item) return;
      const updated = { ...item, ...patch };
      patchItem(contactId, { ...patch, edited: true });
      persistEdit(contactId, updated.subject, updated.body);
    },
    [patchItem, persistEdit]
  );

  // ── rendered viewer (full-size dialog) ───────────────────────────────────
  const openEmailView = React.useCallback(
    async (title: string, description: string, path: string, payload: Record<string, unknown>) => {
      setEmailViewBusy(true);
      try {
        const res = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setEmailView((prevView) => {
          if (prevView) URL.revokeObjectURL(prevView.url);
          return { title, description, url };
        });
      } catch (err) {
        fail("E-Mail-Ansicht fehlgeschlagen", err);
      } finally {
        setEmailViewBusy(false);
      }
    },
    []
  );
  const closeEmailView = React.useCallback(() => {
    setEmailView((prevView) => {
      if (prevView) URL.revokeObjectURL(prevView.url);
      return null;
    });
  }, []);
  /** Full-size preview of a card — the on-screen (possibly unsaved) subject
   * and text ride along so edits preview correctly. */
  const previewItem = React.useCallback(
    (contactId: number) => {
      const item = itemsRef.current.find((it) => it.contactId === contactId);
      if (!item || emailViewBusy) return;
      void openEmailView(
        `Vorschau — ${item.email}`,
        "So wird die E-Mail im Postfach gerendert. Der Rabatt zeigt den Platzhalter-Code " +
          "MO-XXXX — der echte MK-Code wird erst beim Senden erzeugt.",
        "/api/admin/campaign/email-preview",
        { contactId, subject: item.subject, body: item.body }
      );
    },
    [emailViewBusy, openEmailView]
  );
  /** Open the retained content of a send record („Gesendet“, Verlauf). */
  const viewSent = React.useCallback(
    (h: CampaignHistoryItemProps) => {
      if (emailViewBusy) return;
      void openEmailView(
        `Gesendet an ${h.email}`,
        h.sentVia === "copy"
          ? "Kopier-Versand — gespeichert ist der kopierte Text (kein HTML verschickt)."
          : "Genau dieser Inhalt wurde verschickt.",
        "/api/admin/campaign/sent-email",
        { sendId: h.id }
      );
    },
    [emailViewBusy, openEmailView]
  );

  // ── Postausgang: sending without waiting ─────────────────────────────────
  const sendNow = React.useCallback(
    async (contactId: number) => {
      const item = itemsRef.current.find((it) => it.contactId === contactId);
      if (!item || removedRef.current.has(contactId)) return;
      const entry = { contactId, email: item.email, name: contactName(item) };
      removeItem(contactId);
      setOutbox((o) => upsertOutbox(o, { ...entry, state: "sending" }));
      try {
        await adminFetch("/api/admin/campaign/send", { body: { contactId } });
        setOutbox((o) => upsertOutbox(o, { ...entry, state: "sent" }));
        setCountsLocal((c) => ({
          ...c,
          sentToday: c.sentToday + 1,
          sentTotal: c.sentTotal + 1,
          drafted: Math.max(0, c.drafted - 1),
        }));
        toast({ variant: "success", title: `Gesendet an ${item.email}`, duration: 2500 });
        setTimeout(() => {
          setOutbox((o) => o.filter((e) => !(e.contactId === contactId && e.state === "sent")));
        }, OUTBOX_FADE_MS);
      } catch (err) {
        const message = errorMessage(err);
        restoreItem({ ...item, sendError: message });
        setOutbox((o) => upsertOutbox(o, { ...entry, state: "failed", error: message }));
        toast({ variant: "error", title: `Versand abgelehnt — ${item.email}`, description: message });
      }
    },
    [removeItem, restoreItem]
  );

  /** `S` / Senden: leaves the queue at once; the server answers in the
   * Postausgang. Blocked cards and cards with work in flight never send. */
  const send = React.useCallback(
    (contactId: number) => {
      const checks = checksById.get(contactId) ?? [];
      if (reviewVerdict(checks) === "blocked") return;
      if (busyById[contactId]) return;
      if (needsFirstSendConfirm()) {
        setConfirmSendId(contactId);
        return;
      }
      void sendNow(contactId);
    },
    [checksById, busyById, sendNow]
  );
  const confirmAndSend = React.useCallback(() => {
    rememberFirstSendConfirm();
    const id = confirmSendId;
    setConfirmSendId(null);
    if (id !== null) void sendNow(id);
  }, [confirmSendId, sendNow]);
  /** Retry a refused/failed send from the Postausgang. */
  const retrySend = React.useCallback(
    (contactId: number) => {
      patchItem(contactId, { sendError: null });
      setOutbox((o) => o.filter((e) => e.contactId !== contactId));
      // The checks re-run without the refusal; a still-blocked card stays.
      window.setTimeout(() => {
        const item = itemsRef.current.find((it) => it.contactId === contactId);
        if (!item) return;
        void sendNow(contactId);
      }, 0);
    },
    [patchItem, sendNow]
  );
  const dismissOutbox = React.useCallback((contactId: number) => {
    setOutbox((o) => o.filter((e) => e.contactId !== contactId));
  }, []);

  // ── skip (optimistic, undoable) ──────────────────────────────────────────
  const skip = React.useCallback(
    async (contactId: number) => {
      const item = itemsRef.current.find((it) => it.contactId === contactId);
      if (!item || removedRef.current.has(contactId)) return;
      const skippedEntry: CampaignSkippedItemProps = {
        contactId,
        email: item.email,
        firstName: item.firstName,
        lastName: item.lastName,
        hasDraft: true,
      };
      removeItem(contactId);
      setSkippedList((prevList) => [skippedEntry, ...prevList]);
      setCountsLocal((c) => ({ ...c, skipped: c.skipped + 1, drafted: Math.max(0, c.drafted - 1) }));
      try {
        await adminFetch("/api/admin/campaign/skip", { body: { contactId } });
      } catch (err) {
        restoreItem(item);
        setSkippedList((prevList) => prevList.filter((s) => s.contactId !== contactId));
        setCountsLocal((c) => ({ ...c, skipped: Math.max(0, c.skipped - 1), drafted: c.drafted + 1 }));
        fail("Überspringen fehlgeschlagen", err);
      }
    },
    [removeItem, restoreItem]
  );

  /** Undo a skip. If the contact still has its draft it lands straight back in
   * the queue; otherwise a fresh draft is generated first. */
  const unskip = React.useCallback(
    async (contactId: number) => {
      if (restoring.has(contactId)) return;
      setRestoring((s) => new Set(s).add(contactId));
      try {
        const json = await adminFetch<{ status?: string }>("/api/admin/campaign/unskip", {
          body: { contactId },
        });
        if (json.status === "pending") {
          toast({ title: "Wiederhergestellt — Entwurf wird generiert…", duration: 0 });
          await adminFetch("/api/admin/campaign/draft", {
            body: {
              contactId,
              discountPercent: prepareSettings.depth,
              textMode: prepareSettings.textMode,
              regenerate: true,
            },
          });
        }
        removedRef.current.delete(contactId);
        setSkippedList((prevList) => prevList.filter((s) => s.contactId !== contactId));
        toast({ variant: "success", title: "Kontakt zurück in der Warteschlange" });
        reloadFromServer();
      } catch (err) {
        fail("Wiederherstellen fehlgeschlagen", err);
      } finally {
        setRestoring((s) => {
          const nextSet = new Set(s);
          nextSet.delete(contactId);
          return nextSet;
        });
      }
    },
    [restoring, prepareSettings.depth, prepareSettings.textMode, reloadFromServer]
  );

  /** Global-search action: generate a draft for a contact that is NOT in the
   * queue yet (status pending/draft_failed) and pull them in. */
  const draftContact = React.useCallback(
    async (contactId: number) => {
      if (restoring.has(contactId)) return;
      setRestoring((s) => new Set(s).add(contactId));
      const pending = toast({ title: "Entwurf wird generiert…", duration: 0 });
      try {
        await adminFetch("/api/admin/campaign/draft", {
          body: {
            contactId,
            discountPercent: prepareSettings.depth,
            textMode: prepareSettings.textMode,
            regenerate: true,
          },
        });
        toast.dismiss(pending);
        toast({ variant: "success", title: "Entwurf erstellt — Kontakt ist in der Warteschlange" });
        reloadFromServer();
      } catch (err) {
        toast.dismiss(pending);
        fail("Entwurf fehlgeschlagen", err);
      } finally {
        setRestoring((s) => {
          const nextSet = new Set(s);
          nextSet.delete(contactId);
          return nextSet;
        });
      }
    },
    [restoring, prepareSettings.depth, prepareSettings.textMode, reloadFromServer]
  );

  // ── copy path ────────────────────────────────────────────────────────────
  const copy = React.useCallback(async (contactId: number) => {
    const item = itemsRef.current.find((it) => it.contactId === contactId);
    if (!item) return;
    try {
      // Markdown links flatten to "Label (URL)" — the clipboard is plain text.
      await navigator.clipboard.writeText(`${item.subject}\n\n${emailProseToText(item.body)}`);
      setCopiedId(contactId);
      toast({
        variant: "success",
        title: "In Zwischenablage kopiert",
        description:
          item.discountPercent > 0
            ? "Achtung: Der Text enthält den Platzhalter-Code MO-XXXX — beim Kopier-Versand wird KEIN echter Code erzeugt."
            : "Betreff + Text kopiert. Danach „Als erledigt markieren“ klicken.",
      });
    } catch {
      toast({ variant: "error", title: "Kopieren fehlgeschlagen" });
    }
  }, []);
  const markDone = React.useCallback(
    async (contactId: number) => {
      const item = itemsRef.current.find((it) => it.contactId === contactId);
      if (!item || busyById[contactId]) return;
      setBusy(contactId, "markdone");
      try {
        await adminFetch("/api/admin/campaign/mark-done", { body: { contactId } });
        toast({ variant: "success", title: "Als erledigt (kopiert) markiert" });
        setCopiedId(null);
        setCountsLocal((c) => ({
          ...c,
          sentToday: c.sentToday + 1,
          sentTotal: c.sentTotal + 1,
          drafted: Math.max(0, c.drafted - 1),
        }));
        removeItem(contactId);
      } catch (err) {
        fail("Markieren fehlgeschlagen", err);
      } finally {
        setBusy(contactId, null);
      }
    },
    [busyById, setBusy, removeItem]
  );

  // ── regenerate: batched, in the background ───────────────────────────────
  /** Regenerate a contact's draft and patch the card from the full response
   * (text, recommendations, bundle, purchase basis, hero) so the card never
   * drifts from what was persisted. Throws on failure. */
  const runRegenerate = React.useCallback(
    async (contactId: number, opts: RegenerateOptions = {}) => {
      const item = itemsRef.current.find((it) => it.contactId === contactId);
      const depth = opts.depth ?? item?.discountPercent ?? 0;
      const json = await adminFetch<DraftResponse>("/api/admin/campaign/draft", {
        body: {
          contactId,
          discountPercent: depth,
          regenerate: true,
          ...(opts.refreshRecommendations ? { refreshRecommendations: true } : {}),
          ...("purchaseSelection" in opts ? { purchaseSelection: opts.purchaseSelection } : {}),
          ...(opts.textMode ? { textMode: opts.textMode } : {}),
        },
      });
      if (json.draft) {
        const d = json.draft;
        forgetPreviews(contactId);
        patchItem(contactId, {
          subject: d.subject,
          body: d.body,
          discountPercent: d.discountPercent,
          discountExpiresAt: d.discountExpiresAt,
          textMode: d.textMode ?? "detailed",
          segment: d.segment ?? null,
          segmentDays: d.segmentDays ?? null,
          lowConfidence: d.lowConfidence,
          purchaseSummary: d.purchaseSummary,
          purchaseSelectedIds: d.purchaseSelectedIds,
          ...(json.recommendations ? { recommendations: json.recommendations } : {}),
          bundle: json.bundle ?? null,
          ...(d.heroImageUrl !== undefined ? { heroUrl: d.heroImageUrl } : {}),
          ...(d.heroHeadline !== undefined ? { heroHeadline: d.heroHeadline } : {}),
          draftUpdatedAt: d.updatedAt ?? new Date().toISOString(),
          edited: false,
        });
      }
    },
    [patchItem]
  );

  const regenTimers = React.useRef(
    new Map<number, { timer: ReturnType<typeof setTimeout>; opts: RegenerateOptions }>()
  );
  const runRegenerateGuarded = React.useCallback(
    async (contactId: number, opts: RegenerateOptions, successTitle = "Text aktualisiert") => {
      setBusy(contactId, "regen");
      try {
        await runRegenerate(contactId, opts);
        toast({ variant: "success", title: successTitle, duration: 2500 });
      } catch (err) {
        fail("Neu generieren fehlgeschlagen", err);
      } finally {
        if (!regenTimers.current.has(contactId)) setBusy(contactId, null);
      }
    },
    [runRegenerate, setBusy]
  );
  /** Several offer/text changes within a moment collapse into ONE regenerate;
   * the card shows „Text wird angepasst…“ and the operator may move on. */
  const scheduleRegenerate = React.useCallback(
    (contactId: number, opts: RegenerateOptions = {}) => {
      const pending = regenTimers.current.get(contactId);
      const merged = { ...(pending?.opts ?? {}), ...opts };
      if (pending) clearTimeout(pending.timer);
      setBusy(contactId, "regen");
      const timer = setTimeout(() => {
        regenTimers.current.delete(contactId);
        void runRegenerateGuarded(contactId, merged);
      }, REGENERATE_BATCH_MS);
      regenTimers.current.set(contactId, { timer, opts: merged });
    },
    [runRegenerateGuarded, setBusy]
  );
  /** `R` / Neu generieren: immediately, with whatever changes were pending. */
  const regenerate = React.useCallback(
    (contactId: number) => {
      if (!itemsRef.current.some((it) => it.contactId === contactId)) return;
      const busyKind = busyById[contactId];
      if (busyKind && busyKind !== "regen") return;
      const pending = regenTimers.current.get(contactId);
      if (pending) {
        clearTimeout(pending.timer);
        regenTimers.current.delete(contactId);
      }
      void runRegenerateGuarded(contactId, pending?.opts ?? {}, "Entwurf neu generiert");
    },
    [busyById, runRegenerateGuarded]
  );
  React.useEffect(() => {
    const timers = regenTimers.current;
    const saves = saveTimers.current;
    return () => {
      for (const { timer } of timers.values()) clearTimeout(timer);
      for (const timer of saves.values()) clearTimeout(timer);
    };
  }, []);

  // ── offer + text changes (each persists, then batches a regenerate) ──────
  const setDiscount = React.useCallback(
    async (contactId: number, depth: number) => {
      const item = itemsRef.current.find((it) => it.contactId === contactId);
      if (!item || depth === item.discountPercent) return;
      const busyKind = busyById[contactId];
      if (busyKind && busyKind !== "regen") return;
      setBusy(contactId, "discount");
      try {
        const json = await adminFetch<{ discountPercent: number; discountExpiresAt: string | null }>(
          "/api/admin/campaign/discount",
          { body: { contactId, discountPercent: depth } }
        );
        patchItem(contactId, {
          discountPercent: json.discountPercent,
          discountExpiresAt: json.discountExpiresAt,
        });
        scheduleRegenerate(contactId, { depth: json.discountPercent });
      } catch (err) {
        setBusy(contactId, null);
        fail("Rabatt nicht gespeichert", err);
      }
    },
    [busyById, setBusy, patchItem, scheduleRegenerate]
  );

  /** Switch the card's email language (DE/EN): persists the per-contact
   * override, then batches a regenerate so the prose matches. */
  const setLanguage = React.useCallback(
    async (contactId: number, language: "de" | "en") => {
      const item = itemsRef.current.find((it) => it.contactId === contactId);
      if (!item || language === item.language) return;
      const busyKind = busyById[contactId];
      if (busyKind && busyKind !== "regen") return;
      setBusy(contactId, "language");
      try {
        const json = await adminFetch<{ language?: "de" | "en"; languageOverride?: "de" | "en" | null }>(
          "/api/admin/campaign/language",
          { body: { contactId, language } }
        );
        patchItem(contactId, {
          language: json.language ?? language,
          languageOverride: json.languageOverride ?? null,
        });
        scheduleRegenerate(contactId);
      } catch (err) {
        setBusy(contactId, null);
        fail("Sprachwechsel fehlgeschlagen", err);
      }
    },
    [busyById, setBusy, patchItem, scheduleRegenerate]
  );

  /** Switch the card's text mode; the mode is persisted by the regenerate. */
  const setTextMode = React.useCallback(
    (contactId: number, mode: EmailTextModeValue) => {
      const item = itemsRef.current.find((it) => it.contactId === contactId);
      if (!item || mode === item.textMode) return;
      const busyKind = busyById[contactId];
      if (busyKind && busyKind !== "regen") return;
      patchItem(contactId, { textMode: mode });
      toast({ title: `Textmodus: ${EMAIL_TEXT_MODE_LABELS[mode]} — Text wird angepasst…`, duration: 2000 });
      scheduleRegenerate(contactId, { textMode: mode });
    },
    [busyById, patchItem, scheduleRegenerate]
  );

  /** Persist a curated recommendation list; the server also rebuilds an
   * attached bundle to match. Immediate persist per change — no save button. */
  const updateRecommendations = React.useCallback(
    async (contactId: number, productIds: string[]) => {
      const item = itemsRef.current.find((it) => it.contactId === contactId);
      if (!item) return;
      const busyKind = busyById[contactId];
      if (busyKind && busyKind !== "regen") return;
      setBusy(contactId, "recs");
      try {
        const json = await adminFetch<{
          recommendations?: CampaignRecommendation[];
          bundle?: CampaignBundle | null;
          bundleError?: string | null;
        }>("/api/admin/campaign/recommendations", { body: { contactId, productIds } });
        patchItem(contactId, {
          recommendations: json.recommendations ?? item.recommendations,
          // The server rebuilt (or failed to rebuild) an attached bundle; when
          // none was attached, `bundle` is null and stays null.
          bundle: item.bundle ? (json.bundle ?? null) : (json.bundle ?? item.bundle),
          lowConfidence: false,
        });
        if (json.bundleError) {
          toast({ variant: "warning", title: "Set-Angebot", description: json.bundleError });
        }
        scheduleRegenerate(contactId);
      } catch (err) {
        setBusy(contactId, null);
        fail("Empfehlungen nicht gespeichert", err);
      }
    },
    [busyById, setBusy, patchItem, scheduleRegenerate]
  );

  /** Apply the operator's purchase-basis selection: persist it, recompute the
   * recommendations and regenerate the prose — one server round-trip. */
  const applyPurchaseSelection = React.useCallback(
    (contactId: number, selection: string[] | null) => {
      const busyKind = busyById[contactId];
      if (busyKind && busyKind !== "regen") return;
      const pending = regenTimers.current.get(contactId);
      if (pending) {
        clearTimeout(pending.timer);
        regenTimers.current.delete(contactId);
      }
      void runRegenerateGuarded(
        contactId,
        { ...(pending?.opts ?? {}), refreshRecommendations: true, purchaseSelection: selection },
        "Empfehlungen und Text aktualisiert"
      );
    },
    [busyById, runRegenerateGuarded]
  );

  const createBundle = React.useCallback(
    async (contactId: number, productIds: string[], priceOverride: string) => {
      const item = itemsRef.current.find((it) => it.contactId === contactId);
      if (!item) return false;
      const busyKind = busyById[contactId];
      if (busyKind && busyKind !== "regen") return false;
      setBusy(contactId, "bundle");
      try {
        const json = await adminFetch<{ offer?: BundleOfferResponse }>("/api/admin/bundles/create", {
          body: {
            campaignContactId: contactId,
            components: productIds.map((productId) => ({ productId })),
            ...(priceOverride.trim() ? { bundlePriceOverride: priceOverride.trim() } : {}),
          },
        });
        if (json.offer) {
          patchItem(contactId, {
            bundle: {
              id: json.offer.id,
              title: json.offer.title ?? "Dein persönliches Set",
              components: json.offer.components.map((c) => c.title),
              bundlePrice: json.offer.bundlePrice,
              componentsSum: json.offer.componentsSum,
              currency: json.offer.currency,
              expiresAt: json.offer.expiresAt,
            },
          });
          toast({ variant: "success", title: "Set-Angebot erstellt", description: "Text wird angepasst…" });
          scheduleRegenerate(contactId);
          return true;
        }
        setBusy(contactId, null);
        return false;
      } catch (err) {
        setBusy(contactId, null);
        fail("Set-Erstellung fehlgeschlagen", err);
        return false;
      }
    },
    [busyById, setBusy, patchItem, scheduleRegenerate]
  );

  const archiveBundle = React.useCallback(
    async (contactId: number) => {
      const item = itemsRef.current.find((it) => it.contactId === contactId);
      if (!item?.bundle) return;
      const busyKind = busyById[contactId];
      if (busyKind && busyKind !== "regen") return;
      setBusy(contactId, "bundle");
      try {
        await adminFetch("/api/admin/bundles/archive", { body: { id: item.bundle.id } });
        patchItem(contactId, { bundle: null });
        toast({ variant: "success", title: "Set-Angebot archiviert", description: "Text wird angepasst…" });
        scheduleRegenerate(contactId);
      } catch (err) {
        setBusy(contactId, null);
        fail("Archivieren fehlgeschlagen", err);
      }
    },
    [busyById, setBusy, patchItem, scheduleRegenerate]
  );

  /** The Hero block reports a changed hero (generate / remove / headline). */
  const setHero = React.useCallback(
    (contactId: number, hero: { url: string | null; headline: string | null }) => {
      forgetPreviews(contactId);
      patchItem(contactId, { heroUrl: hero.url, heroHeadline: hero.headline });
    },
    [patchItem]
  );
  const setHeroBusy = React.useCallback(
    (contactId: number, generating: boolean) => {
      if (generating) setBusy(contactId, "hero");
      else if (busyById[contactId] === "hero") setBusy(contactId, null);
    },
    [busyById, setBusy]
  );

  // ── batch jobs (header) ──────────────────────────────────────────────────
  const sync = React.useCallback(async () => {
    if (jobBusy) return;
    setJobBusy("sync");
    const pending = toast({ title: "Shopify-Sync läuft…", description: "Abonnent:innen werden abgeglichen.", duration: 0 });
    try {
      const json = await adminFetch<{ total?: number; created?: number; suppressed?: number }>(
        "/api/admin/campaign/sync",
        { body: {} }
      );
      toast.dismiss(pending);
      toast({
        variant: "success",
        title: "Sync abgeschlossen",
        description: `${json.total ?? 0} Abonnent:innen (${json.created ?? 0} neu, ${json.suppressed ?? 0} unterdrückt).`,
      });
      reloadFromServer();
    } catch (err) {
      toast.dismiss(pending);
      fail("Sync fehlgeschlagen", err);
    } finally {
      setJobBusy(null);
    }
  }, [jobBusy, reloadFromServer]);

  /** Rebuild the queue: all open drafts are discarded (edits included), the
   * contacts return to 'pending', and Vorbereiten regenerates them. Called
   * only from the confirm dialog. */
  const resetQueue = React.useCallback(async () => {
    if (jobBusy) return;
    setResetOpen(false);
    setJobBusy("reset");
    try {
      const json = await adminFetch<{ reset?: number }>("/api/admin/campaign/reset-queue", { body: {} });
      toast({
        variant: "success",
        title: `${json.reset ?? 0} Entwürfe verworfen`,
        description: "Kontakte sind wieder „Offen“ — mit „Vorbereiten“ neu generieren.",
      });
      setItems([]);
      reloadFromServer();
    } catch (err) {
      fail("Zurücksetzen fehlgeschlagen", err);
    } finally {
      setJobBusy(null);
    }
  }, [jobBusy, reloadFromServer]);

  /** Vorbereiten as a background job: chunked drafts, then (optionally) the
   * KI-Hero for every prepared contact of the A group. The review keeps
   * working; the header shows the progress with a cancel. */
  const prepare = React.useCallback(
    async (settings: PrepareSettings) => {
      if (prepareJob && prepareJob.phase !== "done") return;
      setPrepareSettings(settings);
      prepareCancelled.current = false;
      let job: PrepareJob = {
        phase: "drafts",
        total: settings.count,
        done: 0,
        prepared: 0,
        failed: 0,
        suppressed: 0,
        heroTotal: 0,
        heroDone: 0,
        heroFailed: 0,
        cancelled: false,
      };
      setPrepareJob(job);
      const preparedIds: number[] = [];
      let queueWasEmpty = itemsRef.current.length === 0;
      try {
        for (let done = 0; done < settings.count; done += PREPARE_CHUNK) {
          if (prepareCancelled.current) break;
          const count = Math.min(PREPARE_CHUNK, settings.count - done);
          const json = await adminFetch<{
            prepared: number;
            failed: number;
            suppressed: number;
            exhausted: boolean;
            preparedContactIds?: number[];
          }>("/api/admin/campaign/prepare", {
            body: { count, discountPercent: settings.depth, textMode: settings.textMode },
          });
          preparedIds.push(...(json.preparedContactIds ?? []));
          job = {
            ...job,
            done: Math.min(settings.count, done + count),
            prepared: job.prepared + json.prepared,
            failed: job.failed + json.failed,
            suppressed: job.suppressed + json.suppressed,
          };
          setPrepareJob(job);
          // An empty desk gets its first cards right away.
          if (queueWasEmpty && json.prepared > 0) {
            queueWasEmpty = false;
            reloadFromServer();
          }
          if (json.exhausted) {
            job = { ...job, done: settings.count };
            setPrepareJob(job);
            break;
          }
        }
        if (settings.withHero && !prepareCancelled.current) {
          const heroIds = preparedIds.filter((id) => abGroupOf(id) === "A");
          job = { ...job, phase: "heroes", heroTotal: heroIds.length };
          setPrepareJob(job);
          for (const id of heroIds) {
            if (prepareCancelled.current) break;
            try {
              const s = await adminFetch<{ prompt?: string; headline?: string }>(
                "/api/admin/email-hero/suggest",
                { body: { kind: "campaign", id } }
              );
              if (!s.prompt) throw new Error("Kein Prompt-Vorschlag");
              const g = await adminFetch<{ url?: string }>("/api/admin/email-hero/generate", {
                body: { kind: "campaign", id, prompt: s.prompt, headline: s.headline ?? null },
              });
              if (g.url) setHero(id, { url: g.url, headline: s.headline ?? null });
              else throw new Error("Kein Bild");
              job = { ...job, heroDone: job.heroDone + 1 };
            } catch {
              job = { ...job, heroDone: job.heroDone + 1, heroFailed: job.heroFailed + 1 };
            }
            setPrepareJob(job);
          }
        }
        const heroNote =
          job.heroTotal > 0
            ? ` ${job.heroDone - job.heroFailed} KI-Hero erzeugt${job.heroFailed ? `, ${job.heroFailed} fehlgeschlagen` : ""}.`
            : "";
        toast({
          variant: job.failed > 0 || job.heroFailed > 0 ? "warning" : "success",
          title: `${job.prepared} Entwürfe erstellt`,
          description: `${job.failed} fehlgeschlagen, ${job.suppressed} unterdrückt.${
            prepareCancelled.current ? " Abgebrochen." : ""
          }${heroNote}`,
        });
        reloadFromServer();
      } catch (err) {
        fail("Vorbereitung fehlgeschlagen", err);
      } finally {
        job = { ...job, phase: "done", cancelled: prepareCancelled.current };
        setPrepareJob(job);
        setTimeout(() => setPrepareJob((j) => (j && j.phase === "done" ? null : j)), 6000);
      }
    },
    [prepareJob, setPrepareSettings, reloadFromServer, setHero]
  );
  const cancelPrepare = React.useCallback(() => {
    prepareCancelled.current = true;
  }, []);

  // ── bulk actions (Liste) ─────────────────────────────────────────────────
  const bulkSkip = React.useCallback(
    async (ids: number[]) => {
      for (const id of ids) await skip(id);
      toast({ variant: "success", title: `${ids.length} Kontakte übersprungen` });
    },
    [skip]
  );
  const bulkRegenerate = React.useCallback(
    async (ids: number[], depth?: number) => {
      if (bulkProgress) return;
      const label = depth === undefined ? "Neu generieren" : `Rabatt ${depth} %`;
      setBulkProgress({ label, done: 0, total: ids.length });
      let failed = 0;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (!itemsRef.current.some((it) => it.contactId === id)) continue;
        setBusy(id, depth === undefined ? "regen" : "discount");
        try {
          if (depth !== undefined) {
            const json = await adminFetch<{ discountPercent: number; discountExpiresAt: string | null }>(
              "/api/admin/campaign/discount",
              { body: { contactId: id, discountPercent: depth } }
            );
            patchItem(id, { discountPercent: json.discountPercent, discountExpiresAt: json.discountExpiresAt });
            setBusy(id, "regen");
            await runRegenerate(id, { depth: json.discountPercent });
          } else {
            await runRegenerate(id);
          }
        } catch {
          failed += 1;
        } finally {
          setBusy(id, null);
        }
        setBulkProgress({ label, done: i + 1, total: ids.length });
      }
      setBulkProgress(null);
      toast({
        variant: failed > 0 ? "warning" : "success",
        title: `${ids.length - failed} Entwürfe aktualisiert`,
        description: failed > 0 ? `${failed} fehlgeschlagen.` : undefined,
      });
    },
    [bulkProgress, setBusy, patchItem, runRegenerate]
  );

  // ── per-card gate summary for the action bar ─────────────────────────────
  const currentChecks = current ? checksOf(current.contactId) : [];
  const currentVerdict: ReviewVerdict = reviewVerdict(currentChecks) as ReviewVerdict;
  const currentBusy = busyOf(currentId);
  const sendBlocked = currentVerdict === "blocked";
  const optInBlocked = currentChecks.some((c) => c.key === "opt_in");

  return {
    // data
    items,
    visibleItems,
    visibleIds,
    current,
    currentId,
    currentIndex,
    nextItem,
    skippedList,
    counts: countsLocal,
    progress,
    filter,
    filterCounts,
    view,
    editMode,
    focusMode,
    // checks
    checksOf,
    verdictOf,
    currentChecks,
    currentVerdict,
    sendBlocked,
    optInBlocked,
    // in-flight
    busyById,
    busyOf,
    currentBusy,
    outbox,
    restoring,
    jobBusy,
    prepareJob,
    prepareSettings,
    bulkProgress,
    copiedId,
    confirmSendId,
    resetOpen,
    emailView,
    emailViewBusy,
    // setters
    setView,
    setFilter,
    setEditMode,
    setFocusMode,
    setPrepareSettings,
    setConfirmSendId,
    setResetOpen,
    closeEmailView,
    // navigation
    select,
    next,
    prev,
    jumpToContact,
    // per-card actions
    editItem,
    send,
    confirmAndSend,
    retrySend,
    dismissOutbox,
    skip,
    unskip,
    draftContact,
    previewItem,
    viewSent,
    copy,
    markDone,
    regenerate,
    setDiscount,
    setLanguage,
    setTextMode,
    updateRecommendations,
    applyPurchaseSelection,
    createBundle,
    archiveBundle,
    setHero,
    setHeroBusy,
    // jobs
    sync,
    resetQueue,
    prepare,
    cancelPrepare,
    bulkSkip,
    bulkRegenerate,
    reloadFromServer,
  };
}

export type CampaignActions = ReturnType<typeof useCampaignActions>;
