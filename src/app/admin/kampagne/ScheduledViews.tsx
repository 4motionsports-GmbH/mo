"use client";

// „Einplanen“: the time choice for one reviewed mail (ScheduleDialog) and the
// view „Eingeplant“ with every approved, not yet sent mail of the campaign
// (ScheduledList). lib/campaign-release-core.mjs owns the time options.

import * as React from "react";
import { CalendarClock, Undo2 } from "lucide-react";
import { releaseTimeOptions } from "@/lib/campaign-release-core.mjs";
import { formatAdmin, ADMIN_DATE_TIME_SHORT } from "@/lib/admin-datetime.mjs";
import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  InfoTip,
  Select,
  type DataTableColumn,
} from "../ui";
import type { ReleaseActions } from "./useReleaseActions";
import type { CampaignQueueItemProps, ScheduledItemProps } from "./types";

export function ScheduleDialog({ release, item }: { release: ReleaseActions; item: CampaignQueueItemProps | null }) {
  const open = release.scheduleId !== null;
  // The choices are computed when the dialog opens (Berlin time).
  const [options, setOptions] = React.useState<ReturnType<typeof releaseTimeOptions>>([]);
  const [choice, setChoice] = React.useState("now");
  React.useEffect(() => {
    if (!open) return;
    setOptions(releaseTimeOptions(Date.now()));
    setChoice("now");
  }, [open]);
  const picked = options.find((o) => o.key === choice) ?? options[0];
  return (
    <Dialog open={open} onOpenChange={(v) => !v && release.setScheduleId(null)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>E-Mail einplanen</DialogTitle>
          <DialogDescription>{item ? `An ${item.email} — „${item.subject}“` : ""}</DialogDescription>
        </DialogHeader>
        <Field
          label="Versand ab"
          info="Der Versand-Job verschickt eingeplante E-Mails alle 10 Minuten nacheinander. Beim Versand werden alle Prüfungen erneut gemacht; hat sich der Entwurf geändert oder lehnt eine Prüfung ab, kommt die E-Mail mit dem Grund zurück in die Warteschlange."
        >
          <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => release.setScheduleId(null)}>
            Abbrechen
          </Button>
          <Button data-autofocus="" onClick={() => void release.confirm(picked?.releaseAt ?? null)}>
            <CalendarClock /> Einplanen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function nameOf(e: ScheduledItemProps): string {
  return [e.firstName, e.lastName].filter(Boolean).join(" ") || e.email;
}

export function ScheduledList({ release }: { release: ReleaseActions }) {
  const columns: DataTableColumn<ScheduledItemProps>[] = [
    {
      key: "who",
      header: "Empfänger:in",
      cell: (e) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{nameOf(e)}</div>
          <div className="truncate text-xs text-muted-foreground">{e.email}</div>
        </div>
      ),
      sortValue: (e) => nameOf(e).toLowerCase(),
    },
    { key: "subject", header: "Betreff", cell: (e) => <span className="line-clamp-1">{e.subject}</span>, hideBelow: "md" },
    {
      key: "release",
      header: "Versand ab",
      cell: (e) => (e.releaseAt ? formatAdmin(e.releaseAt, ADMIN_DATE_TIME_SHORT) : "—"),
      sortValue: (e) => e.releaseAt ?? "",
      width: "9.5rem",
    },
    {
      key: "approved",
      header: "Eingeplant",
      cell: (e) => (e.approvedAt ? formatAdmin(e.approvedAt, ADMIN_DATE_TIME_SHORT) : "—"),
      sortValue: (e) => e.approvedAt ?? "",
      width: "9.5rem",
      hideBelow: "lg",
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "9rem",
      cell: (e) => (
        <Button
          variant="outline"
          size="xs"
          onClick={() => void release.revoke(e.contactId)}
          loading={release.revoking === e.contactId}
          disabled={release.revoking !== null}
        >
          <Undo2 /> Zurücknehmen
        </Button>
      ),
    },
  ];
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-1 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Eingeplant</h2>
        <InfoTip>
          Geprüfte E-Mails, die der Versand-Job ab der gewählten Zeit verschickt (alle 10 Minuten, nacheinander). Beim
          Versand werden alle Prüfungen erneut gemacht; hat sich der Entwurf oder die Kampagne seit dem Einplanen
          geändert oder lehnt eine Prüfung ab, kommt die E-Mail mit dem Grund zurück in die Warteschlange.
        </InfoTip>
      </div>
      <DataTable
        columns={columns}
        rows={release.list}
        rowKey={(e) => e.contactId}
        empty={
          <EmptyState
            plain
            icon={<CalendarClock />}
            title="Nichts eingeplant"
            description={
              release.enabled
                ? "„Einplanen“ (A) im Prüfen-Modus plant eine geprüfte E-Mail für später ein."
                : "„Einplanen“ ist nicht eingeschaltet (CAMPAIGN_RELEASE_ENABLED)."
            }
          />
        }
      />
    </div>
  );
}
