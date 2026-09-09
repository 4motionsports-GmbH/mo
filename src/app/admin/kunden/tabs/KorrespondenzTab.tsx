"use client";

// Korrespondenz — the per-customer email client (docs/EMAIL_SUBSYSTEM_SPIKE.md
// §5): sent + received mail grouped by thread, bodies loaded lazily on expand,
// compose / reply through the central sendEmail() choke-point.

import * as React from "react";
import { Mail, MailOpen, Paperclip, Reply, Send, X } from "lucide-react";
import type { CustomerDetail } from "@/lib/customer-detail";
import type { CorrespondenceMessage } from "@/lib/email-messages-store";
import { ADMIN_DATE_TIME_PADDED, formatAdmin } from "@/lib/admin-datetime.mjs";
import { plural } from "@/lib/admin-format.mjs";
import {
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  InfoTip,
  Input,
  Markdown,
  Spinner,
  StatusBadge,
  Textarea,
  toast,
  useConfirm,
} from "../../ui";
import { adminFetch, errorMessage } from "../../lib/admin-fetch";
import { EmailPreviewButton } from "../../EmailPreviewButton";
import { useCustomerActions } from "../CustomerDetail";

interface FetchedBody {
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: Array<{ filename: string | null; content_type: string | null; size: number | null }>;
}

/** Normalised grouping key (mirrors email-inbound-core.threadKey, inlined so this
 * client component doesn't pull the node:crypto-importing server core into the
 * browser bundle). */
function threadKey(id: string | null): string {
  if (!id) return "";
  return id.trim().replace(/^</, "").replace(/>$/, "").trim().toLowerCase();
}

function cmpTime(a: string | null, b: string | null): number {
  const ta = a ? new Date(a).getTime() : 0;
  const tb = b ? new Date(b).getTime() : 0;
  return ta - tb;
}

function groupThreads(messages: CorrespondenceMessage[]) {
  const map = new Map<string, CorrespondenceMessage[]>();
  for (const m of messages) {
    const key = threadKey(m.threadId) || threadKey(m.messageId) || `id:${m.id}`;
    const list = map.get(key);
    if (list) list.push(m);
    else map.set(key, [m]);
  }
  const threads = Array.from(map.entries()).map(([key, list]) => {
    const ordered = [...list].sort((a, b) => cmpTime(a.occurredAt, b.occurredAt) || a.id - b.id);
    return { key, messages: ordered, latest: ordered[ordered.length - 1] };
  });
  threads.sort(
    (a, b) => cmpTime(b.latest.occurredAt, a.latest.occurredAt) || b.latest.id - a.latest.id
  );
  return threads;
}

function prefixRe(subject: string): string {
  const s = subject.trim();
  if (!s) return "";
  return /^\s*(re|aw)\s*(\[\d+\])?\s*:/i.test(s) ? s : `Re: ${s}`;
}

