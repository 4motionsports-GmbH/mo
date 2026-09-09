"use client";

// Brief — physical mail (docs/EMAIL_SUBSYSTEM_SPIKE.md §4), a SEPARATE flow
// from the email: generate a letter-optimised draft, edit, preview the PDF,
// send via Pingen. Sending is disabled (with the reason) until a complete,
// lawfully held postal address, the feature flag and the Pingen config exist.

import * as React from "react";
import { Eye, Mailbox, Save, Send, Sparkles } from "lucide-react";
import type { CustomerDetail } from "@/lib/customer-detail";
import type { PhysicalLetterRow } from "@/lib/physical-letters-store";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eurFromCents, plural } from "@/lib/admin-format.mjs";
import {
  Button,
  EmptyState,
  Field,
  InfoTip,
  Input,
  StatusBadge,
  Textarea,
  Tooltip,
  toast,
  useConfirm,
  type StatusTone,
} from "../../ui";
import { adminFetch, errorMessage } from "../../lib/admin-fetch";
import { useCustomerActions } from "../CustomerDetail";

// Display fallback per letter when Pingen hasn't reported a price (mirrors the
// server default PINGEN_LETTER_COST_CENTS). Used only for the panel's estimate.
const DEFAULT_LETTER_COST_CENTS = 106;

const STATUS_META: Record<PhysicalLetterRow["status"], { label: string; tone: StatusTone }> = {
  pending: { label: "Angelegt", tone: "neutral" },
  submitted: { label: "Übermittelt", tone: "info" },
  queued: { label: "In Warteschlange", tone: "info" },
  printing: { label: "Wird gedruckt", tone: "info" },
  printed: { label: "Gedruckt", tone: "info" },
  posted: { label: "Versendet", tone: "success" },
  failed: { label: "Fehler", tone: "destructive" },
  cancelled: { label: "Storniert", tone: "neutral" },
  undeliverable: { label: "Unzustellbar", tone: "destructive" },
};

/** POST for a binary response (the letter PDF) with the JSON error envelope. */
async function fetchPdf(path: string, payload: unknown): Promise<Blob> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
  }
  return res.blob();
}

