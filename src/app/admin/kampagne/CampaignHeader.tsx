"use client";

// Header strip of the Kampagne desk — the campaign switcher (which campaign
// this desk works on, 0066), today's progress, the view switch (Prüfen ·
// Liste · Gesendet), the status pills (Versand, Zeitraum, Zielgruppe, failed
// drafts — the original texts sit in InfoTips), the „Vorbereiten…“ popover
// (or its progress pill while the background job runs) and the ⋯ menu with
// the rare batch actions (Zielgruppe aktualisieren, Bearbeiten, Neu aufbauen).

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, FlaskConical, Keyboard, LayoutGrid, Pencil, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { ADMIN_DATE, ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { CAMPAIGN_KIND_LABELS, CAMPAIGN_PHASE_LABELS } from "@/lib/campaign-def.mjs";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import { num, relativeTime } from "@/lib/admin-format.mjs";
import { Button, InfoTip, Menu, ProgressBar, SegmentedControl, StatusBadge } from "../ui";
import { PreparePopover } from "./PreparePopover";
import type { CampaignCostsProps, CampaignCountsProps, CampaignDeskCampaign, CampaignSwitchItem, DeskView } from "./types";
import type { PrepareJob, PrepareSettings } from "./useCampaignActions";

const PHASE_TONE: Record<string, "success" | "warning" | "neutral" | "destructive"> = {
  laeuft: "success",
  geplant: "warning",
  abgelaufen: "destructive",
  pausiert: "warning",
  entwurf: "neutral",
  beendet: "neutral",
  archiviert: "neutral",
};

export function CampaignHeader({
  campaign,
  campaigns,
  counts,
  progress,
  queueSize,
  visibleSize,
  view,
  onView,
  scheduledCount,
  releaseEnabled,
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
  onTestContacts,
}: {
  campaign: CampaignDeskCampaign;
  campaigns: CampaignSwitchItem[];
  counts: CampaignCountsProps;
  progress: { done: number; total: number; ratio: number };
  queueSize: number;
  visibleSize: number;
  view: DeskView;
  onView: (view: DeskView) => void;
  /** Approved mails waiting for the release job („Einplanen“). */
  scheduledCount: number;
  releaseEnabled: boolean;
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
  onTestContacts: () => void;
}) {
  const router = useRouter();
  const running = prepareJob !== null && prepareJob.phase !== "done";
  // A refresh stamped ahead of the browser clock (skew) reads as "gerade eben".
  const refreshedAt = campaign.audienceRefreshedAt ?? counts.lastSyncedAt;
  const syncRelative = refreshedAt ? relativeTime(refreshedAt) : null;
  const syncLabel =
    campaign.kind === "einzel"
      ? "Einzeln aufgenommen"
      : syncRelative === null
        ? "Zielgruppe: nie"
        : syncRelative === "gleich" || syncRelative.startsWith("in ")
          ? "Zielgruppe gerade eben"
          : `Zielgruppe ${syncRelative}`;
  const optIn = Object.entries(counts.byOptInLevel);
  const phaseLabel = CAMPAIGN_PHASE_LABELS[campaign.phase as keyof typeof CAMPAIGN_PHASE_LABELS] ?? campaign.phase;

  // Two rows below 2xl (progress · switch · actions / pills), one row at 2xl.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-3 py-2">
      {/* Which campaign */}
      <div className="order-first flex min-w-0 items-center gap-1.5">
        <Menu
          label="Kampagne wechseln"
          size="sm"
          trigger={
            <Button variant="ghost" size="sm" className="max-w-[16rem] font-semibold">
              <span className="truncate">{campaign.name}</span>
              <ChevronDown />
            </Button>
          }
          items={[
            ...campaigns.map((c) => ({
              key: `c-${c.id}`,
              label: `${c.name}${c.drafted > 0 ? ` · ${num(c.drafted)}` : ""}`,
              onSelect: () => router.push(adminTabHref("kampagne", { campaign: c.slug })),
              disabled: c.id === campaign.id,
            })),
            {
              key: "all",
              label: "Alle Kampagnen",
              icon: <LayoutGrid />,
              separatorBefore: true,
              onSelect: () => router.push(adminTabHref("kampagne")),
            },
          ]}
        />
        <StatusBadge tone={PHASE_TONE[campaign.phase] ?? "neutral"}>{phaseLabel}</StatusBadge>
        <InfoTip>
          {CAMPAIGN_KIND_LABELS[campaign.kind]}. {campaign.audienceText}.
          {campaign.startsAt && <> Start {formatAdmin(campaign.startsAt, ADMIN_DATE)}.</>}
          {campaign.endsAt && <> Ende {formatAdmin(campaign.endsAt, ADMIN_DATE)}.</>}
          {campaign.phase === "geplant" &&
            " Bis zum Start gehen keine Mails an Kund:innen — Vorbereiten und Testkontakte funktionieren schon."}
          {(campaign.phase === "entwurf" || campaign.phase === "pausiert") &&
            " Die Kampagne läuft nicht: es gehen keine Mails hinaus, und Entwürfe lassen sich erst nach dem Start vorbereiten."}
        </InfoTip>
      </div>

      {/* Today's progress */}
      <div className="order-1 flex items-center gap-2 text-sm">
        <span className="whitespace-nowrap tabular-nums">
          <strong>{num(progress.done)}</strong> <span className="text-muted-foreground">gesendet</span>
          <span className="text-muted-foreground"> · </span>
          <strong>{num(queueSize)}</strong> <span className="text-muted-foreground">zu prüfen</span>
          {campaign.dailyTarget != null && campaign.dailyTarget > 0 && (
            <>
              <span className="text-muted-foreground"> · </span>
              <span className="text-muted-foreground">Tagesziel</span> <strong>{num(campaign.dailyTarget)}</strong>
            </>
          )}
        </span>
        <ProgressBar
          value={progress.ratio * 100}
          label="Fortschritt des Tages"
          tone={progress.total > 0 && progress.done === progress.total ? "success" : "accent"}
          className="w-24"
        />
        <InfoTip>
          Heute gesendete Kampagnen-E-Mails gegenüber den Entwürfen, die noch in der
          Warteschlange liegen. Der Balken endet bei der Tagesmenge
          {campaign.dailyTarget != null && campaign.dailyTarget > 0 ? "; das Tagesziel stammt aus der Kampagne." : " — kein festes Ziel."}
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
          ...(releaseEnabled || scheduledCount > 0
            ? [{ value: "eingeplant" as const, label: `Eingeplant ${num(scheduledCount)}` }]
            : []),
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
              ? "Shopify ist verbunden — Kaufhistorie, Set-Angebote und Rabattcodes stehen zur Verfügung."
              : "Shopify ist nicht konfiguriert — Rabattcodes und Set-Angebote sind deaktiviert."}
          </InfoTip>
        </span>
        <span className="inline-flex items-center gap-0.5">
          <StatusBadge tone="neutral" dot={false}>
            {syncLabel}
          </StatusBadge>
          <InfoTip>
            {campaign.kind === "einzel" ? (
              "Die Einzelansprache hat keine Zielgruppe — Personen kommen einzeln aus Kunden oder dem Eingang dazu."
            ) : (
              <>
                Letzter Abgleich der Zielgruppe mit der Kundenbasis:{" "}
                {refreshedAt ? formatAdmin(refreshedAt, ADMIN_DATE_TIME_SHORT) : "noch nie"}. Nur Kund:innen mit
                Einwilligung in E-Mail-Werbung kommen in die Kampagne. Der Abgleich läuft nächtlich und
                über „Zielgruppe aktualisieren“ im Menü.
              </>
            )}
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
          heroOffered={
            heroDesignActive && heroGenerationConfigured && (campaign.heroMode === "ai_ab" || campaign.heroMode === "ai_all")
          }
          heroForAll={campaign.heroMode === "ai_all"}
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
            label: jobBusy === "sync" ? "Wird aktualisiert…" : "Zielgruppe aktualisieren",
            icon: <RefreshCw />,
            onSelect: onSync,
            disabled: campaign.kind === "einzel" || jobBusy !== null,
            disabledReason: campaign.kind === "einzel" ? "Einzelansprache hat keine Zielgruppe" : undefined,
          },
          {
            key: "edit",
            label: "Kampagne bearbeiten",
            icon: <Pencil />,
            onSelect: () => router.push(adminTabHref("kampagne", { edit: String(campaign.id) })),
          },
          {
            key: "test",
            label: "Testkontakte…",
            icon: <FlaskConical />,
            onSelect: onTestContacts,
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
