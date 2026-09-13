"use client";

// The Kampagne review desk — optimised for one person clearing 100–200 e-mails
// a day: three columns under one thin header (rail · mail · Prüfung), the
// rendered e-mail at the centre from the first paint, a precomputed verdict
// per card, one primary action on one key, and nothing that blocks the next
// card. State + mutations live in useCampaignActions; this file composes the
// header, the three views (Prüfen · Liste · Gesendet), the Fokus-Modus, the
// keyboard shortcuts and the dialogs.
//
//   Shortcuts (Prüfen view, not while typing, no dialog open, no modifier):
//   N/P (J/K) next/previous · S send · X skip · E edit / Esc back ·
//   R regenerate · V full-size preview · C copy · F Fokus-Modus ·
//   / contact search · ? this list

import * as React from "react";
import { Inbox, RefreshCw, Sparkles } from "lucide-react";
import { num } from "@/lib/admin-format.mjs";
import { Button, ConfirmDialog, EmptyState, Kbd, Sheet, cn } from "../ui";
import { CampaignHeader } from "./CampaignHeader";
import { ContactHistorySheet } from "./ContactHistorySheet";
import { EmailViewerDialog } from "./EmailViewerDialog";
import { ListView } from "./ListView";
import { MailPane } from "./MailPane";
import { QueueRail, RAIL_SEARCH_ID } from "./QueueRail";
import { ReviewColumn } from "./ReviewColumn";
import { SentHistory } from "./SentHistory";
import type { CampaignDeskProps } from "./types";
import { useCampaignActions } from "./useCampaignActions";
import { usePrefetchPreview } from "./useRenderedPreview";

const SHORTCUTS: Array<[string, string]> = [
  ["N / P", "Nächster / vorheriger Entwurf (auch J / K)"],
  ["S", "Senden und weiter (nur wenn nicht blockiert)"],
  ["X", "Überspringen und weiter (rückgängig über „Übersprungen“)"],
  ["E / Esc", "Betreff und Text bearbeiten / zurück zur Ansicht"],
  ["R", "Neu generieren mit den aktuellen Einstellungen"],
  ["V", "Vorschau in voller Größe (Desktop / Mobil)"],
  ["C", "Betreff und Text kopieren"],
  ["F", "Fokus-Modus ein / aus"],
  ["/", "Kontakt suchen"],
  ["?", "Diese Liste"],
  ["1 … 9, 0", "Bereich wechseln (wie in der Seitenleiste)"],
];

function isTyping(el: HTMLElement | null): boolean {
  const tag = el?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(el?.isContentEditable);
}

function overlayOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]') !== null;
}

