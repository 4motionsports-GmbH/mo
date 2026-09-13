"use client";

// „Verlauf“ — every campaign send to ONE address, in a sheet: subject, date,
// delivery state, code, and the retained content via „Ansehen“. Backed by the
// same paged history route as the „Gesendet“ view, narrowed by the e-mail.

import * as React from "react";
import { Eye } from "lucide-react";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { Button, Callout, EmptyState, Sheet, Spinner, StatusBadge, Tooltip } from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { deliveryState } from "./SentHistory";
import type { CampaignHistoryItemProps } from "./types";

export function ContactHistorySheet({
  email,
  open,
  onOpenChange,
  viewBusy,
  onView,
}: {
  email: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewBusy: boolean;
  onView: (h: CampaignHistoryItemProps) => void;
}) {
  const [rows, setRows] = React.useState<CampaignHistoryItemProps[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setRows(null);
    setError(null);
    const sp = new URLSearchParams({ q: email, page: "1", pageSize: "50" });
    adminFetch<{ rows: CampaignHistoryItemProps[] }>(`/api/admin/campaign/history?${sp.toString()}`, {
      signal: controller.signal,
    })
      .then((json) => {
        if (controller.signal.aborted) return;
        // The search is a substring over email AND subject — keep the address only.
        setRows(json.rows.filter((r) => r.email.toLowerCase() === email.toLowerCase()));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(err));
      });
    return () => controller.abort();
  }, [open, email]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Verlauf" description={email} size="md">
      {error ? (
        <Callout tone="destructive" compact>
          {error}
        </Callout>
      ) : rows === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" /> Lädt…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState plain compact title="Noch keine Kampagnen-E-Mail an diese Adresse." />
      ) : (
        <ul className="divide-y divide-border text-sm">
          {rows.map((h) => {
            const state = deliveryState(h);
            return (
              <li key={h.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{h.subject ?? "—"}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatAdmin(h.sentAt, ADMIN_DATE_TIME_SHORT)}</span>
                    <Tooltip content={state.detail ?? ""} disabled={!state.detail}>
                      <StatusBadge tone={state.tone} tabIndex={0}>
                        {state.label}
                      </StatusBadge>
                    </Tooltip>
                    {h.discountCode && <code className="text-xs">{h.discountCode}</code>}
                    {h.redeemed === true && <StatusBadge tone="success" dot={false}>eingelöst</StatusBadge>}
                    {h.heroVariant && <span>Hero: {h.heroVariant}</span>}
                  </div>
                </div>
                {h.hasContent && (
                  <Button variant="outline" size="xs" disabled={viewBusy} onClick={() => onView(h)}>
                    <Eye /> Ansehen
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
