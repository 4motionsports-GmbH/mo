"use client";

// Header of the Kampagne screen: a stat strip (queue counts, opt-in mix, hero
// A/B split of the current queue) and the toolbar (Sync, defaults for new
// drafts, Prepare with inline progress, Rebuild).

import * as React from "react";
import { RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { EMAIL_TEXT_MODE_LABELS } from "@/lib/email-text-mode.mjs";
import { clampDiscountPercent } from "@/lib/discount-validation.mjs";
import { num } from "@/lib/admin-format.mjs";
import { Button, FilterGroup, InfoTip, ProgressBar, Select, Tooltip } from "../ui";
import type { EmailTextModeValue } from "../EmailTextModeToggle";
import { PREPARE_TOTAL, optInShort, type CampaignBusy, type CampaignCountsProps } from "./types";
import type { PrepareProgress } from "./useCampaignActions";

function HeaderStat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <span className={`inline-flex items-baseline gap-1 ${warn ? "text-warning" : ""}`}>
      <strong className="text-base tabular-nums">{num(value)}</strong>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

export function CampaignHeader({
  counts,
  abSplit,
  busy,
  shopifyConfigured,
  queueEmpty,
  prepareDepth,
  prepareTextMode,
  prepareProgress,
  onPrepareDepth,
  onPrepareTextMode,
  onSync,
  onPrepare,
  onCancelPrepare,
  onReset,
}: {
  counts: CampaignCountsProps;
  abSplit: { withHero: number; without: number };
  busy: CampaignBusy;
  shopifyConfigured: boolean;
  queueEmpty: boolean;
  prepareDepth: number;
  prepareTextMode: EmailTextModeValue;
  prepareProgress: PrepareProgress | null;
  onPrepareDepth: (depth: number) => void;
  onPrepareTextMode: (mode: EmailTextModeValue) => void;
  onSync: () => void;
  onPrepare: () => void;
  onCancelPrepare: () => void;
  onReset: () => void;
}) {
  const optIn = Object.entries(counts.byOptInLevel);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <HeaderStat label="Offen" value={counts.pending} />
        <HeaderStat label="Entwürfe" value={counts.drafted} />
        <HeaderStat label="Heute gesendet" value={counts.sentToday} />
        <HeaderStat label="Übersprungen" value={counts.skipped} />
        <HeaderStat label="Unterdrückt" value={counts.suppressed} />
        {counts.draftFailed > 0 && (
          <HeaderStat label="Entwurf fehlgeschlagen" value={counts.draftFailed} warn />
        )}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          Opt-in: {optIn.length ? optIn.map(([level, n]) => `${optInShort(level)} ${num(n)}`).join(" · ") : "—"}
          <InfoTip>
            Verteilung der Kontakte nach Einwilligungsnachweis. Nur Double-Opt-in (DOI) ist ohne
            weitere Freigabe versendbar; Single-Opt-in und Unbekannt werden blockiert, solange
            CAMPAIGN_ALLOW_SINGLE_OPT_IN nicht gesetzt ist.
          </InfoTip>
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          A/B Hero: {num(abSplit.withHero)} mit · {num(abSplit.without)} ohne
          <InfoTip>
            Warteschlange nach Hero-A/B-Gruppe: gerade Kontakt-IDs sollen mit generiertem KI-Hero
            gesendet werden, ungerade ohne. Der KPI-Bereich vergleicht beide Gruppen.
          </InfoTip>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Tooltip content="Shopify nicht konfiguriert" disabled={shopifyConfigured}>
          <span className="inline-flex">
            <Button
              variant="outline"
              size="sm"
              onClick={onSync}
              loading={busy === "sync"}
              disabled={busy !== null || !shopifyConfigured}
            >
              <RefreshCw /> Sync
            </Button>
          </span>
        </Tooltip>
        <FilterGroup label="Neue Entwürfe" htmlFor="campaign-prepare-depth">
          <Select
            id="campaign-prepare-depth"
            value={String(prepareDepth)}
            onChange={(e) => onPrepareDepth(clampDiscountPercent(e.target.value))}
            className="h-8 w-auto min-w-[7.5rem] py-0 pr-8 text-xs"
            aria-label="Rabatt-Tiefe für neue Entwürfe"
            disabled={busy !== null}
          >
            <option value="0">0 % Rabatt</option>
            <option value="5">5 % Rabatt</option>
            <option value="10">10 % Rabatt</option>
            <option value="15">15 % Rabatt</option>
            <option value="20">20 % Rabatt</option>
          </Select>
          <Select
            id="campaign-prepare-textmode"
            value={prepareTextMode}
            onChange={(e) => onPrepareTextMode(e.target.value as EmailTextModeValue)}
            className="h-8 w-auto min-w-[8rem] py-0 pr-8 text-xs"
            aria-label="Textmodus für neue Entwürfe"
            disabled={busy !== null}
          >
            <option value="detailed">{EMAIL_TEXT_MODE_LABELS.detailed}</option>
            <option value="compact">{EMAIL_TEXT_MODE_LABELS.compact}</option>
            <option value="minimal">{EMAIL_TEXT_MODE_LABELS.minimal}</option>
          </Select>
          <InfoTip>
            Rabatt-Tiefe und Textmodus (wie viel Fließtext die KI über den Produktkacheln
            schreibt) für alle Entwürfe, die „Vorbereiten“, „Entwurf erstellen“ und
            „Wiederherstellen“ neu erzeugen.
          </InfoTip>
        </FilterGroup>
        {prepareProgress ? (
          <span className="flex min-w-[16rem] flex-1 items-center gap-2 text-xs text-muted-foreground">
            <ProgressBar
              value={(prepareProgress.done / prepareProgress.total) * 100}
              label="Fortschritt der Vorbereitung"
              className="max-w-[12rem]"
            />
            <span className="tabular-nums">
              {num(Math.min(prepareProgress.done, prepareProgress.total))}/{num(prepareProgress.total)} ·{" "}
              {num(prepareProgress.prepared)} erstellt
              {prepareProgress.failed > 0 ? `, ${num(prepareProgress.failed)} fehlgeschlagen` : ""}
            </span>
            <Button variant="ghost" size="xs" onClick={onCancelPrepare}>
              <X /> Abbrechen
            </Button>
          </span>
        ) : (
          <Button size="sm" onClick={onPrepare} disabled={busy !== null}>
            <Sparkles /> Nächste {PREPARE_TOTAL} vorbereiten
          </Button>
        )}
        <span className="ml-auto">
          <Tooltip content="Verwirft alle offenen Entwürfe — die Kontakte werden wieder „Offen“.">
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={onReset}
                loading={busy === "reset"}
                disabled={busy !== null || queueEmpty}
              >
                <RotateCcw /> Warteschlange neu aufbauen
              </Button>
            </span>
          </Tooltip>
        </span>
      </div>
    </div>
  );
}