export function KampagneWorkspace(props: CampaignDeskProps) {
  const {
    shopifyConfigured,
    heroDesignActive,
    heroDesignName,
    heroGenerationConfigured,
    minSendIntervalDays,
    costs,
    sentSummary,
  } = props;
  const a = useCampaignActions(props);
  const { current, visibleItems, items, view, focusMode, editMode } = a;
  const [prepareOpen, setPrepareOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const subjectRef = React.useRef<HTMLInputElement>(null);

  // Warm the renderer for the card the operator opens next.
  usePrefetchPreview(a.nextItem, view === "pruefen");

  // ---- keyboard shortcuts (capture phase: the desk owns `/` here) ----------
  const { next, prev, send, skip, regenerate, previewItem, copy, setEditMode, setFocusMode, setView } = a;
  const currentId = current?.contactId ?? null;
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target as HTMLElement | null)) {
        // Esc leaves the editor even from inside the textarea.
        if (e.key === "Escape" && editMode && !overlayOpen()) {
          e.preventDefault();
          setEditMode(false);
          (e.target as HTMLElement).blur();
        }
        return;
      }
      if (overlayOpen()) return;
      const k = e.key;
      if (k === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (k === "/") {
        e.preventDefault();
        if (view !== "pruefen") setView("pruefen");
        requestAnimationFrame(() => document.getElementById(RAIL_SEARCH_ID)?.focus());
        return;
      }
      if (view !== "pruefen") return;
      const lower = k.toLowerCase();
      if (lower === "n" || lower === "j") {
        e.preventDefault();
        next();
      } else if (lower === "p" || lower === "k") {
        e.preventDefault();
        prev();
      } else if (lower === "s" && currentId !== null) {
        e.preventDefault();
        send(currentId);
      } else if (lower === "x" && currentId !== null) {
        e.preventDefault();
        void skip(currentId);
      } else if (lower === "e" && currentId !== null) {
        e.preventDefault();
        setEditMode(true);
      } else if (k === "Escape") {
        if (editMode) {
          e.preventDefault();
          setEditMode(false);
        } else if (focusMode) {
          e.preventDefault();
          setFocusMode(false);
        }
      } else if (lower === "r" && currentId !== null) {
        e.preventDefault();
        regenerate(currentId);
      } else if (lower === "v" && currentId !== null) {
        e.preventDefault();
        previewItem(currentId);
      } else if (lower === "c" && currentId !== null) {
        e.preventDefault();
        void copy(currentId);
      } else if (lower === "f") {
        e.preventDefault();
        setFocusMode(!focusMode);
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [view, currentId, editMode, focusMode, next, prev, send, skip, regenerate, previewItem, copy, setEditMode, setFocusMode, setView]);

  const focusSubject = React.useCallback(() => {
    subjectRef.current?.focus();
    subjectRef.current?.select();
  }, []);

  const emptyQueue = (
    <div className="flex min-h-[20rem] items-center justify-center rounded-lg border border-border bg-card p-6 lg:h-full">
      <EmptyState
        plain
        icon={<Inbox />}
        title={items.length === 0 ? "Keine Entwürfe in der Warteschlange" : "Nichts in diesem Filter"}
        description={
          items.length === 0
            ? "„Vorbereiten…“ erzeugt die Entwürfe der nächsten offenen Kontakte, „Jetzt synchronisieren“ holt die Shopify-Abonnent:innen — oder über die Kontaktsuche links eine:n einzelne:n Kund:in aufnehmen."
            : "Einen anderen Filter wählen oder „Alle“."
        }
        action={
          items.length === 0 ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => setPrepareOpen(true)} disabled={a.jobBusy !== null}>
                <Sparkles /> Vorbereiten…
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={a.sync}
                loading={a.jobBusy === "sync"}
                disabled={a.jobBusy !== null || !shopifyConfigured}
              >
                <RefreshCw /> Jetzt synchronisieren
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => a.setFilter("all")}>
              Alle anzeigen
            </Button>
          )
        }
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <CampaignHeader
        counts={a.counts}
        progress={a.progress}
        queueSize={items.length}
        visibleSize={visibleItems.length}
        view={view}
        onView={setView}
        sendsApproved={props.sendsApproved}
        allowSingleOptIn={props.allowSingleOptIn}
        shopifyConfigured={shopifyConfigured}
        heroDesignActive={heroDesignActive}
        heroGenerationConfigured={heroGenerationConfigured}
        costs={costs}
        jobBusy={a.jobBusy}
        prepareJob={a.prepareJob}
        prepareSettings={a.prepareSettings}
        prepareOpen={prepareOpen}
        onPrepareOpen={setPrepareOpen}
        onPrepareSettings={a.setPrepareSettings}
        onPrepare={(settings) => void a.prepare(settings)}
        onCancelPrepare={a.cancelPrepare}
        onSync={a.sync}
        onReset={() => a.setResetOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
      />

      {view === "gesendet" ? (
        <SentHistory initialTotal={a.counts.sentTotal} summary={sentSummary} viewBusy={a.emailViewBusy} onView={a.viewSent} />
      ) : view === "liste" ? (
        <ListView
          items={items}
          checksOf={a.checksOf}
          verdictOf={a.verdictOf}
          busyIds={a.busyById}
          heroDesignActive={heroDesignActive}
          costs={costs}
          bulkProgress={a.bulkProgress}
          onOpen={a.jumpToContact}
          onBulkSkip={a.bulkSkip}
          onBulkRegenerate={a.bulkRegenerate}
        />
      ) : (
        <div
          className={cn(
            "flex flex-col gap-3 lg:grid lg:h-[calc(100vh-11.75rem)] lg:min-h-[34rem] 2xl:h-[calc(100vh-9.5rem)]",
            focusMode
              ? "lg:grid-cols-[minmax(0,1fr)]"
              : "lg:grid-cols-[200px_minmax(0,1fr)_260px] xl:grid-cols-[236px_minmax(0,1fr)_296px]"
          )}
        >
          {!focusMode && (
            <QueueRail
              items={visibleItems}
              currentContactId={currentId}
              filter={a.filter}
              filterCounts={a.filterCounts}
              verdictOf={a.verdictOf}
              busyIds={a.busyById}
              outbox={a.outbox}
              skipped={a.skippedList}
              restoring={a.restoring}
              onFilter={a.setFilter}
              onSelect={a.select}
              onUnskip={(id) => void a.unskip(id)}
              onDraft={(id) => void a.draftContact(id)}
              onRetrySend={a.retrySend}
              onDismissOutbox={a.dismissOutbox}
            />
          )}
          <div className={cn("min-h-0 min-w-0", focusMode && "mx-auto w-full max-w-[720px]")}>
            {current ? (
              <MailPane
                key={current.contactId}
                item={current}
                position={a.currentIndex + 1}
                total={visibleItems.length}
                actions={a}
                focusMode={focusMode}
                subjectRef={subjectRef}
                onShortcuts={() => setShortcutsOpen(true)}
                onHistory={() => setHistoryOpen(true)}
              />
            ) : (
              emptyQueue
            )}
          </div>
          {!focusMode && current && (
            <ReviewColumn
              key={`review-${current.contactId}`}
              item={current}
              checks={a.currentChecks}
              verdict={a.currentVerdict}
              actions={a}
              shopifyConfigured={shopifyConfigured}
              heroDesignActive={heroDesignActive}
              heroDesignName={heroDesignName}
              heroGenerationConfigured={heroGenerationConfigured}
              minSendIntervalDays={minSendIntervalDays}
              onFocusSubject={focusSubject}
              onHistory={() => setHistoryOpen(true)}
            />
          )}
          {!focusMode && !current && <div className="hidden lg:block" />}
        </div>
      )}

      <ConfirmDialog
        open={a.resetOpen}
        options={{
          title: "Warteschlange neu aufbauen?",
          description: `Alle ${num(items.length)} offenen Entwürfe werden verworfen — auch manuelle Änderungen an Betreff/Text gehen verloren. Die Kontakte werden wieder „Offen“ und mit „Vorbereiten…“ neu generiert (erneute API-Kosten). Gesendete, übersprungene und unterdrückte Kontakte sowie angehängte Set-Angebote bleiben unberührt.`,
          confirmLabel: "Entwürfe verwerfen",
          tone: "destructive",
        }}
        onClose={(ok) => (ok ? void a.resetQueue() : a.setResetOpen(false))}
      />

      <ConfirmDialog
        open={a.confirmSendId !== null}
        options={{
          title: "Ersten Versand heute bestätigen",
          description: `Du startest den heutigen Kampagnen-Versand: Die E-Mail geht an ${
            items.find((it) => it.contactId === a.confirmSendId)?.email ?? "—"
          }. Weitere Sendungen heute werden nicht mehr einzeln bestätigt.`,
          confirmLabel: "Jetzt senden",
        }}
        onClose={(ok) => (ok ? a.confirmAndSend() : a.setConfirmSendId(null))}
      />

      <EmailViewerDialog view={a.emailView} onClose={a.closeEmailView} />

      {current && (
        <ContactHistorySheet
          email={current.email}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          viewBusy={a.emailViewBusy}
          onView={a.viewSent}
        />
      )}

      <Sheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} title="Tastenkürzel" size="sm">
        <dl className="flex flex-col gap-2 text-sm">
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys} className="flex items-start gap-3">
              <dt className="flex w-24 shrink-0 flex-wrap gap-1">
                {keys.split(" / ").map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dt>
              <dd className="text-muted-foreground">{label}</dd>
            </div>
          ))}
        </dl>
      </Sheet>
    </div>
  );
}
