"use client";

// "Brief senden" — the physical-mail action (docs/EMAIL_SUBSYSTEM_SPIKE.md §4),
// wired alongside the per-customer marketing-email flow it mirrors. The letter
// reuses the SAME personalised draft (sendId) as the email; the server renders it
// to a PDF and submits it to Pingen.
//
// The whole path is gated: the button is DISABLED (with a clear reason) when the
// customer has no complete, lawfully-held postal address, when Pingen isn't
// configured, or when the PHYSICAL_MAIL_SENDS_APPROVED flag is off — we never
// guess or part-fill an address. Existing letters show as status chips.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mailbox, Send } from "lucide-react";
import { Badge, Button, toast, type BadgeProps } from "./ui";

export interface PhysicalLetterProps {
  id: number;
  status:
    | "pending"
    | "submitted"
    | "queued"
    | "printing"
    | "printed"
    | "posted"
    | "failed"
    | "cancelled"
    | "undeliverable";
  recipientCity: string | null;
  recipientCountry: string | null;
  costCents: number | null;
  error: string | null;
  createdAt: string | null;
}

const STATUS_META: Record<
  PhysicalLetterProps["status"],
  { label: string; variant: BadgeProps["variant"] }
> = {
  pending: { label: "Angelegt", variant: "secondary" },
  submitted: { label: "Übermittelt", variant: "info" },
  queued: { label: "In Warteschlange", variant: "info" },
  printing: { label: "Wird gedruckt", variant: "info" },
  printed: { label: "Gedruckt", variant: "info" },
  posted: { label: "Versendet", variant: "success" },
  failed: { label: "Fehler", variant: "destructive" },
  cancelled: { label: "Storniert", variant: "secondary" },
  undeliverable: { label: "Unzustellbar", variant: "destructive" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE");
}

export function PhysicalLetterPanel({
  customerEmail,
  sendId,
  eligible,
  reason,
  letters,
}: {
  customerEmail: string;
  /** The live marketing draft id whose content the letter reuses; null = none yet. */
  sendId: number | null;
  eligible: boolean;
  /** Why the action is disabled (address/flag/config), shown to the operator. */
  reason: string | null;
  letters: PhysicalLetterProps[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const canSend = eligible && sendId != null && !busy;
  const disabledReason = !eligible
    ? reason
    : sendId == null
      ? "Zuerst einen E-Mail-Entwurf erstellen — der Brief nutzt denselben Text."
      : null;

  async function onSend() {
    if (sendId == null) return;
    if (!confirm(`Brief an ${customerEmail} über Pingen versenden?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/physical/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        status?: string;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
      toast({ variant: "success", title: "Brief übermittelt", description: customerEmail });
      router.refresh();
    } catch (e) {
      toast({
        variant: "error",
        title: "Brief-Versand fehlgeschlagen",
        description: e instanceof Error ? e.message : "Unbekannter Fehler",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Mailbox className="size-4" /> Postversand (Brief)
        </span>
        <Button size="sm" onClick={onSend} disabled={!canSend} title={disabledReason ?? undefined}>
          <Send /> {busy ? "Übermittle…" : "Brief senden"}
        </Button>
      </div>

      {disabledReason && (
        <p className="mb-2 text-[11px] text-muted-foreground">{disabledReason}</p>
      )}

      {letters.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          <em>Noch kein Brief versendet.</em>
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {letters.map((l) => {
            const meta = STATUS_META[l.status];
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={meta.variant}>{meta.label}</Badge>
                <span>{fmtDate(l.createdAt)}</span>
                {(l.recipientCity || l.recipientCountry) && (
                  <span>
                    {[l.recipientCity, l.recipientCountry].filter(Boolean).join(", ")}
                  </span>
                )}
                {l.costCents != null && <span>{(l.costCents / 100).toFixed(2)} €</span>}
                {l.error && <span className="text-destructive">· {l.error}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
