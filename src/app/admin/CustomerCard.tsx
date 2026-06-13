"use client";

// Per-contact card for the marketing dashboard. Shows the conversation
// transcript (in a Dialog so the card stays compact), persona, discussed
// products and the "chatted but not purchased" flag, and drives the marketing
// workflow:
//
//   Generate draft  → POST /api/admin/marketing/draft  (AI text + unique code + cart)
//   Edit + save     → POST /api/admin/marketing/update (admin edits the draft)
//   Approve & send  → POST /api/admin/marketing/send    (system sends via Resend)
//
// Sent items are clearly marked and become read-only. All gating is server-side
// (the proxy + the route handlers); this component is just the operator UI.
//
// Presentation only: this is the Session-A re-skin onto the shared admin UI kit
// (Card/Badge/Button/Input/Textarea/Dialog/Toast). The control behavior is
// preserved exactly — same endpoints, the "Kein Rabatt" default, the
// depth-changed → Send-disabled → ↻ Neu generieren lockout, the MO-XXXX
// placeholder preview, and read-only sent rows.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, RotateCcw, Save, Send, Sparkles } from "lucide-react";
import {
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_PERCENT_MAX,
  clampDiscountPercent,
} from "@/lib/discount-validation.mjs";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  toast,
} from "./ui";

interface TranscriptMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName: string | null;
}

type PurchaseCheck =
  | { status: "purchased"; orderCount: number; latestOrderName: string | null }
  | { status: "no_purchase" }
  | { status: "unknown" };

interface MarketingSendRow {
  id: number;
  status: "draft" | "approved" | "sent";
  subject: string | null;
  draftedText: string | null;
  discountPercent: number;
  discountCode: string | null;
  discountExpiresAt: string | null;
  cartUrl: string | null;
  sentAt: string | null;
}

export interface MarketingTargetProps {
  captureId: number;
  email: string;
  confirmedAt: string | null;
  personaDisplay: string | null;
  products: Array<{ id: string; name: string }>;
  transcript: TranscriptMessage[];
  purchase: PurchaseCheck;
  latestSend: MarketingSendRow | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("de-DE");
}

/** When present, the card shows a leading selection checkbox (Marketing tab bulk
 * actions). Only passed for contacts eligible for bulk DRAFTING (not yet sent);
 * sent contacts are read-only and never selectable. */
export interface CardSelection {
  selected: boolean;
  onSelectedChange: (next: boolean) => void;
}

