"use client";

// "Brief" — the physical-mail workflow (docs/EMAIL_SUBSYSTEM_SPIKE.md §4), a
// SEPARATE flow from the email: the operator generates a letter-optimised draft
// (own text, no cart/discount/unsubscribe), reviews/edits it, then sends it. The
// server renders it to a print PDF and submits it to Pingen.
//
// The whole path is gated: the "Brief senden" button is DISABLED (with a clear
// reason) when the customer has no complete, lawfully-held postal address, when
// Pingen isn't configured, or when PHYSICAL_MAIL_SENDS_APPROVED is off — we never
// guess or part-fill an address. Existing letters show as status chips.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mailbox, Save, Send, Sparkles } from "lucide-react";
import { Badge, Button, Input, Label, Textarea, toast, type BadgeProps } from "./ui";

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

function reportError(e: unknown) {
  toast({
    variant: "error",
    title: "Fehler",
    description: e instanceof Error ? e.message : "Unbekannter Fehler",
  });
}

export function PhysicalLetterPanel({
  customerId,
  customerEmail,
  eligible,
  reason,
  letters,
  initialSubject,
  initialBody,
}: {
  customerId: number;
  customerEmail: string;
  eligible: boolean;
  /** Why the action is disabled (address/flag/config), shown to the operator. */
  reason: string | null;
  letters: PhysicalLetterProps[];
  initialSubject: string | null;
  initialBody: string | null;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject ?? "");
  const [body, setBody] = useState(initialBody ?? "");
  const [busy, setBusy] = useState<null | "gen" | "save" | "send">(null);
  const hasDraft = body.trim().length > 0;

  async function call(payload: unknown): Promise<{ subject?: string; body?: string }> {
    const res = await fetch("/api/admin/customers/letter-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => ({}))) as {
      letterDraft?: { subject?: string; body?: string };
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
    return json.letterDraft ?? {};
  }

  async function onGenerate() {
    setBusy("gen");
    try {
      const draft = await call({ customerId });
      setSubject(draft.subject ?? "");
      setBody(draft.body ?? "");
      toast({ variant: "success", title: "Brief-Entwurf generiert", description: customerEmail });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    if (!body.trim()) return;
    setBusy("save");
    try {
      await call({ customerId, save: true, subject: subject.trim(), body });
      toast({ variant: "success", title: "Brief-Entwurf gespeichert" });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function onSend() {
    if (!confirm(`Brief an ${customerEmail} über Pingen versenden?`)) return;
    setBusy("send");
    try {
      // Persist any unsaved edits first so the printed letter matches the textarea.
      await call({ customerId, save: true, subject: subject.trim(), body });
      const res = await fetch("/api/admin/physical/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
      toast({ variant: "success", title: "Brief übermittelt", description: customerEmail });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  const canSend = eligible && hasDraft && busy === null;
  const sendDisabledReason = !eligible ? reason : !hasDraft ? "Zuerst einen Brief-Entwurf generieren." : null;

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Mailbox className="size-4" /> Brief (Postversand)
        </span>
        <Button variant="secondary" size="sm" onClick={onGenerate} disabled={busy !== null}>
          <Sparkles /> {busy === "gen" ? "Generiere…" : hasDraft ? "Neu generieren" : "Brief-Entwurf generieren"}
        </Button>
      </div>

      <p className="mb-2 text-[11px] text-muted-foreground">
        Eigener, für den Druck optimierter Text (kein Warenkorb-Button, kein Abmeldelink). Wird als
        PDF gerendert und über Pingen an die hinterlegte Postadresse versendet.
      </p>

      {hasDraft && (
        <div className="mb-3">
          <Label htmlFor={`letter-subject-${customerId}`} className="mb-1 block text-muted-foreground">
            Betreff
          </Label>
          <Input
            id={`letter-subject-${customerId}`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={busy !== null}
            placeholder="Briefbetreff"
          />
          <Label htmlFor={`letter-body-${customerId}`} className="mb-1 mt-3 block text-muted-foreground">
            Brieftext (bearbeitbar)
          </Label>
          <Textarea
            id={`letter-body-${customerId}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            maxLength={20000}
            disabled={busy !== null}
            className="resize-y"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onSave} disabled={busy !== null}>
              <Save /> {busy === "save" ? "Speichere…" : "Entwurf speichern"}
            </Button>
            <Button onClick={onSend} disabled={!canSend} title={sendDisabledReason ?? undefined}>
              <Send /> {busy === "send" ? "Übermittle…" : "Brief senden"}
            </Button>
          </div>
        </div>
      )}

      {sendDisabledReason && <p className="mb-2 text-[11px] text-muted-foreground">{sendDisabledReason}</p>}

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
                  <span>{[l.recipientCity, l.recipientCountry].filter(Boolean).join(", ")}</span>
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
