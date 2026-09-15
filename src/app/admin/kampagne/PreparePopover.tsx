"use client";

// „Vorbereiten…“ — the settings of the background draft job in a popover:
// how many contacts, the Rabatt depth and Textmodus for the NEW drafts, the
// optional KI-Hero for the A group, and an estimate (drafts, cost, time)
// from the recorded ai_usage averages before any money is spent. The values
// are remembered per browser (useCampaignActions).

import * as React from "react";
import { Sparkles } from "lucide-react";
import { EMAIL_TEXT_MODE_LABELS } from "@/lib/email-text-mode.mjs";
import { clampDiscountPercent } from "@/lib/discount-validation.mjs";
import { DISCOUNT_SCOPE_OPTIONS, parseDiscountScope } from "@/lib/discount-scope.mjs";
import { prepareEstimate } from "@/lib/campaign-desk-core.mjs";
import { eur, num, plural } from "@/lib/admin-format.mjs";
import { Button, Checkbox, InfoTip, Popover, Select } from "../ui";
import type { EmailTextModeValue } from "../EmailTextModeToggle";
import { PREPARE_OPTIONS, type CampaignCostsProps, type CampaignCountsProps } from "./types";
import type { PrepareSettings } from "./useCampaignActions";

function minutes(seconds: number): string {
  if (seconds < 60) return `${num(Math.max(1, Math.round(seconds)))} s`;
  return `${num(Math.ceil(seconds / 60))} Min.`;
}

