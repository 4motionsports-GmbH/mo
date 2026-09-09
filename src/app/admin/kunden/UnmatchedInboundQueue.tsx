"use client";

// "Unmatched inbound" — the ONE global view of the in-admin email client:
// received messages from an address we don't recognise (customer_id IS NULL)
// land here so a reply from an unknown sender is never lost. The only action
// is "assign to customer": it sets customer_id and re-threads, moving the
// message into that customer's Korrespondenz.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Inbox, Paperclip } from "lucide-react";
import type { UnmatchedInboundMessage } from "@/lib/email-messages-store";
import { ADMIN_DATE_TIME_PADDED, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num } from "@/lib/admin-format.mjs";
import { Button, Disclosure, InfoTip, Select, StatusBadge, toast } from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";

export interface AssignTarget {
  id: number;
  email: string;
}

export function UnmatchedInboundQueue({
  messages,
  customers,
}: {
  messages: UnmatchedInboundMessage[];
  customers: AssignTarget[];
}) {
  if (messages.length === 0) return null;

  return (
    <Disclosure
      defaultOpen
      className="border-warning/40 bg-warning/5"
      title={
        <span className="inline-flex items-center gap-2">
          <Inbox className="size-4 text-warning" aria-hidden />
          Nicht zugeordneter Posteingang
          <StatusBadge tone="warning">{num(messages.length)}</StatusBadge>
        </span>
      }
      actions={
        <InfoTip>
          Antworten von Adressen, die zu keinem Kunden passen. Ordne jede einem Kunden zu — sie
          wandert dann in dessen Korrespondenz-Verlauf.
        </InfoTip>
      }
    >
      <div className="flex flex-col gap-2">
        {messages.map((m) => (
          <UnmatchedRow key={m.id} message={m} customers={customers} />
        ))}
      </div>
    </Disclosure>
  );
}

function UnmatchedRow({
  message,
  customers,
}: {
  message: UnmatchedInboundMessage;
  customers: AssignTarget[];
}) {
  const router = useRouter();
  const [target, setTarget] = React.useState<string>("");
  const [busy, setBusy] = React.useState(false);

  // A customer whose email matches the sender is the obvious assignment —
  // pre-select it so the common case is one click.
  const suggested = customers.find(
    (c) => c.email.toLowerCase() === message.fromAddress.toLowerCase()
  );

  async function onAssign() {
    const customerId = Number(target || (suggested ? suggested.id : 0));
    if (!Number.isInteger(customerId) || customerId <= 0) {
      toast({ variant: "warning", title: "Kein Kunde gewählt", description: "Bitte einen Kunden auswählen." });
      return;
    }
    setBusy(true);
    try {
      const json = await adminFetch<{ customerEmail?: string }>("/api/admin/correspondence/assign", {
        body: { messageId: message.id, customerId },
      });
      toast({ variant: "success", title: "Zugeordnet", description: json.customerEmail ?? "Kunde" });
      router.refresh();
    } catch (e) {
      toast({ variant: "error", title: "Zuordnung fehlgeschlagen", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const selectId = `unmatched-target-${message.id}`;

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge tone="accent" dot={false}>
          {message.fromAddress || "unbekannt"}
        </StatusBadge>
        <span className="text-sm font-medium">{message.subject || "(kein Betreff)"}</span>
        {message.attachmentCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
            <Paperclip className="size-3" aria-hidden /> {message.attachmentCount}
          </span>
        )}
        <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
          {formatAdmin(message.occurredAt, ADMIN_DATE_TIME_PADDED)}
        </span>
      </div>
      {message.snippet && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{message.snippet}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select
          id={selectId}
          value={target || (suggested ? String(suggested.id) : "")}
          onChange={(e) => setTarget(e.target.value)}
          disabled={busy || customers.length === 0}
          className="h-8 max-w-[18rem] text-xs"
          aria-label="Kunde für die Zuordnung"
        >
          <option value="">Kunde wählen…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.email}
              {suggested && c.id === suggested.id ? " (passende Adresse)" : ""}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={onAssign} loading={busy} disabled={customers.length === 0}>
          Zuordnen
        </Button>
      </div>
    </div>
  );
}
