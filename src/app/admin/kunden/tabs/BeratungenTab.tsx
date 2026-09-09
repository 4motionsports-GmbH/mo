"use client";

// Beratungen — the customer's consultation timeline; each transcript opens in a
// dialog rendered by the shared TranscriptView.

import * as React from "react";
import { MessageSquare } from "lucide-react";
import type { CustomerDetail } from "@/lib/customer-detail";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { plural } from "@/lib/admin-format.mjs";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  StatusBadge,
  TranscriptView,
} from "../../ui";

export function BeratungenTab({ customer }: { customer: CustomerDetail }) {
  const [openId, setOpenId] = React.useState<number | null>(null);
  const open = customer.sessions.find((s) => s.conversationId === openId) ?? null;
  const openIndex = open ? customer.sessions.indexOf(open) : -1;

  if (customer.sessions.length === 0) {
    return (
      <EmptyState
        compact
        icon={<MessageSquare />}
        title="Keine Beratung verknüpft"
        description="Die E-Mail wurde erfasst, aber die zugehörige Chat-Session ist nicht (mehr) gespeichert."
      />
    );
  }

  return (
    <div>
      <div className="mb-3 text-sm font-semibold text-foreground">
        {plural(customer.sessions.length, "Beratung", "Beratungen")}
      </div>
      <ol className="relative ml-1 border-l border-border">
        {customer.sessions.map((s, i) => (
          <li key={s.conversationId} className="relative mb-3 pl-5 last:mb-0">
            <span
              className="absolute -left-[5px] top-2 size-2.5 rounded-full border-2 border-card bg-accent"
              aria-hidden
            />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-medium">Beratung {i + 1}</span>
              <span className="text-xs text-muted-foreground">
                {formatAdmin(s.createdAt, ADMIN_DATE)}
                {s.personaDisplay ? ` · ${s.personaDisplay}` : ""}
              </span>
              <StatusBadge tone="neutral" dot={false}>
                {plural(s.messageCount, "Nachricht", "Nachrichten")}
              </StatusBadge>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setOpenId(s.conversationId)}
                disabled={s.transcript.length === 0}
              >
                <MessageSquare /> Transkript
              </Button>
            </div>
          </li>
        ))}
      </ol>

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Beratung {openIndex + 1}</DialogTitle>
            <DialogDescription>
              {formatAdmin(open?.createdAt ?? null, ADMIN_DATE)} · {customer.email}
              {open?.personaDisplay ? ` · ${open.personaDisplay}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 max-h-[65vh] overflow-y-auto rounded-lg bg-surface-2 p-3">
            <TranscriptView turns={open?.transcript ?? []} showTimes={false} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
