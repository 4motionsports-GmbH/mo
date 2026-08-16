"use client";

// Kampagne review workspace (client) — optimized for one person clearing ~200
// emails/day: one contact at a time, keyboard-driven, <2 clicks per email on
// the happy path. All mutations go through the guarded /api/admin/campaign/*
// routes; the legal gates are enforced SERVER-side — the disabled buttons here
// are UX, never the guarantee.
//
//   Queue card:  left = contact (name, email, language + opt-in badges,
//                purchase summary, recommendations); right = editable subject +
//                body (persisted on change via /update), discount display.
//   Actions:     Send (gated), Copy (+ explicit "mark as done" — copying alone
//                never mutates), Regenerate, Skip. After Send/Skip the queue
//                auto-advances.
//   Shortcuts:   N/P next/previous, C copy, S send (only when allowed), X skip
//                (ignored while typing / with a modifier held).

import * as React from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  RefreshCw,
  Send,
  SkipForward,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  Textarea,
  toast,
} from "./ui";
import { EmailPreviewFrame } from "./EmailPreviewFrame";
import {
  DISCOUNT_PERCENT_MAX,
  clampDiscountPercent,
} from "@/lib/discount-validation.mjs";
import { emailProseToText } from "@/lib/email-prose.mjs";

export interface CampaignQueueItemProps {
  contactId: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** EFFECTIVE email language (operator override, else Shopify-derived). */
  language: "de" | "en";
  /** Operator-pinned language, or null when the derivation applies. */
  languageOverride: "de" | "en" | null;
  optInLevel: string;
  ordersCount: number;
  totalSpentCents: number;
  subject: string;
  body: string;
  discountPercent: number;
  discountExpiresAt: string | null;
  lowConfidence: boolean;
  purchaseSummary: {
    orders: Array<{
      name: string;
      createdAt: string | null;
      totalAmount: string | null;
      currencyCode: string | null;
      items: Array<{
        title: string | null;
        quantity: number;
        /** Catalog product id when the item maps to a current catalog product
         * (selectable as recommendation basis); null/absent otherwise. */
        productId?: string | null;
      }>;
    }>;
    truncated: boolean;
  } | null;
  /** Operator-narrowed purchase basis for the recommendations (product ids);
   * null = all purchases (the default). */
  purchaseSelectedIds: string[] | null;
  recommendations: Array<{ id: string; name: string; url: string | null }>;
  /** Attached ACTIVE bundle offer (docs/CAMPAIGNS.md §4), or null. */
  bundle: {
    id: number;
    title: string;
    components: string[];
    /** Decimal Money strings (as stored). */
    bundlePrice: string;
    componentsSum: string;
    currency: string;
    expiresAt: string | null;
  } | null;
}

export interface CampaignHistoryItemProps {
  id: number;
  email: string;
  subject: string | null;
  sentVia: "email" | "copy";
  discountCode: string | null;
  sentAt: string | null;
  /** true/false when Shopify answered; null = unknown/unchecked. */
  redeemed: boolean | null;
  /** True when the shipped content was retained (viewable via „Ansehen“);
   * sends recorded before migration 0038 have nothing stored. */
  hasContent: boolean;
}

export interface CampaignCountsProps {
  pending: number;
  drafted: number;
  sentTotal: number;
  sentToday: number;
  skipped: number;
  suppressed: number;
  draftFailed: number;
  byOptInLevel: Record<string, number>;
}

const PREPARE_TOTAL = 50;
const PREPARE_CHUNK = 5;

async function callApi(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (json as { error?: { message?: string } })?.error?.message ?? `Fehler (${res.status})`
    );
  }
  return json;
}

function formatEuro(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE");
}

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
    window.localStorage.setItem(
      "ms-campaign-first-send",
      new Date().toISOString().slice(0, 10)
    );
  } catch {
    // best-effort only
  }
}

export interface CampaignSkippedItemProps {
  contactId: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  hasDraft: boolean;
}