export function BriefTab({ customer }: { customer: CustomerDetail }) {
  const { refresh } = useCustomerActions();
  const { confirm, confirmDialog } = useConfirm();
  const [instructions, setInstructions] = React.useState("");
  const [subject, setSubject] = React.useState(customer.letterDraftSubject ?? "");
  const [body, setBody] = React.useState(customer.letterDraftBody ?? "");
  const [busy, setBusy] = React.useState<null | "gen" | "save" | "send" | "preview">(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const hasDraft = body.trim().length > 0;
  const letters = customer.physicalLetters;

  React.useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const fail = (e: unknown) =>
    toast({ variant: "error", title: "Fehler", description: errorMessage(e) });

  async function draftCall(payload: unknown): Promise<{ subject?: string; body?: string }> {
    const json = await adminFetch<{ letterDraft?: { subject?: string; body?: string } }>(
      "/api/admin/customers/letter-draft",
      { body: payload }
    );
    return json.letterDraft ?? {};
  }

  async function loadPreview(nextSubject: string, nextBody: string) {
    setBusy("preview");
    try {
      const blob = await fetchPdf("/api/admin/customers/letter-preview", {
        customerId: customer.id,
        subject: nextSubject,
        body: nextBody,
      });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function onGenerate() {
    setBusy("gen");
    try {
      const draft = await draftCall({
        customerId: customer.id,
        adminInstructions: instructions.trim() || null,
      });
      const s = draft.subject ?? "";
      const b = draft.body ?? "";
      setSubject(s);
      setBody(b);
      toast({ variant: "success", title: "Brief-Entwurf generiert", description: customer.email });
      await loadPreview(s, b);
    } catch (e) {
      fail(e);
      setBusy(null);
    }
  }

  async function onSave() {
    if (!body.trim()) return;
    setBusy("save");
    try {
      await draftCall({ customerId: customer.id, save: true, subject: subject.trim(), body });
      toast({ variant: "success", title: "Brief-Entwurf gespeichert" });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function onSend() {
    const ok = await confirm({
      title: `Brief an ${customer.email} versenden?`,
      description: "Der Brief wird als PDF gerendert und über Pingen an die hinterlegte Postadresse geschickt.",
      confirmLabel: "Brief senden",
    });
    if (!ok) return;
    setBusy("send");
    try {
      // Persist any unsaved edits first so the printed letter matches the textarea.
      await draftCall({ customerId: customer.id, save: true, subject: subject.trim(), body });
      await adminFetch("/api/admin/physical/send", { body: { customerId: customer.id } });
      toast({ variant: "success", title: "Brief übermittelt", description: customer.email });
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;
  const sendDisabledReason = !customer.physicalEligible
    ? customer.physicalReason
    : !hasDraft
      ? "Zuerst einen Brief-Entwurf generieren."
      : null;
  const sent = letters.filter((l) => l.status !== "pending" && l.status !== "failed");
  const totalCents = sent.reduce((sum, l) => sum + (l.costCents ?? DEFAULT_LETTER_COST_CENTS), 0);

  return (
    <div className="flex flex-col gap-4">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Mailbox className="size-4 text-muted-foreground" aria-hidden /> Brief (Postversand)
          <InfoTip>
            Eigener, für den Druck optimierter Text (kein Warenkorb-Button, kein Abmeldelink). Wird
            als PDF gerendert und über Pingen an die hinterlegte Postadresse versendet.
          </InfoTip>
        </span>
        <Button variant="secondary" size="sm" onClick={onGenerate} loading={busy === "gen"} disabled={disabled}>
          <Sparkles /> {hasDraft ? "Neu generieren" : "Brief-Entwurf generieren"}
        </Button>
      </div>

      <Field label="Hinweise für den Brief (optional)">
        <Textarea
          id={`letter-instr-${customer.id}`}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={2}
          maxLength={2000}
          disabled={disabled}
          className="min-h-0 resize-y"
          placeholder='z. B. „Lieferung nach Österreich erwähnen“, „auf die neue Rudergeräte-Linie hinweisen“'
        />
      </Field>

      {hasDraft && (
        <div className="flex flex-col gap-3">
          <Field label="Betreff">
            <Input
              id={`letter-subject-${customer.id}`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={disabled}
              placeholder="Briefbetreff"
            />
          </Field>
          <Field label="Brieftext">
            <Textarea
              id={`letter-body-${customer.id}`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              maxLength={20000}
              disabled={disabled}
              className="resize-y"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={onSave} loading={busy === "save"} disabled={disabled}>
              <Save /> Speichern
            </Button>
            <Button
              variant="outline"
              onClick={() => void loadPreview(subject.trim(), body)}
              loading={busy === "preview"}
              disabled={disabled}
            >
              <Eye /> Vorschau aktualisieren
            </Button>
            <Tooltip content={sendDisabledReason ?? ""} disabled={!sendDisabledReason}>
              <span className="inline-flex">
                <Button onClick={onSend} loading={busy === "send"} disabled={disabled || Boolean(sendDisabledReason)}>
                  <Send /> Brief senden
                </Button>
              </span>
            </Tooltip>
            {sendDisabledReason && (
              <span className="text-xs text-muted-foreground">{sendDisabledReason}</span>
            )}
          </div>

          {previewUrl && (
            <Field
              label="PDF-Vorschau"
              info="Nach Textänderungen „Vorschau aktualisieren“ klicken. Ohne hinterlegte Adresse zeigt die Vorschau einen Platzhalter im Adressfeld."
            >
              <iframe
                title="Brief-Vorschau"
                src={previewUrl}
                className="h-[520px] w-full rounded-md border border-border bg-white"
              />
            </Field>
          )}
        </div>
      )}

      {!hasDraft && sendDisabledReason && customer.physicalEligible === false && (
        <p className="text-xs text-muted-foreground">{sendDisabledReason}</p>
      )}

      <div className="border-t border-border pt-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Versendete Briefe
          {sent.length > 0 && (
            <>
              {" "}
              · {plural(sent.length, "Brief", "Briefe")} · Porto ~{eurFromCents(totalCents)}
            </>
          )}
        </div>
        {letters.length === 0 ? (
          <EmptyState compact plain title="Noch kein Brief versendet." />
        ) : (
          <ol className="flex flex-col gap-1">
            {letters.map((l) => {
              const meta = STATUS_META[l.status];
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                  <span>{formatAdmin(l.createdAt, ADMIN_DATE)}</span>
                  {l.subject && <span className="truncate">„{l.subject}“</span>}
                  {(l.recipientCity || l.recipientCountry) && (
                    <span>{[l.recipientCity, l.recipientCountry].filter(Boolean).join(", ")}</span>
                  )}
                  {l.costCents != null && <span>{eurFromCents(l.costCents)}</span>}
                  {l.error && <span className="text-destructive">· {l.error}</span>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