export function PreparePopover({
  open,
  onOpenChange,
  counts,
  costs,
  settings,
  onSettings,
  heroOffered,
  disabled,
  onStart,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  counts: CampaignCountsProps;
  costs: CampaignCostsProps;
  settings: PrepareSettings;
  onSettings: (patch: Partial<PrepareSettings>) => void;
  heroOffered: boolean;
  disabled: boolean;
  onStart: (settings: PrepareSettings) => void;
  trigger: React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
}) {
  const withHero = heroOffered && settings.withHero;
  const estimate = prepareEstimate({
    count: settings.count,
    pendingSendable: counts.pendingSendable,
    draftCostEur: costs.draftEur,
    heroCostEur: costs.heroEur,
    withHero,
  });
  const nothingToDo = estimate.drafts === 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange} trigger={trigger} label="Vorbereiten" align="end">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-1 text-sm font-semibold">
          Nächste Entwürfe vorbereiten
          <InfoTip>
            Erzeugt die Entwürfe für die nächsten offenen Kontakte im Sendefenster — in kleinen
            Schritten im Hintergrund, die Prüfung läuft währenddessen weiter. Rabatt-Tiefe, „Gilt
            für“ (gesamte Bestellung, nur Empfehlungen oder nur Set) und
            Textmodus (wie viel Fließtext die KI über den Produktkacheln schreibt) gelten für alle
            Entwürfe, die „Vorbereiten“, „Entwurf erstellen“ und „Wiederherstellen“ neu erzeugen.
            Generierung kostet API-Geld; die Schätzung stammt aus den erfassten Kosten der letzten
            Läufe.
          </InfoTip>
        </div>

        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs">
          <label htmlFor="campaign-prepare-count" className="font-medium text-muted-foreground">
            Anzahl
          </label>
          <div className="flex items-center gap-2">
            <Select
              id="campaign-prepare-count"
              value={String(settings.count)}
              onChange={(e) => onSettings({ count: Number(e.target.value) })}
              className="h-8 w-auto min-w-[5.5rem] py-0 pr-8 text-xs"
              disabled={disabled}
            >
              {PREPARE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <span className="text-muted-foreground tabular-nums">
              {num(counts.pending)} offen · {num(counts.pendingSendable)} im Sendefenster
            </span>
          </div>

          <label htmlFor="campaign-prepare-depth" className="font-medium text-muted-foreground">
            Rabatt
          </label>
          <Select
            id="campaign-prepare-depth"
            value={String(settings.depth)}
            onChange={(e) => onSettings({ depth: clampDiscountPercent(e.target.value) })}
            className="h-8 w-auto min-w-[7rem] py-0 pr-8 text-xs"
            aria-label="Rabatt-Tiefe für neue Entwürfe"
            disabled={disabled}
          >
            <option value="0">0 % Rabatt</option>
            <option value="5">5 % Rabatt</option>
            <option value="10">10 % Rabatt</option>
            <option value="15">15 % Rabatt</option>
            <option value="20">20 % Rabatt</option>
          </Select>

          {settings.depth > 0 && (
            <>
              <label htmlFor="campaign-prepare-scope" className="font-medium text-muted-foreground">
                Gilt für
              </label>
              <Select
                id="campaign-prepare-scope"
                value={settings.scope}
                onChange={(e) => onSettings({ scope: parseDiscountScope(e.target.value) })}
                className="h-8 w-auto min-w-[8rem] py-0 pr-8 text-xs"
                aria-label="Worauf der Rabattcode der neuen Entwürfe gilt"
                disabled={disabled}
              >
                {DISCOUNT_SCOPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.long}
                  </option>
                ))}
              </Select>
            </>
          )}

          <label htmlFor="campaign-prepare-textmode" className="font-medium text-muted-foreground">
            Textmodus
          </label>
          <Select
            id="campaign-prepare-textmode"
            value={settings.textMode}
            onChange={(e) => onSettings({ textMode: e.target.value as EmailTextModeValue })}
            className="h-8 w-auto min-w-[8rem] py-0 pr-8 text-xs"
            aria-label="Textmodus für neue Entwürfe"
            disabled={disabled}
          >
            <option value="detailed">{EMAIL_TEXT_MODE_LABELS.detailed}</option>
            <option value="compact">{EMAIL_TEXT_MODE_LABELS.compact}</option>
            <option value="minimal">{EMAIL_TEXT_MODE_LABELS.minimal}</option>
          </Select>
        </div>

        {heroOffered && (
          <label className="flex cursor-pointer items-start gap-2 text-xs">
            <Checkbox
              className="mt-0.5 size-3.5"
              checked={settings.withHero}
              disabled={disabled}
              onChange={(e) => onSettings({ withHero: e.target.checked })}
            />
            <span>
              KI-Hero für die A-Gruppe erzeugen
              <InfoTip className="ml-1">
                Nach den Entwürfen wird für jeden vorbereiteten Kontakt mit gerader ID (A-Gruppe des
                Hero-A/B-Tests) ein Bild-Prompt vorgeschlagen und das Hero-Bild gerendert — etwa
                anderthalb Minuten und die angegebenen Kosten pro Bild. Ungerade IDs (B-Gruppe)
                senden ohne Hero; der KPI-Bereich vergleicht beide Gruppen.
              </InfoTip>
            </span>
          </label>
        )}

        <div className="rounded-md bg-surface-2 px-2.5 py-2 text-xs tabular-nums">
          {nothingToDo ? (
            <span className="text-muted-foreground">
              Keine offenen Kontakte im Sendefenster — erst „Jetzt synchronisieren“.
            </span>
          ) : (
            <>
              <strong>{plural(estimate.drafts, "Entwurf", "Entwürfe")}</strong>
              {estimate.heroes > 0 && <> · {plural(estimate.heroes, "Hero-Bild", "Hero-Bilder")}</>}
              {" · "}
              {estimate.costEur === null ? (
                <span className="text-muted-foreground">Kosten: noch keine Daten</span>
              ) : (
                <>≈ {eur(estimate.costEur)}</>
              )}
              {" · "}≈ {minutes(estimate.seconds)}
            </>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={disabled || nothingToDo}
            onClick={() => onStart({ ...settings, withHero })}
            data-autofocus
          >
            <Sparkles /> Vorbereiten starten
          </Button>
        </div>
      </div>
    </Popover>
  );
}