export function KampagneWorkspace({
  counts,
  queue,
  history,
  skipped,
  sendsApproved,
  allowSingleOptIn,
  shopifyConfigured,
}: {
  counts: CampaignCountsProps;
  queue: CampaignQueueItemProps[];
  history: CampaignHistoryItemProps[];
  skipped: CampaignSkippedItemProps[];
  sendsApproved: boolean;
  allowSingleOptIn: boolean;
  shopifyConfigured: boolean;
}) {
  const [view, setView] = React.useState<"queue" | "sent">("queue");
  // Local working copy of the queue; processed contacts are removed so the
  // card always shows the next reviewable draft without a server round-trip.
  const [items, setItems] = React.useState(queue);
  const [index, setIndex] = React.useState(0);
  // Review filter: opt-in level (all / provable DOI only / SOI+unknown only)
  // narrows the WORKING view; mutations are keyed by contactId so filtering
  // can never mis-target a card. (Contact SEARCH is global — see QueueRail —
  // and deliberately not a queue filter.)
  const [optInFilter, setOptInFilter] = React.useState<"all" | "doi" | "soi">("all");
  const [skippedList, setSkippedList] = React.useState(skipped);
  const [busy, setBusy] = React.useState<
    | null
    | "send"
    | "skip"
    | "regen"
    | "sync"
    | "prepare"
    | "markdone"
    | "bundle"
    | "recs"
    | "selection"
    | "discount"
    | "reset"
  >(null);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [prepareProgress, setPrepareProgress] = React.useState<string | null>(null);
  const [prepareDepth, setPrepareDepth] = React.useState(0);
  const [copiedId, setCopiedId] = React.useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // Rendered-HTML viewer (queue draft preview + sent-email view). Own busy
  // flag — a read-only preview never blocks the review state machine. The
  // object URL is revoked on replace/close.
  const [emailView, setEmailView] = React.useState<{
    title: string;
    description: string;
    url: string;
  } | null>(null);
  const [emailViewBusy, setEmailViewBusy] = React.useState(false);

  /** Fetch rendered email HTML from a guarded admin route and open it in the
   * viewer dialog (same fetch→blob→object-URL pattern as the letter preview). */
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
          const json = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setEmailView((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return { title, description, url };
        });
      } catch (err) {
        toast({
          variant: "error",
          title: "E-Mail-Ansicht fehlgeschlagen",
          description: String((err as Error).message ?? err),
        });
      } finally {
        setEmailViewBusy(false);
      }
    },
    []
  );

  const closeEmailView = React.useCallback(() => {
    setEmailView((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const visibleItems = React.useMemo(() => {
    return items.filter((it) => {
      if (optInFilter === "doi" && it.optInLevel !== "CONFIRMED_OPT_IN") return false;
      if (optInFilter === "soi" && it.optInLevel === "CONFIRMED_OPT_IN") return false;
      return true;
    });
  }, [items, optInFilter]);

  const clampedIndex = Math.min(index, Math.max(0, visibleItems.length - 1));
  const current = visibleItems[clampedIndex] ?? null;

  /** Filter-button handler: switching the view restarts at its top. */
  const applyOptInFilter = React.useCallback((next: "all" | "doi" | "soi") => {
    setOptInFilter(next);
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
      setItems((prev) =>
        prev.map((it) => (it.contactId === contactId ? { ...it, ...patch } : it))
      );
    },
    []
  );

  // ---- edits (persisted via /update, debounced) ----------------------------
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistEdit = React.useCallback((contactId: number, subject: string, body: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      callApi("/api/admin/campaign/update", { contactId, subject, body }).catch((err) =>
        toast({ variant: "error", title: "Änderung nicht gespeichert", description: String(err.message ?? err) })
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
    setItems((prev) => prev.filter((it) => it.contactId !== id));
    setIndex((i) => Math.max(0, Math.min(i, visibleItems.length - 2)));
  }, [current, visibleItems.length]);

  // ---- per-contact gate state ---------------------------------------------
  const optInBlocked = current
    ? current.optInLevel !== "CONFIRMED_OPT_IN" && !allowSingleOptIn
    : false;
  const sendBlocked = !sendsApproved || optInBlocked;

  // ---- actions -------------------------------------------------------------
  const doSend = React.useCallback(async () => {
    if (!current || busy || sendBlocked) return;
    if (needsFirstSendConfirm()) {
      setConfirmOpen(true);
      return;
    }
    setBusy("send");
    try {
      await callApi("/api/admin/campaign/send", { contactId: current.contactId });
      toast({ variant: "success", title: `Gesendet an ${current.email}` });
      removeCurrent();
    } catch (err) {
      toast({
        variant: "error",
        title: "Senden fehlgeschlagen",
        description: String((err as Error).message ?? err),
      });
    } finally {
      setBusy(null);
    }
  }, [current, busy, sendBlocked, removeCurrent]);

  const confirmAndSend = React.useCallback(async () => {
    rememberFirstSendConfirm();
    setConfirmOpen(false);
    if (!current || busy) return;
    setBusy("send");
    try {
      await callApi("/api/admin/campaign/send", { contactId: current.contactId });
      toast({ variant: "success", title: `Gesendet an ${current.email}` });
      removeCurrent();
    } catch (err) {
      toast({
        variant: "error",
        title: "Senden fehlgeschlagen",
        description: String((err as Error).message ?? err),
      });
    } finally {
      setBusy(null);
    }
  }, [current, busy, removeCurrent]);

  const doSkip = React.useCallback(async () => {
    if (!current || busy) return;
    setBusy("skip");
    try {
      await callApi("/api/admin/campaign/skip", { contactId: current.contactId });
      // Skips are undoable: the contact moves to the rail's "Übersprungen"
      // section, where "Wiederherstellen" puts it straight back in the queue.
      setSkippedList((prev) => [
        {
          contactId: current.contactId,
          email: current.email,
          firstName: current.firstName,
          lastName: current.lastName,
          hasDraft: true,
        },
        ...prev,
      ]);
      removeCurrent();
    } catch (err) {
      toast({
        variant: "error",
        title: "Überspringen fehlgeschlagen",
        description: String((err as Error).message ?? err),
      });
    } finally {
      setBusy(null);
    }
  }, [current, busy, removeCurrent]);

  /** Undo a skip. If the contact still has its draft it lands straight back
   * in the queue; otherwise a fresh draft is generated first. Reloads so the
   * server-rendered queue (recommendations, bundle, purchase card) is
   * complete. */
  const doUnskip = React.useCallback(
    async (contactId: number) => {
      if (busy) return;
      setBusy("skip");
      try {
        const json = (await callApi("/api/admin/campaign/unskip", { contactId })) as {
          status?: string;
        };
        if (json.status === "pending") {
          toast({ title: "Wiederhergestellt — Entwurf wird generiert…", duration: 0 });
          await callApi("/api/admin/campaign/draft", {
            contactId,
            discountPercent: prepareDepth,
            regenerate: true,
          });
        }
        toast({
          variant: "success",
          title: "Kontakt zurück in der Warteschlange",
          description: "Seite wird neu geladen…",
        });
        window.location.reload();
      } catch (err) {
        toast({
          variant: "error",
          title: "Wiederherstellen fehlgeschlagen",
          description: String((err as Error).message ?? err),
        });
        setBusy(null);
      }
    },
    [busy, prepareDepth]
  );

  /** Global-search action: generate a draft for a contact that is NOT in the
   * queue yet (status pending/draft_failed) and pull them in. Reloads so the
   * full server-rendered card data is present. */
  const doDraftContact = React.useCallback(
    async (contactId: number) => {
      if (busy) return;
      setBusy("regen");
      try {
        toast({ title: "Entwurf wird generiert…", duration: 0 });
        await callApi("/api/admin/campaign/draft", {
          contactId,
          discountPercent: prepareDepth,
          regenerate: true,
        });
        toast({
          variant: "success",
          title: "Entwurf erstellt — Kontakt ist in der Warteschlange",
          description: "Seite wird neu geladen…",
        });
        window.location.reload();
      } catch (err) {
        toast({
          variant: "error",
          title: "Entwurf fehlgeschlagen",
          description: String((err as Error).message ?? err),
        });
        setBusy(null);
      }
    },
    [busy, prepareDepth]
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
      await navigator.clipboard.writeText(
        `${current.subject}\n\n${emailProseToText(current.body)}`
      );
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
      await callApi("/api/admin/campaign/mark-done", { contactId: current.contactId });
      toast({ variant: "success", title: "Als erledigt (kopiert) markiert" });
      setCopiedId(null);
      removeCurrent();
    } catch (err) {
      toast({
        variant: "error",
        title: "Markieren fehlgeschlagen",
        description: String((err as Error).message ?? err),
      });
    } finally {
      setBusy(null);
    }
  }, [current, busy, removeCurrent]);

  const setCurrentBundle = React.useCallback(
    (bundle: CampaignQueueItemProps["bundle"]) => {
      if (current) patchItem(current.contactId, { bundle });
    },
    [current, patchItem]
  );

  /** Regenerate a contact's draft with the current depth and patch the card
   * from the full response (text, recommendations, bundle, purchase basis) so
   * the card never drifts from what was persisted. No busy guard — callers own
   * the busy state so offer changes (products / discount / bundle) can CHAIN a
   * regenerate in the same action. Throws on failure. */
  const runRegenerate = React.useCallback(
    async (
      contactId: number,
      depth: number,
      extra?: { refreshRecommendations?: boolean; purchaseSelection?: string[] | null }
    ) => {
      const json = (await callApi("/api/admin/campaign/draft", {
        contactId,
        discountPercent: depth,
        regenerate: true,
        ...(extra?.refreshRecommendations ? { refreshRecommendations: true } : {}),
        ...(extra && "purchaseSelection" in extra
          ? { purchaseSelection: extra.purchaseSelection }
          : {}),
      })) as {
        draft?: {
          subject: string;
          body: string;
          discountPercent: number;
          discountExpiresAt: string | null;
          lowConfidence: boolean;
          purchaseSummary: CampaignQueueItemProps["purchaseSummary"];
          purchaseSelectedIds: string[] | null;
        };
        recommendations?: Array<{ id: string; name: string; url: string | null }>;
        bundle?: CampaignQueueItemProps["bundle"];
      };
      if (json.draft) {
        const d = json.draft;
        patchItem(contactId, {
          subject: d.subject,
          body: d.body,
          discountPercent: d.discountPercent,
          discountExpiresAt: d.discountExpiresAt,
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
        const json = (await callApi("/api/admin/bundles/create", {
          campaignContactId: current.contactId,
          components: productIds.map((productId) => ({ productId })),
          ...(priceOverride.trim() ? { bundlePriceOverride: priceOverride.trim() } : {}),
        })) as {
          offer?: {
            id: number;
            title: string | null;
            components: Array<{ title: string }>;
            bundlePrice: string;
            componentsSum: string;
            currency: string;
            expiresAt: string | null;
          };
        };
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
        toast({
          variant: "error",
          title: "Set-Erstellung fehlgeschlagen",
          description: String((err as Error).message ?? err),
        });
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
      await callApi("/api/admin/bundles/archive", { id: current.bundle.id });
      setCurrentBundle(null);
      toast({
        variant: "success",
        title: "Set-Angebot archiviert",
        description: "Text wird neu generiert…",
      });
      await runRegenerate(current.contactId, current.discountPercent);
      toast({ variant: "success", title: "Text aktualisiert" });
    } catch (err) {
      toast({
        variant: "error",
        title: "Archivieren fehlgeschlagen",
        description: String((err as Error).message ?? err),
      });
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
        toast({
          variant: "error",
          title: "Neu generieren fehlgeschlagen",
          description: String((err as Error).message ?? err),
        });
      } finally {
        setBusy(null);
      }
    },
    [current, busy, runRegenerate]
  );

  /** Switch the card's email language (DE/EN). Persists the per-contact
   * override (a re-sync never clobbers it; picking the derived language clears
   * the pin), then CHAINS a regenerate so the prose matches — the send-time
   * blocks (Mo-Hinweis, Rabattzeile, Set-Angebot, Footer) follow the effective
   * language automatically. */
  const doSetLanguage = React.useCallback(
    async (language: "de" | "en") => {
      if (!current || busy || language === current.language) return;
      setBusy("regen");
      try {
        const json = (await callApi("/api/admin/campaign/language", {
          contactId: current.contactId,
          // Choosing the profile-derived language = back to automatic.
          language,
        })) as { language?: "de" | "en"; languageOverride?: "de" | "en" | null };
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
        toast({
          variant: "error",
          title: "Sprachwechsel fehlgeschlagen",
          description: String((err as Error).message ?? err),
        });
      } finally {
        setBusy(null);
      }
    },
    [current, busy, patchItem, runRegenerate]
  );

  /** Persist a curated recommendation list; the server also rebuilds an
   * attached bundle to match. Immediate persist per change — no save button. */
  const doUpdateRecommendations = React.useCallback(
    async (productIds: string[]) => {
      if (!current || busy) return;
      setBusy("recs");
      try {
        const json = (await callApi("/api/admin/campaign/recommendations", {
          contactId: current.contactId,
          productIds,
        })) as {
          recommendations?: Array<{ id: string; name: string; url: string | null }>;
          bundle?: CampaignQueueItemProps["bundle"];
          bundleError?: string | null;
        };
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
        toast({
          variant: "success",
          title: "Empfehlungen gespeichert",
          description: "Text wird neu generiert…",
        });
        await runRegenerate(current.contactId, current.discountPercent);
        toast({ variant: "success", title: "Text aktualisiert" });
      } catch (err) {
        toast({
          variant: "error",
          title: "Empfehlungen nicht gespeichert",
          description: String((err as Error).message ?? err),
        });
      } finally {
        setBusy(null);
      }
    },
    [current, busy, patchItem, runRegenerate]
  );

  /** Apply the operator's purchase-basis selection: persist it, recompute the
   * recommendations from the selected purchases (an attached bundle is rebuilt
   * to match) and regenerate the prose — one action, one server round-trip. */
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
        toast({
          variant: "error",
          title: "Auswahl konnte nicht angewendet werden",
          description: String((err as Error).message ?? err),
        });
      } finally {
        setBusy(null);
      }
    },
    [current, busy, runRegenerate]
  );

  /** Set the discount depth on the existing draft, then auto-regenerate the
   * prose so it weaves the new offer in (the code + deadline additionally
   * ship deterministically at send time). */
  const doSetDiscount = React.useCallback(
    async (depth: number) => {
      if (!current || busy) return;
      setBusy("discount");
      try {
        const json = (await callApi("/api/admin/campaign/discount", {
          contactId: current.contactId,
          discountPercent: depth,
        })) as {
          discountPercent: number;
          discountExpiresAt: string | null;
          proseMismatch: boolean;
          prosePercents: number[];
        };
        patchItem(current.contactId, {
          discountPercent: json.discountPercent,
          discountExpiresAt: json.discountExpiresAt,
        });
        toast({
          variant: "success",
          title:
            json.discountPercent > 0
              ? `Rabatt auf ${json.discountPercent} % gesetzt`
              : "Rabatt entfernt",
          description: "Text wird neu generiert…",
        });
        await runRegenerate(current.contactId, json.discountPercent);
        toast({ variant: "success", title: "Text aktualisiert" });
      } catch (err) {
        toast({
          variant: "error",
          title: "Rabatt nicht gespeichert",
          description: String((err as Error).message ?? err),
        });
      } finally {
        setBusy(null);
      }
    },
    [current, busy, patchItem, runRegenerate]
  );

  const doSync = React.useCallback(async () => {
    if (busy) return;
    setBusy("sync");
    const progressId = toast({
      title: "Shopify-Sync läuft…",
      description: "Abonnent:innen werden abgeglichen.",
      duration: 0,
    });
    try {
      const json = (await callApi("/api/admin/campaign/sync", {})) as {
        total?: number;
        created?: number;
        suppressed?: number;
      };
      toast({
        variant: "success",
        title: "Sync abgeschlossen",
        description: `${json.total ?? 0} Abonnent:innen (${json.created ?? 0} neu, ${json.suppressed ?? 0} unterdrückt). Seite wird neu geladen…`,
      });
      window.location.reload();
    } catch (err) {
      toast({
        variant: "error",
        title: "Sync fehlgeschlagen",
        description: String((err as Error).message ?? err),
      });
      setBusy(null);
    } finally {
      // Toaster auto-dismiss handles the progress toast; nothing to clean up.
      void progressId;
    }
  }, [busy]);

  /** Rebuild the queue: all open drafts are discarded (edits included), the
   * contacts return to 'pending', and "Prepare" regenerates them with the
   * current code. Called only from the confirm dialog. */
  const doResetQueue = React.useCallback(async () => {
    if (busy) return;
    setResetOpen(false);
    setBusy("reset");
    try {
      const json = (await callApi("/api/admin/campaign/reset-queue", {})) as {
        reset?: number;
      };
      toast({
        variant: "success",
        title: `${json.reset ?? 0} Entwürfe verworfen`,
        description:
          "Kontakte sind wieder „Offen“ — mit „Nächste 50 vorbereiten“ neu generieren. Seite wird neu geladen…",
      });
      window.location.reload();
    } catch (err) {
      toast({
        variant: "error",
        title: "Zurücksetzen fehlgeschlagen",
        description: String((err as Error).message ?? err),
      });
      setBusy(null);
    }
  }, [busy]);

  const doPrepare = React.useCallback(async () => {
    if (busy) return;
    setBusy("prepare");
    let prepared = 0;
    let failed = 0;
    let suppressed = 0;
    try {
      for (let done = 0; done < PREPARE_TOTAL; done += PREPARE_CHUNK) {
        setPrepareProgress(`${done}/${PREPARE_TOTAL}…`);
        const json = (await callApi("/api/admin/campaign/prepare", {
          count: PREPARE_CHUNK,
          discountPercent: prepareDepth,
        })) as {
          prepared: number;
          failed: number;
          suppressed: number;
          exhausted: boolean;
        };
        prepared += json.prepared;
        failed += json.failed;
        suppressed += json.suppressed;
        if (json.exhausted) break;
      }
      toast({
        variant: failed > 0 ? "warning" : "success",
        title: `${prepared} Entwürfe erstellt`,
        description:
          `${failed} fehlgeschlagen, ${suppressed} unterdrückt. ` + `Seite wird neu geladen…`,
      });
      window.location.reload();
    } catch (err) {
      toast({
        variant: "error",
        title: "Vorbereitung fehlgeschlagen",
        description: String((err as Error).message ?? err),
      });
      setBusy(null);
      setPrepareProgress(null);
    }
  }, [busy, prepareDepth]);

  // ---- keyboard shortcuts --------------------------------------------------
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) {
        return;
      }
      if (view !== "queue") return;
      // No review shortcuts while a dialog is open (S must never send blind).
      if (emailView || confirmOpen || resetOpen) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, Math.max(0, visibleItems.length - 1)));
      } else if (k === "p") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (k === "c") {
        e.preventDefault();
        void doCopy();
      } else if (k === "s") {
        e.preventDefault();
        void doSend();
      } else if (k === "x") {
        e.preventDefault();
        void doSkip();
      } else if (k === "v") {
        e.preventDefault();
        doPreview();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    view,
    visibleItems.length,
    doCopy,
    doSend,
    doSkip,
    doPreview,
    emailView,
    confirmOpen,
    resetOpen,
  ]);

  // ---- render --------------------------------------------------------------
  return (
    <div className="space-y-4">
      {!sendsApproved && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm text-warning">
          <strong>Versand gesperrt:</strong> Die anwaltliche Freigabe für diesen Kanal
          steht aus (<code>CAMPAIGN_SENDS_APPROVED=false</code>). Entwürfe, Vorschau und
          Kopieren funktionieren; der Senden-Button bleibt deaktiviert und der Server
          lehnt jeden Versand ab.
        </div>
      )}
      {!shopifyConfigured && (
        <div className="rounded-lg border border-info/30 bg-info/10 px-3.5 py-3 text-sm text-info">
          Shopify ist nicht konfiguriert — Sync, Kaufhistorie und Rabattcodes sind
          deaktiviert.
        </div>
      )}

      {/* Header: counts + actions */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
        <HeaderStat label="Offen" value={counts.pending} />
        <HeaderStat label="Entwürfe" value={counts.drafted} />
        <HeaderStat label="Heute gesendet" value={counts.sentToday} />
        <HeaderStat label="Übersprungen" value={counts.skipped} />
        <HeaderStat label="Unterdrückt" value={counts.suppressed} />
        {counts.draftFailed > 0 && (
          <HeaderStat label="Entwurf fehlgeschlagen" value={counts.draftFailed} warn />
        )}
        <span className="text-muted-foreground">
          Opt-in:{" "}
          {Object.entries(counts.byOptInLevel)
            .map(([level, n]) => `${optInShort(level)} ${n}`)
            .join(" · ") || "—"}
        </span>
        <span className="ms-auto flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={doSync}
            disabled={busy !== null || !shopifyConfigured}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {busy === "sync" ? "Sync läuft…" : "Sync"}
          </Button>
          <span className="flex items-center gap-1.5">
            <Select
              value={String(prepareDepth)}
              onChange={(e) => setPrepareDepth(clampDiscountPercent(e.target.value))}
              className="h-8 w-24"
              aria-label="Rabatt-Tiefe für neue Entwürfe"
              disabled={busy !== null}
            >
              <option value="0">0 % Rabatt</option>
              <option value="5">5 %</option>
              <option value="10">10 %</option>
              <option value="15">15 %</option>
              <option value="20">20 %</option>
            </Select>
            <Button size="sm" onClick={doPrepare} disabled={busy !== null}>
              {busy === "prepare"
                ? (prepareProgress ?? "Läuft…")
                : `Nächste ${PREPARE_TOTAL} vorbereiten`}
            </Button>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResetOpen(true)}
            disabled={busy !== null || items.length === 0}
          >
            {busy === "reset" ? "Setzt zurück…" : "Warteschlange neu aufbauen"}
          </Button>
        </span>
      </div>

      {/* Sub-view switch + review filters */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button
          variant={view === "queue" ? "default" : "outline"}
          size="sm"
          onClick={() => setView("queue")}
        >
          Warteschlange ({visibleItems.length}
          {visibleItems.length !== items.length ? `/${items.length}` : ""})
        </Button>
        <Button
          variant={view === "sent" ? "default" : "outline"}
          size="sm"
          onClick={() => setView("sent")}
        >
          Gesendet ({history.length})
        </Button>
        {view === "queue" && (
          <>
            <span className="ms-2 flex items-center gap-1">
              {(
                [
                  ["all", "Alle"],
                  ["doi", "Nur DOI"],
                  ["soi", "Nur Single/Unbekannt"],
                ] as const
              ).map(([key, label]) => (
                <Button
                  key={key}
                  variant={optInFilter === key ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => applyOptInFilter(key)}
                >
                  {label}
                </Button>
              ))}
            </span>
            <span className="ms-auto text-xs text-muted-foreground">
              Tasten: <Kbd>N</Kbd> weiter · <Kbd>P</Kbd> zurück · <Kbd>V</Kbd> Vorschau ·{" "}
              <Kbd>C</Kbd> kopieren · <Kbd>S</Kbd> senden · <Kbd>X</Kbd> überspringen
            </span>
          </>
        )}
      </div>

      {view === "sent" ? (
        <SentHistory history={history} viewBusy={emailViewBusy} onView={doViewSent} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
          <QueueRail
            items={visibleItems}
            currentContactId={current?.contactId ?? null}
            skipped={skippedList}
            busy={busy !== null}
            onJump={jumpToContact}
            onUnskip={doUnskip}
            onDraft={doDraftContact}
          />
          {!current ? (
            <div className="rounded-lg border border-info/30 bg-info/10 px-3.5 py-3 text-sm text-info">
              Keine Entwürfe in der Warteschlange. „Sync“ holt die Shopify-Abonnent:innen,
              „Nächste {PREPARE_TOTAL} vorbereiten“ erzeugt die Entwürfe — oder über die
              Kontaktsuche links eine:n einzelne:n Kund:in aufnehmen.
            </div>
          ) : (
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>
                Entwurf {clampedIndex + 1} von {visibleItems.length}
              </span>
              <span className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={clampedIndex === 0}
                >
                  ← Zurück
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setIndex((i) => Math.min(i + 1, Math.max(0, visibleItems.length - 1)))
                  }
                  disabled={clampedIndex >= visibleItems.length - 1}
                >
                  Weiter →
                </Button>
              </span>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(280px,2fr)_3fr]">
              {/* Left: contact context */}
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-base font-semibold">
                    {[current.firstName, current.lastName].filter(Boolean).join(" ") ||
                      "(kein Name)"}
                  </div>
                  <div className="text-muted-foreground">{current.email}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <LanguageToggle
                    language={current.language}
                    overridden={current.languageOverride !== null}
                    disabled={busy !== null}
                    onSelect={doSetLanguage}
                  />
                  <OptInBadge level={current.optInLevel} blocked={optInBlocked} />
                  {current.lowConfidence && (
                    <Badge variant="warning">
                      <AlertTriangle className="h-3 w-3" />
                      Empfehlungen unsicher
                    </Badge>
                  )}
                </div>
                <div className="text-muted-foreground">
                  {current.ordersCount} Bestellungen · {formatEuro(current.totalSpentCents)}{" "}
                  Umsatz
                </div>

                <PurchaseHistorySection
                  key={`hist-${current.contactId}`}
                  summary={current.purchaseSummary}
                  appliedSelection={current.purchaseSelectedIds}
                  busy={busy !== null}
                  applying={busy === "selection"}
                  onApply={doApplyPurchaseSelection}
                />

                <RecommendationsEditor
                  key={`recs-${current.contactId}`}
                  recommendations={current.recommendations}
                  busy={busy !== null}
                  saving={busy === "recs"}
                  onChange={doUpdateRecommendations}
                />

                <DiscountControl
                  key={`disc-${current.contactId}`}
                  percent={current.discountPercent}
                  expiresAt={current.discountExpiresAt}
                  busy={busy !== null}
                  saving={busy === "discount"}
                  onApply={doSetDiscount}
                />

                <BundleSection
                  bundle={current.bundle}
                  recommendations={current.recommendations}
                  shopifyConfigured={shopifyConfigured}
                  busy={busy !== null}
                  creating={busy === "bundle"}
                  onCreate={doCreateBundle}
                  onArchive={doArchiveBundle}
                />
              </div>

              {/* Right: editable draft + actions */}
              <div className="space-y-3">
                <Input
                  value={current.subject}
                  onChange={(e) => editCurrent({ subject: e.target.value })}
                  aria-label="Betreff"
                />
                <Textarea
                  value={current.body}
                  onChange={(e) => editCurrent({ body: e.target.value })}
                  rows={16}
                  aria-label="E-Mail-Text"
                  className="font-mono text-xs leading-relaxed"
                />
                <p className="text-xs text-muted-foreground">
                  Produktbilder-Raster, Mo-Hinweis (Deep-Link), Rabattzeile und
                  Abmelde-/Impressum-Footer werden beim Versand automatisch angehängt und
                  sind hier nicht editierbar.
                </p>

                {optInBlocked && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                    <strong>Erneute Einwilligung erforderlich:</strong> Für diesen Kontakt
                    liegt kein nachweisbares Double-Opt-in vor (
                    {optInShort(current.optInLevel)}). Senden ist blockiert; Kopieren ist
                    möglich.
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={doSend} disabled={sendBlocked || busy !== null}>
                      <Send className="h-4 w-4" />
                      {busy === "send" ? "Sendet…" : "Senden"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={doPreview}
                      disabled={emailViewBusy}
                      title="Gerenderte E-Mail-Vorschau (inkl. Produktbilder, Mo-Hinweis, Rabattzeile und Footer)"
                    >
                      <Eye className="h-4 w-4" />
                      {emailViewBusy ? "Lädt…" : "Vorschau"}
                    </Button>
                    <Button variant="outline" onClick={doCopy} disabled={busy !== null}>
                      <Copy className="h-4 w-4" />
                      Kopieren
                    </Button>
                    {copiedId === current.contactId && (
                      <Button variant="outline" onClick={doMarkDone} disabled={busy !== null}>
                        <Check className="h-4 w-4" />
                        Als erledigt markieren
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => doRegenerate(current.discountPercent)}
                      disabled={busy !== null}
                    >
                      <RefreshCw className="h-4 w-4" />
                      {busy === "regen" ? "Generiert…" : "Neu generieren"}
                    </Button>
                  </div>
                  <Button variant="outline" onClick={doSkip} disabled={busy !== null}>
                    <SkipForward className="h-4 w-4" />
                    Überspringen
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
          )}
        </div>
      )}

      {/* Rebuild-queue confirmation */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Warteschlange neu aufbauen?</DialogTitle>
            <DialogDescription>
              Alle {items.length} offenen Entwürfe werden verworfen — auch manuelle
              Änderungen an Betreff/Text gehen verloren. Die Kontakte werden wieder
              „Offen“ und mit „Nächste {PREPARE_TOTAL} vorbereiten“ neu generiert
              (erneute API-Kosten). Gesendete, übersprungene und unterdrückte Kontakte
              sowie angehängte Set-Angebote bleiben unberührt.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Abbrechen
            </Button>
            <Button variant="destructive" onClick={doResetQueue}>
              Entwürfe verwerfen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rendered-email viewer (draft preview + sent content) */}
      <Dialog open={emailView !== null} onOpenChange={(v) => !v && closeEmailView()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{emailView?.title}</DialogTitle>
            <DialogDescription>{emailView?.description}</DialogDescription>
          </DialogHeader>
          {emailView && <EmailPreviewFrame title={emailView.title} src={emailView.url} />}
        </DialogContent>
      </Dialog>

      {/* First-send-of-the-day confirmation */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ersten Versand heute bestätigen</DialogTitle>
            <DialogDescription>
              Du startest den heutigen Kampagnen-Versand: Die E-Mail geht an{" "}
              {current?.email ?? "—"}. Weitere Sendungen heute werden nicht mehr einzeln
              bestätigt.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={confirmAndSend}>Jetzt senden</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Purchase history with the recommendation-basis selection: every purchased
 * item that maps to a CURRENT catalog product gets a checkbox (all selected by
 * default = the whole history is the basis). Changing the selection shows an
 * apply button that recomputes the recommendations from the selected purchases
 * and regenerates the text in one round-trip; the selection is persisted on
 * the draft so later regenerates keep it. Items without a catalog match stay
 * informational (they can't steer the similarity search). */
function PurchaseHistorySection({
  summary,
  appliedSelection,
  busy,
  applying,
  onApply,
}: {
  summary: CampaignQueueItemProps["purchaseSummary"];
  appliedSelection: string[] | null;
  busy: boolean;
  applying: boolean;
  onApply: (selection: string[] | null) => void;
}) {
  // All selectable product ids (catalog-matched purchases), first-seen order.
  const selectableIds = React.useMemo(() => {
    const ids: string[] = [];
    for (const o of summary?.orders ?? []) {
      for (const i of o.items) {
        if (i.productId && !ids.includes(i.productId)) ids.push(i.productId);
      }
    }
    return ids;
  }, [summary]);

  // The selection as APPLIED on the draft, clipped to what's selectable
  // (null = all). Local checkbox state seeds from it and re-seeds after an
  // apply round-trip patches the card.
  const appliedIds = React.useMemo(
    () =>
      appliedSelection === null
        ? selectableIds
        : selectableIds.filter((id) => appliedSelection.includes(id)),
    [appliedSelection, selectableIds]
  );
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(appliedIds));
  const appliedKey = appliedIds.join("|");
  React.useEffect(() => {
    setSelected(new Set(appliedIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey]);

  const dirty =
    selected.size !== appliedIds.length || appliedIds.some((id) => !selected.has(id));
  const allSelected = selectableIds.length > 0 && selected.size === selectableIds.length;

  // Drafts saved before the selection feature lack the productId field
  // entirely — a regenerate refreshes the snapshot and enables the checkboxes.
  const legacySummary =
    selectableIds.length === 0 &&
    (summary?.orders ?? []).some((o) => o.items.some((i) => !("productId" in i)));

  const toggle = (productId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(productId);
      else next.delete(productId);
      return next;
    });
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">Kaufhistorie</span>
        {selectableIds.length > 1 && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              className="size-3.5"
              checked={allSelected}
              indeterminate={selected.size > 0 && !allSelected}
              disabled={busy}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(selectableIds) : new Set())
              }
            />
            Alle
          </label>
        )}
      </div>
      {summary && summary.orders.length > 0 ? (
        <ul className="space-y-1.5">
          {summary.orders.map((o) => (
            <li key={o.name} className="rounded-md border border-border px-2.5 py-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {o.name} · {formatDate(o.createdAt)}
                </span>
                <span>
                  {o.totalAmount
                    ? `${Number(o.totalAmount).toLocaleString("de-DE", {
                        style: "currency",
                        currency: o.currencyCode ?? "EUR",
                      })}`
                    : ""}
                </span>
              </div>
              <div className="mt-0.5 space-y-0.5">
                {o.items.map((i, idx) =>
                  i.productId ? (
                    <label
                      key={idx}
                      className="flex cursor-pointer items-start gap-1.5 text-xs"
                    >
                      <Checkbox
                        className="mt-px size-3.5"
                        checked={selected.has(i.productId)}
                        disabled={busy}
                        onChange={(e) => toggle(i.productId as string, e.target.checked)}
                      />
                      <span>
                        {i.quantity}× {i.title ?? "?"}
                      </span>
                    </label>
                  ) : (
                    <div key={idx} className="ps-5 text-xs text-muted-foreground">
                      {i.quantity}× {i.title ?? "?"}
                    </div>
                  )
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-muted-foreground">Keine Bestelldetails verfügbar.</div>
      )}
      {selectableIds.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {appliedSelection !== null && !dirty
            ? `Empfehlungsbasis: ${appliedIds.length} von ${selectableIds.length} Käufen ausgewählt.`
            : "Ausgewählte Käufe sind die Basis für Empfehlungen und Text."}
        </p>
      )}
      {legacySummary && (
        <p className="mt-1 text-xs text-muted-foreground">
          Kaufauswahl wird nach „Neu generieren“ verfügbar.
        </p>
      )}
      {dirty && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            onClick={() => onApply(allSelected ? null : [...selected])}
            disabled={busy || selected.size === 0}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {applying ? "Erzeugt neu…" : "Empfehlungen & Text neu erzeugen"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set(appliedIds))}
            disabled={busy}
          >
            Verwerfen
          </Button>
          {selected.size === 0 && (
            <span className="text-xs text-warning">Mindestens einen Kauf auswählen.</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Per-card bundle-offer section: shows the attached active set (price, "statt"
 * when genuinely cheaper, expiry, archive), or a small composer that creates a
 * set from the card's recommended products via the EXISTING bundle mechanism
 * (/api/admin/bundles/create with campaignContactId — docs/BUNDLES.md). */
function BundleSection({
  bundle,
  recommendations,
  shopifyConfigured,
  busy,
  creating,
  onCreate,
  onArchive,
}: {
  bundle: CampaignQueueItemProps["bundle"];
  recommendations: Array<{ id: string; name: string; url: string | null }>;
  shopifyConfigured: boolean;
  busy: boolean;
  creating: boolean;
  onCreate: (productIds: string[], priceOverride: string) => void;
  onArchive: () => void;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(recommendations.map((r) => r.id))
  );
  const [priceOverride, setPriceOverride] = React.useState("");
  // Re-seed the composer when the card (its recommendations) changes.
  const recKey = recommendations.map((r) => r.id).join("|");
  React.useEffect(() => {
    setSelected(new Set(recommendations.map((r) => r.id)));
    setPriceOverride("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recKey]);

  if (bundle) {
    const price = Number(bundle.bundlePrice);
    const sum = Number(bundle.componentsSum);
    const money = (n: number) =>
      n.toLocaleString("de-DE", { style: "currency", currency: bundle.currency || "EUR" });
    return (
      <div>
        <div className="mb-1 font-medium">Set-Angebot</div>
        <div className="rounded-md border border-border px-2.5 py-1.5 text-xs">
          <div className="font-medium">{bundle.title}</div>
          <div className="text-muted-foreground">{bundle.components.join(" + ")}</div>
          <div className="mt-1">
            {Number.isFinite(price) ? money(price) : bundle.bundlePrice}
            {Number.isFinite(price) && Number.isFinite(sum) && price < sum && (
              <span className="text-muted-foreground"> (statt {money(sum)})</span>
            )}
            {bundle.expiresAt ? (
              <span className="text-muted-foreground">
                {" "}
                · läuft ab {formatDate(bundle.expiresAt)}
              </span>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={onArchive}
            disabled={busy}
          >
            Set entfernen (archivieren)
          </Button>
        </div>
      </div>
    );
  }

  if (!shopifyConfigured || recommendations.length === 0) {
    return (
      <div>
        <div className="mb-1 font-medium">Set-Angebot</div>
        <div className="text-xs text-muted-foreground">
          {shopifyConfigured
            ? "Keine Empfehlungen, aus denen ein Set gebaut werden könnte."
            : "Shopify nicht konfiguriert — keine Set-Angebote möglich."}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 font-medium">Set-Angebot</div>
      <div className="space-y-1 text-xs">
        {recommendations.map((r) => (
          <label key={r.id} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={selected.has(r.id)}
              onChange={(e) => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(r.id);
                  else next.delete(r.id);
                  return next;
                });
              }}
            />
            {r.name}
          </label>
        ))}
        <div className="flex items-center gap-1.5 pt-1">
          <Input
            type="text"
            inputMode="decimal"
            placeholder="Set-Preis € (optional)"
            value={priceOverride}
            onChange={(e) => setPriceOverride(e.target.value)}
            className="h-8 w-40 text-xs"
            aria-label="Set-Preis (optional, sonst Summe der Einzelpreise)"
            disabled={busy}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => onCreate([...selected], priceOverride)}
            disabled={busy || selected.size === 0}
          >
            {creating ? "Erstellt…" : "Set aus Empfehlungen erstellen"}
          </Button>
        </div>
        <p className="text-muted-foreground">
          Erstellt ein echtes (unlisted) Shopify-Set über den bestehenden
          Bundle-Mechanismus; der Text wird automatisch neu generiert und der
          Angebots-Block beim Versand angehängt.
        </p>
      </div>
    </div>
  );
}

/** Left rail of the queue view: contact list (click to jump), the GLOBAL
 * contact search (all statuses — pull anyone into the queue), and the
 * restorable "Übersprungen" section. */
function QueueRail({
  items,
  currentContactId,
  skipped,
  busy,
  onJump,
  onUnskip,
  onDraft,
}: {
  items: CampaignQueueItemProps[];
  currentContactId: number | null;
  skipped: CampaignSkippedItemProps[];
  busy: boolean;
  onJump: (contactId: number) => void;
  onUnskip: (contactId: number) => void;
  onDraft: (contactId: number) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<
    Array<{
      id: number;
      email: string;
      firstName: string | null;
      lastName: string | null;
      status: string;
      optInLevel: string;
      hasDraft: boolean;
    }>
  >([]);
  const [searching, setSearching] = React.useState(false);
  const [showSkipped, setShowSkipped] = React.useState(false);
  const searchSeq = React.useRef(0);

  // Search-as-you-type over ALL campaign contacts (any status), debounced;
  // results clear below 2 chars. Same pattern as the Kunden bundle composer.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      searchSeq.current++;
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const json = (await callApi("/api/admin/campaign/contacts", { query: q })) as {
          contacts?: typeof results;
        };
        if (seq !== searchSeq.current) return;
        setResults(json.contacts ?? []);
      } catch {
        // Non-fatal: an empty result list; the next keystroke retries.
        if (seq === searchSeq.current) setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const name = (c: { email: string; firstName: string | null; lastName: string | null }) =>
    [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email;

  const statusAction = (c: (typeof results)[number]) => {
    switch (c.status) {
      case "drafted":
        return (
          <Button variant="outline" size="sm" onClick={() => onJump(c.id)}>
            Öffnen
          </Button>
        );
      case "pending":
      case "draft_failed":
        return (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onDraft(c.id)}>
            Entwurf erstellen
          </Button>
        );
      case "skipped":
        return (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onUnskip(c.id)}>
            Wiederherstellen
          </Button>
        );
      case "sent":
        return <Badge variant="success">Gesendet</Badge>;
      case "suppressed":
        return <Badge variant="warning">Unterdrückt</Badge>;
      default:
        return <Badge variant="outline">{c.status}</Badge>;
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm lg:sticky lg:top-4">
      <div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Alle Kontakte durchsuchen…"
          className="h-8 text-xs"
          aria-label="Alle Kampagnen-Kontakte durchsuchen"
        />
        {searching && <div className="mt-1 text-xs text-muted-foreground">Sucht…</div>}
        {!searching && query.trim().length >= 2 && (
          <ul className="mt-1.5 space-y-1">
            {results.length === 0 && (
              <li className="text-xs text-muted-foreground">Keine Treffer.</li>
            )}
            {results.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{name(c)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {c.email}
                  </span>
                </span>
                {statusAction(c)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Warteschlange ({items.length})
        </div>
        <ul className="max-h-96 space-y-0.5 overflow-y-auto">
          {items.map((it, i) => (
            <li key={it.contactId}>
              <button
                type="button"
                onClick={() => onJump(it.contactId)}
                className={`w-full rounded-md px-2 py-1 text-start text-xs transition-colors ${
                  it.contactId === currentContactId
                    ? "bg-secondary font-medium"
                    : "hover:bg-secondary/60"
                }`}
              >
                <span className="text-muted-foreground">{i + 1}.</span>{" "}
                {name(it)}
                {it.optInLevel !== "CONFIRMED_OPT_IN" && (
                  <span className="text-warning" title="Kein nachweisbares Double-Opt-in">
                    {" "}
                    ⚠
                  </span>
                )}
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">Leer.</li>
          )}
        </ul>
      </div>

      <div>
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowSkipped((v) => !v)}
        >
          Übersprungen ({skipped.length}) {showSkipped ? "▾" : "▸"}
        </button>
        {showSkipped && (
          <ul className="mt-1 space-y-1">
            {skipped.length === 0 && (
              <li className="text-xs text-muted-foreground">Keine übersprungenen Kontakte.</li>
            )}
            {skipped.map((s) => (
              <li
                key={s.contactId}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs">{name(s)}</span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onUnskip(s.contactId)}
                >
                  Wiederherstellen
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Editable recommendation list: remove per item, add via the shared catalog
 * search (/api/admin/catalog/search — the bundle composer's picker backend),
 * SEARCH-AS-YOU-TYPE like the Kunden bundle composer. Every change persists
 * immediately (onChange → the recommendations route, which also rebuilds an
 * attached bundle and regenerates the prose). */
function RecommendationsEditor({
  recommendations,
  busy,
  saving,
  onChange,
}: {
  recommendations: Array<{ id: string; name: string; url: string | null }>;
  busy: boolean;
  saving: boolean;
  onChange: (productIds: string[]) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<
    Array<{ productId: string; title: string; inStock: boolean }>
  >([]);
  const [searching, setSearching] = React.useState(false);
  const searchSeq = React.useRef(0);

  // Search-as-you-type over the synced catalog, debounced — the same pattern
  // as the Kunden bundle composer. Results clear below a 2-char query.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      searchSeq.current++;
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const json = (await callApi("/api/admin/catalog/search", { query: q })) as {
          products?: Array<{ productId: string; title: string; inStock: boolean }>;
        };
        if (seq !== searchSeq.current) return;
        setResults(json.products ?? []);
      } catch (err) {
        if (seq === searchSeq.current) {
          toast({
            variant: "error",
            title: "Katalogsuche fehlgeschlagen",
            description: String((err as Error).message ?? err),
          });
        }
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const ids = recommendations.map((r) => r.id);

  return (
    <div>
      <div className="mb-1 font-medium">
        Empfohlene Produkte{saving ? " · speichert…" : ""}
      </div>
      {recommendations.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {recommendations.map((r) => (
            <li key={r.id} className="flex items-center gap-1.5">
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {r.name}
                </a>
              ) : (
                <span>{r.name}</span>
              )}
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`${r.name} entfernen`}
                disabled={busy || recommendations.length <= 1}
                onClick={() => onChange(ids.filter((id) => id !== r.id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-muted-foreground">Keine.</div>
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Produkt suchen (tippen)…"
          className="h-8 w-52 text-xs"
          aria-label="Produkt für Empfehlung suchen"
          disabled={busy}
        />
        {searching && <span className="text-xs text-muted-foreground">Sucht…</span>}
      </div>
      {results.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs">
          {results.slice(0, 6).map((p) => (
            <li key={p.productId}>
              <button
                type="button"
                className="underline underline-offset-2 disabled:no-underline disabled:opacity-50"
                disabled={busy || !p.inStock || ids.includes(p.productId)}
                onClick={() => {
                  setResults([]);
                  setQuery("");
                  onChange([...ids, p.productId]);
                }}
              >
                + {p.title}
              </button>
              {!p.inStock && <span className="text-muted-foreground"> (ausverkauft)</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Änderungen werden sofort gespeichert, ein angehängtes Set wird angepasst und der Text
        automatisch neu generiert.
      </p>
    </div>
  );
}

/** Post-generation discount control: set/clear the depth on the existing draft
 * (the code + expiry ship deterministically at send time — no regenerate
 * required; a contradicting prose percentage triggers the warning/refusal). */
function DiscountControl({
  percent,
  expiresAt,
  busy,
  saving,
  onApply,
}: {
  percent: number;
  expiresAt: string | null;
  busy: boolean;
  saving: boolean;
  onApply: (depth: number) => void;
}) {
  const [value, setValue] = React.useState(percent);
  React.useEffect(() => setValue(percent), [percent]);
  return (
    <div>
      <div className="mb-1 font-medium">Rabatt</div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          max={DISCOUNT_PERCENT_MAX}
          value={value}
          onChange={(e) => setValue(clampDiscountPercent(e.target.value))}
          className="h-8 w-16 text-xs"
          aria-label="Rabatt-Tiefe in Prozent"
          disabled={busy}
        />
        <span className="text-xs text-muted-foreground">%</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onApply(value)}
          disabled={busy || value === percent}
        >
          {saving ? "Speichert…" : "Übernehmen"}
        </Button>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {percent > 0 ? (
          <>
            Aktuell {percent} % — echter <code>MK-</code>-Code wird beim Senden erzeugt
            {expiresAt ? ` (voraussichtlich gültig bis ${formatDate(expiresAt)})` : ""}.
            „Übernehmen“ generiert den Text automatisch neu.
          </>
        ) : (
          "Kein Rabatt. Kann jederzeit gesetzt werden — „Übernehmen“ generiert den Text automatisch neu; Code + Rabattzeile werden beim Versand angehängt."
        )}
      </div>
    </div>
  );
}

function SentHistory({
  history,
  viewBusy,
  onView,
}: {
  history: CampaignHistoryItemProps[];
  viewBusy: boolean;
  onView: (h: CampaignHistoryItemProps) => void;
}) {
  if (history.length === 0) {
    return (
      <div className="rounded-lg border border-info/30 bg-info/10 px-3.5 py-3 text-sm text-info">
        Noch keine Kampagnen-E-Mails gesendet.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-start text-xs text-muted-foreground">
            <th className="px-3 py-2 text-start font-medium">Empfänger</th>
            <th className="px-3 py-2 text-start font-medium">Betreff</th>
            <th className="px-3 py-2 text-start font-medium">Via</th>
            <th className="px-3 py-2 text-start font-medium">Code</th>
            <th className="px-3 py-2 text-start font-medium">Eingelöst</th>
            <th className="px-3 py-2 text-start font-medium">Gesendet</th>
            <th className="px-3 py-2 text-start font-medium">Inhalt</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2">{h.email}</td>
              <td className="max-w-64 truncate px-3 py-2">{h.subject ?? "—"}</td>
              <td className="px-3 py-2">
                <Badge variant="outline">{h.sentVia === "copy" ? "Kopiert" : "E-Mail"}</Badge>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{h.discountCode ?? "—"}</td>
              <td className="px-3 py-2">
                {h.discountCode === null ? "—" : h.redeemed === null ? "?" : h.redeemed ? "✓" : "✗"}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {h.sentAt ? new Date(h.sentAt).toLocaleString("de-DE") : "—"}
              </td>
              <td className="px-3 py-2">
                {h.hasContent ? (
                  <Button variant="outline" size="sm" disabled={viewBusy} onClick={() => onView(h)}>
                    <Eye className="h-3.5 w-3.5" />
                    Ansehen
                  </Button>
                ) : (
                  <span
                    className="text-xs text-muted-foreground"
                    title="Für diesen Versand wurde kein Inhalt gespeichert (vor Einführung der Speicherung gesendet)."
                  >
                    —
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeaderStat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <span className={warn ? "text-warning" : undefined}>
      <strong>{value}</strong> <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/** DE/EN switch for the card's email language. Shows the EFFECTIVE language
 * (normally derived from the Shopify profile — see campaign-language.mjs);
 * clicking the other one pins it per contact and regenerates the text. */
function LanguageToggle({
  language,
  overridden,
  disabled,
  onSelect,
}: {
  language: "de" | "en";
  overridden: boolean;
  disabled: boolean;
  onSelect: (language: "de" | "en") => void;
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-border text-xs"
      role="group"
      aria-label="Sprache der E-Mail"
      title={
        overridden
          ? "Sprache manuell festgelegt (Sync ändert sie nicht mehr)."
          : "Sprache aus dem Shopify-Profil abgeleitet — Klick legt sie manuell fest und generiert den Text neu."
      }
    >
      {(["de", "en"] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          disabled={disabled || language === lang}
          onClick={() => onSelect(lang)}
          className={
            language === lang
              ? "bg-primary px-2 py-0.5 font-semibold text-primary-foreground"
              : "px-2 py-0.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
          }
        >
          {lang.toUpperCase()}
        </button>
      ))}
      {overridden && (
        <span className="border-l border-border px-1.5 py-0.5 text-muted-foreground" title="Manuell festgelegt">
          ✎
        </span>
      )}
    </div>
  );
}

function OptInBadge({ level, blocked }: { level: string; blocked: boolean }) {
  if (level === "CONFIRMED_OPT_IN") {
    return <Badge variant="success">Double-Opt-in</Badge>;
  }
  return (
    <Badge variant="warning">
      {optInShort(level)}
      {blocked ? " · Senden blockiert" : ""}
    </Badge>
  );
}

function optInShort(level: string): string {
  switch (level) {
    case "CONFIRMED_OPT_IN":
      return "DOI";
    case "SINGLE_OPT_IN":
      return "Single-Opt-in";
    default:
      return "Unbekannt";
  }
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-secondary px-1 py-0.5 font-mono text-[10px]">
      {children}
    </kbd>
  );
}
