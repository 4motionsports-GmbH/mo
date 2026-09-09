"use client";

// Kampagne review workspace — optimised for one person clearing ~200 emails a
// day: one contact at a time, keyboard-driven, <2 clicks per email on the happy
// path. State + mutations live in useCampaignActions; this file composes the
// header, the Warteschlange / Gesendet views and the dialogs.
//
//   Shortcuts (queue view, not while typing, no dialog open, no modifier):
//   N/P next/previous · V preview · C copy · S send (only when allowed) · X skip

import * as React from "react";
import { Inbox } from "lucide-react";
import { num } from "@/lib/admin-format.mjs";
import {
  Callout,
  ConfirmDialog,
  EmptyState,
  Kbd,
  SegmentedControl,
  SplitPane,
  Tabs,
  TabsList,
  TabsTrigger,
} from "../ui";
import { CampaignHeader } from "./CampaignHeader";
import { EmailViewerDialog } from "./EmailViewerDialog";
import { QueueRail } from "./QueueRail";
import { ReviewCard } from "./ReviewCard";
import { SentHistory } from "./SentHistory";
import {
  PREPARE_TOTAL,
  type CampaignCountsProps,
  type CampaignQueueItemProps,
  type CampaignSkippedItemProps,
  type OptInFilter,
} from "./types";
import { useCampaignActions } from "./useCampaignActions";

const OPT_IN_OPTIONS: Array<{ value: OptInFilter; label: string }> = [
  { value: "all", label: "Alle" },
  { value: "doi", label: "Nur DOI" },
  { value: "soi", label: "Nur Single/Unbekannt" },
];

