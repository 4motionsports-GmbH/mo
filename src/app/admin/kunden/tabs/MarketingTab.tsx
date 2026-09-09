"use client";

// Marketing — the per-customer personalised email: settings (Hinweise, Rabatt,
// Textmodus) → generate → edit → preview → approve & send. Editing and sending
// reuse the marketing endpoints, so the send path (eligibility, unsubscribe,
// mint-at-send, tracking, logging) is the same single audited pipeline. All
// gating is server-side; this is presentation only. The bundle composer
// ("Set-Angebot") lives in a collapsible section below the settings.

import * as React from "react";
import { RotateCcw, Save, Send, Sparkles, Trash2 } from "lucide-react";
import type { CustomerDetail, CustomerDetailMarketingSend } from "@/lib/customer-detail";
import {
  DISCOUNT_PERCENT_MIN,
  DISCOUNT_PERCENT_MAX,
  clampDiscountPercent,
} from "@/lib/discount-validation.mjs";
import { DEFAULT_EMAIL_TEXT_MODE, EMAIL_TEXT_MODE_HINTS } from "@/lib/email-text-mode.mjs";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import {
  Button,
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

const BLOCKED_NOTE: Record<Exclude<CustomerDetail["marketingStatus"], "confirmed">, string> = {
  none: "Keine Marketing-Einwilligung — es kann keine Marketing-E-Mail generiert werden.",
  pending: "Double-Opt-In noch nicht bestätigt — bis dahin keine Marketing-E-Mail.",
  unsubscribed: "Abgemeldet — es wird keine Marketing-E-Mail mehr generiert oder gesendet.",
};

export function MarketingTab({ customer }: { customer: CustomerDetail }) {
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

  if (customer.marketingStatus !== "confirmed") {
    return <Callout tone="info">{BLOCKED_NOTE[customer.marketingStatus]}</Callout>;
  }

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
