"use client";

// Header strip of the Kampagne desk — ONE line: today's progress, the view
// switch (Prüfen · Liste · Gesendet), the status pills (Versand, Shopify,
// last sync, failed drafts — the original texts sit in InfoTips), the
// „Vorbereiten…“ popover (or its progress pill while the background job runs)
// and the ⋯ menu with the rare batch actions (Sync, Neu aufbauen).

import * as React from "react";
import { Keyboard, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num, relativeTime } from "@/lib/admin-format.mjs";
import { Button, InfoTip, Menu, ProgressBar, SegmentedControl, StatusBadge } from "../ui";
import { PreparePopover } from "./PreparePopover";
import type { CampaignCostsProps, CampaignCountsProps, DeskView } from "./types";
import type { PrepareJob, PrepareSettings } from "./useCampaignActions";

export function CampaignHeader({
  counts,
  progress,
  queueSize,
  visibleSize,
  view,
  onView,
  sendsApproved,
  allowSingleOptIn,
  shopifyConfigured,
  heroDesignActive,
  heroGenerationConfigured,
  costs,
  jobBusy,
  prepareJob,
  prepareSettings,
  prepareOpen,
  onPrepareOpen,
  onPrepareSettings,
  onPrepare,
  onCancelPrepare,
  onSync,
  onReset,
  onShortcuts,
}: {
  counts: CampaignCountsProps;
  progress: { done: number; total: number; ratio: number };
  queueSize: number;
  visibleSize: number;
  view: DeskView;
  onView: (view: DeskView) => void;
  sendsApproved: boolean;
  allowSingleOptIn: boolean;
  shopifyConfigured: boolean;
  heroDesignActive: boolean;
  heroGenerationConfigured: boolean;
  costs: CampaignCostsProps;
  jobBusy: null | "sync" | "reset";
  prepareJob: PrepareJob | null;
  prepareSettings: PrepareSettings;
  prepareOpen: boolean;
  onPrepareOpen: (open: boolean) => void;
  onPrepareSettings: (patch: Partial<PrepareSettings>) => void;
  onPrepare: (settings: PrepareSettings) => void;
  onCancelPrepare: () => void;
  onSync: () => void;
  onReset: () => void;
  onShortcuts: () => void;
}) {
  const running = prepareJob !== null && prepareJob.phase !== "done";
  // A sync stamped ahead of the browser clock (skew) reads as "gerade eben".
  const syncRelative = counts.lastSyncedAt ? relativeTime(counts.lastSyncedAt) : null;
  const syncLabel =
    syncRelative === null
      ? "Sync: nie"
      : syncRelative === "gleich" || syncRelative.startsWith("in ")
        ? "Sync gerade eben"
        : `Sync ${syncRelative}`;
  const optIn = Object.entries(counts.byOptInLevel);

  // Two rows below 2xl (progress · switch · actions / pills), one row at 2xl.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-3 py-2">
      {/* Today's progress */}
      <div className="order-1 flex items-center gap-2 text-sm">
        <span className="whitespace-nowrap tabular-nums">
          <strong>{num(progress.done)}</strong> <span className="text-muted-foreground">gesendet</span>
          <span className="text-muted-foreground"> · </span>
          <strong>{num(queueSize)}</strong> <span className="text-muted-foreground">zu prüfen</span>
        </span>
        <ProgressBar
          value={progress.ratio * 100}
          label="Fortschritt des Tages"
          tone={progress.total > 0 && progress.done === progress.total ? "success" : "accent"}
          className="w-24"
        />
        <InfoTip>
          Heute gesendete Kampagnen-E-Mails gegenüber den Entwürfen, die noch in der
          Warteschlange liegen. Der Balken endet bei der Tagesmenge — kein festes Ziel.
          {counts.pending > 0 && (
            <>
              {" "}
              Dazu {num(counts.pending)} offene Kontakte ohne Entwurf ({num(counts.pendingSendable)} im
              Sendefenster), {num(counts.skipped)} übersprungen, {num(counts.suppressed)} unterdrückt.
            </>
          )}
          {optIn.length > 0 && (
            <>
              {" "}
              Opt-in: {optIn.map(([level, n]) => `${level === "CONFIRMED_OPT_IN" ? "DOI" : level === "SINGLE_OPT_IN" ? "Single-Opt-in" : "Unbekannt"} ${num(n)}`).join(" · ")}.
              Nur Double-Opt-in (DOI) ist ohne weitere Freigabe versendbar; Single-Opt-in und
              Unbekannt werden blockiert, solange CAMPAIGN_ALLOW_SINGLE_OPT_IN nicht gesetzt ist.
            </>
          )}
        </InfoTip>
      </div>

      {/* View switch */}
      <SegmentedControl
        className="order-2"
        label="Ansicht"
        value={view}
        onChange={onView}
        options={[
          {
            value: "pruefen",
            label: `Prüfen${visibleSize !== queueSize ? ` ${num(visibleSize)}/${num(queueSize)}` : ""}`,
          },
          { value: "liste", label: "Liste" },
          { value: "gesendet", label: `Gesendet ${num(counts.sentTotal)}` },
        ]}
      />

      {/* Status pills */}
      <div className="order-4 flex basis-full flex-wrap items-center gap-1.5 2xl:order-3 2xl:ml-auto 2xl:basis-auto">
        <span className="inline-flex items-center gap-0.5">
          <StatusBadge tone={sendsApproved ? "success" : "destructive"}>
            {sendsApproved ? "Versand freigegeben" : "Versand gesperrt"}
          </StatusBadge>
          <InfoTip>
            {sendsApproved ? (
              <>
                CAMPAIGN_SENDS_APPROVED ist gesetzt — der Server nimmt Sendungen an. Jede
                Sendung durchläuft trotzdem die Gates: Opt-in-Stufe
                {allowSingleOptIn ? " (Single-Opt-in freigegeben)" : " (nur Double-Opt-in)"},
                Unterdrückungsliste, Sperrfrist, Rabatt-Prüfung.
              </>
            ) : (
              <>
                Die anwaltliche Freigabe für diesen Kanal steht aus (CAMPAIGN_SENDS_APPROVED=false).
                Entwürfe, Vorschau und Kopieren funktionieren; der Senden-Button bleibt deaktiviert
                und der Server lehnt jeden Versand ab.
              </>
            )}
          </InfoTip>
        </span>
        <span className="inline-flex items-center gap-0.5">
          <StatusBadge tone={shopifyConfigured ? "success" : "warning"}>
            {shopifyConfigured ? "Shopify" : "Shopify fehlt"}
          </StatusBadge>
          <InfoTip>
            {shopifyConfigured
              ? "Shopify ist verbunden — Sync, Kaufhistorie, Set-Angebote und Rabattcodes stehen zur Verfügung."
              : "Shopify ist nicht konfiguriert — Sync, Kaufhistorie und Rabattcodes sind deaktiviert."}
          </InfoTip>
        </span>
        <span className="inline-flex items-center gap-0.5">
          <StatusBadge tone="neutral" dot={false}>
            {syncLabel}
          </StatusBadge>
          <InfoTip>
            Letzter Abgleich der Shopify-Abonnent:innen:{" "}
            {counts.lastSyncedAt ? formatAdmin(counts.lastSyncedAt, ADMIN_DATE_TIME_SHORT) : "noch nie"}.
            Der Sync läuft nächtlich automatisch (Cron) und über „Jetzt synchronisieren“ im Menü.
          </InfoTip>
        </span>
        {counts.draftFailed > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <StatusBadge tone="warning">{num(counts.draftFailed)} fehlgeschlagen</StatusBadge>
            <InfoTip>
              Bei {num(counts.draftFailed)} Kontakten ist die Entwurfs-Generierung fehlgeschlagen. Sie
              werden nicht automatisch wiederholt — über die Kontaktsuche „Entwurf erstellen“ wählen.
            </InfoTip>
          </span>
        )}
      </div>

      {/* Vorbereiten + ⋯ */}
      <div className="order-3 ml-auto flex items-center gap-2 2xl:order-4 2xl:ml-0">
      {running && prepareJob ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ProgressBar
            value={
              prepareJob.phase === "heroes"
                ? prepareJob.heroTotal > 0
                  ? (prepareJob.heroDone / prepareJob.heroTotal) * 100
                  : 100
                : prepareJob.total > 0
                  ? (prepareJob.done / prepareJob.total) * 100
                  : 0
            }
            label="Fortschritt der Vorbereitung"
            className="w-20"
          />
          <span className="tabular-nums">
            {prepareJob.phase === "heroes"
              ? `Hero ${num(prepareJob.heroDone)}/${num(prepareJob.heroTotal)}`
              : `${num(Math.min(prepareJob.done, prepareJob.total))}/${num(prepareJob.total)} · ${num(prepareJob.prepared)} erstellt`}
            {prepareJob.failed > 0 ? `, ${num(prepareJob.failed)} fehlgeschlagen` : ""}
          </span>
          <Button variant="ghost" size="xs" onClick={onCancelPrepare}>
            <X /> Abbrechen
          </Button>
        </div>
      ) : (
        <PreparePopover
          open={prepareOpen}
          onOpenChange={onPrepareOpen}
          counts={counts}
          costs={costs}
          settings={prepareSettings}
          onSettings={onPrepareSettings}
          heroOffered={heroDesignActive && heroGenerationConfigured}
          disabled={jobBusy !== null}
          onStart={(settings) => {
            onPrepareOpen(false);
            onPrepare(settings);
          }}
          trigger={
            <Button size="sm" disabled={jobBusy !== null}>
              <Sparkles /> Vorbereiten…
            </Button>
          }
        />
      )}

      <Menu
        label="Weitere Aktionen"
        size="sm"
        items={[
          {
            key: "sync",
            label: jobBusy === "sync" ? "Synchronisiert…" : "Jetzt synchronisieren",
            icon: <RefreshCw />,
            onSelect: onSync,
            disabled: !shopifyConfigured || jobBusy !== null,
            disabledReason: !shopifyConfigured ? "Shopify nicht konfiguriert" : undefined,
          },
          {
            key: "shortcuts",
            label: "Tastenkürzel",
            icon: <Keyboard />,
            shortcut: "?",
            onSelect: onShortcuts,
          },
          {
            key: "reset",
            label: "Warteschlange neu aufbauen",
            icon: <RotateCcw />,
            tone: "destructive",
            separatorBefore: true,
            onSelect: onReset,
            disabled: queueSize === 0 || jobBusy !== null || running,
            disabledReason: queueSize === 0 ? "Keine offenen Entwürfe" : undefined,
          },
        ]}
      />
      </div>
    </div>
  );
}