export function CustomerCard({
  target,
  selection,
}: {
  target: MarketingTargetProps;
  selection?: CardSelection;
}) {
  const router = useRouter();
  const send = target.latestSend;
  const isSent = send?.status === "sent";
  const hasDraft = Boolean(send) && !isSent;

  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [subject, setSubject] = useState(send?.subject ?? "");
  const [body, setBody] = useState(send?.draftedText ?? "");
  // The selected discount depth. Defaults to the draft's stored depth, or "None"
  // (0) for a fresh card — applying a discount is always a deliberate choice.
  const [discountPercent, setDiscountPercent] = useState<number>(send?.discountPercent ?? 0);
  const [busy, setBusy] = useState<null | "draft" | "save" | "send">(null);

  // When a draft exists but the admin changed the depth, the prose and the
  // (eventual) real code would disagree — force a re-generate before sending.
  const needsRegenerate = hasDraft && send != null && discountPercent !== send.discountPercent;

  async function call(path: string, payload: unknown): Promise<unknown> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((json as { error?: { message?: string } })?.error?.message ?? `Fehler (${res.status})`);
    }
    return json;
  }

  function reportError(e: unknown) {
    toast({
      variant: "error",
      title: "Fehler",
      description: e instanceof Error ? e.message : "Unbekannter Fehler",
    });
  }

  async function onGenerate() {
    setBusy("draft");
    try {
      const json = (await call("/api/admin/marketing/draft", {
        captureId: target.captureId,
        discountPercent,
        // Re-generate (overwrite) when a draft already exists — e.g. the depth
        // changed. A fresh card inserts a new draft.
        regenerate: hasDraft,
      })) as { send?: MarketingSendRow };
      if (json.send) {
        setSubject(json.send.subject ?? "");
        setBody(json.send.draftedText ?? "");
        setDiscountPercent(json.send.discountPercent ?? 0);
      }
      toast({ variant: "success", title: "Entwurf generiert", description: target.email });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    if (!send) return;
    setBusy("save");
    try {
      await call("/api/admin/marketing/update", { sendId: send.id, subject, body });
      toast({ variant: "success", title: "Entwurf gespeichert" });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  async function onSend() {
    if (!send) return;
    if (needsRegenerate) {
      toast({
        variant: "warning",
        title: "Rabatt geändert",
        description: "Bitte zuerst neu generieren, damit Text und Code übereinstimmen.",
      });
      return;
    }
    if (!confirm(`E-Mail an ${target.email} wirklich senden?`)) return;
    setBusy("send");
    try {
      // Persist any unsaved edits first so the sent mail matches the textarea.
      await call("/api/admin/marketing/update", { sendId: send.id, subject, body });
      await call("/api/admin/marketing/send", { sendId: send.id });
      toast({ variant: "success", title: "E-Mail gesendet", description: target.email });
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-5">
      {/* Header: (optional select checkbox +) email + meta on the left, status
          badges on the right */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {selection && (
            <Checkbox
              className="mt-1"
              checked={selection.selected}
              onChange={(e) => selection.onSelectedChange(e.target.checked)}
              aria-label={`${target.email} für Sammelaktion auswählen`}
            />
          )}
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{target.email}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              DOI bestätigt: {fmtDate(target.confirmedAt)}
              {target.personaDisplay ? ` · Persona: ${target.personaDisplay}` : ""}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <PurchaseBadge purchase={target.purchase} />
          {isSent ? (
            <Badge variant="success">✓ Gesendet</Badge>
          ) : hasDraft ? (
            <Badge variant="info">Offener Entwurf</Badge>
          ) : null}
        </div>
      </div>

      {/* Products + transcript trigger */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {target.products.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Besprochen:</span>
            {target.products.map((p) => (
              <Badge key={p.id} variant="secondary">
                {p.name}
              </Badge>
            ))}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => setTranscriptOpen(true)}
        >
          <MessageSquare /> Transkript ({target.transcript.length})
        </Button>
      </div>

      <TranscriptDialog
        open={transcriptOpen}
        onOpenChange={setTranscriptOpen}
        email={target.email}
        transcript={target.transcript}
      />

      {/* Marketing workflow */}
      <div className="mt-4 border-t border-border pt-4">
        {isSent ? (
          <SentPanel send={send!} email={target.email} />
        ) : hasDraft ? (
          <DraftPanel
            captureId={target.captureId}
            subject={subject}
            body={body}
            setSubject={setSubject}
            setBody={setBody}
            busy={busy}
            discountPercent={discountPercent}
            setDiscountPercent={setDiscountPercent}
            needsRegenerate={needsRegenerate}
            onSave={onSave}
            onSend={onSend}
            onGenerate={onGenerate}
          />
        ) : (
          <div>
            <DiscountSelector
              captureId={target.captureId}
              value={discountPercent}
              onChange={setDiscountPercent}
              disabled={busy === "draft"}
            />
            <p className="mt-2 mb-3 text-xs text-muted-foreground">
              Rabatt vor dem Generieren wählen — der Text wird darum herum geschrieben.
              Bei einem Rabatt zeigt der Entwurf einen Platzhalter-Code (
              <code className="rounded bg-muted px-1 py-0.5">MO-XXXX</code>); der echte,
              einmalige Code wird erst beim Versand erzeugt.
            </p>
            <Button onClick={onGenerate} disabled={busy === "draft"}>
              <Sparkles /> {busy === "draft" ? "Generiere Entwurf…" : "Entwurf generieren"}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function TranscriptDialog({
  open,
  onOpenChange,
  email,
  transcript,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  email: string;
  transcript: TranscriptMessage[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Transkript · {email}</DialogTitle>
        </DialogHeader>
        <div className="mt-3 max-h-[60vh] overflow-y-auto rounded-lg bg-muted/50 p-3 text-sm leading-relaxed">
          {transcript.length === 0 ? (
            <em className="text-muted-foreground">
              Kein Transkript verknüpft (Session nicht gefunden).
            </em>
          ) : (
            transcript.map((m, i) => (
              <p key={i} className="mb-2 last:mb-0">
                <strong className={m.role === "user" ? "text-foreground" : "text-accent"}>
                  {m.role === "user" ? "Kunde" : "Berater"}:
                </strong>{" "}
                {m.content}
              </p>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseBadge({ purchase }: { purchase: PurchaseCheck }) {
  if (purchase.status === "no_purchase") {
    return (
      <Badge variant="warning" title="Hat beraten, aber keinen Kauf im Zeitfenster">
        ★ Beraten, nicht gekauft
      </Badge>
    );
  }
  if (purchase.status === "purchased") {
    return (
      <Badge variant="success" title={purchase.latestOrderName ?? undefined}>
        ✓ Hat gekauft
      </Badge>
    );
  }
  return <Badge variant="secondary">Kaufstatus unbekannt</Badge>;
}

function SentPanel({ send, email }: { send: MarketingSendRow; email: string }) {
  return (
    <div>
      <Badge variant="success">✓ Gesendet am {fmtDate(send.sentAt)}</Badge>
      <div className="mt-3 text-sm">
        <div className="text-xs text-muted-foreground">Betreff</div>
        <div className="font-semibold">{send.subject || "—"}</div>
        {send.discountPercent > 0 && (
          <div className="mt-2 text-xs text-muted-foreground">
            Rabatt: {send.discountPercent} %
            {send.discountCode ? (
              <>
                {" "}
                · Code: <code className="rounded bg-muted px-1 py-0.5">{send.discountCode}</code>
              </>
            ) : null}
            {send.discountExpiresAt ? ` (gültig bis ${fmtDate(send.discountExpiresAt)})` : ""}
          </div>
        )}
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-accent">
            Gesendeten Text anzeigen
          </summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-sans text-sm">
            {send.draftedText}
          </pre>
        </details>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Versendet über das System an {email} — Abmeldelink automatisch angehängt.
        </p>
      </div>
    </div>
  );
}

// Numeric discount input: a whole percent in [0, 50], DEFAULT 0. 0 = no code is
// minted and no discount block appears in the email; >0 mints the unique MS5-
// code at send time with this percentage. Bounds mirror the server
// (lib/discount-validation.mjs) and are clamped on change.
function DiscountSelector({
  captureId,
  value,
  onChange,
  disabled,
}: {
  captureId: number;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  const id = `ms-discount-${captureId}`;
  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 block text-muted-foreground">
        Persönlicher Rabatt (%)
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={DISCOUNT_PERCENT_MIN}
          max={DISCOUNT_PERCENT_MAX}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(clampDiscountPercent(e.target.valueAsNumber))}
          className="w-24"
        />
        <span className="text-xs text-muted-foreground">
          {value === 0
            ? "0 = kein Rabatt, kein Code"
            : `${DISCOUNT_PERCENT_MIN}–${DISCOUNT_PERCENT_MAX} %`}
        </span>
      </div>
    </div>
  );
}

function DraftPanel({
  captureId,
  subject,
  body,
  setSubject,
  setBody,
  busy,
  discountPercent,
  setDiscountPercent,
  needsRegenerate,
  onSave,
  onSend,
  onGenerate,
}: {
  captureId: number;
  subject: string;
  body: string;
  setSubject: (v: string) => void;
  setBody: (v: string) => void;
  busy: null | "draft" | "save" | "send";
  discountPercent: number;
  setDiscountPercent: (v: number) => void;
  needsRegenerate: boolean;
  onSave: () => void;
  onSend: () => void;
  onGenerate: () => void;
}) {
  return (
    <div>
      <Badge variant="info">Entwurf — noch nicht gesendet</Badge>

      <div className="mt-3 mb-1">
        <DiscountSelector
          captureId={captureId}
          value={discountPercent}
          onChange={setDiscountPercent}
          disabled={busy !== null}
        />
      </div>

      {needsRegenerate ? (
        <div className="my-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <span>
            Rabatt geändert auf {discountPercent === 0 ? "Kein Rabatt" : `${discountPercent} %`} —
            der aktuelle Text passt nicht mehr.
          </span>
          <Button variant="secondary" size="sm" onClick={onGenerate} disabled={busy !== null}>
            <RotateCcw /> {busy === "draft" ? "Generiere…" : "Neu generieren"}
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {discountPercent > 0
            ? `Vorschau mit Platzhalter-Code MO-XXXX. Den Platzhalter im Text bitte nicht ändern — er wird beim Versand durch den echten, einmaligen ${discountPercent}%-Code ersetzt.`
            : "Kein Rabatt gewählt — der Text nennt keinen Code, der Warenkorb-Link enthält keinen Rabatt."}
        </p>
      )}

      <Label htmlFor="ms-subject" className="mt-3 mb-1 block text-muted-foreground">
        Betreff
      </Label>
      <Input id="ms-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />

      <Label htmlFor="ms-body" className="mt-3 mb-1 block text-muted-foreground">
        E-Mail-Text (bearbeitbar)
      </Label>
      <Textarea
        id="ms-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={10}
        className="resize-y"
      />

      <div className="mt-2 text-xs text-muted-foreground">
        {discountPercent > 0
          ? `Beim Versand: einmaliger ${discountPercent}%-Code wird erzeugt und automatisch als vorausgefüllter Warenkorb-Button & Abmeldelink angehängt.`
          : "Beim Versand werden Warenkorb-Button & Abmeldelink automatisch angehängt."}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onSave} disabled={busy !== null}>
          <Save /> {busy === "save" ? "Speichere…" : "Entwurf speichern"}
        </Button>
        <Button
          onClick={onSend}
          disabled={busy !== null || needsRegenerate}
          title={needsRegenerate ? "Bitte zuerst neu generieren" : undefined}
        >
          <Send /> {busy === "send" ? "Sende…" : "Freigeben & senden"}
        </Button>
      </div>
    </div>
  );
}
