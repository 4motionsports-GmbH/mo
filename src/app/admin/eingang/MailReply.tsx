"use client";

// E-Mails im Eingang — the right pane of an „E-Mail beantworten“ item: the
// conversation (the item's mails highlighted, earlier ones folded), the AI
// summary with a reply draft (written on first open, a service reply — never
// advertising), and the reply itself: edit, „Antwort senden“ (confirmed), and
// the item closes. The reply goes through the same path as Kunden →
// Korrespondenz (/api/admin/correspondence/send, threaded).

import * as React from "react";
import Link from "next/link";
import { Mail, Paperclip, Send, Sparkles } from "lucide-react";
import type { InboxItem } from "@/lib/inbox-store";
import { MAIL_INTENT_LABELS } from "@/lib/inbox-mail-core.mjs";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import { ADMIN_DATE_TIME_PADDED, formatAdmin } from "@/lib/admin-datetime.mjs";
import { plural } from "@/lib/admin-format.mjs";
import { Button, Callout, Disclosure, Field, InfoTip, Input, StatusBadge, Textarea, cn, toast, useConfirm } from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import type { InboxCustomerCard, InboxMailThread } from "./types";

type Message = InboxMailThread["messages"][number];

const URGENCY: Record<string, { label: string; tone: "destructive" | "warning" | "neutral" }> = {
  hoch: { label: "Dringend", tone: "destructive" },
  mittel: { label: "Normal", tone: "warning" },
  niedrig: { label: "Kann warten", tone: "neutral" },
};

