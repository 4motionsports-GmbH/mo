"use client";

// „Einplanen“ on the review desk (migration 0072, lib/campaign-release.ts): a
// reviewed mail is approved for the release job instead of being sent now. The
// card leaves the queue at once; the server checks every gate the send would
// check (without sending) and the job sends it from the chosen time on. „Zu-
// rücknehmen“ in the view „Eingeplant“ brings it back to the queue.

import * as React from "react";
import { reviewVerdict } from "@/lib/campaign-review-checks.mjs";
import { formatAdmin, ADMIN_DATE_TIME_SHORT } from "@/lib/admin-datetime.mjs";
import { toast } from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import type { CampaignActions } from "./useCampaignActions";
import type { ScheduledItemProps } from "./types";

export function useReleaseActions({
  enabled,
  scheduled,
  actions,
}: {
  enabled: boolean;
  scheduled: ScheduledItemProps[];
  actions: CampaignActions;
}) {
  const [list, setList] = React.useState(scheduled);
  React.useEffect(() => setList(scheduled), [scheduled]);
  const [scheduleId, setScheduleId] = React.useState<number | null>(null);
  const [revoking, setRevoking] = React.useState<number | null>(null);
  const { items, checksOf, busyOf, removeItem, restoreItem, reloadFromServer } = actions;

  /** Whether a card may be planned (same conditions as Senden, never a Testkontakt). */
  const canSchedule = React.useCallback(
    (contactId: number) => {
      if (!enabled) return false;
      const item = items.find((it) => it.contactId === contactId);
      if (!item || item.isTest) return false;
      if (reviewVerdict(checksOf(contactId)) === "blocked") return false;
      return busyOf(contactId) === null;
    },
    [enabled, items, checksOf, busyOf]
  );

  /** `A` / „Einplanen…“: opens the time choice for this card. */
  const open = React.useCallback(
    (contactId: number) => {
      if (canSchedule(contactId)) setScheduleId(contactId);
    },
    [canSchedule]
  );

  /** Confirmed in the dialog: the card leaves the queue, the server approves. */
  const confirm = React.useCallback(
    async (releaseAt: string | null) => {
      const id = scheduleId;
      setScheduleId(null);
      if (id === null) return;
      const item = items.find((it) => it.contactId === id);
      if (!item) return;
      removeItem(id);
      try {
        const json = await adminFetch<{ releaseAt: string }>("/api/admin/campaign/approve", {
          body: { contactId: id, releaseAt },
        });
        setList((l) =>
          [
            ...l.filter((e) => e.contactId !== id),
            {
              contactId: id,
              email: item.email,
              firstName: item.firstName,
              lastName: item.lastName,
              subject: item.subject,
              approvedAt: new Date().toISOString(),
              releaseAt: json.releaseAt,
            },
          ].sort((a, b) => String(a.releaseAt).localeCompare(String(b.releaseAt)))
        );
        toast({
          variant: "success",
          title: `Eingeplant — ${item.email}`,
          description: `Versand ab ${formatAdmin(json.releaseAt, ADMIN_DATE_TIME_SHORT)}`,
          duration: 3000,
        });
      } catch (err) {
        const message = errorMessage(err);
        restoreItem({ ...item, sendError: message });
        toast({ variant: "error", title: `Nicht eingeplant — ${item.email}`, description: message });
      }
    },
    [scheduleId, items, removeItem, restoreItem]
  );

  /** „Zurücknehmen“: the mail returns to the review queue (server refresh). */
  const revoke = React.useCallback(
    async (contactId: number) => {
      setRevoking(contactId);
      try {
        await adminFetch("/api/admin/campaign/unapprove", { body: { contactId } });
        setList((l) => l.filter((e) => e.contactId !== contactId));
        toast({ variant: "success", title: "Zurückgenommen — wieder in der Warteschlange", duration: 2500 });
        reloadFromServer();
      } catch (err) {
        toast({ variant: "error", title: "Nicht zurückgenommen", description: errorMessage(err) });
      } finally {
        setRevoking(null);
      }
    },
    [reloadFromServer]
  );

  return { enabled, list, scheduleId, setScheduleId, canSchedule, open, confirm, revoke, revoking };
}

export type ReleaseActions = ReturnType<typeof useReleaseActions>;