export function KorrespondenzTab({ customer }: { customer: CustomerDetail }) {
  const messages = customer.correspondence;
  const [composing, setComposing] = React.useState(false);
  const [replyTo, setReplyTo] = React.useState<number | null>(null);
  const threads = React.useMemo(() => groupThreads(messages), [messages]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Korrespondenz
          <InfoTip>
            Alle E-Mails mit diesem Kunden (gesendet und eingegangen), nach Thread gruppiert.
            Antworten des Kunden auf unsere Adresse landen automatisch hier.
          </InfoTip>
          <span className="text-xs font-normal text-muted-foreground">
            {messages.length === 0
              ? "· noch keine E-Mails"
              : `· ${plural(messages.length, "Nachricht", "Nachrichten")} in ${plural(threads.length, "Thread", "Threads")}`}
          </span>
        </span>
        <Button
          size="sm"
          onClick={() => {
            setReplyTo(null);
            setComposing(true);
          }}
          disabled={composing && replyTo === null}
        >
          <Mail /> Neue E-Mail
        </Button>
      </div>

      {composing && (
        <Composer
          customerId={customer.id}
          customerEmail={customer.email}
          inReplyToMessageId={replyTo}
          replyContext={replyTo != null ? messages.find((m) => m.id === replyTo) ?? null : null}
          onClose={() => setComposing(false)}
        />
      )}

      {threads.length === 0 ? (
        <EmptyState
          compact
          icon={<Mail />}
          title="Noch kein E-Mail-Verlauf"
          description="Sobald du eine E-Mail schreibst oder der Kunde antwortet, erscheint hier der Verlauf."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {threads.map((t) => (
            <ThreadCard
              key={t.key}
              messages={t.messages}
              onReply={() => {
                setReplyTo(t.latest.id);
                setComposing(true);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadCard({
  messages,
  onReply,
}: {
  messages: CorrespondenceMessage[];
  onReply: () => void;
}) {
  const subject = messages.find((m) => m.subject)?.subject ?? "(kein Betreff)";
  return (
    <Card className="bg-surface-2 p-3 shadow-none">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-semibold">{subject}</div>
        <Button variant="ghost" size="sm" onClick={onReply}>
          <Reply /> Antworten
        </Button>
      </div>
      <ol className="flex flex-col gap-1.5">
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
      </ol>
    </Card>
  );
}

function MessageRow({ message }: { message: CorrespondenceMessage }) {
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState<FetchedBody | null>(null);
  const [loading, setLoading] = React.useState(false);
  const isReceived = message.direction === "received";

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (body || loading) return;
    setLoading(true);
    try {
      const json = await adminFetch<FetchedBody>("/api/admin/correspondence/message", {
        body: { id: message.id },
      });
      setBody({
        bodyText: json.bodyText ?? null,
        bodyHtml: json.bodyHtml ?? null,
        attachments: json.attachments ?? [],
      });
    } catch (e) {
      toast({ variant: "error", title: "Inhalt konnte nicht geladen werden", description: errorMessage(e) });
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <li className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <StatusBadge tone={isReceived ? "accent" : "neutral"} icon={isReceived ? <MailOpen /> : <Send />}>
          {isReceived ? "Eingegangen" : "Gesendet"}
        </StatusBadge>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {message.snippet || <em>(kein Vorschautext)</em>}
        </span>
        {message.attachmentCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
            <Paperclip className="size-3" aria-hidden /> {message.attachmentCount}
          </span>
        )}
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {formatAdmin(message.occurredAt, ADMIN_DATE_TIME_PADDED)}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-2.5 py-2">
          <div className="mb-1.5 text-2xs text-muted-foreground">
            Von {message.fromAddress || "—"} · An {message.toAddress || "—"}
            {message.marketingSendId != null ? " · Marketing-Versand" : ""}
          </div>
          {loading ? <Spinner size="sm" label="Inhalt wird geladen" /> : <MessageBody body={body} />}
        </div>
      )}
    </li>
  );
}

/** Render a fetched body through the sanitized Markdown renderer. Prefer the
 * plain text; if only HTML exists, strip tags to text (never inject raw HTML). */
function MessageBody({ body }: { body: FetchedBody | null }) {
  if (!body) return <p className="text-sm text-muted-foreground"><em>Kein Inhalt.</em></p>;
  const text = body.bodyText?.trim()
    ? body.bodyText
    : body.bodyHtml
      ? body.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      : "";
  return (
    <>
      {text ? (
        <Markdown content={text} className="rounded-md bg-surface-2 p-2.5" />
      ) : (
        <p className="text-sm text-muted-foreground"><em>Kein Textinhalt.</em></p>
      )}
      {body.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {body.attachments.map((a, i) => (
            <StatusBadge key={i} tone="neutral" icon={<Paperclip />}>
              {a.filename || "Anhang"}
            </StatusBadge>
          ))}
        </div>
      )}
    </>
  );
}

function Composer({
  customerId,
  customerEmail,
  inReplyToMessageId,
  replyContext,
  onClose,
}: {
  customerId: number;
  customerEmail: string;
  inReplyToMessageId: number | null;
  replyContext: CorrespondenceMessage | null;
  onClose: () => void;
}) {
  const { refresh } = useCustomerActions();
  const { confirm, confirmDialog } = useConfirm();
  const isReply = inReplyToMessageId != null;
  const [subject, setSubject] = React.useState(isReply ? prefixRe(replyContext?.subject ?? "") : "");
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function onSend() {
    if (!text.trim()) {
      toast({ variant: "warning", title: "Leerer Text", description: "Bitte einen Nachrichtentext eingeben." });
      return;
    }
    const ok = await confirm({
      title: `E-Mail an ${customerEmail} senden?`,
      description: subject.trim() ? `Betreff: ${subject.trim()}` : "Ohne Betreff.",
      confirmLabel: "Senden",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await adminFetch("/api/admin/correspondence/send", {
        body: {
          customerId,
          subject: subject.trim() || undefined,
          body: text,
          inReplyToMessageId: inReplyToMessageId ?? undefined,
        },
      });
      toast({ variant: "success", title: "E-Mail gesendet", description: customerEmail });
      onClose();
      refresh();
    } catch (e) {
      toast({ variant: "error", title: "Senden fehlgeschlagen", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-accent/40 p-3 shadow-none">
      {confirmDialog}
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {isReply ? "Antwort an " : "Neue E-Mail an "}
          {customerEmail}
          <InfoTip>
            Wird über den zentralen Versandweg gesendet (Absender: motion sports). Antworten des
            Kunden landen wieder hier im Verlauf.
          </InfoTip>
        </span>
        <IconButton label="Schließen" size="icon-sm" onClick={onClose} disabled={busy}>
          <X />
        </IconButton>
      </div>
      <div className="flex flex-col gap-3">
        <Field label="Betreff">
          <Input
            id={`corr-subject-${customerId}`}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={busy}
            placeholder={isReply ? "Re: …" : "Betreff der E-Mail"}
          />
        </Field>
        <Field label="Nachricht">
          <Textarea
            id={`corr-body-${customerId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            maxLength={20000}
            disabled={busy}
            className="resize-y"
            placeholder="Deine Nachricht an den Kunden…"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSend} loading={busy}>
            <Send /> Senden
          </Button>
          <EmailPreviewButton
            path="/api/admin/correspondence/email-preview"
            getPayload={() => ({ body: text })}
            title={`Vorschau — ${customerEmail}`}
            description="So wird deine Nachricht beim Kunden gerendert — bewusst schlichtes Text-Layout ohne Marketing-Elemente."
            disabled={busy || !text.trim()}
          />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
        </div>
      </div>
    </Card>
  );
}