export function MailReply({
  item,
  customer,
  mail,
  open,
  sendRef,
  onSuggestion,
  onSent,
}: {
  item: InboxItem;
  customer: InboxCustomerCard | null;
  mail: InboxMailThread | null;
  /** The item is open (not decided) — the reply form is shown. */
  open: boolean;
  /** The pane's primary action (Enter) — „Antwort senden“. */
  sendRef: React.MutableRefObject<() => void>;
  onSuggestion: (s: InboxItem["suggestion"]) => void;
  onSent: () => void;
}) {
  const s = item.suggestion;
  const [subject, setSubject] = React.useState(s?.betreff ?? "");
  const [body, setBody] = React.useState(s?.text ?? "");
  const [edited, setEdited] = React.useState(false);
  const [drafting, setDrafting] = React.useState(false);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const autoDrafted = React.useRef(false);

  // A fresh draft fills the form unless the operator already typed.
  React.useEffect(() => {
    if (!s || edited) return;
    setSubject(s.betreff ?? "");
    setBody(s.text ?? "");
  }, [s, edited]);

  const draft = React.useCallback(async () => {
    setDrafting(true);
    setDraftError(null);
    try {
      const json = await adminFetch<{ suggestion: InboxItem["suggestion"] }>("/api/admin/inbox/suggest", { body: { id: item.id } });
      setEdited(false);
      onSuggestion(json.suggestion);
    } catch (e) {
      setDraftError(errorMessage(e));
    } finally {
      setDrafting(false);
    }
  }, [item.id, onSuggestion]);

  // Written once on first open of an item without a draft.
  React.useEffect(() => {
    if (!open || s || autoDrafted.current || !mail?.messages.some((m) => m.direction === "received")) return;
    autoDrafted.current = true;
    void draft();
  }, [open, s, mail, draft]);

  const send = React.useCallback(async () => {
    if (!customer || !body.trim()) return;
    const ok = await confirm({
      title: "Antwort senden?",
      description: `An ${customer.email}${subject.trim() ? ` — „${subject.trim()}“` : ""}. Die Antwort steht danach in der Korrespondenz der Person.`,
      confirmLabel: "Senden",
    });
    if (!ok) return;
    setSending(true);
    try {
      await adminFetch("/api/admin/correspondence/send", {
        body: { customerId: customer.id, subject: subject.trim(), body, inReplyToMessageId: mail?.replyToMessageId ?? undefined },
      });
      toast({ variant: "success", title: "Antwort gesendet", description: customer.email });
      onSent();
    } catch (e) {
      toast({ variant: "error", title: "Nicht gesendet", description: errorMessage(e) });
    } finally {
      setSending(false);
    }
  }, [customer, body, subject, mail, confirm, onSent]);

  React.useEffect(() => {
    sendRef.current = () => void send();
  });

  const messages = mail?.messages ?? [];
  const firstNew = messages.findIndex((m) => m.isNew);
  const earlier = firstNew > 0 ? messages.slice(0, firstNew) : [];
  const current = firstNew >= 0 ? messages.slice(firstNew) : messages.slice(-1);
  const historyHref = item.customerId != null ? adminTabHref("kunden", { customer: String(item.customerId), ctab: "korrespondenz" }) : null;
  const urgency = s?.dringlichkeit ? URGENCY[s.dringlichkeit] : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Mail className="size-4 text-muted-foreground" aria-hidden />
          {current.filter((m) => m.direction === "received").length > 1
            ? plural(current.filter((m) => m.direction === "received").length, "E-Mail", "E-Mails")
            : "E-Mail"}
          {historyHref && (
            <Link href={historyHref} className="ml-auto text-xs font-normal text-muted-foreground hover:text-foreground hover:underline">
              Ganzer Verlauf
            </Link>
          )}
        </div>
        {messages.length === 0 && <p className="text-xs text-muted-foreground">Die E-Mail ist nicht mehr gespeichert.</p>}
        {earlier.length > 0 && (
          <Disclosure title={`Früherer Verlauf (${earlier.length})`} framed={false} contentClassName="flex flex-col gap-2 pt-2">
            {earlier.map((m) => (
              <MessageCard key={m.id} message={m} muted />
            ))}
          </Disclosure>
        )}
        {current.map((m) => (
          <MessageCard key={m.id} message={m} />
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
          KI-Zusammenfassung
          <InfoTip>
            Von der KI aus der E-Mail, dem Verlauf, den letzten Bestellungen und dem Profil. Der Entwurf ist eine
            Service-Antwort — keine Werbung, keine Rabatte, keine erfundenen Angaben; offene Punkte stehen in eckigen
            Klammern. Gesendet wird erst nach deiner Prüfung.
          </InfoTip>
          {s?.anliegen && (
            <StatusBadge tone="neutral" dot={false}>
              {MAIL_INTENT_LABELS[s.anliegen as keyof typeof MAIL_INTENT_LABELS] ?? s.anliegen}
            </StatusBadge>
          )}
          {urgency && <StatusBadge tone={urgency.tone}>{urgency.label}</StatusBadge>}
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => void draft()} loading={drafting}>
            <Sparkles /> {s ? "Neuer Entwurf" : "Entwurf schreiben"}
          </Button>
        </div>
        {s ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-border p-3 text-sm">
            <p>{s.warum}</p>
            {s.aktion && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Vor dem Senden:</span> {s.aktion}
              </p>
            )}
            {s.offenePunkte && s.offenePunkte.length > 0 && (
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {s.offenePunkte.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        ) : drafting ? (
          <p className="text-xs text-muted-foreground">Die KI liest die E-Mail …</p>
        ) : draftError ? (
          <Callout tone="info" compact>
            {draftError} Die Antwort kannst du auch selbst schreiben.
          </Callout>
        ) : (
          <p className="text-xs text-muted-foreground">Noch kein Entwurf.</p>
        )}
      </section>

      {open && (
        <section className="flex flex-col gap-3 rounded-md border border-border bg-surface-2 p-3">
          <div className="text-sm font-semibold">Antwort an {customer?.name ?? customer?.email ?? "die Person"}</div>
          <Field label="Betreff" htmlFor={`reply-subject-${item.id}`}>
            <Input
              id={`reply-subject-${item.id}`}
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setEdited(true);
              }}
              placeholder="Re: …"
            />
          </Field>
          <Field label="Text" htmlFor={`reply-body-${item.id}`}>
            <Textarea
              id={`reply-body-${item.id}`}
              rows={11}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setEdited(true);
              }}
              placeholder={drafting ? "Der Entwurf kommt gleich …" : "Antwort schreiben …"}
            />
          </Field>
          {/\[[^\]]+\]/.test(body) && (
            <p className="text-xs text-warning">Der Text enthält noch Platzhalter in eckigen Klammern.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void send()} loading={sending} disabled={!customer || !body.trim()}>
              <Send /> Antwort senden
            </Button>
            <span className="text-xs text-muted-foreground">Danach ist der Eintrag erledigt.</span>
          </div>
        </section>
      )}
      {confirmDialog}
    </div>
  );
}

function MessageCard({ message: m, muted = false }: { message: Message; muted?: boolean }) {
  const received = m.direction === "received";
  return (
    <article
      className={cn(
        "rounded-md border p-3 text-sm",
        received && m.isNew ? "border-accent/40 bg-accent-soft/40" : "border-border",
        muted && "opacity-80"
      )}
    >
      <header className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{received ? m.fromAddress : "Wir"}</span>
        {m.occurredAt && <span>{formatAdmin(m.occurredAt, ADMIN_DATE_TIME_PADDED)}</span>}
        {m.attachmentCount > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <Paperclip className="size-3" aria-hidden /> {m.attachmentCount}
          </span>
        )}
      </header>
      {m.subject && <div className="mb-1 font-medium">{m.subject}</div>}
      <p className={cn("whitespace-pre-wrap break-words text-sm", !received && "text-muted-foreground")}>
        {m.text || "(kein Text)"}
      </p>
    </article>
  );
}