export function KampagneWorkspace({
  counts,
  queue,
  skipped,
  sendsApproved,
  allowSingleOptIn,
  shopifyConfigured,
}: {
  counts: CampaignCountsProps;
  queue: CampaignQueueItemProps[];
  skipped: CampaignSkippedItemProps[];
  sendsApproved: boolean;
  allowSingleOptIn: boolean;
  shopifyConfigured: boolean;
}) {
  const a = useCampaignActions({ queue, skipped, sendsApproved, allowSingleOptIn });
  const [view, setView] = React.useState<"queue" | "sent">("queue");
  const { current, visibleItems, items } = a;

  const abSplit = React.useMemo(() => {
    let withHero = 0;
    for (const it of items) if (it.contactId % 2 === 0) withHero++;
    return { withHero, without: items.length - withHero };
  }, [items]);

  // ---- keyboard shortcuts --------------------------------------------------
  const { doCopy, doSend, doSkip, doPreview, next, prev, emailView, confirmOpen, resetOpen } = a;
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (view !== "queue") return;
      // No review shortcuts while a dialog is open (S must never send blind).
      if (emailView || confirmOpen || resetOpen) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        next();
      } else if (k === "p") {
        e.preventDefault();
        prev();
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
  }, [view, doCopy, doSend, doSkip, doPreview, next, prev, emailView, confirmOpen, resetOpen]);

  return (
    <div className="flex flex-col gap-4">
      {!sendsApproved && (
        <Callout tone="warning" title="Versand gesperrt">
          Die anwaltliche Freigabe für diesen Kanal steht aus (<code>CAMPAIGN_SENDS_APPROVED=false</code>).
          Entwürfe, Vorschau und Kopieren funktionieren; der Senden-Button bleibt deaktiviert und der
          Server lehnt jeden Versand ab.
        </Callout>
      )}
      {!shopifyConfigured && (
        <Callout tone="info">
          Shopify ist nicht konfiguriert — Sync, Kaufhistorie und Rabattcodes sind deaktiviert.
        </Callout>
      )}

      <CampaignHeader
        counts={counts}
        abSplit={abSplit}
        busy={a.busy}
        shopifyConfigured={shopifyConfigured}
        queueEmpty={items.length === 0}
        prepareDepth={a.prepareDepth}
        prepareTextMode={a.prepareTextMode}
        prepareProgress={a.prepareProgress}
        onPrepareDepth={a.setPrepareDepth}
        onPrepareTextMode={a.setPrepareTextMode}
        onSync={a.doSync}
        onPrepare={a.doPrepare}
        onCancelPrepare={a.cancelPrepare}
        onReset={() => a.setResetOpen(true)}
      />

      <Tabs value={view} onValueChange={(v) => setView(v === "sent" ? "sent" : "queue")}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <TabsList variant="underline">
            <TabsTrigger
              value="queue"
              badge={`${num(visibleItems.length)}${visibleItems.length !== items.length ? `/${num(items.length)}` : ""}`}
            >
              Warteschlange
            </TabsTrigger>
            <TabsTrigger value="sent" badge={num(counts.sentTotal)}>
              Gesendet
            </TabsTrigger>
          </TabsList>
          {view === "queue" && (
            <div className="flex flex-wrap items-center gap-3 pb-1">
              <SegmentedControl
                label="Opt-in-Filter"
                value={a.optInFilter}
                onChange={a.applyOptInFilter}
                options={OPT_IN_OPTIONS}
              />
              <span className="hidden items-center gap-1 text-xs text-muted-foreground xl:flex">
                <Kbd>N</Kbd> weiter · <Kbd>P</Kbd> zurück · <Kbd>V</Kbd> Vorschau · <Kbd>C</Kbd> kopieren ·{" "}
                <Kbd>S</Kbd> senden · <Kbd>X</Kbd> überspringen
              </span>
            </div>
          )}
        </div>
      </Tabs>

      {view === "sent" ? (
        <SentHistory initialTotal={counts.sentTotal} viewBusy={a.emailViewBusy} onView={a.doViewSent} />
      ) : (
        <SplitPane
          listWidth="sm"
          listLabel="Warteschlange"
          stickyTopClassName="lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)]"
          list={
            <QueueRail
              items={visibleItems}
              currentContactId={current?.contactId ?? null}
              skipped={a.skippedList}
              busy={a.busy !== null}
              onJump={a.jumpToContact}
              onUnskip={a.doUnskip}
              onDraft={a.doDraftContact}
            />
          }
          detail={
            current ? (
              <ReviewCard
                key={current.contactId}
                current={current}
                position={a.clampedIndex + 1}
                total={visibleItems.length}
                shopifyConfigured={shopifyConfigured}
                actions={a}
              />
            ) : (
              <EmptyState
                icon={<Inbox />}
                title="Keine Entwürfe in der Warteschlange"
                description={`„Sync“ holt die Shopify-Abonnent:innen, „Nächste ${PREPARE_TOTAL} vorbereiten“ erzeugt die Entwürfe — oder über die Kontaktsuche links eine:n einzelne:n Kund:in aufnehmen.`}
                className="min-h-[16rem]"
              />
            )
          }
        />
      )}

      <ConfirmDialog
        open={a.resetOpen}
        options={{
          title: "Warteschlange neu aufbauen?",
          description: `Alle ${num(items.length)} offenen Entwürfe werden verworfen — auch manuelle Änderungen an Betreff/Text gehen verloren. Die Kontakte werden wieder „Offen“ und mit „Nächste ${PREPARE_TOTAL} vorbereiten“ neu generiert (erneute API-Kosten). Gesendete, übersprungene und unterdrückte Kontakte sowie angehängte Set-Angebote bleiben unberührt.`,
          confirmLabel: "Entwürfe verwerfen",
          tone: "destructive",
        }}
        onClose={(ok) => (ok ? void a.doResetQueue() : a.setResetOpen(false))}
      />

      <ConfirmDialog
        open={a.confirmOpen}
        options={{
          title: "Ersten Versand heute bestätigen",
          description: `Du startest den heutigen Kampagnen-Versand: Die E-Mail geht an ${current?.email ?? "—"}. Weitere Sendungen heute werden nicht mehr einzeln bestätigt.`,
          confirmLabel: "Jetzt senden",
        }}
        onClose={(ok) => (ok ? void a.confirmAndSend() : a.setConfirmOpen(false))}
      />

      <EmailViewerDialog view={a.emailView} onClose={a.closeEmailView} />
    </div>
  );
}
