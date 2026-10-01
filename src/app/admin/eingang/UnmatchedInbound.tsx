"use client";

// E-Mails, die keinem Kunden zugeordnet sind — received messages from an
// address we don't recognise (customer_id IS NULL), so a reply from an unknown
// sender is never lost. The only action is „Zuordnen“: pick the person (search
// by name or e-mail over the whole customer base) — the message moves into
// that customer's Korrespondenz.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Inbox, Paperclip } from "lucide-react";
import type { UnmatchedInboundMessage } from "@/lib/email-messages-store";
import { ADMIN_DATE_TIME_PADDED, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num } from "@/lib/admin-format.mjs";
import { Button, Disclosure, InfoTip, Input, Select, StatusBadge, toast } from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";

interface Hit {
  id: number;
  email: string;
  name: string | null;
}

export function UnmatchedInbound({ messages }: { messages: UnmatchedInboundMessage[] }) {
  return (
    <Disclosure
      defaultOpen
      className="border-warning/40 bg-warning/5"
      title={
        <span className="inline-flex items-center gap-2">
          <Inbox className="size-4 text-warning" aria-hidden />
          E-Mails nicht zugeordnet
          <StatusBadge tone="warning">{num(messages.length)}</StatusBadge>
        </span>
      }
      actions={
        <InfoTip>
          Antworten von Adressen, die zu keinem Kunden passen. Ordne jede einem Kunden zu — sie wandert dann
          in dessen Korrespondenz-Verlauf.
        </InfoTip>
      }
    >
      <div className="flex flex-col gap-2">
        {messages.map((m) => (
          <UnmatchedRow key={m.id} message={m} />
        ))}
      </div>
    </Disclosure>
  );
}

function UnmatchedRow({ message }: { message: UnmatchedInboundMessage }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [target, setTarget] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(() => {
      adminFetch<{ items: Array<{ id: number; email: string; name: string | null }> }>(
        `/api/admin/customers/list?kq=${encodeURIComponent(q)}`,
        { signal: controller.signal }
      )
        .then((json) => {
          if (controller.signal.aborted) return;
          const next = json.items.slice(0, 10).map((c) => ({ id: c.id, email: c.email, name: c.name }));
          setHits(next);
          setTarget(next[0] ? String(next[0].id) : "");
        })
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [query]);

  async function onAssign() {
    const customerId = Number(target);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      toast({ variant: "warning", title: "Kein Kunde gewählt", description: "Bitte einen Kunden suchen und auswählen." });
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
      {message.snippet && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{message.snippet}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="w-64 max-w-full">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kunde suchen (Name oder E-Mail)"
            aria-label="Kunde suchen"
            className="h-8 text-xs"
          />
        </div>
        <div className="w-72 max-w-full">
          <Select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={busy || hits.length === 0}
            className="h-8 text-xs"
            aria-label="Kunde für die Zuordnung"
          >
            {hits.length === 0 ? <option value="">Erst suchen …</option> : null}
            {hits.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ? `${c.name} · ${c.email}` : c.email}
              </option>
            ))}
          </Select>
        </div>
        <Button size="sm" onClick={onAssign} loading={busy} disabled={!target}>
          Zuordnen
        </Button>
      </div>
    </div>
  );
}
