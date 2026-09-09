"use client";

// The Kampagne review state machine: the working queue (processed contacts are
// removed locally so the card always shows the next draft), the opt-in filter,
// and every mutation. All mutations go through the guarded /api/admin/campaign/*
// routes with the SAME payloads as before the redesign; the legal gates are
// enforced SERVER-side — disabled buttons here are UX, never the guarantee.
//
// Bulk operations that change the server-side queue (Sync, Prepare, Reset,
// Unskip, Draft-from-search) call router.refresh(); the server re-renders the
// screen and the working copy re-syncs from the fresh props (effect below).

import * as React from "react";
import { useRouter } from "next/navigation";
import { EMAIL_TEXT_MODE_LABELS, DEFAULT_EMAIL_TEXT_MODE } from "@/lib/email-text-mode.mjs";
import { emailProseToText } from "@/lib/email-prose.mjs";
import { toast } from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import type { EmailTextModeValue } from "../EmailTextModeToggle";
import {
  PREPARE_CHUNK,
  PREPARE_TOTAL,
  type CampaignBundle,
  type CampaignBusy,
  type CampaignHistoryItemProps,
  type CampaignQueueItemProps,
  type CampaignRecommendation,
  type CampaignSkippedItemProps,
  type OptInFilter,
} from "./types";

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

export interface EmailView {
  title: string;
  description: string;
  url: string;
}

export interface PrepareProgress {
  done: number;
  total: number;
  prepared: number;
  failed: number;
}

interface RegenerateExtra {
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
  };
  recommendations?: CampaignRecommendation[];
  bundle?: CampaignBundle | null;
}

const fail = (title: string, err: unknown) =>
  toast({ variant: "error", title, description: errorMessage(err) });

