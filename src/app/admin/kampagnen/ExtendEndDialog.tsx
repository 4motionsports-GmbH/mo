"use client";

// „Ende ändern“ / „Verlängern“ — one dialog for every campaign kind with an
// end (all but the Einzelansprache): the Kampagnen card, the Rundmail
// workspace, the review desk's ⋯ menu and the locked „Versand spätestens bis“
// of the editor open it. A new end (quick choices: today / tomorrow 23:59, in
// 7 days; or „Ohne Ende“), what will happen (a Rundmail: who still waits and
// how long the rest takes — and a warning when the new end comes too early),
// one button. The rules are lib/campaign-end.mjs; the server checks them again
// (POST /api/admin/campaigns/extend). docs/CAMPAIGNS.md §2.6.

import * as React from "react";
import { CalendarClock } from "lucide-react";
import { ADMIN_WEEKDAY_DATE_TIME, formatAdmin, fromBerlinInputValue, toBerlinInputValue } from "@/lib/admin-datetime.mjs";
import { num } from "@/lib/admin-format.mjs";
import { campaignEndChange, campaignEndSuggestions, mailingEndOutlook, validateCampaignEnd } from "@/lib/campaign-end.mjs";
import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  toast,
} from "../ui";
import { adminFetch } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import { useNow } from "../lib/use-now";

/** The campaign the dialog changes (what every entry point already has). */
export interface ExtendEndTarget {
  id: number;
  name: string;
  kind: "laufend" | "aktion" | "einzel" | "rundmail";
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  endedAt?: string | null;
  /** A Rundmail: recipients still waiting, its send finished, its tempo (mails per minute). */
  rundmail?: { open: number; finished: boolean; perMinute: number | null } | null;
}

export interface ExtendEndResult {
  campaign: { id: number; status: string; endsAt: string | null };
  mode: "change" | "resume";
  expired: boolean;
  open: number | null;
  started: boolean;
}

/** The dialog's decision for a target (also the entry points' „may I offer it?“). */
export function endChangeOf(target: ExtendEndTarget, now = Date.now()) {
  return campaignEndChange(
    {
      kind: target.kind,
      status: target.status,
      startsAt: target.startsAt,
      endsAt: target.endsAt,
      endedAt: target.endedAt ?? null,
      finished: target.rundmail?.finished ?? false,
    },
    { now }
  );
}

/** The label of the action that opens the dialog: „Verlängern…“ once the end stopped it, else „Ende ändern…“. */
export function extendActionLabel(target: ExtendEndTarget, now = Date.now()): string {
  const change = endChangeOf(target, now);
  if (change.ok && change.expired) return target.kind === "rundmail" ? "Versand verlängern…" : "Verlängern…";
  return target.kind === "rundmail" ? "„Versand spätestens bis“ ändern…" : "Ende ändern…";
}

