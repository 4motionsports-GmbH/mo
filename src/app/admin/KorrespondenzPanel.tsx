"use client";

// Per-customer "Korrespondenz" panel for the Kunden tab (the in-admin email
// client, docs/EMAIL_SUBSYSTEM_SPIKE.md §5). Anchored INSIDE the customer detail
// — NOT a global inbox.
//
//   - Thread view: this customer's email_messages (sent + received interleaved),
//     grouped by thread, newest thread first; direction shown via a badge.
//   - Read is cheap: the list is metadata + snippet only (no body shipped). The
//     full body/attachments are fetched LAZILY (POST …/correspondence/message)
//     only when a message is expanded, via provider_email_id when needed.
//   - Compose / reply: a textarea + send that calls the existing sendEmail()
//     choke-point (POST …/correspondence/send). A reply threads onto the message
//     it answers; the Reply-To is our inbound address so the next reply threads
//     back. The mirror-write logs the sent row — a router.refresh() re-reads it.
//
// Presentation only: bodies render through the sanitized Markdown renderer; no
// raw HTML is ever injected.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, MailOpen, Paperclip, Reply, Send, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Markdown,
  Textarea,
  toast,
} from "./ui";

export interface CorrespondenceMessageProps {
  id: number;
  direction: "sent" | "received";
  messageId: string | null;
  threadId: string | null;
  subject: string | null;
  fromAddress: string;
  toAddress: string;
  snippet: string | null;
  attachmentCount: number;
  hasBody: boolean;
  providerEmailId: string | null;
  marketingSendId: number | null;
  occurredAt: string | null;
}