export function useCampaignActions({
  queue,
  skipped,
  sendsApproved,
  allowSingleOptIn,
}: {
  queue: CampaignQueueItemProps[];
  skipped: CampaignSkippedItemProps[];
  sendsApproved: boolean;
  allowSingleOptIn: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState(queue);
  const [index, setIndex] = React.useState(0);
  // Review filter: opt-in level narrows the WORKING view; mutations are keyed by
  // contactId so filtering can never mis-target a card.
  const [optInFilter, setOptInFilter] = React.useState<OptInFilter>("all");
  const [skippedList, setSkippedList] = React.useState(skipped);
  const [busy, setBusy] = React.useState<CampaignBusy>(null);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [prepareProgress, setPrepareProgress] = React.useState<PrepareProgress | null>(null);
  const prepareCancelled = React.useRef(false);
  const [prepareDepth, setPrepareDepth] = React.useState(0);
  const [prepareTextMode, setPrepareTextMode] = React.useState<EmailTextModeValue>(
    DEFAULT_EMAIL_TEXT_MODE as EmailTextModeValue
  );
  const [copiedId, setCopiedId] = React.useState<number | null>(null);
  // Rendered-HTML viewer (queue draft preview + sent-email view). Own busy flag
  // — a read-only preview never blocks the review state machine.
  const [emailView, setEmailView] = React.useState<EmailView | null>(null);
  const [emailViewBusy, setEmailViewBusy] = React.useState(false);

  // Re-sync the working copy whenever the SERVER hands over a fresh queue
  // (router.refresh() after Sync / Prepare / Reset / Unskip / Draft). Every
  // server render produces new prop arrays, so this also covers a queue that
  // ends up identical (skip + restore) — local state must not stay stale.
  React.useEffect(() => {
    setItems(queue);
    setIndex(0);
    setOptInFilter("all");
    setBusy(null);
    setPrepareProgress(null);
    setCopiedId(null);
  }, [queue]);
  React.useEffect(() => {
    setSkippedList(skipped);
  }, [skipped]);

  const visibleItems = React.useMemo(
    () =>
      items.filter((it) => {
        if (optInFilter === "doi" && it.optInLevel !== "CONFIRMED_OPT_IN") return false;
        if (optInFilter === "soi" && it.optInLevel === "CONFIRMED_OPT_IN") return false;
        return true;
      }),
    [items, optInFilter]
  );
  const clampedIndex = Math.min(index, Math.max(0, visibleItems.length - 1));
  const current = visibleItems[clampedIndex] ?? null;

  const next = React.useCallback(
    () => setIndex((i) => Math.min(i + 1, Math.max(0, visibleItems.length - 1))),
    [visibleItems.length]
  );
  const prev = React.useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  /** Filter-button handler: switching the view restarts at its top. */
  const applyOptInFilter = React.useCallback((nextFilter: OptInFilter) => {
    setOptInFilter(nextFilter);
    setIndex(0);
  }, []);

  /** Jump straight to a queue card (rail click / global search "Öffnen").
   * Clears the opt-in filter so the target is always in view. */
  const jumpToContact = React.useCallback(
    (contactId: number) => {
      setOptInFilter("all");
      const idx = items.findIndex((it) => it.contactId === contactId);
      if (idx >= 0) setIndex(idx);
    },
    [items]
  );

  /** Patch one card by contactId (filter-safe — never by list position). */
  const patchItem = React.useCallback(
    (contactId: number, patch: Partial<CampaignQueueItemProps>) => {
      setItems((prevItems) =>
        prevItems.map((it) => (it.contactId === contactId ? { ...it, ...patch } : it))
      );
    },
    []
  );

  // ---- edits (persisted via /update, debounced) ----------------------------
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistEdit = React.useCallback((contactId: number, subject: string, body: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      adminFetch("/api/admin/campaign/update", { body: { contactId, subject, body } }).catch(
        (err) => fail("Änderung nicht gespeichert", err)
      );
    }, 600);
  }, []);

  const editCurrent = React.useCallback(
    (patch: Partial<Pick<CampaignQueueItemProps, "subject" | "body">>) => {
      if (!current) return;
      const updated = { ...current, ...patch };
      patchItem(current.contactId, patch);
      persistEdit(updated.contactId, updated.subject, updated.body);
    },
    [current, patchItem, persistEdit]
  );

  const removeCurrent = React.useCallback(() => {
    if (!current) return;
    const id = current.contactId;
    setItems((prevItems) => prevItems.filter((it) => it.contactId !== id));
    setIndex((i) => Math.max(0, Math.min(i, visibleItems.length - 2)));
  }, [current, visibleItems.length]);

  // ---- per-contact gate state ---------------------------------------------
  const optInBlocked = current
    ? current.optInLevel !== "CONFIRMED_OPT_IN" && !allowSingleOptIn
    : false;
  const sendBlocked = !sendsApproved || optInBlocked;

  /** Server-side queue changed (sync / prepare / reset / unskip / draft): let
   * the server re-render the screen; the workspace remounts with fresh data. */
  const reloadFromServer = React.useCallback(() => router.refresh(), [router]);

  // ---- viewer ---------------------------------------------------------------
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

  // ---- actions -------------------------------------------------------------
  const sendCurrent = React.useCallback(async () => {
    if (!current) return;
    setBusy("send");
    try {
      await adminFetch("/api/admin/campaign/send", { body: { contactId: current.contactId } });
      toast({ variant: "success", title: `Gesendet an ${current.email}` });
      removeCurrent();
    } catch (err) {
      fail("Senden fehlgeschlagen", err);
    } finally {
      setBusy(null);
    }
  }, [current, removeCurrent]);

  const doSend = React.useCallback(async () => {
    if (!current || busy || sendBlocked) return;
    if (needsFirstSendConfirm()) {
      setConfirmOpen(true);
      return;
    }
    await sendCurrent();
  }, [current, busy, sendBlocked, sendCurrent]);

  const confirmAndSend = React.useCallback(async () => {
    rememberFirstSendConfirm();
    setConfirmOpen(false);
    if (!current || busy) return;
    await sendCurrent();
  }, [current, busy, sendCurrent]);

  const doSkip = React.useCallback(async () => {
    if (!current || busy) return;
    setBusy("skip");
    try {
      await adminFetch("/api/admin/campaign/skip", { body: { contactId: current.contactId } });
      // Skips are undoable: the contact moves to the rail's "Übersprungen"
      // section, where "Wiederherstellen" puts it straight back in the queue.
      setSkippedList((prevList) => [
        {
          contactId: current.contactId,
          email: current.email,
          firstName: current.firstName,
          lastName: current.lastName,
          hasDraft: true,
        },
        ...prevList,
      ]);
      removeCurrent();
    } catch (err) {
      fail("Überspringen fehlgeschlagen", err);
    } finally {
      setBusy(null);
    }
  }, [current, busy, removeCurrent]);

  /** Undo a skip. If the contact still has its draft it lands straight back in
   * the queue; otherwise a fresh draft is generated first. */
  const doUnskip = React.useCallback(
    async (contactId: number) => {
      if (busy) return;
      setBusy("skip");
      try {
        const json = await adminFetch<{ status?: string }>("/api/admin/campaign/unskip", {
          body: { contactId },
        });
        if (json.status === "pending") {
          toast({ title: "Wiederhergestellt — Entwurf wird generiert…", duration: 0 });
          await adminFetch("/api/admin/campaign/draft", {
            body: {
              contactId,
              discountPercent: prepareDepth,
              textMode: prepareTextMode,
              regenerate: true,
            },
          });
        }
        toast({
          variant: "success",
          title: "Kontakt zurück in der Warteschlange",
          description: "Warteschlange wird aktualisiert…",
        });
        reloadFromServer();
      } catch (err) {
        fail("Wiederherstellen fehlgeschlagen", err);
        setBusy(null);
      }
    },
    [busy, prepareDepth, prepareTextMode, reloadFromServer]
  );

  /** Global-search action: generate a draft for a contact that is NOT in the
   * queue yet (status pending/draft_failed) and pull them in. */
  const doDraftContact = React.useCallback(
    async (contactId: number) => {
      if (busy) return;
      setBusy("regen");
      try {
        toast({ title: "Entwurf wird generiert…", duration: 0 });
        await adminFetch("/api/admin/campaign/draft", {
          body: {
            contactId,
            discountPercent: prepareDepth,
            textMode: prepareTextMode,
            regenerate: true,
          },
        });
        toast({
          variant: "success",
          title: "Entwurf erstellt — Kontakt ist in der Warteschlange",
          description: "Warteschlange wird aktualisiert…",
        });
        reloadFromServer();
      } catch (err) {
        fail("Entwurf fehlgeschlagen", err);
        setBusy(null);
      }
    },
    [busy, prepareDepth, prepareTextMode, reloadFromServer]
  );

  /** Rendered-HTML preview of the CURRENT card — the on-screen (possibly
   * unsaved) subject/body ride along so edits preview correctly. */
  const doPreview = React.useCallback(() => {
    if (!current || emailViewBusy) return;
    void openEmailView(
      `Vorschau — ${current.email}`,
      "So wird die E-Mail im Postfach gerendert. Der Rabatt zeigt den Platzhalter-Code " +
        "MO-XXXX — der echte MK-Code wird erst beim Senden erzeugt.",
      "/api/admin/campaign/email-preview",
      { contactId: current.contactId, subject: current.subject, body: current.body }
    );
  }, [current, emailViewBusy, openEmailView]);

  /** Open the retained content of a send record from the "Gesendet" view. */
  const doViewSent = React.useCallback(
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

  const doCopy = React.useCallback(async () => {
    if (!current) return;
    try {
      // Markdown links flatten to "Label (URL)" — the clipboard is plain text.
      await navigator.clipboard.writeText(`${current.subject}\n\n${emailProseToText(current.body)}`);
      setCopiedId(current.contactId);
      toast({
        variant: "success",
        title: "In Zwischenablage kopiert",
        description:
          current.discountPercent > 0
            ? "Achtung: Der Text enthält den Platzhalter-Code MO-XXXX — beim Kopier-Versand wird KEIN echter Code erzeugt."
            : "Betreff + Text kopiert. Danach „Als erledigt markieren“ klicken.",
      });
    } catch {
      toast({ variant: "error", title: "Kopieren fehlgeschlagen" });
    }
  }, [current]);

  const doMarkDone = React.useCallback(async () => {
    if (!current || busy) return;
    setBusy("markdone");
    try {
      await adminFetch("/api/admin/campaign/mark-done", { body: { contactId: current.contactId } });
      toast({ variant: "success", title: "Als erledigt (kopiert) markiert" });
      setCopiedId(null);
      removeCurrent();
    } catch (err) {
      fail("Markieren fehlgeschlagen", err);
    } finally {
      setBusy(null);
    }
  }, [current, busy, removeCurrent]);

  const setCurrentBundle = React.useCallback(
    (bundle: CampaignBundle | null) => {
      if (current) patchItem(current.contactId, { bundle });
    },
    [current, patchItem]
  );

  /** Regenerate a contact's draft with the current depth and patch the card
   * from the full response (text, recommendations, bundle, purchase basis) so
   * the card never drifts from what was persisted. No busy guard — callers own
   * the busy state so offer changes can CHAIN a regenerate. Throws on failure. */
  const runRegenerate = React.useCallback(
    async (contactId: number, depth: number, extra?: RegenerateExtra) => {
      const json = await adminFetch<DraftResponse>("/api/admin/campaign/draft", {
        body: {
          contactId,
          discountPercent: depth,
          regenerate: true,
          ...(extra?.refreshRecommendations ? { refreshRecommendations: true } : {}),
          ...(extra && "purchaseSelection" in extra
            ? { purchaseSelection: extra.purchaseSelection }
            : {}),
          ...(extra?.textMode ? { textMode: extra.textMode } : {}),
        },
      });
      if (json.draft) {
        const d = json.draft;
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
        });
      }
    },
    [patchItem]
  );

  const doCreateBundle = React.useCallback(
    async (productIds: string[], priceOverride: string) => {
      if (!current || busy) return;
      setBusy("bundle");
      try {
        const json = await adminFetch<{
          offer?: {
            id: number;
            title: string | null;
            components: Array<{ title: string }>;
            bundlePrice: string;
            componentsSum: string;
            currency: string;
            expiresAt: string | null;
          };
        }>("/api/admin/bundles/create", {
          body: {
            campaignContactId: current.contactId,
            components: productIds.map((productId) => ({ productId })),
            ...(priceOverride.trim() ? { bundlePriceOverride: priceOverride.trim() } : {}),
          },
        });
        if (json.offer) {
          setCurrentBundle({
            id: json.offer.id,
            title: json.offer.title ?? "Dein persönliches Set",
            components: json.offer.components.map((c) => c.title),
            bundlePrice: json.offer.bundlePrice,
            componentsSum: json.offer.componentsSum,
            currency: json.offer.currency,
            expiresAt: json.offer.expiresAt,
          });
          toast({
            variant: "success",
            title: "Set-Angebot erstellt",
            description: "Text wird neu generiert, damit er das Set erwähnt…",
          });
          await runRegenerate(current.contactId, current.discountPercent);
          toast({ variant: "success", title: "Text aktualisiert" });
        }
      } catch (err) {
        fail("Set-Erstellung fehlgeschlagen", err);
      } finally {
        setBusy(null);
      }
    },
    [current, busy, setCurrentBundle, runRegenerate]
  );

  const doArchiveBundle = React.useCallback(async () => {
    if (!current?.bundle || busy) return;
    setBusy("bundle");
    try {
      await adminFetch("/api/admin/bundles/archive", { body: { id: current.bundle.id } });
      setCurrentBundle(null);
      toast({ variant: "success", title: "Set-Angebot archiviert", description: "Text wird neu generiert…" });
      await runRegenerate(current.contactId, current.discountPercent);
      toast({ variant: "success", title: "Text aktualisiert" });
    } catch (err) {
      fail("Archivieren fehlgeschlagen", err);
    } finally {
      setBusy(null);
    }
  }, [current, busy, setCurrentBundle, runRegenerate]);

  const doRegenerate = React.useCallback(
    async (depth: number) => {
      if (!current || busy) return;
      setBusy("regen");
      try {
        await runRegenerate(current.contactId, depth);
        toast({ variant: "success", title: "Entwurf neu generiert" });
      } catch (err) {
        fail("Neu generieren fehlgeschlagen", err);
      } finally {
        setBusy(null);
      }
    },
    [current, busy, runRegenerate]
  );

  /** Switch the card's email language (DE/EN): persists the per-contact
   * override, then CHAINS a regenerate so the prose matches. */
  const doSetLanguage = React.useCallback(
    async (language: "de" | "en") => {
      if (!current || busy || language === current.language) return;
      setBusy("regen");
      try {
        const json = await adminFetch<{
          language?: "de" | "en";
          languageOverride?: "de" | "en" | null;
        }>("/api/admin/campaign/language", { body: { contactId: current.contactId, language } });
        patchItem(current.contactId, {
          language: json.language ?? language,
          languageOverride: json.languageOverride ?? null,
        });
        toast({
          title: `Sprache: ${language === "en" ? "Englisch" : "Deutsch"} — Text wird neu generiert…`,
          duration: 0,
        });
        await runRegenerate(current.contactId, current.discountPercent);
        toast({ variant: "success", title: "Text in neuer Sprache generiert" });
      } catch (err) {
        fail("Sprachwechsel fehlgeschlagen", err);
      } finally {
        setBusy(null);
      }
    },
    [current, busy, patchItem, runRegenerate]
  );

  /** Switch the card's text mode and CHAIN a regenerate so the visible prose
   * matches the selected mode. The mode is persisted on the draft row. */
  const doSetTextMode = React.useCallback(
    async (mode: EmailTextModeValue) => {
      if (!current || busy || mode === current.textMode) return;
      setBusy("regen");
      try {
        toast({
          title: `Textmodus: ${EMAIL_TEXT_MODE_LABELS[mode]} — Text wird neu generiert…`,
          duration: 0,
        });
        await runRegenerate(current.contactId, current.discountPercent, { textMode: mode });
        toast({ variant: "success", title: "Text im neuen Modus generiert" });
      } catch (err) {
        fail("Textmodus-Wechsel fehlgeschlagen", err);
      } finally {
        setBusy(null);
      }
    },
    [current, busy, runRegenerate]
  );

  /** Persist a curated recommendation list; the server also rebuilds an
   * attached bundle to match. Immediate persist per change — no save button. */
  const doUpdateRecommendations = React.useCallback(
    async (productIds: string[]) => {
      if (!current || busy) return;
      setBusy("recs");
      try {
        const json = await adminFetch<{
          recommendations?: CampaignRecommendation[];
          bundle?: CampaignBundle | null;
          bundleError?: string | null;
        }>("/api/admin/campaign/recommendations", {
          body: { contactId: current.contactId, productIds },
        });
        patchItem(current.contactId, {
          recommendations: json.recommendations ?? current.recommendations,
          // The server rebuilt (or failed to rebuild) an attached bundle; when
          // none was attached, `bundle` is null and stays null.
          bundle: current.bundle ? (json.bundle ?? null) : (json.bundle ?? current.bundle),
          lowConfidence: false,
        });
        if (json.bundleError) {
          toast({ variant: "warning", title: "Set-Angebot", description: json.bundleError });
        }
        toast({ variant: "success", title: "Empfehlungen gespeichert", description: "Text wird neu generiert…" });
        await runRegenerate(current.contactId, current.discountPercent);
        toast({ variant: "success", title: "Text aktualisiert" });
      } catch (err) {
        fail("Empfehlungen nicht gespeichert", err);
      } finally {
        setBusy(null);
      }
    },
    [current, busy, patchItem, runRegenerate]
  );

  /** Apply the operator's purchase-basis selection: persist it, recompute the
   * recommendations and regenerate the prose — one server round-trip. */
  const doApplyPurchaseSelection = React.useCallback(
    async (selection: string[] | null) => {
      if (!current || busy) return;
      setBusy("selection");
      try {
        toast({
          title: "Auswahl wird angewendet — Empfehlungen & Text werden neu erzeugt…",
          duration: 0,
        });
        await runRegenerate(current.contactId, current.discountPercent, {
          refreshRecommendations: true,
          purchaseSelection: selection,
        });
        toast({ variant: "success", title: "Empfehlungen und Text aktualisiert" });
      } catch (err) {
        fail("Auswahl konnte nicht angewendet werden", err);
      } finally {
        setBusy(null);
      }
    },
    [current, busy, runRegenerate]
  );

  /** Set the discount depth on the existing draft, then auto-regenerate the
   * prose so it weaves the new offer in (the code + deadline additionally ship
   * deterministically at send time). */
  const doSetDiscount = React.useCallback(
    async (depth: number) => {
      if (!current || busy) return;
      setBusy("discount");
      try {
        const json = await adminFetch<{
          discountPercent: number;
          discountExpiresAt: string | null;
          proseMismatch: boolean;
          prosePercents: number[];
        }>("/api/admin/campaign/discount", {
          body: { contactId: current.contactId, discountPercent: depth },
        });
        patchItem(current.contactId, {
          discountPercent: json.discountPercent,
          discountExpiresAt: json.discountExpiresAt,
        });
        toast({
          variant: "success",
          title: json.discountPercent > 0 ? `Rabatt auf ${json.discountPercent} % gesetzt` : "Rabatt entfernt",
          description: "Text wird neu generiert…",
        });
        await runRegenerate(current.contactId, json.discountPercent);
        toast({ variant: "success", title: "Text aktualisiert" });
      } catch (err) {
        fail("Rabatt nicht gespeichert", err);
      } finally {
        setBusy(null);
      }
    },
    [current, busy, patchItem, runRegenerate]
  );

  const doSync = React.useCallback(async () => {
    if (busy) return;
    setBusy("sync");
    toast({ title: "Shopify-Sync läuft…", description: "Abonnent:innen werden abgeglichen." });
    try {
      const json = await adminFetch<{ total?: number; created?: number; suppressed?: number }>(
        "/api/admin/campaign/sync",
        { body: {} }
      );
      toast({
        variant: "success",
        title: "Sync abgeschlossen",
        description: `${json.total ?? 0} Abonnent:innen (${json.created ?? 0} neu, ${json.suppressed ?? 0} unterdrückt). Warteschlange wird aktualisiert…`,
      });
      reloadFromServer();
    } catch (err) {
      fail("Sync fehlgeschlagen", err);
      setBusy(null);
    }
  }, [busy, reloadFromServer]);

  /** Rebuild the queue: all open drafts are discarded (edits included), the
   * contacts return to 'pending', and "Prepare" regenerates them. Called only
   * from the confirm dialog. */
  const doResetQueue = React.useCallback(async () => {
    if (busy) return;
    setResetOpen(false);
    setBusy("reset");
    try {
      const json = await adminFetch<{ reset?: number }>("/api/admin/campaign/reset-queue", {
        body: {},
      });
      toast({
        variant: "success",
        title: `${json.reset ?? 0} Entwürfe verworfen`,
        description:
          "Kontakte sind wieder „Offen“ — mit „Nächste 50 vorbereiten“ neu generieren. Warteschlange wird aktualisiert…",
      });
      reloadFromServer();
    } catch (err) {
      fail("Zurücksetzen fehlgeschlagen", err);
      setBusy(null);
    }
  }, [busy, reloadFromServer]);

  const doPrepare = React.useCallback(async () => {
    if (busy) return;
    setBusy("prepare");
    prepareCancelled.current = false;
    let prepared = 0;
    let failed = 0;
    let suppressed = 0;
    setPrepareProgress({ done: 0, total: PREPARE_TOTAL, prepared: 0, failed: 0 });
    try {
      for (let done = 0; done < PREPARE_TOTAL; done += PREPARE_CHUNK) {
        if (prepareCancelled.current) break;
        const json = await adminFetch<{
          prepared: number;
          failed: number;
          suppressed: number;
          exhausted: boolean;
        }>("/api/admin/campaign/prepare", {
          body: { count: PREPARE_CHUNK, discountPercent: prepareDepth, textMode: prepareTextMode },
        });
        prepared += json.prepared;
        failed += json.failed;
        suppressed += json.suppressed;
        setPrepareProgress({ done: done + PREPARE_CHUNK, total: PREPARE_TOTAL, prepared, failed });
        if (json.exhausted) break;
      }
      toast({
        variant: failed > 0 ? "warning" : "success",
        title: `${prepared} Entwürfe erstellt`,
        description: `${failed} fehlgeschlagen, ${suppressed} unterdrückt.${
          prepareCancelled.current ? " Abgebrochen." : ""
        } Warteschlange wird aktualisiert…`,
      });
      reloadFromServer();
    } catch (err) {
      fail("Vorbereitung fehlgeschlagen", err);
      setBusy(null);
      setPrepareProgress(null);
    }
  }, [busy, prepareDepth, prepareTextMode, reloadFromServer]);

  const cancelPrepare = React.useCallback(() => {
    prepareCancelled.current = true;
  }, []);

  return {
    items,
    visibleItems,
    current,
    clampedIndex,
    optInFilter,
    skippedList,
    busy,
    prepareProgress,
    prepareDepth,
    prepareTextMode,
    copiedId,
    confirmOpen,
    resetOpen,
    emailView,
    emailViewBusy,
    optInBlocked,
    sendBlocked,
    setPrepareDepth,
    setPrepareTextMode,
    setConfirmOpen,
    setResetOpen,
    closeEmailView,
    next,
    prev,
    applyOptInFilter,
    jumpToContact,
    editCurrent,
    doSend,
    confirmAndSend,
    doSkip,
    doUnskip,
    doDraftContact,
    doPreview,
    doViewSent,
    doCopy,
    doMarkDone,
    doCreateBundle,
    doArchiveBundle,
    doRegenerate,
    doSetLanguage,
    doSetTextMode,
    doUpdateRecommendations,
    doApplyPurchaseSelection,
    doSetDiscount,
    doSync,
    doResetQueue,
    doPrepare,
    cancelPrepare,
  };
}

export type CampaignActions = ReturnType<typeof useCampaignActions>;
