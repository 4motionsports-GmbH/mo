"use client";

// Marketing — the one consent (OptOutControl), the Einzelansprache (a 1:1
// campaign mail: note → draft → review on the campaign desk, the same audited
// send path as every campaign) and the person's campaign history. A personal
// mail started on the former Marketing path stays editable here until it is
// sent or deleted. Without consent every advertising action is blocked — the
// server gates enforce it; this is presentation only.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Megaphone, RotateCcw, Save, Send, Sparkles, Trash2 } from "lucide-react";
import type { CustomerDetail, CustomerDetailMarketingSend } from "@/lib/customer-detail";
import {
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_PERCENT_MAX,
  clampDiscountPercent,
} from "@/lib/discount-validation.mjs";
import { DEFAULT_EMAIL_TEXT_MODE, EMAIL_TEXT_MODE_HINTS } from "@/lib/email-text-mode.mjs";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import {
  Button,
  buttonVariants,
  Callout,
  Disclosure,
  Field,
  InfoTip,
  Input,
  Markdown,
  StatusBadge,
  Textarea,
  Tooltip,
  toast,
  useConfirm,
} from "../../ui";
import { adminFetch, errorMessage } from "../../lib/admin-fetch";
import { EmailPreviewButton } from "../../EmailPreviewButton";
import { EmailTextModeToggle, type EmailTextModeValue } from "../../EmailTextModeToggle";
import { HeroImagePanel } from "../../HeroImagePanel";
import { BundleComposer } from "../BundleComposer";
import { useCustomerActions } from "../CustomerDetail";
import { OptOutControl } from "./OptOutControl";

const BLOCKED_NOTE: Record<string, string> = {
  not_subscribed: "Keine Einwilligung für E-Mail-Werbung — keine Einzelansprache, keine Kampagne. Erreichbar nur, wenn die Person sich im Shop oder bei Mo anmeldet.",
  pending: "Die Anmeldung ist noch nicht bestätigt (Double-Opt-in) — bis dahin keine Werbe-Mail.",
  unsubscribed: "Abgemeldet — es wird keine Werbe-Mail mehr erstellt oder gesendet.",
};

const PARTICIPATION_STATUS: Record<string, string> = {
  pending: "Offen",
  drafted: "Entwurf bereit",
  sending: "Wird gesendet",
  sent: "Gesendet",
  skipped: "Übersprungen",
  suppressed: "Gesperrt",
  excluded: "Nicht mehr in der Zielgruppe",
  draft_failed: "Entwurf fehlgeschlagen",
};

export function MarketingTab({ customer }: { customer: CustomerDetail }) {
  const blockNote = customer.consent.blockReason
    ? "Die Adresse ist gesperrt (Bounce, Beschwerde oder Löschung) — keine Werbe-Mail."
    : BLOCKED_NOTE[customer.consent.state];
  const legacyOpen = customer.marketingSend != null && customer.marketingSend.status !== "sent";
  return (
    <div className="flex flex-col gap-5">
      <OptOutControl customer={customer} />
      {customer.consent.sendable ? <Einzelansprache customer={customer} /> : blockNote && <Callout tone="info">{blockNote}</Callout>}
      <Participation customer={customer} />
      {legacyOpen && customer.consent.sendable && (
        <Disclosure title="Persönliche E-Mail (bisheriger Weg) — offener Entwurf">
          <LegacyMarketingMail customer={customer} />
        </Disclosure>
      )}
    </div>
  );
}

