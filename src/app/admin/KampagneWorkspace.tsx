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
  RefreshCw,
  Send,
  SkipForward,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
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
import {
  DISCOUNT_PERCENT_MAX,
  clampDiscountPercent,
} from "@/lib/discount-validation.mjs";

export interface CampaignQueueItemProps {
  contactId: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  language: "de" | "en";
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
      items: Array<{ title: string | null; quantity: number }>;
    }>;
    truncated: boolean;
  } | null;
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

export function KampagneWorkspace({
  counts,
  queue,
  history,
  sendsApproved,
  allowSingleOptIn,
  shopifyConfigured,
}: {
  counts: CampaignCountsProps;
  queue: CampaignQueueItemProps[];
  history: CampaignHistoryItemProps[];
  sendsApproved: boolean;
  allowSingleOptIn: boolean;
  shopifyConfigured: boolean;
}) {
  const [view, setView] = React.useState<"queue" | "sent">("queue");
  // Local working copy of the queue; processed contacts are removed so the
  // card always shows the next reviewable draft without a server round-trip.
  const [items, setItems] = React.useState(queue);
  const [index, setIndex] = React.useState(0);
  // Review filters: opt-in level (all / provable DOI only / SOI+unknown only)
  // + a free-text contact search. Both narrow the WORKING view; mutations are
  // keyed by contactId so filtering can never mis-target a card.
  const [optInFilter, setOptInFilter] = React.useState<"all" | "doi" | "soi">("all");
  const [search, setSearch] = React.useState("");
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
    | "discount"
    | "reset"
  >(null);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [prepareProgress, setPrepareProgress] = React.useState<string | null>(null);
  const [prepareDepth, setPrepareDepth] = React.useState(0);
  const [copiedId, setCopiedId] = React.useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const visibleItems = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (optInFilter === "doi" && it.optInLevel !== "CONFIRMED_OPT_IN") return false;
      if (optInFilter === "soi" && it.optInLevel === "CONFIRMED_OPT_IN") return false;
      if (
        q &&
        !`${it.email} ${it.firstName ?? ""} ${it.lastName ?? ""}`.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [items, optInFilter, search]);

  // A filter change restarts at the top of the (new) view.
  React.useEffect(() => {
    setIndex(0);
  }, [optInFilter, search]);

  const clampedIndex = Math.min(index, Math.max(0, visibleItems.length - 1));
  const current = visibleItems[clampedIndex] ?? null;

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

  const doCopy = React.useCallback(async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(`${current.subject}\n\n${current.body}`);
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
            description:
              "„↻ Neu generieren“ klicken, damit der E-Mail-Text das Set erwähnt — der Angebots-Block selbst wird beim Versand automatisch angehängt.",
          });
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
    [current, busy, setCurrentBundle]
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
        description:
          "Falls der Text das Set erwähnt: „↻ Neu generieren“, damit die Erwähnung verschwindet.",
      });
    } catch (err) {
      toast({
        variant: "error",
        title: "Archivieren fehlgeschlagen",
        description: String((err as Error).message ?? err),
      });
    } finally {
      setBusy(null);
    }
  }, [current, busy, setCurrentBundle]);

  const doRegenerate = React.useCallback(
    async (depth: number) => {
      if (!current || busy) return;
      setBusy("regen");
      try {
        const json = (await callApi("/api/admin/campaign/draft", {
          contactId: current.contactId,
          discountPercent: depth,
          regenerate: true,
        })) as {
          draft?: {
            subject: string;
            body: string;
            discountPercent: number;
            discountExpiresAt: string | null;
            lowConfidence: boolean;
          };
        };
        if (json.draft) {
          const d = json.draft;
          patchItem(current.contactId, {
            subject: d.subject,
            body: d.body,
            discountPercent: d.discountPercent,
            discountExpiresAt: d.discountExpiresAt,
            lowConfidence: d.lowConfidence,
          });
          toast({ variant: "success", title: "Entwurf neu generiert" });
        }
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
    [current, busy, patchItem]
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
        } else {
          toast({
            variant: "success",
            title: "Empfehlungen gespeichert",
            description:
              "„↻ Neu generieren“, damit der E-Mail-Text die neuen Produkte empfiehlt.",
          });
        }
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
    [current, busy, patchItem]
  );

  /** Set the discount depth on the existing draft WITHOUT regenerating — the
   * code + deadline ship deterministically at send time. Warns when the prose
   * clearly states a different percentage (the send route blocks that). */
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
        if (json.proseMismatch) {
          toast({
            variant: "warning",
            title: "Text erwähnt einen anderen Rabatt",
            description:
              `Im Text steht ${json.prosePercents.join("/")} % — bitte „↻ Neu generieren“, ` +
              `sonst wird der Versand abgelehnt.`,
          });
        } else {
          toast({
            variant: "success",
            title:
              json.discountPercent > 0
                ? `Rabatt auf ${json.discountPercent} % gesetzt`
                : "Rabatt entfernt",
            description:
              json.discountPercent > 0
                ? "Der echte MK-Code + die Rabattzeile werden beim Versand automatisch angehängt."
                : undefined,
          });
        }
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
    [current, busy, patchItem]
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
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, visibleItems.length, doCopy, doSend, doSkip]);

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
            <RefreshCw className="me-1.5 h-3.5 w-3.5" />
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
                  onClick={() => setOptInFilter(key)}
                >
                  {label}
                </Button>
              ))}
            </span>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Kontakt suchen (E-Mail/Name)…"
              className="h-8 w-56 text-xs"
              aria-label="Kontakt suchen"
            />
            <span className="ms-auto text-xs text-muted-foreground">
              Tasten: <Kbd>N</Kbd> weiter · <Kbd>P</Kbd> zurück · <Kbd>C</Kbd> kopieren ·{" "}
              <Kbd>S</Kbd> senden · <Kbd>X</Kbd> überspringen
            </span>
          </>
        )}
      </div>

      {view === "sent" ? (
        <SentHistory history={history} />
      ) : !current ? (
        <div className="rounded-lg border border-info/30 bg-info/10 px-3.5 py-3 text-sm text-info">
          Keine Entwürfe in der Warteschlange. „Sync“ holt die Shopify-Abonnent:innen,
          „Nächste {PREPARE_TOTAL} vorbereiten“ erzeugt die Entwürfe.
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
                  <Badge variant="outline">{current.language.toUpperCase()}</Badge>
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

                <div>
                  <div className="mb-1 font-medium">Kaufhistorie</div>
                  {current.purchaseSummary && current.purchaseSummary.orders.length > 0 ? (
                    <ul className="space-y-1.5">
                      {current.purchaseSummary.orders.map((o) => (
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
                          <div className="text-xs">
                            {o.items
                              .map((i) => `${i.quantity}× ${i.title ?? "?"}`)
                              .join(", ")}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Keine Bestelldetails verfügbar.
                    </div>
                  )}
                </div>

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
                  Mo-Hinweis (Deep-Link), Rabattzeile und Abmelde-/Impressum-Footer werden
                  beim Versand automatisch angehängt und sind hier nicht editierbar.
                </p>

                {optInBlocked && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                    <strong>Erneute Einwilligung erforderlich:</strong> Für diesen Kontakt
                    liegt kein nachweisbares Double-Opt-in vor (
                    {optInShort(current.optInLevel)}). Senden ist blockiert; Kopieren ist
                    möglich.
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={doSend} disabled={sendBlocked || busy !== null}>
                    <Send className="me-1.5 h-4 w-4" />
                    {busy === "send" ? "Sendet…" : "Senden"}
                  </Button>
                  <Button variant="outline" onClick={doCopy} disabled={busy !== null}>
                    <Copy className="me-1.5 h-4 w-4" />
                    Kopieren
                  </Button>
                  {copiedId === current.contactId && (
                    <Button variant="outline" onClick={doMarkDone} disabled={busy !== null}>
                      <Check className="me-1.5 h-4 w-4" />
                      Als erledigt markieren
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => doRegenerate(current.discountPercent)}
                    disabled={busy !== null}
                  >
                    <RefreshCw className="me-1.5 h-4 w-4" />
                    {busy === "regen" ? "Generiert…" : "↻ Neu generieren"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={doSkip}
                    disabled={busy !== null}
                    className="ms-auto"
                  >
                    <SkipForward className="me-1.5 h-4 w-4" />
                    Überspringen
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
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
          Bundle-Mechanismus; der Angebots-Block wird beim Versand automatisch angehängt.
        </p>
      </div>
    </div>
  );
}

/** Editable recommendation list: remove per item, add via the shared catalog
 * search (/api/admin/catalog/search — the bundle composer's picker backend).
 * Every change persists immediately (onChange → the recommendations route,
 * which also rebuilds an attached bundle to match). */
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

  const doSearch = React.useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const json = (await callApi("/api/admin/catalog/search", { query: q })) as {
        products?: Array<{ productId: string; title: string; inStock: boolean }>;
      };
      setResults(json.products ?? []);
    } catch (err) {
      toast({
        variant: "error",
        title: "Katalogsuche fehlgeschlagen",
        description: String((err as Error).message ?? err),
      });
    } finally {
      setSearching(false);
    }
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
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void doSearch();
            }
          }}
          placeholder="Produkt suchen…"
          className="h-8 w-44 text-xs"
          aria-label="Produkt für Empfehlung suchen"
          disabled={busy}
        />
        <Button variant="outline" size="sm" onClick={doSearch} disabled={busy || !query.trim()}>
          {searching ? "Sucht…" : "Suchen"}
        </Button>
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
        Änderungen werden sofort gespeichert und ein angehängtes Set wird angepasst; „↻ Neu
        generieren“, damit der Text sie empfiehlt.
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
            {expiresAt ? ` (voraussichtlich gültig bis ${formatDate(expiresAt)})` : ""}. Auch
            ohne Neu-Generieren wirksam: Code + Ablaufdatum werden automatisch angehängt.
          </>
        ) : (
          "Kein Rabatt. Kann auch nach der Generierung gesetzt werden — Code + Rabattzeile werden beim Versand automatisch angehängt."
        )}
      </div>
    </div>
  );
}

function SentHistory({ history }: { history: CampaignHistoryItemProps[] }) {
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