export function ExtendEndDialog({
  target,
  open,
  onOpenChange,
  onDone,
}: {
  target: ExtendEndTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a successful change (refresh the page or the state). */
  onDone?: (result: ExtendEndResult) => void;
}) {
  // While the request runs the dialog stays open (the form mounts afresh on every open — DialogContent renders only then).
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open && target != null} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent size="sm">
        {target && <ExtendEndForm target={target} onBusy={setBusy} onClose={() => onOpenChange(false)} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

function ExtendEndForm({
  target,
  onBusy,
  onClose,
  onDone,
}: {
  target: ExtendEndTarget;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
  onDone?: (result: ExtendEndResult) => void;
}) {
  // Read once when the dialog opens: a future end starts from itself, an end that passed (or none) from the first suggestion.
  const [openedAt] = React.useState(() => Date.now());
  const [value, setValue] = React.useState(() => {
    const end = target.endsAt ? Date.parse(target.endsAt) : NaN;
    return Number.isFinite(end) && end > openedAt ? toBerlinInputValue(target.endsAt) : (campaignEndSuggestions({ now: openedAt })[0]?.value ?? "");
  });
  const [noEnd, setNoEnd] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  // The checks follow the clock while the dialog is open (an end chosen 20 minutes ahead becomes too close).
  const now = useNow(15_000) ?? openedAt;

  const submit = useAsyncAction(
    async (id: number, endsAt: string | null) =>
      adminFetch<ExtendEndResult>("/api/admin/campaigns/extend", { body: { id, endsAt } }),
    { errorToast: "Nicht geändert" }
  );

  const change = endChangeOf(target, openedAt);
  const isRundmail = target.kind === "rundmail";
  const expired = change.ok && change.expired;
  const iso = noEnd ? null : fromBerlinInputValue(value);
  const check = noEnd
    ? ({ ok: true, endsAt: null } as const)
    : iso
      ? validateCampaignEnd(iso, { now, startsAt: target.startsAt })
      : ({ ok: false, message: "Datum und Uhrzeit wählen." } as const);
  const waiting = isRundmail ? (target.rundmail?.open ?? 0) : 0;
  const perMinute = target.rundmail?.perMinute ?? null;
  const outlook =
    isRundmail && waiting > 0 && perMinute
      ? mailingEndOutlook({ open: waiting, perMinute, endsAt: check.ok ? check.endsAt : null, startsAt: target.startsAt, now })
      : null;

  const title = isRundmail ? (expired ? "Versand verlängern" : "„Versand spätestens bis“ ändern") : expired ? "Kampagne verlängern" : "Ende ändern";
  const previous = target.endsAt
    ? `bisher ${formatAdmin(target.endsAt, ADMIN_WEEKDAY_DATE_TIME)} Uhr${expired ? " — abgelaufen" : ""}`
    : "bisher ohne Ende";

  const save = async () => {
    setTouched(true);
    if (!check.ok) return;
    onBusy(true);
    const result = await submit.run(target.id, check.endsAt);
    onBusy(false);
    if (!result) return;
    const newEnd = result.campaign.endsAt ? `${formatAdmin(result.campaign.endsAt, ADMIN_WEEKDAY_DATE_TIME)} Uhr` : "ohne Ende";
    toast({
      variant: "success",
      title: result.expired ? (isRundmail ? "Versand läuft weiter" : "Kampagne läuft wieder") : "Ende geändert",
      description:
        isRundmail && result.expired && (result.open ?? 0) > 0
          ? `${num(result.open ?? 0)} Empfänger:innen bekommen die Mail jetzt — neues Ende: ${newEnd}.`
          : `Neues Ende: ${newEnd}.`,
    });
    onClose();
    onDone?.(result);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          „{target.name}“ · {previous}
        </DialogDescription>
      </DialogHeader>

      {!change.ok ? (
        <Callout tone="neutral">{change.message}</Callout>
      ) : (
        <div className="mt-1 flex flex-col gap-3">
          <Field
            label={isRundmail ? "Neues „Versand spätestens bis“" : "Neues Ende"}
            info={
              isRundmail
                ? "Bis dahin geht die Rundmail an alle, die sie noch nicht bekommen haben — im gewählten Tempo. Wer sie schon bekommen hat, bekommt sie nicht noch einmal. Was bis zum Ende nicht gesendet ist, geht nicht mehr raus."
                : "Bis dahin läuft die Kampagne: Entwürfe vorbereiten und Mails senden wie bisher. Danach endet sie automatisch."
            }
            error={touched && !check.ok ? check.message : undefined}
          >
            <Input
              type="datetime-local"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setTouched(true);
              }}
              disabled={noEnd}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-1.5">
            {campaignEndSuggestions({ now: openedAt }).map((s) => (
              <Button
                key={s.key}
                type="button"
                size="xs"
                variant={!noEnd && value === s.value ? "default" : "outline"}
                onClick={() => {
                  setNoEnd(false);
                  setValue(s.value);
                  setTouched(true);
                }}
              >
                {s.label}
              </Button>
            ))}
            <label className="ml-1 inline-flex items-center gap-1.5 text-xs text-foreground">
              <Checkbox checked={noEnd} onChange={(e) => setNoEnd(e.target.checked)} />
              Ohne Ende
            </label>
          </div>

          {isRundmail && waiting > 0 && (
            <Callout tone={outlook && !outlook.fits && check.ok ? "warning" : "info"} compact icon={<CalendarClock />}>
              {num(waiting)} Empfänger:innen haben die Mail noch nicht bekommen
              {expired ? " — sie bekommen sie ab sofort" : ""}
              {outlook ? ` (Dauer ${outlook.label})` : ""}. Wer sie schon bekommen hat, bekommt sie nicht noch einmal.
              {outlook && !outlook.fits && check.ok && <> Bis zum neuen Ende reicht die Zeit nicht für alle — ein späteres Ende wählen.</>}
            </Callout>
          )}
          {!isRundmail && expired && (
            <Callout tone="info" compact icon={<CalendarClock />}>
              Die Kampagne läuft danach wieder — Entwürfe vorbereiten und Mails senden wie vorher, bis zum neuen Ende.
            </Callout>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submit.pending}>
          {change.ok ? "Abbrechen" : "Schließen"}
        </Button>
        {change.ok && (
          <Button data-autofocus="" onClick={() => void save()} loading={submit.pending} disabled={touched && !check.ok}>
            {expired ? "Verlängern" : "Speichern"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