function Einzelansprache({ customer }: { customer: CustomerDetail }) {
  const router = useRouter();
  const { refresh } = useCustomerActions();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const open = customer.campaigns.find(
    (p) => p.campaignKind === "einzel" && ["pending", "drafted", "draft_failed", "sending"].includes(p.status)
  );
  const deskHref = (contactId: number) => adminTabHref("kampagne", { campaign: "einzelansprache", contact: String(contactId) });

  async function prepare() {
    setBusy(true);
    try {
      const json = await adminFetch<{ contactId: number; drafted: boolean }>("/api/admin/campaigns/add-recipient", {
        body: { customerId: customer.id, adminNote: note.trim() || null, draft: true },
      });
      toast({
        variant: "success",
        title: json.drafted ? "Entwurf bereit" : "In der Einzelansprache",
        description: json.drafted ? "Weiter im Prüftisch." : "Der Entwurf kann im Prüftisch erstellt werden.",
      });
      refresh();
      router.push(deskHref(json.contactId));
    } catch (e) {
      toast({ variant: "error", title: "Einzelansprache nicht möglich", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        Einzelansprache
        <InfoTip>
          Eine persönliche Mail nur an diese Person — mit Profil, Käufen und Gesprächen, auf Wunsch mit
          Rabatt oder Set. Der Entwurf landet im Prüftisch der Kampagne „Einzelansprache“ und geht
          erst nach deiner Prüfung raus (gleiche Prüfungen und Sperren wie jede Kampagne).
        </InfoTip>
      </div>
      {open ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{PARTICIPATION_STATUS[open.status] ?? open.status}</span>
          <Link href={deskHref(open.contactId)} className={buttonVariants({ size: "sm", variant: "outline" })}>
            <ExternalLink /> Im Prüftisch öffnen
          </Link>
        </div>
      ) : (
        <>
          <Textarea
            aria-label="Hinweis für die KI"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1500}
            className="min-h-0 resize-y bg-card"
            placeholder="Optional: worum soll es gehen? z. B. „Nachfrage zum Rack, Zubehör für Klimmzüge anbieten“"
          />
          <div>
            <Button size="sm" onClick={() => void prepare()} loading={busy}>
              <Sparkles /> Einzelansprache vorbereiten
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function Participation({ customer }: { customer: CustomerDetail }) {
  if (customer.campaigns.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Megaphone className="size-3.5" aria-hidden /> Noch in keiner Kampagne.
      </p>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <div className="text-sm font-semibold">Kampagnen</div>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {customer.campaigns.map((p) => (
          <li key={p.contactId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <span className="font-medium">{p.campaignName}</span>
            <StatusBadge tone={p.status === "sent" ? "success" : p.status === "drafted" ? "info" : "neutral"}>
              {PARTICIPATION_STATUS[p.status] ?? p.status}
            </StatusBadge>
            {p.sentAt && <span className="text-xs text-muted-foreground">{formatAdmin(p.sentAt, ADMIN_DATE)}</span>}
            {p.subject && <span className="min-w-0 truncate text-xs text-muted-foreground">„{p.subject}“</span>}
            {p.clickedAt && <StatusBadge tone="accent">geklickt</StatusBadge>}
            {p.unsubscribedAt && <StatusBadge tone="destructive">danach abgemeldet</StatusBadge>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LegacyMarketingMail({ customer }: { customer: CustomerDetail }) {
  const { refresh } = useCustomerActions();
  const { confirm, confirmDialog } = useConfirm();
  const [send, setSend] = React.useState<CustomerDetailMarketingSend | null>(
    customer.marketingSend
  );
  // Special instructions: prefer the snapshot of an OPEN draft (so the editor
  // shows what the visible text was generated with), then the saved value.
  const [instructions, setInstructions] = React.useState<string>(
    (customer.marketingSend && customer.marketingSend.status !== "sent"
      ? customer.marketingSend.adminInstructions
      : null) ??
      customer.adminInstructions ??
      ""
  );
  const isSent = send?.status === "sent";
  const hasDraft = Boolean(send) && !isSent;

  const [subject, setSubject] = React.useState(hasDraft ? (send?.subject ?? "") : "");
  const [body, setBody] = React.useState(hasDraft ? (send?.draftedText ?? "") : "");
  const [discountPercent, setDiscountPercent] = React.useState<number>(
    hasDraft ? (send?.discountPercent ?? 0) : 0
  );
  const [textMode, setTextMode] = React.useState<EmailTextModeValue>(
    hasDraft
      ? ((send?.textMode ?? "detailed") as EmailTextModeValue)
      : (DEFAULT_EMAIL_TEXT_MODE as EmailTextModeValue)
  );
  const [busy, setBusy] = React.useState<null | "draft" | "save" | "send" | "delete">(null);

  // Depth, instructions or text mode changed vs. the open draft ⇒ the visible
  // text was generated with other inputs — force a re-generate before sending.
  const needsRegenerate =
    hasDraft &&
    send != null &&
    (discountPercent !== send.discountPercent ||
      instructions.trim() !== (send.adminInstructions ?? "") ||
      textMode !== (send.textMode ?? "detailed"));

  const fail = (e: unknown) =>
    toast({ variant: "error", title: "Fehler", description: errorMessage(e) });

  async function onGenerate() {
    setBusy("draft");
    try {
      const json = await adminFetch<{ send?: CustomerDetailMarketingSend }>(
        "/api/admin/customers/marketing-draft",
        {
          body: {
            customerId: customer.id,
            discountPercent,
            adminInstructions: instructions.trim() || null,
            textMode,
            // Overwrite an existing open draft; after a SENT mail this creates a
            // fresh one (the sent row stays as immutable history).
            regenerate: hasDraft,
          },
        }
      );
      if (json.send) {
        setSend(json.send);
        setSubject(json.send.subject ?? "");
        setBody(json.send.draftedText ?? "");
        setDiscountPercent(json.send.discountPercent ?? 0);
        setInstructions(json.send.adminInstructions ?? "");
        setTextMode((json.send.textMode ?? "detailed") as EmailTextModeValue);
      }
      toast({ variant: "success", title: "Entwurf generiert", description: customer.email });
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    if (!send) return;
    setBusy("save");
    try {
      await adminFetch("/api/admin/marketing/update", { body: { sendId: send.id, subject, body } });
      toast({ variant: "success", title: "Entwurf gespeichert" });
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!send) return;
    const ok = await confirm({
      title: "Entwurf löschen?",
      description: "Der Entwurf kann nicht wiederhergestellt werden.",
      confirmLabel: "Löschen",
      tone: "destructive",
    });
    if (!ok) return;
    setBusy("delete");
    try {
      await adminFetch("/api/admin/marketing/delete", { body: { sendId: send.id } });
      setSend(null);
      setSubject("");
      setBody("");
      setDiscountPercent(0);
      toast({ variant: "success", title: "Entwurf gelöscht", description: customer.email });
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function onSend() {
    if (!send) return;
    if (needsRegenerate) {
      toast({
        variant: "warning",
        title: "Rabatt, Textmodus oder Hinweise geändert",
        description: "Bitte zuerst neu generieren, damit Text und Eingaben übereinstimmen.",
      });
      return;
    }
    const ok = await confirm({
      title: `E-Mail an ${customer.email} senden?`,
      description: (
        <span>
          Betreff: <strong className="text-foreground">{subject || "—"}</strong>
          {discountPercent > 0 ? (
            <>
              {" "}
              · Rabatt {discountPercent} % (einmaliger Code wird beim Senden erzeugt)
            </>
          ) : (
            " · ohne Rabatt"
          )}
        </span>
      ),
      confirmLabel: "Jetzt senden",
    });
    if (!ok) return;
    setBusy("send");
    try {
      // Persist any unsaved edits first so the sent mail matches the textarea.
      await adminFetch("/api/admin/marketing/update", { body: { sendId: send.id, subject, body } });
      await adminFetch("/api/admin/marketing/send", { body: { sendId: send.id } });
      setSend({
        ...send,
        status: "sent",
        subject,
        draftedText: body,
        sentAt: new Date().toISOString(),
      });
      toast({ variant: "success", title: "E-Mail gesendet", description: customer.email });
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;
  const id = (name: string) => `ms-customer-${name}-${customer.id}`;

  return (
    <div className="flex flex-col gap-4">
      {confirmDialog}

      {isSent && send && (
        <Callout tone="success" title={`Gesendet am ${formatAdmin(send.sentAt, ADMIN_DATE)}`}>
          <div className="text-xs">
            Betreff: <strong className="text-foreground">{send.subject || "—"}</strong>
            {send.discountPercent > 0 && (
              <>
                {" "}
                · Rabatt {send.discountPercent} %
                {send.discountCode && (
                  <>
                    {" "}
                    · Code <code>{send.discountCode}</code>
                  </>
                )}
              </>
            )}
          </div>
          <Disclosure title="Gesendeten Text anzeigen" framed={false} className="mt-1">
            <Markdown content={send.draftedText} className="rounded-lg bg-card p-3" />
          </Disclosure>
        </Callout>
      )}

      {/* Settings for the next generation. */}
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Field
            label="Besondere Hinweise (optional)"
            info="Wird der KI als Team-Anweisung mitgegeben (klar getrennt von den Kundendaten) und am Entwurf gespeichert (Audit-Trail)."
          >
            <Textarea
              id={id("instructions")}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              maxLength={2000}
              disabled={disabled}
              className="min-h-0 resize-y bg-card"
              placeholder='z. B. „Erwähne die neue Rudergeräte-Linie“, „Bundle anbieten“'
            />
          </Field>
          <Field
            label="Rabatt (%)"
            info={`0 = kein Rabatt, kein Code. ${DISCOUNT_PERCENT_MIN}–${DISCOUNT_PERCENT_MAX} % erzeugt beim Versand einen einmaligen, 7 Tage gültigen Code.`}
          >
            <Input
              id={id("discount")}
              type="number"
              inputMode="numeric"
              min={DISCOUNT_PERCENT_MIN}
              max={DISCOUNT_PERCENT_MAX}
              step={1}
              value={discountPercent}
              disabled={disabled}
              onChange={(e) => setDiscountPercent(clampDiscountPercent(e.target.valueAsNumber))}
              className="w-24"
            />
          </Field>
          <Field label="Textmodus" info={EMAIL_TEXT_MODE_HINTS[textMode]} htmlFor={id("textmode")}>
            <div id={id("textmode")} className="flex h-9 items-center">
              <EmailTextModeToggle value={textMode} disabled={disabled} onSelect={setTextMode} />
            </div>
          </Field>
        </div>
      </div>

      {hasDraft && send ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info" size="md">
              Entwurf — noch nicht gesendet
            </StatusBadge>
            {!needsRegenerate && (
              <span className="text-xs text-muted-foreground">
                {discountPercent > 0
                  ? `Platzhalter-Code MO-XXXX bitte nicht ändern — er wird beim Versand durch den echten ${discountPercent}%-Code ersetzt.`
                  : "Ohne Rabatt: kein Code im Text, kein Rabatt im Warenkorb-Link."}
              </span>
            )}
          </div>

          {needsRegenerate && (
            <Callout
              tone="warning"
              compact
              action={
                <Button variant="secondary" size="sm" onClick={onGenerate} loading={busy === "draft"} disabled={disabled}>
                  <RotateCcw /> Neu generieren
                </Button>
              }
            >
              Rabatt, Textmodus oder Hinweise geändert — der aktuelle Text passt nicht mehr.
            </Callout>
          )}

          <Field label="Betreff">
            <Input id={id("subject")} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={disabled} />
          </Field>
          <Field
            label="E-Mail-Text"
            info={`Beim Versand werden Warenkorb-Button und Abmeldelink automatisch angehängt${
              discountPercent > 0 ? " und der einmalige Rabattcode erzeugt" : ""
            }. Gesendet wird nur an bestätigte, nicht abgemeldete Adressen.`}
          >
            <Textarea
              id={id("body")}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              disabled={disabled}
              className="resize-y"
            />
          </Field>

          <HeroImagePanel key={`hero-${send.id}`} kind="marketing" targetId={send.id} disabled={disabled} />

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button variant="secondary" onClick={onSave} loading={busy === "save"} disabled={disabled}>
              <Save /> Speichern
            </Button>
            <EmailPreviewButton
              path="/api/admin/marketing/email-preview"
              getPayload={() => ({ sendId: send.id, subject, body })}
              title={`Vorschau — ${customer.email}`}
              description={
                "So wird die E-Mail im Postfach gerendert (inkl. Produktbilder, Bundle und Footer). " +
                (discountPercent > 0
                  ? "Der Rabatt zeigt den Platzhalter-Code MO-XXXX — der echte Code und der getrackte Warenkorb-Link entstehen erst beim Senden."
                  : "Der getrackte Warenkorb-Link entsteht erst beim Senden.")
              }
              disabled={disabled}
            />
            <Tooltip content="Bitte zuerst neu generieren" disabled={!needsRegenerate}>
              <span className="inline-flex">
                <Button onClick={onSend} loading={busy === "send"} disabled={disabled || needsRegenerate}>
                  <Send /> Freigeben &amp; senden
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="ghost"
              className="ml-auto text-destructive hover:text-destructive"
              onClick={onDelete}
              loading={busy === "delete"}
              disabled={disabled}
            >
              <Trash2 /> Entwurf löschen
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onGenerate} loading={busy === "draft"} disabled={disabled}>
            <Sparkles />{" "}
            {isSent ? "Neue personalisierte E-Mail generieren" : "Personalisierte E-Mail generieren"}
          </Button>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Nutzt alle Gespräche, das Kundenverständnis und die Kaufhistorie.
            <InfoTip>
              Der Entwurf nutzt ALLES zu diesem Kunden: alle verknüpften Gespräche, das aktuelle
              Kundenverständnis und die Kaufhistorie (bereits Gekauftes wird nicht erneut
              empfohlen). Ein KI-Durchlauf — kostet Tokens.
            </InfoTip>
          </span>
        </div>
      )}

      <BundleComposer
        customerId={customer.id}
        customerEmail={customer.email}
        sendId={send && send.status !== "sent" ? send.id : null}
        initialBundles={customer.bundles}
      />
    </div>
  );
}