interface FetchedBody {
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: Array<{ filename: string | null; content_type: string | null; size: number | null }>;
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

/** Normalised grouping key (mirrors email-inbound-core.threadKey, inlined here so
 * this client component doesn't pull the node:crypto-importing server core into
 * the browser bundle): strip angle brackets + lower-case so a sent `<id>` and
 * its received reply `id` collapse into one conversation. */
function threadKey(id: string | null): string {
  if (!id) return "";
  return id.trim().replace(/^</, "").replace(/>$/, "").trim().toLowerCase();
}

/** Group the flat, oldest-first message list into threads keyed by the
 * normalised thread id (so a sent `<id>` and its received reply `id` collapse
 * into one conversation). Threads are sorted newest-activity first. */
function groupThreads(messages: CorrespondenceMessageProps[]) {
  const map = new Map<string, CorrespondenceMessageProps[]>();
  for (const m of messages) {
    const key = threadKey(m.threadId) || threadKey(m.messageId) || `id:${m.id}`;
    const list = map.get(key);
    if (list) list.push(m);
    else map.set(key, [m]);
  }
  const threads = Array.from(map.entries()).map(([key, list]) => {
    // Oldest-first within the thread (the input is already ordered, but be safe).
    const ordered = [...list].sort((a, b) => cmpTime(a.occurredAt, b.occurredAt) || a.id - b.id);
    return { key, messages: ordered, latest: ordered[ordered.length - 1] };
  });
  threads.sort((a, b) => cmpTime(b.latest.occurredAt, a.latest.occurredAt) || b.latest.id - a.latest.id);
  return threads;
}

function cmpTime(a: string | null, b: string | null): number {
  const ta = a ? new Date(a).getTime() : 0;
  const tb = b ? new Date(b).getTime() : 0;
  return ta - tb;
}

export function KorrespondenzPanel({
  customerId,
  customerEmail,
  messages,
}: {
  customerId: number;
  customerEmail: string;
  messages: CorrespondenceMessageProps[];
}) {
  // Compose form is collapsed by default; a reply opens it pre-targeted at a
  // message. `replyTo` null = a fresh thread (compose), a number = reply.
  const [composing, setComposing] = useState(false);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const threads = groupThreads(messages);

  function openCompose() {
    setReplyTo(null);
    setComposing(true);
  }
  function openReply(messageId: number) {
    setReplyTo(messageId);
    setComposing(true);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {messages.length === 0
            ? "Noch keine E-Mails mit diesem Kunden."
            : `${messages.length} Nachricht(en) in ${threads.length} Thread(s).`}
        </span>
        <Button size="sm" onClick={openCompose} disabled={composing && replyTo === null}>
          <Mail /> Neue E-Mail
        </Button>
      </div>

      {composing && (
        <Composer
          customerId={customerId}
          customerEmail={customerEmail}
          inReplyToMessageId={replyTo}
          replyContext={
            replyTo != null ? messages.find((m) => m.id === replyTo) ?? null : null
          }
          onClose={() => setComposing(false)}
        />
      )}

      {threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <em>
            Sobald du eine E-Mail schreibst oder der Kunde antwortet, erscheint hier der
            Verlauf.
          </em>
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {threads.map((t) => (
            <ThreadCard
              key={t.key}
              messages={t.messages}
              onReply={() => openReply(t.latest.id)}
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
  messages: CorrespondenceMessageProps[];
  onReply: () => void;
}) {
  const subject = messages.find((m) => m.subject)?.subject ?? "(kein Betreff)";
  return (
    <Card className="bg-muted/30 p-3 shadow-none">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm font-semibold">{subject}</div>
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

function MessageRow({ message }: { message: CorrespondenceMessageProps }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<FetchedBody | null>(null);
  const [loading, setLoading] = useState(false);
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
      const res = await fetch("/api/admin/correspondence/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: message.id }),
      });
      const json = (await res.json().catch(() => ({}))) as FetchedBody & {
        error?: { message?: string };
      };
      if (!res.ok) {
        throw new Error(
          (json as { error?: { message?: string } })?.error?.message ?? `Fehler (${res.status})`
        );
      }
      setBody({
        bodyText: json.bodyText ?? null,
        bodyHtml: json.bodyHtml ?? null,
        attachments: json.attachments ?? [],
      });
    } catch (e) {
      reportError(e);
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
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <Badge variant={isReceived ? "accent" : "secondary"}>
          {isReceived ? (
            <>
              <MailOpen className="size-3" /> Eingegangen
            </>
          ) : (
            <>
              <Send className="size-3" /> Gesendet
            </>
          )}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {message.snippet || <em>(kein Vorschautext)</em>}
        </span>
        {message.attachmentCount > 0 && (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
            <Paperclip className="size-3" /> {message.attachmentCount}
          </span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {fmtDateTime(message.occurredAt)}
        </span>
        <span className="shrink-0 text-muted-foreground">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-border px-2.5 py-2">
          <div className="mb-1.5 text-[11px] text-muted-foreground">
            Von {message.fromAddress || "—"} · An {message.toAddress || "—"}
            {message.marketingSendId != null ? " · Marketing-Versand" : ""}
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Lade Inhalt…</p>
          ) : (
            <MessageBody body={body} />
          )}
        </div>
      )}
    </li>
  );
}

/** Render a fetched body through the sanitized Markdown renderer. Prefer the
 * plain text; if only HTML exists, strip tags to text (the Markdown renderer is
 * markdown-only by design — it never injects raw HTML). */
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
        <Markdown content={text} className="rounded-md bg-muted/40 p-2.5" />
      ) : (
        <p className="text-sm text-muted-foreground"><em>Kein Textinhalt.</em></p>
      )}
      {body.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {body.attachments.map((a, i) => (
            <Badge key={i} variant="secondary">
              <Paperclip className="size-3" /> {a.filename || "Anhang"}
            </Badge>
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
  replyContext: CorrespondenceMessageProps | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const isReply = inReplyToMessageId != null;
  const [subject, setSubject] = useState(
    isReply ? prefixRe(replyContext?.subject ?? "") : ""
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSend() {
    if (!text.trim()) {
      toast({ variant: "warning", title: "Leerer Text", description: "Bitte einen Nachrichtentext eingeben." });
      return;
    }
    if (!confirm(`E-Mail an ${customerEmail} senden?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/correspondence/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          subject: subject.trim() || undefined,
          body: text,
          inReplyToMessageId: inReplyToMessageId ?? undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
      }
      toast({ variant: "success", title: "E-Mail gesendet", description: customerEmail });
      onClose();
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-3 border-accent/40 p-3 shadow-none">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          {isReply ? "Antwort an " : "Neue E-Mail an "}
          {customerEmail}
        </span>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} disabled={busy} aria-label="Schließen">
          <X />
        </Button>
      </div>

      <Label htmlFor={`corr-subject-${customerId}`} className="mb-1 block text-muted-foreground">
        Betreff
      </Label>
      <Input
        id={`corr-subject-${customerId}`}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        disabled={busy}
        placeholder={isReply ? "Re: …" : "Betreff der E-Mail"}
      />

      <Label htmlFor={`corr-body-${customerId}`} className="mb-1 mt-3 block text-muted-foreground">
        Nachricht
      </Label>
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
      <p className="mt-1 text-[11px] text-muted-foreground">
        Wird über den zentralen Versandweg gesendet (Absender:{" "}
        <code className="rounded bg-muted px-1">motion sports</code>). Antworten des Kunden
        landen wieder hier im Verlauf.
      </p>

      <div className="mt-3 flex gap-2">
        <Button onClick={onSend} disabled={busy}>
          <Send /> {busy ? "Sende…" : "Senden"}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Abbrechen
        </Button>
      </div>
    </Card>
  );
}

function prefixRe(subject: string): string {
  const s = subject.trim();
  if (!s) return "";
  return /^\s*(re|aw)\s*(\[\d+\])?\s*:/i.test(s) ? s : `Re: ${s}`;
}
