"use client";

// "Unmatched inbound" queue — the ONE global view of the in-admin email client
// (docs/EMAIL_SUBSYSTEM_SPIKE.md §5). Received messages from an address we don't
// recognise (customer_id IS NULL) land here so a reply from an unknown sender is
// never lost. The only action is "assign to customer": it sets customer_id and
// re-threads, moving the message into that customer's Korrespondenz panel.
//
// Deliberately minimal — no body, no search, no folders. Triage only.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Paperclip } from "lucide-react";
import { Badge, Button, Card, Select, toast } from "./ui";

export interface UnmatchedMessageProps {
  id: number;
  subject: string | null;
  fromAddress: string;
  toAddress: string;
  snippet: string | null;
  attachmentCount: number;
  occurredAt: string | null;
}

export interface AssignTargetProps {
  id: number;
  email: string;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function reportError(e: unknown) {
  toast({
    variant: "error",
    title: "Fehler",
    description: e instanceof Error ? e.message : "Unbekannter Fehler",
  });
}

export function UnmatchedInboundQueue({
  messages,
  customers,
}: {
  messages: UnmatchedMessageProps[];
  customers: AssignTargetProps[];
}) {
  if (messages.length === 0) return null;

  return (
    <Card className="mb-4 border-warning/30 bg-warning/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Inbox className="size-4 text-warning" />
        <h3 className="text-sm font-semibold text-foreground">
          Nicht zugeordneter Posteingang
        </h3>
        <Badge variant="warning">{messages.length}</Badge>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Antworten von Adressen, die zu keinem Kunden passen. Ordne jede einem Kunden zu —
        sie wandert dann in dessen Korrespondenz-Verlauf.
      </p>
      <div className="flex flex-col gap-2">
        {messages.map((m) => (
          <UnmatchedRow key={m.id} message={m} customers={customers} />
        ))}
      </div>
    </Card>
  );
}

function UnmatchedRow({
  message,
  customers,
}: {
  message: UnmatchedMessageProps;
  customers: AssignTargetProps[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // A customer whose email matches the sender is the obvious assignment — surface
  // it first so the common case is one click.
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
      const res = await fetch("/api/admin/correspondence/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, customerId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        customerEmail?: string;
        error?: { message?: string };
      };
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
      }
      toast({
        variant: "success",
        title: "Zugeordnet",
        description: json.customerEmail ?? "Kunde",
      });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="accent">{message.fromAddress || "unbekannt"}</Badge>
        <span className="text-sm font-medium">{message.subject || "(kein Betreff)"}</span>
        {message.attachmentCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
            <Paperclip className="size-3" /> {message.attachmentCount}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {fmtDateTime(message.occurredAt)}
        </span>
      </div>
      {message.snippet && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{message.snippet}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select
          value={target || (suggested ? String(suggested.id) : "")}
          onChange={(e) => setTarget(e.target.value)}
          disabled={busy || customers.length === 0}
          className="h-8 max-w-[18rem]"
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
        <Button size="sm" onClick={onAssign} disabled={busy || customers.length === 0}>
          {busy ? "Ordne zu…" : "Zuordnen"}
        </Button>
      </div>
    </div>
  );
}
